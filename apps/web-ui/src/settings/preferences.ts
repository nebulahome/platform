/**
 * The preferences that belong to this browser rather than to the account.
 *
 * The line between these and the server settings is not where they are convenient to keep, it is
 * whose answer they are. How dark the screen should be is a fact about the room the screen is
 * in: a wall tablet in a hallway and a laptop in a bedroom want different answers, and the same
 * person owns both. Whether telemetry is kept for a year is a fact about the installation, and
 * there is exactly one right answer to it.
 *
 * So these live in `localStorage`, and signing in somewhere else starts from the defaults again.
 * That is the cost of the choice and it is worth saying out loud in the interface, which is what
 * the note at the bottom of the Interface page is for.
 *
 * Only preferences something actually reads are here. A density switch that no layout consults
 * is a control that lies, and there are enough real ones to fill the page.
 */
import { create } from 'zustand';

/** How the interface picks its palette. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;

/** How the interface picks its palette. */
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** How much the interface moves. */
export const MOTION_CHOICES = ['system', 'full', 'reduced'] as const;

/** How much the interface moves. */
export type MotionChoice = (typeof MOTION_CHOICES)[number];

/** Where signing in leaves you. */
export const START_PAGES = [
  '/dashboards',
  '/automations',
  '/scenes',
  '/devices',
  '/aliases',
  '/packages',
] as const;

/** Where signing in leaves you. */
export type StartPage = (typeof START_PAGES)[number];

/** Everything this browser remembers. */
export type Preferences = {
  /** Which palette. `system` follows the operating system. */
  readonly theme: ThemeChoice;

  /** How much movement. `system` follows the operating system. */
  readonly motion: MotionChoice;

  /** Which page opens when you sign in. */
  readonly startPage: StartPage;
};

/** What a browser that has never been told anything uses. */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  motion: 'system',
  startPage: '/dashboards',
};

/** The key the whole set is filed under. One key, so a read is one parse and one guard. */
const STORAGE_KEY = 'nebula.preferences';

/**
 * Narrows an unknown value to one of a fixed set of choices.
 *
 * @param choices - What is allowed.
 * @param value - What was stored.
 * @param fallback - What to use when it is not one of them.
 * @returns A valid choice.
 */
function oneOf<TChoice extends string>(
  choices: readonly TChoice[],
  value: unknown,
  fallback: TChoice,
): TChoice {
  return choices.find((choice) => choice === value) ?? fallback;
}

/**
 * Reads what this browser remembers.
 *
 * Anything unreadable, unparseable or unrecognised falls back to the default for that field
 * alone. Storage that has been hand-edited, or written by an older build that had a fourth
 * theme, should cost that one preference rather than all of them.
 *
 * @returns The preferences.
 */
export function readPreferences(): Preferences {
  let stored: unknown;

  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);

    stored = raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    // A private window, a browser configured to block site data, or half a JSON document.
    return DEFAULT_PREFERENCES;
  }

  if (typeof stored !== 'object' || stored === null) {
    return DEFAULT_PREFERENCES;
  }

  const record: Record<string, unknown> = { ...stored };

  return {
    theme: oneOf(THEME_CHOICES, record['theme'], DEFAULT_PREFERENCES.theme),
    motion: oneOf(MOTION_CHOICES, record['motion'], DEFAULT_PREFERENCES.motion),
    startPage: oneOf(START_PAGES, record['startPage'], DEFAULT_PREFERENCES.startPage),
  };
}

/**
 * Stores the preferences.
 *
 * @param preferences - What to remember.
 */
function writePreferences(preferences: Preferences): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A browser that refuses to store them applies them for this tab and forgets them on
    // reload. That is a worse experience, not a broken one.
  }
}

/**
 * Puts the preferences on the root element, where the stylesheet reads them.
 *
 * `system` removes the attribute rather than setting it to a third value, because the stylesheet
 * expresses "follow the system" as the absence of a choice - `:root:not([data-theme='dark'])`
 * inside a media query. Writing `data-theme="system"` would satisfy that selector and appear to
 * work, right up until somebody adds a rule that matches on the attribute itself.
 *
 * @param preferences - What to apply.
 * @param root - The element to apply them to. Injected for the tests.
 */
export function applyPreferences(
  preferences: Preferences,
  root: HTMLElement = globalThis.document.documentElement,
): void {
  if (preferences.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.dataset['theme'] = preferences.theme;
  }

  if (preferences.motion === 'system') {
    root.removeAttribute('data-motion');
  } else {
    root.dataset['motion'] = preferences.motion;
  }
}

/** The preferences, and the one way to change them. */
export type PreferencesState = Preferences & {
  /** Changes one or more preferences, stores them, and applies them to the page. */
  readonly set: (changes: Partial<Preferences>) => void;
};

/**
 * The preferences store.
 *
 * Zustand rather than TanStack Query for the same reason the session is: this is the client's
 * own state, not a cached copy of a server resource. Nothing here can go stale, and nothing here
 * can be refetched.
 */
export const usePreferences = create<PreferencesState>((set, get) => ({
  ...readPreferences(),

  /**
   * Changes one or more preferences.
   *
   * Storing and applying happen here rather than in an effect somewhere. A preference that is
   * saved but not applied until the next render is a switch that appears not to work, and one
   * applied but not saved is a switch that forgets.
   *
   * @param changes - What to change.
   */
  set: (changes: Partial<Preferences>): void => {
    const { theme, motion, startPage } = { ...get(), ...changes };
    const next: Preferences = { theme, motion, startPage };

    set(next);
    writePreferences(next);
    applyPreferences(next);
  },
}));

/*
 * Applied at module scope, before anything renders.
 *
 * A theme applied in an effect means the first paint is the wrong colour and the second is the
 * right one, which is the flash this setting exists to avoid.
 */
applyPreferences(readPreferences());
