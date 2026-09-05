/**
 * Where the two tokens live in the browser.
 *
 * **The access token is never written to storage.** It is a bearer credential valid for fifteen
 * minutes; keeping it in memory means a reload throws it away and one is minted again from the
 * refresh token, which costs a round trip and removes it from the reach of anything that can
 * read `localStorage`.
 *
 * **The refresh token is written to `localStorage`**, and that is the weaker half of this file.
 * It is what makes a reload keep you signed in, and the API hands it back in a response body, so
 * the browser has to hold it somewhere a script can reach. The stronger arrangement is an
 * `HttpOnly; Secure; SameSite=Strict` cookie set by the API, which script cannot read at all;
 * that needs the API to set cookies, which it does not do yet. Recorded here rather than left as
 * an assumption, and noted in API.md as the change worth making.
 *
 * `sessionStorage` was the other option: safer, since it dies with the tab, but it also means
 * every new tab starts signed out, which for a wall-mounted dashboard is the wrong trade.
 */

/** The key the refresh token is filed under. */
const REFRESH_TOKEN_KEY = 'nebula.refresh-token';

/**
 * Reads the stored refresh token.
 *
 * Storage can throw rather than merely be empty - a private window, a browser configured to
 * block site data - so every access is guarded. A failure to read is the same as not being
 * signed in, which is a state the interface already handles.
 *
 * @returns The token, or null when there is none.
 */
export function readRefreshToken(): string | null {
  try {
    return globalThis.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Stores the refresh token.
 *
 * @param token - The token to keep, or null to forget it.
 */
export function writeRefreshToken(token: string | null): void {
  try {
    if (token === null) {
      globalThis.localStorage.removeItem(REFRESH_TOKEN_KEY);

      return;
    }

    globalThis.localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // A browser that refuses to store it leaves the person signed in for this tab only. That is
    // a worse experience, not a broken one, and it is not worth failing a sign-in over.
  }
}
