/**
 * Keeps the live channel open while somebody is signed in, and hands what it says to the store.
 *
 * Mounted once, in the signed-in shell, rather than by every page that wants live values: the
 * socket is one per browser tab by design (API.md 7), and a page that opened its own would be a
 * second authentication and a second copy of every state change.
 *
 * A device event does two things here. The lists that show devices and entities are read again,
 * because a row was just added or removed; and the socket is opened afresh, because the server
 * decided what this socket may hear when it authenticated and a device adopted since is not in
 * that decision. An `updated` device only has the device list read again: its entities are the
 * ones it had.
 *
 * A channel that comes back after a drop forgets what it had said and has the lists read again:
 * nothing replays the changes made while it was down, and a reading kept from before the drop
 * would stand over the fresh one until the entity happened to change again.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { CONTAINER_QUERY_KEYS } from '@/containers/api';
import { refreshAccessToken } from '@/lib/api-client';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { LiveClient } from '@/live/live-client';
import { useLive } from '@/live/live-store';

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
       * Hands a message to the store, and reacts to the registry changing.
       *
       * @param message - What the server sent.
       */
      onMessage: (message): void => {
        useLive.getState().apply(message);

        if (message.type === 'device_event' && message.event === 'updated') {
          // The device changed on its own - found, a new firmware - and nothing about which
          // entities there are, so the socket's decision still stands.
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
        } else if (message.type === 'device_event') {
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
          client.reconnect();
        }

        if (message.type === 'discovery_event') {
          // Only the count travels; the list is read again with the permission it takes. So are
          // the vendors: what a vendor's listener says and the devices it passed over are theirs.
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
        }

        if (message.type === 'integration_event') {
          // An account of a vendor signed in, out, or needs signing in again: its page reads
          // the vendor again, and the devices that come with an account.
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
        }

        if (message.type === 'container_event') {
          // Only the name travels: the containers pages read again, and a vendor's page shows
          // where its containers stand.
          void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
        }

        if (message.type === 'backup_event') {
          // A backup began, moved on or ended - a scheduled one too: the backups page follows it
          // at once rather than at its next poll.
          void queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.status });
          void queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.runs });
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
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.activity });
        }

        if (next === 'live') {
          hasBeenLive = true;
        }

        useLive.getState().setStatus(next);
      },
    });

    client.start();

    return (): void => {
      client.stop();
      useLive.getState().reset();
    };
  }, [status, queryClient]);
}
