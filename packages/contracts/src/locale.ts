/**
 * The languages the interface speaks, and how the one a person reads is chosen.
 *
 * There are two answers to "which language". The house has one - `house.locale`, chosen on the
 * first run and changed from the server settings - which is what the sign-in screen speaks and
 * what everybody reads until they say otherwise. A person may say otherwise: `auth.users.locale`
 * holds their own choice, and null there means they follow the house, so changing the house
 * language reaches everyone who never picked one.
 *
 * The choice is only ever about what the interface shows. Names, states, automations and logs
 * are data and stay as they were written (RULES.md 1).
 *
 * The list is fixed in the build: the interface carries a catalogue for each language here and
 * nothing else, so a language is added by adding its catalogue and its tag below. A stored tag
 * that is no longer listed - a language removed - is read as no choice at all, never as an error.
 */
import { z } from 'zod';

/** Every language the interface carries a catalogue for. English is the source, not a file. */
export const SUPPORTED_LOCALES = ['en', 'it'] as const;

/** One of {@link SUPPORTED_LOCALES}. */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Validates a language tag the platform stores: one of {@link SUPPORTED_LOCALES}. */
export const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES);

/** What the house speaks before anybody chose, and what anything untranslated falls back to. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Each language by its own name, as a language picker lists it.
 *
 * Never translated: somebody looking for their own language finds it under the name they know it
 * by, whatever the screen is in at the time.
 */
export const LOCALE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  en: 'English',
  it: 'Italiano',
};

/**
 * Says whether a value is one of the supported languages.
 *
 * @param value - What was stored or sent.
 * @returns True for a supported tag.
 */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

/**
 * Finds the first supported language among a browser's preferences.
 *
 * Regional tags count for their language - `it-IT` and `it-CH` are Italian - because the
 * catalogues are per language. The order is the browser's: the first of its languages the
 * interface speaks wins, not the first the interface lists.
 *
 * @param tags - The preferences, most wanted first: `navigator.languages`.
 * @returns The language, or undefined when none of them is supported.
 */
export function matchSupportedLocale(tags: readonly string[]): SupportedLocale | undefined {
  for (const tag of tags) {
    const language = tag.trim().toLowerCase().split(/[-_]/)[0];

    if (isSupportedLocale(language)) {
      return language;
    }
  }

  return undefined;
}

/**
 * The language a person reads: their own choice, else the house's, else English.
 *
 * Every step tolerates a value that is not supported any more, so a catalogue removed from a later
 * build leaves people reading the next language down rather than a screen that fails to start.
 *
 * @param personal - Their own choice; null when they follow the house.
 * @param house - The house language.
 * @returns The language the interface should speak to them.
 */
export function resolveDisplayLocale(
  personal: string | null | undefined,
  house: string | null | undefined,
): SupportedLocale {
  if (isSupportedLocale(personal)) {
    return personal;
  }

  return isSupportedLocale(house) ? house : DEFAULT_LOCALE;
}
