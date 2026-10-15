/**
 * The package's strings said in English, filled in: what `useTranslation` says where no
 * interface lends it - a component's unit test - and the fallback the interface's catalogue lookup
 * matches word for word.
 */
import type { PluralEnglish, Translation, TranslationValues } from './types.js';

/** A `{{placeholder}}`, as i18next writes it. */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Fills a string's placeholders.
 *
 * @param text - The string.
 * @param values - What fills them; a placeholder with no value is left as written.
 * @returns The string, filled.
 */
export function interpolate(text: string, values: TranslationValues | undefined): string {
  return text.replaceAll(PLACEHOLDER, (whole, name: string) => {
    const value = values?.[name];

    return value === undefined ? whole : String(value);
  });
}

/**
 * Says a string's English, its plural form chosen by `count`.
 *
 * @param english - The English, or a plural's two forms.
 * @param values - What fills it.
 * @returns The English, filled.
 */
export function englishOf(english: string | PluralEnglish, values?: TranslationValues): string {
  const text =
    typeof english === 'string' ? english : values?.['count'] === 1 ? english.one : english.other;

  return interpolate(text, values);
}

/** The package's strings in English. */
export const ENGLISH: Translation = {
  /**
   * Says a string's English.
   *
   * @param key - Its key, unused: there is no catalogue here.
   * @param english - Its English.
   * @param values - What fills it.
   * @returns The English, filled.
   */
  t: (key, english, values) => englishOf(english, values),
  locale: 'en',
};
