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
 * that decision.
 *
 * A channel that comes back after a drop forgets what it had said and has the lists read again:
 * nothing replays the changes made while it was down, and a reading kept from before the drop
 * would stand over the fresh one until the entity happened to change again.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSession } from '@/auth/session-store';
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

        if (message.type === 'device_event') {
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
          client.reconnect();
        }

        if (message.type === 'discovery_event') {
          // Only the count travels; the list is read again with the permission it takes.
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
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
