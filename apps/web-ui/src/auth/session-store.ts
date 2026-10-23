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

import {
  DEFAULT_LOCALE,
  matchSupportedLocale,
  resolveDisplayLocale,
  type GrantedPermission,
  type SessionUser,
  type SupportedLocale,
} from '@nebulahome/contracts';

import {
  completeSetup,
  fetchSession,
  fetchSetupStatus,
  signIn,
  signOut,
  submitSecondFactor,
} from '@/auth/api';
import { readRefreshToken, writeRefreshToken } from '@/auth/token-storage';
import { applyLanguage, readLanguageHint } from '@/i18n/language';
import { translate } from '@/i18n/messages';
import { connectSession, refreshAccessToken } from '@/lib/api-client';
import { isApiUnreachable } from '@/lib/api-error';
import { forgetListStates } from '@/lib/use-list-state';

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

  /**
   * Whether the opening decision is being held up by an API that has not answered yet.
   *
   * True while `initialise` is retrying, so the intro screen can say why it is still spinning:
   * a mark that turns for forty seconds with no explanation reads as a hang, where the same
   * forty seconds with "waiting for Nebula" under it reads as what it is.
   */
  readonly isWaitingForApi: boolean;

  /** The house language, as the server last said it: what the sign-in screen speaks. */
  readonly houseLocale: SupportedLocale;

  /**
   * The language the interface speaks to whoever is in front of it: a signed-in person's own
   * choice, else the house's; on the first run, the one picked for the house.
   */
  readonly language: SupportedLocale;

  /** Works out which screen the application should open on. */
  readonly initialise: () => Promise<void>;

  /** Signs in with a password. Resolves to whether a second factor is still needed. */
  readonly signInWithPassword: (username: string, password: string) => Promise<boolean>;

  /** Completes an outstanding two-factor challenge. */
  readonly submitCode: (code: string) => Promise<void>;

  /** Creates the first owner and signs them in. */
  readonly createFirstOwner: (request: Parameters<typeof completeSetup>[0]) => Promise<void>;

  /** Re-reads the signed-in account, after something about it has changed. */
  readonly refreshUser: () => Promise<void>;

  /** On the first run, speaks the language picked for the house before the house exists. */
  readonly chooseSetupLanguage: (locale: SupportedLocale) => void;

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

/** The shortest wait between two attempts to reach the API, and the longest it grows to. */
const RETRY_DELAY_MS = { first: 1000, longest: 10_000 } as const;

/**
 * How long to wait before asking the API again.
 *
 * Doubles from a second to ten, and stays there. Fast enough that the page comes alive within a
 * moment of the service, slow enough that a hundred wall tablets waiting on a restart are not
 * a hundred requests a second against something that is trying to come up.
 *
 * @param attempt - How many attempts have failed, counting from one.
 * @returns The wait, in milliseconds.
 */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_DELAY_MS.first * 2 ** (attempt - 1), RETRY_DELAY_MS.longest);
}

/**
 * Waits.
 *
 * @param ms - For how long.
 * @returns A promise that settles afterwards.
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** What one attempt at the opening decision concluded. */
type DecisionOutcome =
  /** The status has been set; nothing more to do. */
  | 'decided'

  /** Nothing could be asked, because the API was not there to ask. Try again later. */
  | 'unreachable';

/** The part of the store one attempt is allowed to write. */
type DecisionSetter = (
  partial: Partial<
    Pick<
      SessionState,
      'status' | 'user' | 'accessToken' | 'challengeId' | 'houseLocale' | 'language'
    >
  >,
) => void;

/**
 * The languages a signed-in person brings with them.
 *
 * @param user - Who signed in.
 * @returns The house language, and the one they read.
 */
function languagesOf(user: SessionUser): Pick<SessionState, 'houseLocale' | 'language'> {
  return {
    houseLocale: user.houseLocale,
    language: resolveDisplayLocale(user.locale, user.houseLocale),
  };
}

/**
 * The language a first run opens in: the browser's when the interface speaks it, else English.
 * The person may pick another before the house exists, and the one they finish in is the house's.
 *
 * @returns The language.
 */
function browserLocale(): SupportedLocale {
  return matchSupportedLocale(globalThis.navigator.languages) ?? DEFAULT_LOCALE;
}

/**
 * Makes the opening decision once.
 *
 * Three outcomes, in the order they are cheapest to establish: there is a refresh token and it
 * still works, so the session is restored; there is not, and the installation has no accounts,
 * so setup is shown; otherwise the sign-in form is. A fourth - the API never answered - is not a
 * decision and is handed back as such rather than turned into one.
 *
 * Every branch is inside a `try`, and it has to be. The status this sets is what picks the
 * screen, so a throw that escaped would not show an error: it would leave the status at
 * `starting` with nobody to move it on.
 *
 * @param set - The store's setter.
 * @returns Whether a status was set, or whether the API has to be asked again later.
 */
