/**
 * Who is signed in, as one piece of client state.
 *
 * Zustand rather than TanStack Query, and the split is the one RULES.md 15.4 draws: the session
 * is not a cached copy of a server resource that can go stale and be refetched, it is the
 * client's own answer to "may I render this at all". Every route guard and the API client read
 * it, and it has to be readable outside React - which a query cache is not.
 *
 * The status is a union rather than a set of booleans. `isLoading && !isAuthenticated` and
 * `isAuthenticated && needsSecondFactor` are both states a pair of booleans can express and
 * neither means anything; a union cannot be put into them.
 */
import { create } from 'zustand';

import type { GrantedPermission, SessionUser } from '@nebula-home/contracts';

import {
  completeSetup,
  fetchSession,
  fetchSetupStatus,
  signIn,
  signOut,
  submitSecondFactor,
} from '@/auth/api';
import { readRefreshToken, writeRefreshToken } from '@/auth/token-storage';
import { connectSession, refreshAccessToken } from '@/lib/api-client';

/** Where a person is in the sign-in flow. */
export type SessionStatus =
  /** Nothing has been decided yet; the application is still working out which screen to show. */
  | 'starting'

  /** There are no accounts at all. The only thing to show is the setup form. */
  | 'setup-required'

  /** Nobody is signed in. */
  | 'signed-out'

  /** The password was right and the second factor is outstanding. */
  | 'awaiting-second-factor'

  /** Signed in. */
  | 'signed-in';

/** The session, and everything that changes it. */
export type SessionState = {
  /** Where the person is in the flow. */
  readonly status: SessionStatus;

  /** Who is signed in. Present only when the status says so. */
  readonly user: SessionUser | undefined;

  /**
   * The access token.
   *
   * Held here and nowhere else, and deliberately never written to storage - see
   * `token-storage.ts` for why.
   */
  readonly accessToken: string | null;

  /** The outstanding two-factor challenge, when there is one. */
  readonly challengeId: string | null;

  /** Works out which screen the application should open on. */
  readonly initialise: () => Promise<void>;

  /** Signs in with a password. Resolves to whether a second factor is still needed. */
  readonly signInWithPassword: (username: string, password: string) => Promise<boolean>;

  /** Completes an outstanding two-factor challenge. */
  readonly submitCode: (code: string) => Promise<void>;

  /** Creates the first owner and signs them in. */
  readonly createFirstOwner: (request: Parameters<typeof completeSetup>[0]) => Promise<void>;

  /** Signs out. */
  readonly signOut: (allSessions?: boolean) => Promise<void>;

  /** Says whether the signed-in person holds a permission. */
  readonly can: (key: string, scopes?: readonly string[]) => boolean;
};

/** The scope that means everywhere. */
const EVERYWHERE = '*';

/**
 * Decides whether a set of grants permits an action.
 *
 * The same rules the API enforces, reimplemented here for one purpose only: hiding controls a
 * person cannot use. **It is not a security boundary and must never be treated as one** - the
 * server checks every request regardless, and a bug in this function shows the wrong button
 * rather than granting anything (ARCHITECTURE.md 12.3).
 *
 * @param grants - What the person holds.
 * @param key - The permission being checked.
 * @param scopes - Every scope the target falls under.
 * @returns True when the action is permitted.
 */
export function isPermitted(
  grants: readonly GrantedPermission[],
  key: string,
  scopes: readonly string[] = [],
): boolean {
  const relevant = grants.filter((grant) => grant.key === key);

  /**
   * Says whether one grant covers the target.
   *
   * @param grant - The grant being considered.
   * @returns True when its scope is everywhere, or names a scope the target falls under.
   */
  const matches = (grant: GrantedPermission): boolean =>
    grant.scope === EVERYWHERE || scopes.includes(grant.scope);

  if (relevant.some((grant) => grant.effect === 'deny' && matches(grant))) {
    return false;
  }

  return relevant.some((grant) => grant.effect === 'allow' && matches(grant));
}

/**
 * The session store.
 *
 * A single store rather than one per concern: every field here changes together on sign-in and
 * on sign-out, and splitting them would mean two updates that a render can fall between.
 */
