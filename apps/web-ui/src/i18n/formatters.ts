/**
 * Numbers, dates, lists and orderings in the language the interface speaks.
 *
 * An `Intl` formatter is expensive to build and cheap to use, so code used to build one at module
 * scope - with the browser's locale, or a fixed `'en-GB'`, decided once at import. The interface
 * now changes language while it runs, so every formatter is asked for here instead: built for the
 * language spoken at the moment it is asked, and kept for the next caller with the same language
 * and options.
 *
 * The region comes from the browser when it speaks the same language: somebody reading English
 * with a British browser gets "3 Sept" and a 24-hour clock, an American browser "Sep 3". The
 * language is always the interface's, so the words around a date and the date agree.
 *
 * Plain functions rather than hooks: they are called from helpers as often as from components,
 * and a change of language draws the whole interface again, so whatever asks during a render gets
 * the new language.
 */
import { currentLocale } from '@/i18n/language';

/**
 * The locale formatting uses: the browser's own tag when it is the interface's language, so its
 * region counts; the language alone otherwise.
 *
 * @param language - The interface's language.
 * @returns A locale tag.
 */
export function formattingLocale(language: string = currentLocale()): string {
  const tags = globalThis.navigator.languages;

  return (
    tags.find((tag) => tag.toLowerCase().split(/[-_]/u)[0] === language && tag.includes('-')) ??
    language
  );
}

/** Every formatter built so far, by kind, language and options. */
const cache = new Map<string, unknown>();

/**
 * Builds a formatter, or hands back the one already built for the same language and options.
 *
 * @param kind - Which `Intl` constructor.
 * @param options - Its options; their JSON is part of the key.
 * @param build - Builds one for a language.
 * @returns The formatter.
 */
function cached<TFormatter>(
  kind: string,
  options: object | undefined,
  build: (locale: string) => TFormatter,
): TFormatter {
  const locale = formattingLocale();
  const key = `${kind}|${locale}|${JSON.stringify(options ?? {})}`;
  const found = cache.get(key) as TFormatter | undefined;

  if (found !== undefined) {
    return found;
  }

  const built = build(locale);

  cache.set(key, built);

  return built;
}

/**
 * A number formatter in the interface's language.
 *
 * @param options - How to format.
 * @returns The formatter.
 */
export function numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('number', options, (locale) => new Intl.NumberFormat(locale, options));
}

/**
 * A date and time formatter in the interface's language.
 *
 * @param options - How to format: the time zone among them, when it is the house's.
 * @returns The formatter.
 */
export function dateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached('date', options, (locale) => new Intl.DateTimeFormat(locale, options));
}

/**
 * A relative time formatter in the interface's language: "3 minutes ago".
 *
 * @param options - How to format.
 * @returns The formatter.
 */
export function relativeTimeFormat(
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cached('relative', options, (locale) => new Intl.RelativeTimeFormat(locale, options));
}

/**
 * A list formatter in the interface's language: "a, b and c".
 *
 * @param options - How to join.
 * @returns The formatter.
 */
export function listFormat(options?: Intl.ListFormatOptions): Intl.ListFormat {
  return cached('list', options, (locale) => new Intl.ListFormat(locale, options));
}

/**
 * A collator in the interface's language, for sorting what people read.
 *
 * @param options - How to compare.
 * @returns The collator.
 */
export function collator(options?: Intl.CollatorOptions): Intl.Collator {
  return cached('collator', options, (locale) => new Intl.Collator(locale, options));
}

/**
 * The names of languages, regions or units in the interface's language.
 *
 * @param options - Which kind of name.
 * @returns The display names.
 */
export function displayNames(options: Intl.DisplayNamesOptions): Intl.DisplayNames {
  return cached('names', options, (locale) => new Intl.DisplayNames(locale, options));
}