async function decideOnce(set: DecisionSetter): Promise<DecisionOutcome> {
  try {
    if (readRefreshToken() !== null) {
      const accessToken = await refreshAccessToken();

      if (accessToken !== null) {
        try {
          set({ accessToken });
          const user = await fetchSession();

          set({ status: 'signed-in', user, challengeId: null, ...languagesOf(user) });

          return 'decided';
        } catch (cause: unknown) {
          if (isApiUnreachable(cause)) {
            return 'unreachable';
          }

          // The token verified but the session could not be read: the account was deleted or
          // deactivated between the two calls. Falling through signs them out cleanly.
          writeRefreshToken(null);
          set({ accessToken: null });
        }
      }
    }
  } catch (cause: unknown) {
    if (isApiUnreachable(cause)) {
      // The refresh could not even be attempted. The token is untouched - it may be perfectly
      // good - and the whole decision is made again once there is somebody to make it with.
      return 'unreachable';
    }

    // The refresh was made and something else went wrong with it. Fall through to the decision
    // an unauthenticated visitor gets.
    set({ accessToken: null });
  }

  try {
    const { isRequired, locale } = await fetchSetupStatus();

    set({
      status: isRequired ? 'setup-required' : 'signed-out',
      houseLocale: locale,
      language: isRequired ? browserLocale() : locale,
    });

    return 'decided';
  } catch (cause: unknown) {
    if (isApiUnreachable(cause)) {
      return 'unreachable';
    }

    // The API answered and the answer was a failure - a 500, a body of the wrong shape. That
    // is not going to change by asking again in a second. Showing the sign-in form is the
    // honest default: it is what the person will need once it is fixed, and the form itself
    // will report the failure.
    set({ status: 'signed-out' });

    return 'decided';
  }
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
  isWaitingForApi: false,

  // The language this browser spoke last time, until the server says which it is.
  houseLocale: readLanguageHint() ?? DEFAULT_LOCALE,
  language: readLanguageHint() ?? DEFAULT_LOCALE,

  /**
   * Works out which screen to open on.
   *
   * Three outcomes, in the order they are cheapest to establish: there is a refresh token and it
   * still works, so restore the session; there is not, and the installation has no accounts, so
   * show setup; otherwise show the sign-in form.
   */
  initialise: async (): Promise<void> => {
    // The decision is retried, not made once. Two things can stop it being made at all, and
    // both are temporary: `api` is still starting - it comes up well after Vite does, so the
    // first page load of `pnpm dev` reliably finds nobody on the port - or it is restarting.
    // Deciding "signed out" in that moment is wrong twice over: a fresh installation would be
    // shown the sign-in form instead of setup, and a valid session would be shown the sign-in
    // form instead of its dashboard. And it is a decision that never gets revisited, so the
    // page stays wrong after the API arrives until somebody reloads it. Waiting is the honest
    // answer, and the intro screen already knows how to wait.
    for (let attempt = 1; ; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- each attempt exists because the one before it found nobody to ask
      const outcome = await decideOnce(set);

      if (outcome === 'decided') {
        set({ isWaitingForApi: false });

        return;
      }

      set({ isWaitingForApi: true });

      // eslint-disable-next-line no-await-in-loop -- the wait is the retry schedule
      await delay(retryDelayMs(attempt));
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
      ...languagesOf(answer.user),
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
      throw new Error(
        translate('auth.sessionStore.thereIsNoSign', 'There is no sign-in to complete'),
      );
    }

    const answer = await submitSecondFactor(challengeId, code);

    writeRefreshToken(answer.tokens.refreshToken);
    set({
      status: 'signed-in',
      user: answer.user,
      accessToken: answer.tokens.accessToken,
      challengeId: null,
      ...languagesOf(answer.user),
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
      ...languagesOf(answer.user),
    });
  },

  /**
   * Re-reads the signed-in account.
   *
   * Called after something changes the account itself rather than a resource beside it: a
   * renamed profile, a second factor turned on, a role changed by an administrator. The rail
   * shows the display name and half the interface asks `can`, and both read from here - so a
   * change that is not read back leaves the person looking at their old name and, worse, at
   * controls they no longer have.
   *
   * A failure is swallowed. Nothing the caller did has gone wrong; the copy on screen is merely
   * a little out of date, and it will be right after the next reload.
   */
  refreshUser: async (): Promise<void> => {
    try {
      const user = await fetchSession();

      set({ user, ...languagesOf(user) });
    } catch {
      // Deliberately quiet: see above.
    }
  },

  /**
   * Speaks the language picked on the first run, before there is a house to store it on.
   *
   * @param locale - The language.
   */
  chooseSetupLanguage: (locale: SupportedLocale): void => {
    set({ language: locale });
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
      forgetListStates();

      // The sign-in screen speaks the house's language, whatever the person who left read.
      set({
        status: 'signed-out',
        user: undefined,
        accessToken: null,
        challengeId: null,
        language: get().houseLocale,
      });
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
    useSession.setState((state) => ({
      status: 'signed-out',
      user: undefined,
      accessToken: null,
      challengeId: null,
      language: state.houseLocale,
    }));
  },
});

/*
 * The interface speaks the language the session decided, from the first render: the hint now,
 * the server's answer as soon as there is one, and every change after.
 */
void applyLanguage(useSession.getState().language);

useSession.subscribe((state, previous) => {
  if (state.language !== previous.language) {
    void applyLanguage(state.language);
  }
});