export const useSession = create<SessionState>((set, get) => ({
  status: 'starting',
  user: undefined,
  accessToken: null,
  challengeId: null,

  /**
   * Works out which screen to open on.
   *
   * Three outcomes, in the order they are cheapest to establish: there is a refresh token and it
   * still works, so restore the session; there is not, and the installation has no accounts, so
   * show setup; otherwise show the sign-in form.
   */
  initialise: async (): Promise<void> => {
    // Every branch below is inside a `try`, and it has to be. This runs once, before anything
    // has rendered, and the status it sets is what picks the screen - so a throw here does not
    // show an error, it leaves the status at `starting` and the person looks at a blank page
    // for as long as they are willing to. There is no state in which failing to decide is
    // better than deciding to show the sign-in form.
    try {
      if (readRefreshToken() !== null) {
        const accessToken = await refreshAccessToken();

        if (accessToken !== null) {
          try {
            set({ accessToken });
            set({ status: 'signed-in', user: await fetchSession(), challengeId: null });

            return;
          } catch {
            // The token verified but the session could not be read: the account was deleted or
            // deactivated between the two calls. Falling through signs them out cleanly.
            writeRefreshToken(null);
            set({ accessToken: null });
          }
        }
      }
    } catch {
      // The refresh itself could not be made - the API is down, or the network is. Fall through
      // to the same decision an unauthenticated visitor gets.
      set({ accessToken: null });
    }

    try {
      const { isRequired } = await fetchSetupStatus();

      set({ status: isRequired ? 'setup-required' : 'signed-out' });
    } catch {
      // The API is unreachable. Showing the sign-in form is the honest default: it is what the
      // person will need once it comes back, and the form itself will report the failure.
      set({ status: 'signed-out' });
    }
  },

  /**
   * Signs in with a password.
   *
   * @param username - What they typed.
   * @param password - What they typed.
   * @returns True when a second factor is still needed.
   */
  signInWithPassword: async (username: string, password: string): Promise<boolean> => {
    const answer = await signIn(username, password);

    if (answer.status === 'two_factor_required') {
      set({ status: 'awaiting-second-factor', challengeId: answer.challengeId });

      return true;
    }

    writeRefreshToken(answer.tokens.refreshToken);
    set({
      status: 'signed-in',
      user: answer.user,
      accessToken: answer.tokens.accessToken,
      challengeId: null,
    });

    return false;
  },

  /**
   * Completes an outstanding challenge.
   *
   * @param code - A one-time code or a recovery code.
   * @throws {Error} When there is no challenge to complete, which means the person reached this
   * screen by navigating to it rather than by signing in.
   */
  submitCode: async (code: string): Promise<void> => {
    const { challengeId } = get();

    if (challengeId === null) {
      throw new Error('There is no sign-in to complete');
    }

    const answer = await submitSecondFactor(challengeId, code);

    writeRefreshToken(answer.tokens.refreshToken);
    set({
      status: 'signed-in',
      user: answer.user,
      accessToken: answer.tokens.accessToken,
      challengeId: null,
    });
  },

  /**
   * Creates the first owner.
   *
   * @param request - The account to create.
   */
  createFirstOwner: async (request: Parameters<typeof completeSetup>[0]): Promise<void> => {
    const answer = await completeSetup(request);

    writeRefreshToken(answer.tokens.refreshToken);
    set({
      status: 'signed-in',
      user: answer.user,
      accessToken: answer.tokens.accessToken,
      challengeId: null,
    });
  },

  /**
   * Signs out.
   *
   * The local state is cleared whether or not the server call succeeds. A person who pressed
   * "sign out" on a shared machine and got a network error must not still be signed in on that
   * screen; the server-side session expires on its own.
   *
   * @param allSessions - Whether to end every session this person has.
   */
  signOut: async (allSessions = false): Promise<void> => {
    try {
      await signOut(allSessions);
    } finally {
      writeRefreshToken(null);
      set({ status: 'signed-out', user: undefined, accessToken: null, challengeId: null });
    }
  },

  /**
   * Says whether the signed-in person holds a permission.
   *
   * @param key - The permission.
   * @param scopes - Every scope the target falls under.
   * @returns True when they hold it.
   */
  can: (key: string, scopes: readonly string[] = []): boolean =>
    isPermitted(get().user?.permissions ?? [], key, scopes),
}));

/*
 * Wires the API client to the store.
 *
 * At module scope rather than in a component: the client needs a token for the very first call,
 * which may happen before anything has rendered.
 */
connectSession({
  /**
   * Reads the current access token.
   *
   * @returns The token, or null.
   */
  readAccessToken: (): string | null => useSession.getState().accessToken,

  /**
   * Records a freshly minted pair.
   *
   * @param accessToken - The new access token.
   * @param refreshToken - The new refresh token.
   */
  onRefreshed: (accessToken: string, refreshToken: string): void => {
    writeRefreshToken(refreshToken);
    useSession.setState({ accessToken });
  },

  /** Clears the session when the server says it is over. */
  onSignedOut: (): void => {
    useSession.setState({
      status: 'signed-out',
      user: undefined,
      accessToken: null,
      challengeId: null,
    });
  },
});
