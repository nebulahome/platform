/**
 * Keeps the live channel open while somebody is signed in, and hands what it says to the store.
 *
 * Mounted once, in the signed-in shell, rather than by every page that wants live values: the
 * socket is one per browser tab by design (API.md 7), and a page that opened its own would be a
 * second authentication and a second copy of every state change.
 *
 * Every other message says that something a page lists changed, and {@link staleAfter} names the
 * lists: they are read again, a moment later and once for a burst of messages - and the lists a
 * busy house makes stale every second, the automations and the devices, at most once every few
 * seconds ({@link THROTTLED}). A device added, removed or described again also opens the socket
 * afresh, because the server decided what this socket may hear when it authenticated and those
 * entities are not in that decision. An account or a role changed takes a new token first: the
 * permissions are written into it. A device the hub removed because it was hardware already in the
 * house is also said, in a toast that leads to it.
 *
 * A channel that comes back after a drop forgets what it had said and has every list it keeps
 * fresh read again: nothing replays the changes made while it was down, and a reading kept from
 * before the drop would stand over the fresh one until the entity happened to change again. A
 * socket opened afresh on purpose, for new devices, dropped nothing: it keeps its readings and has
 * only the entities read again, for what changed in the moment between. After a restart or an
 * update it comes back as soon as the page sees Nebula Home answer, not when its back-off says
 * ({@link reconnectsNow}).
 */
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

import type {
  BrokerEventPart,
  BrokerId,
  DuplicateOf,
  LibraryKind,
  WsServerMessage,
} from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { CONTAINER_QUERY_KEYS } from '@/containers/api';
import { DASHBOARD_QUERY_KEYS } from '@/dashboard/api';
import { translate } from '@/i18n/messages';
import { refreshAccessToken } from '@/lib/api-client';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { BLUETOOTH_QUERY_KEYS } from '@/library/bluetooth-api';
import { BROKER_QUERY_KEYS } from '@/library/brokers-api';
import { INFRARED_QUERY_KEYS } from '@/library/infrared-api';
import { INTEGRATION_CATALOGUE_KEYS } from '@/library/integration-catalogue-api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { MODBUS_QUERY_KEYS } from '@/library/modbus-api';
import { SERIAL_QUERY_KEYS } from '@/library/serial-api';
import { THREAD_QUERY_KEYS } from '@/library/thread-api';
import { LiveClient, type LiveStatus } from '@/live/live-client';
import { useLive } from '@/live/live-store';
import { packageLive } from '@/live/package-live';
import { PACKAGE_QUERY_KEYS } from '@/packages/api';
import { CALENDAR_QUERY_KEYS } from '@/routes/calendar/api';
import { devicePath } from '@/routes/library/device/device-path';
import { SETTINGS_QUERY_KEYS } from '@/settings/api';
import { fetchPlatformState, UPDATES_QUERY_KEY } from '@/settings/updates-api';
import { usePlatform, type PlatformStage } from '@/system/platform-store';

/**
 * How long stale lists wait to be read again, in milliseconds: a hub starting thirty devices says
 * so sixty times in a second, and each list is read once for all of them.
 */
const REFRESH_DELAY_MS = 200;

/**
 * How long a device event waits to open the socket afresh, in milliseconds: adopting thirty
 * devices is one new socket, and one read of every list, rather than thirty.
 */
const RECONNECT_DELAY_MS = 1000;

/** How long a list in {@link THROTTLED} waits after it was read before it is read again. */
const THROTTLE_MS = 5000;

/**
 * The lists read again at most once every {@link THROTTLE_MS}, the last change of a burst
 * included: each automation's run and each device's report would otherwise read the whole list.
 */
const THROTTLED: ReadonlySet<string> = new Set([
  JSON.stringify(LIBRARY_QUERY_KEYS.automations),
  JSON.stringify(LIBRARY_QUERY_KEYS.devices),
]);

/**
 * A query a message makes stale, without the queries under its key: a list, and not the items a
 * page has open.
 */
export type ExactStale = { readonly queryKey: QueryKey; readonly exact: true };

/** What a message makes stale: a key and every query under it, or one query alone. */
export type Stale = QueryKey | ExactStale;

/**
 * The Brokers page's cards, which say how every broker stands: that list alone, because every
 * broker's own queries are under its key too.
 */
const BROKER_CARDS: ExactStale = { queryKey: BROKER_QUERY_KEYS.brokers, exact: true };

