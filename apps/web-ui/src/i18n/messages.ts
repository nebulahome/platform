/**
 * Strings that are declared in one place and said in another.
 *
 * A component says its strings with `useTranslation()`'s `t`, where it renders them. Two kinds of
 * string cannot: the labels of a table built at module scope - the rail's groups, the settings
 * sections, the names of the sensor classes - which exist before any language is chosen, and the
 * sentences a plain function builds for a component to show. For the first, `defineMessage`
 * records the key and its English and says nothing yet; `text` says it, in whatever language the
 * interface speaks by then. For the second, `translate` is `t` without a hook.
 *
 * Both read the current language from the instance, which is safe because a change of language
 * draws the whole interface again (`LanguageBoundary` in `language.ts`).
 */
import type { TOptions } from 'i18next';

import { i18n } from '@/i18n/instance';

/** A string declared before it is said: its key in the catalogue and its English. */
export type Message = {
  /** Where the catalogue keeps it. */
  readonly key: string;

  /** What it says in English, and in any language whose catalogue lacks the key. */
  readonly defaultValue: string;
};

/** The values a string is filled in with, and the count a plural is chosen by. */
export type MessageValues = Readonly<Record<string, unknown>>;

/**
 * Declares a string without saying it.
 *
 * @param key - Its key in the catalogue: `sidebar.groups.home`.
 * @param defaultValue - What it says in English.
 * @returns The message, for {@link text} to say.
 */
export function defineMessage(key: string, defaultValue: string): Message {
  return { key, defaultValue };
}

/**
 * Says a declared string in the language the interface speaks now.
 *
 * @param message - The string.
 * @param values - What fills its `{{placeholders}}`.
 * @returns It, translated, or its English when the catalogue lacks it.
 */
export function text(message: Message, values?: MessageValues): string {
  return i18n.t(message.key, { ...values, defaultValue: message.defaultValue });
}

/**
 * Says a string outside a component: `t` without the hook.
 *
 * Takes what `t` takes, so a sentence moves between a component and a helper unchanged - the
 * English as the second argument, or `defaultValue_one`/`defaultValue_other` in the options for
 * a plural.
 *
 * @param key - Its key in the catalogue.
 * @param defaultValueOrOptions - Its English, or the options with the English in them.
 * @param values - What fills it, when the English came as a string.
 * @returns It, translated, or its English.
 */
export function translate(
  key: string,
  defaultValueOrOptions: string | TOptions,
  values?: MessageValues,
): string {
  return typeof defaultValueOrOptions === 'string'
    ? i18n.t(key, { ...values, defaultValue: defaultValueOrOptions })
    : i18n.t(key, defaultValueOrOptions);
}
