/**
 * What every test file gets before it runs: the DOM matchers, and an unmount after each test.
 *
 * Testing Library unmounts on its own only when Vitest's globals are on, and they are off here,
 * so the teardown is registered explicitly - otherwise every render stacks on the last one.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach } from 'vitest';

// An i18next in English, as the interface starts: every `t` answers with the English written
// beside its key, which is what the tests read.
void i18next
  .createInstance()
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: false,
    resources: {},
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

afterEach(() => {
  cleanup();
});
