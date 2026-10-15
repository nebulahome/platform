/**
 * The interface's one i18next instance (RULES.md 1).
 *
 * English is not a catalogue. Every string is written in English where it is used - `t('key',
 * 'English')` - and that default is what any language without the key shows, which is the
 * fallback the platform promises: a missing translation reads English, never a key. Other
 * languages are catalogues under `src/locales/`, loaded when somebody needs them
 * (`language.ts`), and a package's interface adds a namespace of its own beside the
 * interface's.
 *
 * Initialised synchronously at import, in English, so a component rendered before anything
 * else - a test, the waiting screen - already has a `t` that answers.
 */
import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LOCALE } from '@nebulahome/contracts';

/** The interface's own namespace; a package's is `package/<id>`. */
export const CORE_NAMESPACE = 'translation';

/** The instance every `t` in the interface reads. */
export const i18n: I18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,

  // Nothing falls back to another catalogue: a key a language lacks shows its English default,
  // which is written beside the key in the code.
  fallbackLng: false,
  ns: [CORE_NAMESPACE],
  defaultNS: CORE_NAMESPACE,
  resources: {},
  partialBundledLanguages: true,

  // Synchronous: the catalogues are added by hand, and nothing waits for a backend.
  initAsync: false,

  // Keys name places in the catalogue's tree; a colon is ordinary text, never a namespace.
  keySeparator: '.',
  nsSeparator: false,

  // React escapes what it renders, and no catalogue is ever rendered as HTML.
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,

  // A language is applied once its catalogues are in (`applyLanguage`), so nothing suspends.
  react: { useSuspense: false },
});