/** The lists each part of the library an owner edits is shown in. */
const LIBRARY_LISTS: Readonly<Record<LibraryKind, readonly Stale[]>> = {
  // Where the house is goes into the automation editor's sun and zone.
  areas: [
    LIBRARY_QUERY_KEYS.areas,
    LIBRARY_QUERY_KEYS.automationHouse,
    LIBRARY_QUERY_KEYS.devices,
    LIBRARY_QUERY_KEYS.entities,
  ],
  tags: [LIBRARY_QUERY_KEYS.tags, LIBRARY_QUERY_KEYS.devices, LIBRARY_QUERY_KEYS.entities],
  // An entity shown in a calendar is an occurrence of it.
  entities: [
    LIBRARY_QUERY_KEYS.entities,
    LIBRARY_QUERY_KEYS.devices,
    LIBRARY_QUERY_KEYS.tags,
    CALENDAR_QUERY_KEYS.occurrences,
  ],

  // A device linked to another, or unlinked, is offered no longer, or again; the brokers' cards
  // count the devices linked.
  devices: [
    LIBRARY_QUERY_KEYS.devices,
    LIBRARY_QUERY_KEYS.entities,
    LIBRARY_QUERY_KEYS.tags,
    LINK_QUERY_KEYS.suggestions,
    BROKER_CARDS,
  ],
  scenes: [LIBRARY_QUERY_KEYS.scenes],
  aliases: [LIBRARY_QUERY_KEYS.aliases, LIBRARY_QUERY_KEYS.entities],

  // A webhook is an automation's trigger.
  automations: [LIBRARY_QUERY_KEYS.automations, LIBRARY_QUERY_KEYS.webhooks],
  dashboards: [DASHBOARD_QUERY_KEYS.dashboards],
  calendar: [CALENDAR_QUERY_KEYS.all],
  people: [SETTINGS_QUERY_KEYS.users, SETTINGS_QUERY_KEYS.roles, DASHBOARD_QUERY_KEYS.assignees],
  // The holidays' place, the weekend and the hidden holidays are settings.
  settings: [SETTINGS_QUERY_KEYS.server, CALENDAR_QUERY_KEYS.all],
  icons: [LIBRARY_QUERY_KEYS.icons],
  backups: [BACKUP_QUERY_KEYS.locations, BACKUP_QUERY_KEYS.status],
  vendors: [LIBRARY_QUERY_KEYS.vendors, LIBRARY_QUERY_KEYS.devices],
};

/**
 * The lists each part of a broker's page is shown in, by the parts the hub names. How a broker
 * stands is also on its card.
 */
const BROKER_LISTS: {
  readonly [TBroker in BrokerId]: Readonly<Record<BrokerEventPart<TBroker>, readonly Stale[]>>;
} = {
  matter: {
    status: [BROKER_QUERY_KEYS.matterStatus, BROKER_CARDS],
    nodes: [BROKER_QUERY_KEYS.matterNodes],
    network: [BROKER_QUERY_KEYS.matterNetwork],
    networks: [BROKER_QUERY_KEYS.matterNetworks],
  },
  thread: {
    status: [THREAD_QUERY_KEYS.status, BROKER_CARDS],
    devices: [THREAD_QUERY_KEYS.devices],
    'border-routers': [THREAD_QUERY_KEYS.borderRouters],
  },
  bluetooth: {
    status: [BLUETOOTH_QUERY_KEYS.status, BROKER_CARDS],
    devices: [BLUETOOTH_QUERY_KEYS.devices],
    found: [BLUETOOTH_QUERY_KEYS.found],
    scanners: [BLUETOOTH_QUERY_KEYS.scanners],
  },
  mqtt: {
    status: [BROKER_QUERY_KEYS.mqttStatus, BROKER_CARDS],
    devices: [BROKER_QUERY_KEYS.mqttDevices],
    clients: [BROKER_QUERY_KEYS.mqttClients],
    mappings: [BROKER_QUERY_KEYS.mqttMappings],
  },
  modbus: {
    status: [MODBUS_QUERY_KEYS.status, BROKER_CARDS],
    devices: [MODBUS_QUERY_KEYS.devices],
    found: [MODBUS_QUERY_KEYS.found],
    templates: [MODBUS_QUERY_KEYS.templates],
  },
  serial: {
    status: [SERIAL_QUERY_KEYS.status, BROKER_CARDS],
    ports: [SERIAL_QUERY_KEYS.ports],
    devices: [SERIAL_QUERY_KEYS.devices],
  },
  infrared: {
    status: [INFRARED_QUERY_KEYS.status, BROKER_CARDS],
    // Each remote's own page, with its buttons, too.
    remotes: [INFRARED_QUERY_KEYS.remotes, INFRARED_QUERY_KEYS.remote],
    blasters: [INFRARED_QUERY_KEYS.blasters],
  },
};

