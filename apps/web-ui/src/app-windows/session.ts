/**
 * The cookie the containers' pages are read with (docs: ingress, 2.2; app windows, 4.4): the API
 * copies the access token into `nebula_ingress`, which lives as long as the token, fifteen minutes.
 * A window's page makes its own requests, with no header, for as long as it is open, so the cookie
 * is laid again before a page loads unless it is fresh, and again whenever the token is renewed.
 */
import { useAppWindows } from '@/app-windows/app-windows-store';
import { useSession } from '@/auth/session-store';
import { openIngressSession } from '@/containers/api';

/** How long a cookie just laid is taken as fresh: well inside its fifteen minutes. */
const FRESH_MS = 10 * 60 * 1000;

/** When the cookie was last laid. */
let laidAt = Number.NEGATIVE_INFINITY;

/** The request laying it, while one is out: everybody who needs it waits for the same one. */
let laying: Promise<void> | undefined;

/** What lays the cookie; the gallery, which has no session, swaps it for one that does nothing. */
export const ingressSession = { open: openIngressSession };

/**
 * Lays the cookie unless it is fresh.
 *
 * @param isForced - Lay it even when it is fresh: the token has just been renewed.
 * @returns Settles once the cookie is there; fails when the API refuses it.
 */
export async function ensureIngressSession(isForced = false): Promise<void> {
  if (!isForced && Date.now() - laidAt < FRESH_MS) {
    return;
  }

  laying ??= ingressSession
    .open()
    .then(() => {
      laidAt = Date.now();
    })
    .finally(() => {
      laying = undefined;
    });

  await laying;
}

// A renewed token is laid again at once while a page is open; signed out, every window closes,
// which ends their pages and the sockets they hold.
useSession.subscribe((state, previous) => {
  if (state.accessToken === previous.accessToken) {
    return;
  }

  if (state.accessToken === null) {
    laidAt = Number.NEGATIVE_INFINITY;
    useAppWindows.getState().clear();
  } else if (useAppWindows.getState().windows.length > 0) {
    ensureIngressSession(true).catch(() => {
      // The next page load, or a reload, says so and lays it again.
    });
  }
});
