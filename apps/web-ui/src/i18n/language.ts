/**
 * Which language the interface speaks, and changing it.
 *
 * The session decides the language (`auth/session-store.ts`): a person's own choice, else the
 * house's, else - before anybody is known - the house's as the sign-in screen is told it, or on
 * the first run the browser's. This module only carries the decision out: it loads what the
 * language needs, then switches.
 *
 * Loading comes first, for every catalogue the language needs - the interface's own, cronstrue's
 * words for schedules, and each package interface already on the page - so the switch happens
 * once, to a complete language, rather than to English first and then string by string. Switches
 * are queued, and one overtaken by a later one is dropped: picking Italian and then English
 * quickly ends in English whatever order the catalogues arrive in.
 *
 * The language is remembered in this browser, as a hint for the next visit, so the screen that
 * waits for the server already speaks it. The hint is a convenience: the session's answer
 * replaces it as soon as there is one.
 */
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  resolveDisplayLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@nebulahome/contracts';

import { CORE_NAMESPACE, i18n } from '@/i18n/instance';

/** A catalogue as it is written: nested keys, strings at the leaves. */
export type CatalogueTree = { readonly [key: string]: string | CatalogueTree };

/** Loads one namespace's catalogue for a language: undefined when it has none. */
export type CatalogueLoader = (locale: SupportedLocale) => Promise<CatalogueTree | undefined>;

/** The languages with a catalogue of their own: every one but English, which is in the code. */
type TranslatedLocale = Exclude<SupportedLocale, 'en'>;

/** The interface's catalogues, each its own chunk. */
const CORE_CATALOGUES: Readonly<Record<TranslatedLocale, () => Promise<CatalogueTree>>> = {
  /**
   * Loads the Italian catalogue.
   *
   * @returns It.
   */
  it: async () => (await import('@/locales/it.json')).default,
};

/** cronstrue's words for each language, which register themselves when imported. */
const SCHEDULE_WORDS: Readonly<Record<TranslatedLocale, () => Promise<unknown>>> = {
  /**
   * Loads cronstrue's Italian.
   *
   * @returns The module, which registers itself.
   */
  it: async () => import('cronstrue/locales/it'),
};

/** Where the hint is kept. */
const HINT_KEY = 'nebula.language';

/** The namespaces a package interface added, and how to load each one's catalogues. */
const sources = new Map<string, CatalogueLoader>();

/** The language most recently asked for. */
let wanted: SupportedLocale = DEFAULT_LOCALE;

/** The switch in progress, so the next one waits for it. */
let queue: Promise<void> = Promise.resolve();

/**
 * Says whether a language has catalogues to load.
 *
 * @param locale - The language.
 * @returns True for every language but English.
 */
function isTranslated(locale: SupportedLocale): locale is TranslatedLocale {
  return locale !== DEFAULT_LOCALE;
}

/**
 * Loads one namespace's catalogue into the instance, once.
 *
 * A catalogue that cannot be loaded - a chunk lost to a deploy, a package that answers nothing -
 * leaves that namespace in English rather than holding the switch up: a sentence in the wrong
 * language is a smaller failure than a screen that cannot change language at all.
 *
 * @param locale - The language.
 * @param namespace - Whose catalogue.
 * @param load - How to load it.
 */
async function loadNamespace(
  locale: SupportedLocale,
  namespace: string,
  load: () => Promise<CatalogueTree | undefined>,
): Promise<void> {
  if (i18n.hasResourceBundle(locale, namespace)) {
    return;
  }

  try {
    const catalogue = await load();

    if (catalogue !== undefined) {
      i18n.addResourceBundle(locale, namespace, catalogue, true, true);
    }
  } catch {
    // English, for this namespace: see above.
  }
}

/**
 * Loads everything a language needs.
 *
 * @param locale - The language.
 */
async function loadLanguage(locale: SupportedLocale): Promise<void> {
  if (!isTranslated(locale)) {
    return;
  }

  await Promise.all([
    loadNamespace(locale, CORE_NAMESPACE, CORE_CATALOGUES[locale]),
    SCHEDULE_WORDS[locale]().catch(() => undefined),
    ...[...sources].map(async ([namespace, load]) =>
      loadNamespace(locale, namespace, async () => load(locale)),
    ),
  ]);
}

/**
 * Reads the language this browser spoke last time.
 *
 * @returns It, or undefined when it never spoke one or cannot remember.
 */
export function readLanguageHint(): SupportedLocale | undefined {
  try {
    const stored = globalThis.localStorage.getItem(HINT_KEY);

    return isSupportedLocale(stored) ? stored : undefined;
  } catch {
    // A private window, or site data turned off: no hint, which costs one screen in English.
    return undefined;
  }
}

/**
 * Remembers the language for the next visit.
 *
 * @param locale - The language.
 */
function writeLanguageHint(locale: SupportedLocale): void {
  try {
    globalThis.localStorage.setItem(HINT_KEY, locale);
  } catch {
    // See readLanguageHint.
  }
}

/**
 * The language the interface speaks now.
 *
 * @returns It.
 */
export function currentLocale(): SupportedLocale {
  return resolveDisplayLocale(i18n.language, null);
}

/**
 * Switches the interface to a language, once everything it needs is loaded.
 *
 * @param locale - The language.
 * @returns A promise that settles once it is spoken, or once a later switch overtook it.
 */
export async function applyLanguage(locale: SupportedLocale): Promise<void> {
  wanted = locale;

  queue = queue.then(async () => {
    if (wanted !== locale) {
      return;
    }

    await loadLanguage(locale);

    if (wanted !== locale) {
      return;
    }

    if (i18n.language !== locale) {
      await i18n.changeLanguage(locale);
    }

    globalThis.document.documentElement.lang = locale;
    writeLanguageHint(locale);
  });

  return queue;
}

/**
 * Adds a namespace whose catalogues are loaded with the interface's: a package's interface.
 *
 * The language spoken now is loaded straight away, so whatever the package draws first is already
 * in it; every later switch loads the namespace with the rest. Added again - a new build of the
 * package - it forgets what the old one loaded.
 *
 * @param namespace - The namespace: `package/<id>`.
 * @param load - How to load one of its catalogues.
 * @returns A promise that settles once the language spoken now is loaded for it.
 */
export async function addCatalogueSource(namespace: string, load: CatalogueLoader): Promise<void> {
  if (sources.get(namespace) !== load) {
    for (const locale of SUPPORTED_LOCALES) {
      i18n.removeResourceBundle(locale, namespace);
    }
  }

  sources.set(namespace, load);

  const locale = currentLocale();

  if (isTranslated(locale)) {
    await loadNamespace(locale, namespace, async () => load(locale));
  }
}
