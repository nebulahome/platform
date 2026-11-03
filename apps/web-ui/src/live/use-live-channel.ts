/**
 * Keeps the live channel open while somebody is signed in, and hands what it says to the store.
 *
 * Mounted once, in the signed-in shell, rather than by every page that wants live values: the
 * socket is one per browser tab by design (API.md 7), and a page that opened its own would be a
 * second authentication and a second copy of every state change.
 *
 * Every other message says that something a page lists changed, and {@link staleAfter} names the
 * lists: they are read again, a moment later and once for a burst of messages. A device added,
 * removed or described again also opens the socket afresh, because the server decided what this
 * socket may hear when it authenticated and those entities are not in that decision.
 *
 * A channel that comes back after a drop forgets what it had said and has every list it keeps
 * fresh read again: nothing replays the changes made while it was down, and a reading kept from
 * before the drop would stand over the fresh one until the entity happened to change again.
 */
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { WsServerMessage } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { CONTAINER_QUERY_KEYS } from '@/containers/api';
import { refreshAccessToken } from '@/lib/api-client';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { INTEGRATION_CATALOGUE_KEYS } from '@/library/integration-catalogue-api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { LiveClient } from '@/live/live-client';
import { useLive } from '@/live/live-store';
import { packageLive } from '@/live/package-live';
import { PACKAGE_QUERY_KEYS } from '@/packages/api';
import { fetchPlatformState, UPDATES_QUERY_KEY } from '@/settings/updates-api';
import { usePlatform } from '@/system/platform-store';

/**
 * How long stale lists wait to be read again, in milliseconds: a hub starting thirty devices says
 * so sixty times in a second, and each list is read once for all of them.
 */
const REFRESH_DELAY_MS = 200;

/** Every list the channel keeps fresh, read again when it comes back from a drop. */
export const KEPT_FRESH: readonly QueryKey[] = [
  LIBRARY_QUERY_KEYS.devices,
  LIBRARY_QUERY_KEYS.entities,
  LIBRARY_QUERY_KEYS.activity,
  LIBRARY_QUERY_KEYS.vendors,
  LIBRARY_QUERY_KEYS.discovered,
  LINK_QUERY_KEYS.found,
  LINK_QUERY_KEYS.suggestions,
  LIBRARY_QUERY_KEYS.automations,
  LIBRARY_QUERY_KEYS.automationRuns,
  LIBRARY_QUERY_KEYS.webhookCalls,
  INTEGRATION_CATALOGUE_KEYS.all,
  CONTAINER_QUERY_KEYS.all,
  PACKAGE_QUERY_KEYS.all,
  BACKUP_QUERY_KEYS.status,
  BACKUP_QUERY_KEYS.runs,
  BACKUP_QUERY_KEYS.archives,
  UPDATES_QUERY_KEY,
];

/**
 * Whether a device event changed which entities there are.
 *
 * @param message - The event.
 * @returns False for a device that changed on its own - its state, a new firmware - and kept the
 *   entities it had.
 */
function changesEntities(message: Extract<WsServerMessage, { type: 'device_event' }>): boolean {
  return message.event !== 'updated' || message.payload.described !== undefined;
}

/**
 * The lists a message from the channel makes stale.
 *
 * @param message - What the server sent.
 * @returns Their keys; none for a message that changes no list.
 */
