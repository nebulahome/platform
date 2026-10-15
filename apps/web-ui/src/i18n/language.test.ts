import { afterEach, describe, expect, it, vi } from 'vitest';

import { numberFormat } from '@/i18n/formatters';
import { i18n } from '@/i18n/instance';
import {
  addCatalogueSource,
  applyLanguage,
  currentLocale,
  readLanguageHint,
} from '@/i18n/language';
import { defineMessage, text, translate } from '@/i18n/messages';

vi.mock('@/locales/it.json', () => ({
  default: {
    sample: {
      title: 'Dispositivi',
      named: 'Dispositivi di {{name}}',
      count_one: 'un dispositivo',
      count_many: '{{count}} di dispositivi',
      count_other: '{{count}} dispositivi',
    },
  },
}));

afterEach(async () => {
  await applyLanguage('en');
});

describe('switching language', () => {
  it('speaks the catalogue once it is loaded, and English where it has nothing', async () => {
    await applyLanguage('it');

    expect(currentLocale()).toBe('it');
    expect(globalThis.document.documentElement.lang).toBe('it');
    expect(i18n.t('sample.title', { defaultValue: 'Devices' })).toBe('Dispositivi');
    expect(i18n.t('sample.missing', { defaultValue: 'Not translated' })).toBe('Not translated');
  });

  it('chooses the plural the language calls for', async () => {
    const options = {
      defaultValue_one: '{{count}} device',
      defaultValue_other: '{{count}} devices',
    };

    expect(i18n.t('sample.count', { ...options, count: 3 })).toBe('3 devices');

    await applyLanguage('it');

    expect(i18n.t('sample.count', { ...options, count: 1 })).toBe('un dispositivo');
    expect(i18n.t('sample.count', { ...options, count: 3 })).toBe('3 dispositivi');
  });

  it('ends in the language asked for last, whatever loads first', async () => {
    void applyLanguage('it');
    await applyLanguage('en');

    expect(currentLocale()).toBe('en');
  });

  it('remembers the language for the next visit', async () => {
    await applyLanguage('it');

    expect(readLanguageHint()).toBe('it');
  });
});

describe('strings said outside a component', () => {
  it('says a declared message, and a sentence with values, in the language spoken now', async () => {
    const title = defineMessage('sample.title', 'Devices');

    expect(text(title)).toBe('Devices');

    await applyLanguage('it');

    expect(text(title)).toBe('Dispositivi');
    expect(translate('sample.named', 'Devices of {{name}}', { name: 'Casa' })).toBe(
      'Dispositivi di Casa',
    );
  });

  it('formats numbers the way the language writes them', async () => {
    expect(numberFormat().format(1234.5)).toBe('1,234.5');

    await applyLanguage('it');

    expect(numberFormat().format(1234.5)).toBe('1234,5');
    expect(numberFormat({ useGrouping: 'always' }).format(1234.5)).toBe('1.234,5');
  });
});

describe("a package's catalogues", () => {
  it('loads a namespace for the language spoken now, and for each one switched to', async () => {
    const load = vi.fn(async (locale: string) =>
      Promise.resolve(locale === 'it' ? { greeting: 'Ciao' } : undefined),
    );

    await addCatalogueSource('package/sample', load);
    await applyLanguage('it');

    expect(load).toHaveBeenCalledWith('it');
    expect(i18n.t('greeting', { ns: 'package/sample', defaultValue: 'Hello' })).toBe('Ciao');
  });

  it('keeps English for a namespace whose catalogue cannot be loaded', async () => {
    await addCatalogueSource('package/broken', async () => Promise.reject(new Error('gone')));
    await applyLanguage('it');

    expect(i18n.t('greeting', { ns: 'package/broken', defaultValue: 'Hello' })).toBe('Hello');
  });
});