/**
 * The lists one part of a broker's page is shown in.
 *
 * @param broker - The broker.
 * @param part - One of its parts.
 * @returns Their keys.
 */
function brokerListsOf<TBroker extends BrokerId>(
  broker: TBroker,
  part: BrokerEventPart<TBroker>,
): readonly Stale[] {
  return BROKER_LISTS[broker][part];
}

/** Every list the channel keeps fresh, read again when it comes back from a drop. */
export const KEPT_FRESH: readonly Stale[] = [
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
  ...Object.values(LIBRARY_LISTS).flat(),
  ...Object.values(BROKER_LISTS).flatMap((parts) => Object.values(parts).flat()),
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
export function staleAfter(message: WsServerMessage): readonly Stale[] {
  switch (message.type) {
    case 'device_event':
      // A device added or removed is offered to be linked, or no longer, and leaves the found.
      // The brokers' cards count their devices and how many are online: they are read again too.
      return changesEntities(message)
        ? [
            LIBRARY_QUERY_KEYS.devices,
            LIBRARY_QUERY_KEYS.entities,
            LIBRARY_QUERY_KEYS.discovered,
            LINK_QUERY_KEYS.found,
            LINK_QUERY_KEYS.suggestions,
            BROKER_CARDS,
          ]
        : [LIBRARY_QUERY_KEYS.devices, BROKER_CARDS];

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
      // A run started or ended: the list shows its last run, the editor that automation's runs,
      // and a webhook that started it its calls. The automation itself is as it was: an edit is a
      // library event.
      return [
        { queryKey: LIBRARY_QUERY_KEYS.automations, exact: true },
        [...LIBRARY_QUERY_KEYS.automationRuns, message.automationId],
        LIBRARY_QUERY_KEYS.webhookCalls,
      ];

    case 'backup_event':
      // A backup began, moved on or ended - a scheduled one too - and one that ended is an archive.
      return [BACKUP_QUERY_KEYS.status, BACKUP_QUERY_KEYS.runs, BACKUP_QUERY_KEYS.archives];

    case 'platform_event':
      // An update that ended or gave up without a restart: Maintenance says how at once.
      return message.payload.operation === null ? [UPDATES_QUERY_KEY] : [];

    case 'library_event':
      return LIBRARY_LISTS[message.kind];

    case 'broker_event':
      return brokerListsOf(message.broker, message.part);

    default:
      return [];
  }
}

/**
 * Whether the channel opens again at once rather than when its back-off says.
 *
 * Nebula Home answering again after a restart or an update is the moment it can: by then the
 * back-off may have grown to ten seconds. Once, as the page sees it come back, and only while the
 * channel waits - a socket already opening would be thrown away.
 *
 * @param stage - Where the page has seen the operation get to.
 * @param before - Where it had got to before.
 * @param status - Where the channel stands.
 * @returns True to open it now.
 */
export function reconnectsNow(
  stage: PlatformStage | undefined,
  before: PlatformStage | undefined,
  status: LiveStatus,
): boolean {
  return stage === 'back' && before !== 'back' && status === 'offline';
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
  const navigate = useNavigate();

  // The latest navigate, read when a toast's action is chosen: it changes with every address, and
  // the socket must not be opened afresh for that.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (status !== 'signed-in') {
      return undefined;
    }

    /**
     * Says that a device added by hand was hardware already in the house, so the hub removed it.
     *
     * @param name - The device that was removed.
     * @param existing - The device it already was.
     */
    const sayDuplicate = (name: string, existing: DuplicateOf): void => {
      toast.warning({
        title: translate('live.duplicate.title', 'Already in the house'),
        message: translate(
          'live.duplicate.message',
          '{{name}} is already {{existing}}, so the device you just added was removed.',
          { name, existing: existing.name },
        ),
        action: {
          label: translate('live.duplicate.open', 'Open {{existing}}', { existing: existing.name }),

          /** Opens the device it already was. */
          onSelect: () => {
            void navigateRef.current(devicePath(existing.id));
          },
        },
      });
    };

    // Whether the channel has been live before, which makes the next time it is live a return.
    let hasBeenLive = false;

    // The lists made stale and not yet read again, by key; the timer that reads them and when it
    // goes off; and when each list in THROTTLED was last read again.
    const due = new Map<string, { readonly queryKey: QueryKey; readonly exact?: true }>();
    let pending: ReturnType<typeof setTimeout> | undefined;
    let pendingAt = 0;
    const readAt = new Map<string, number>();

    // The fresh socket a burst of device events asked for, until it is opened; and whether the
    // socket opening now is that one, which dropped nothing.
    let reconnectDue: ReturnType<typeof setTimeout> | undefined;
    let isRenewing = false;

    /**
     * Has every stale list read again now, but a throttled one read too recently, which waits for
     * its turn.
     *
     * @param isForced - Whether the throttled ones go now too: after a drop, nothing waits.
     */
    const flush = (isForced = false): void => {
      clearTimeout(pending);
      pending = undefined;

      const now = Date.now();
      let laterMs: number | undefined;

      for (const [id, stale] of due) {
        const waitMs =
          isForced || !THROTTLED.has(id) ? 0 : (readAt.get(id) ?? 0) + THROTTLE_MS - now;

        if (waitMs > 0) {
          laterMs = Math.min(laterMs ?? waitMs, waitMs);
          continue;
        }

        due.delete(id);
        readAt.set(id, now);
        void queryClient.invalidateQueries(stale);
      }

      if (laterMs !== undefined) {
        flushIn(laterMs);
      }
    };

    /**
     * Has the stale lists read again in a while, unless a read is already asked for sooner.
     *
     * @param delayMs - How long from now.
     */
    const flushIn = (delayMs: number): void => {
      if (pending !== undefined && pendingAt <= Date.now() + delayMs) {
        return;
      }

      clearTimeout(pending);
      pendingAt = Date.now() + delayMs;
      pending = setTimeout(() => {
        flush();
      }, delayMs);
    };

    /**
     * Has lists read again shortly, together with any others made stale meanwhile.
     *
     * @param stales - Their keys, or a list alone.
     */
    const refresh = (stales: readonly Stale[]): void => {
      for (const stale of stales) {
        const queryKey: QueryKey = 'queryKey' in stale ? stale.queryKey : stale;
        const id = JSON.stringify(queryKey);
        const wasDue = due.get(id);

        // A key already due with the queries under it stays so: that reads the list alone too.
        due.set(
          id,
          'queryKey' in stale && (wasDue === undefined || wasDue.exact === true)
            ? stale
            : { queryKey },
        );
      }

      if (due.size > 0) {
        flushIn(REFRESH_DELAY_MS);
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
          reconnectDue ??= setTimeout(() => {
            reconnectDue = undefined;
            isRenewing = true;
            client.reconnect();
          }, RECONNECT_DELAY_MS);
        }

        if (
          message.type === 'device_event' &&
          message.event === 'removed' &&
          message.payload.reason === 'duplicate' &&
          message.payload.duplicateOf !== undefined
        ) {
          sayDuplicate(message.payload.name, message.payload.duplicateOf);
        }

        if (message.type === 'platform_event') {
          // Nebula Home restarts or updates: every page shows it, whoever started it.
          usePlatform.getState().follow(message.payload.operation);
        }

        if (message.type === 'library_event' && message.kind === 'people') {
          // A role or an account changed, perhaps this one's: what it may see is written into the
          // token, so a new one is asked for, the socket opened with it, and the account read.
          void refreshAccessToken()
            .then(async (token) => {
              if (token !== null) {
                client.reconnect();
                await useSession.getState().refreshUser();
              }
            })
            .catch(() => undefined);
        }
      },

      /**
       * Records where the channel stands.
       *
       * @param next - The standing.
       */
      onStatus: (next): void => {
        if (next === 'live' && hasBeenLive && !isRenewing) {
          useLive.getState().forgetReadings();
          // At once: the readings just forgotten leave the older lists showing until then.
          refresh(KEPT_FRESH);
          flush(true);
        } else if (next === 'live') {
          // What changed between the page's first read and this subscription was never sent; nor,
          // on a socket opened afresh for new devices, what changed while it opened.
          refresh([LIBRARY_QUERY_KEYS.entities]);
        }

        // A socket opened afresh that did not get through is a drop like any other.
        if (next !== 'connecting') {
          isRenewing = false;
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

    const unwatch = usePlatform.subscribe((platform, before) => {
      if (reconnectsNow(platform.watch?.stage, before.watch?.stage, useLive.getState().status)) {
        client.reconnect();
      }
    });

    return (): void => {
      unwatch();
      clearTimeout(pending);
      clearTimeout(reconnectDue);
      client.stop();
      useLive.getState().reset();
      packageLive.reset();
    };
  }, [status, queryClient]);
}