export function staleAfter(message: WsServerMessage): readonly QueryKey[] {
  switch (message.type) {
    case 'device_event':
      // A device added or removed is offered to be linked, or no longer, and leaves the found.
      return changesEntities(message)
        ? [
            LIBRARY_QUERY_KEYS.devices,
            LIBRARY_QUERY_KEYS.entities,
            LIBRARY_QUERY_KEYS.discovered,
            LINK_QUERY_KEYS.found,
            LINK_QUERY_KEYS.suggestions,
          ]
        : [LIBRARY_QUERY_KEYS.devices];

    case 'discovery_event':
      // Only the count travels; the lists are read again with the permission they take - the
      // integrations page's and each vendor's Found tab. So are the vendors: what a vendor's
      // listener says and the devices it passed over are theirs.
      return [LIBRARY_QUERY_KEYS.discovered, LINK_QUERY_KEYS.found, LIBRARY_QUERY_KEYS.vendors];

    case 'integration_event':
      // A vendor was installed, updated or removed, or an account of it signed in, out, or needs
      // signing in again: its page, the devices that come with it, what the catalogue says of it.
      return [
        LIBRARY_QUERY_KEYS.vendors,
        LIBRARY_QUERY_KEYS.devices,
        INTEGRATION_CATALOGUE_KEYS.all,
      ];

    case 'container_event':
      // Only the name travels: the containers pages, and a vendor's page shows where its
      // containers stand.
      return [CONTAINER_QUERY_KEYS.all, LIBRARY_QUERY_KEYS.vendors];

    case 'package_event':
      // A new release is a new address to import its interface from, and a stopped one takes its
      // devices with it.
      return [
        PACKAGE_QUERY_KEYS.all,
        LIBRARY_QUERY_KEYS.devices,
        LIBRARY_QUERY_KEYS.entities,
        LIBRARY_QUERY_KEYS.vendors,
      ];

    case 'automation_event':
      // A run started or ended: the list shows its last run, the editor its runs, and a webhook
      // that started it its calls.
      return [
        LIBRARY_QUERY_KEYS.automations,
        LIBRARY_QUERY_KEYS.automationRuns,
        LIBRARY_QUERY_KEYS.webhookCalls,
      ];

    case 'backup_event':
      // A backup began, moved on or ended - a scheduled one too - and one that ended is an archive.
      return [BACKUP_QUERY_KEYS.status, BACKUP_QUERY_KEYS.runs, BACKUP_QUERY_KEYS.archives];

    case 'platform_event':
      // An update that ended or gave up without a restart: Maintenance says how at once.
      return message.payload.operation === null ? [UPDATES_QUERY_KEY] : [];

    default:
      return [];
  }
}

/**
 * Where the channel is, next to wherever the page was served from.
 *
 * @returns The socket URL.
 */
export function liveChannelUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

  return `${scheme}://${window.location.host}/api/v1/ws`;
}

/** Runs the live channel for the signed-in session. */
export function useLiveChannel(): void {
  const status = useSession((state) => state.status);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== 'signed-in') {
      return undefined;
    }

    // Whether the channel has been live before, which makes the next time it is live a return.
    let hasBeenLive = false;

    // The lists made stale and not yet read again, by key, and the timer that reads them.
    const due = new Map<string, QueryKey>();
    let pending: ReturnType<typeof setTimeout> | undefined;

    /** Has every stale list read again now. */
    const flush = (): void => {
      clearTimeout(pending);
      pending = undefined;

      for (const key of due.values()) {
        void queryClient.invalidateQueries({ queryKey: key });
      }

      due.clear();
    };

    /**
     * Has lists read again shortly, together with any others made stale meanwhile.
     *
     * @param keys - Their keys.
     */
    const refresh = (keys: readonly QueryKey[]): void => {
      for (const key of keys) {
        due.set(JSON.stringify(key), key);
      }

      if (due.size > 0 && pending === undefined) {
        pending = setTimeout(flush, REFRESH_DELAY_MS);
      }
    };

    const client = new LiveClient({
      url: liveChannelUrl(),

      /**
       * Reads the token the session holds right now.
       *
       * @returns The access token, or null once signed out.
       */
      readAccessToken: (): string | null => useSession.getState().accessToken,
      refreshAccessToken,

      /**
       * Hands a message to the store, and has what it made stale read again.
       *
       * @param message - What the server sent.
       */
      onMessage: (message): void => {
        useLive.getState().apply(message);
        packageLive.apply(message);
        refresh(staleAfter(message));

        if (message.type === 'device_event' && changesEntities(message)) {
          client.reconnect();
        }

        if (message.type === 'platform_event') {
          // Nebula Home restarts or updates: every page shows it, whoever started it.
          usePlatform.getState().follow(message.payload.operation);
        }
      },

      /**
       * Records where the channel stands.
       *
       * @param next - The standing.
       */
      onStatus: (next): void => {
        if (next === 'live' && hasBeenLive) {
          useLive.getState().forgetReadings();
          // At once: the readings just forgotten leave the older lists showing until then.
          refresh(KEPT_FRESH);
          flush();
        }

        if (next === 'live') {
          hasBeenLive = true;

          // A new socket follows nothing: the packages' topics are followed again on it.
          packageLive.attach((message) => {
            client.send(message);
          });

          // A restart or an update under way since before this page opened, or since the channel
          // dropped, is read once: its events are only told as they happen.
          void fetchPlatformState()
            .then((state) => {
              usePlatform.getState().setMachine(state.machine);

              if (state.operation !== null) {
                usePlatform.getState().follow(state.operation);
              }
            })
            .catch(() => undefined);
        } else {
          packageLive.detach();
        }

        useLive.getState().setStatus(next);
      },
    });

    client.start();

    return (): void => {
      clearTimeout(pending);
      client.stop();
      useLive.getState().reset();
      packageLive.reset();
    };
  }, [status, queryClient]);
}
