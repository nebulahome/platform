/**
 * A package's strings: its catalogues loaded into a namespace of its own when its interface is,
 * and `useTranslation` - lent to it - saying them in the viewer's language, its English where the
 * catalogue is silent.
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n/instance';
import { applyLanguage } from '@/i18n/language';
import { importModule } from '@/packages/import-module';
import { loadPackageUi, packageNamespace } from '@/packages/loader';
import { PackageScope, UI_HOST } from '@/packages/sdk-ui';
import { aPackage } from '@/testing/package-fixtures';

vi.mock('@/packages/import-module', () => ({ importModule: vi.fn() }));

// The first load imports what the interface lends - the whole UI library - lazily. Paid here,
// with room, rather than inside the first test's 5 s while the monorepo tests in parallel.
beforeAll(async () => {
  await import('@/packages/shared-modules');
}, 60_000);

afterEach(async () => {
  await applyLanguage('en');
});

/**
 * Draws inside a package's scope.
 *
 * @param props - What is drawn.
 * @param props.children - It.
 * @returns It, as the weather package's.
 */
function Weather(props: { readonly children: ReactNode }) {
  return (
    <PackageScope value={{ id: 'weather', version: '1.1.0', name: 'Weather' }} portal={null}>
      {props.children}
    </PackageScope>
  );
}

describe("a package's catalogues", () => {
  it("are loaded with its interface, the reader's language first", async () => {
    await applyLanguage('it');
    vi.mocked(importModule).mockResolvedValue({
      default: {
        kind: 'nebula.ui',
        sdk: '1.1.0',
        page: undefined,
        cards: {},
        entityViews: {},
        locales: { it: async () => Promise.resolve({ default: { title: 'Titolo' } }) },
      },
    });

    await loadPackageUi(aPackage({ id: 'broker-strings' }));

    expect(i18n.t('title', { ns: packageNamespace('broker-strings') })).toBe('Titolo');
  });

  it('are none for a build before SDK 1.1', async () => {
    vi.mocked(importModule).mockResolvedValue({
      default: { kind: 'nebula.ui', sdk: '1.0.0', page: undefined, cards: {}, entityViews: {} },
    });

    await expect(loadPackageUi(aPackage({ id: 'broker-old' }))).resolves.toMatchObject({
      locales: {},
    });
  });
});

describe('useTranslation, as the interface lends it', () => {
  it("says the package's strings in the reader's language, and its English where they lack", async () => {
    i18n.addResourceBundle('it', packageNamespace('weather'), {
      title: 'Il meteo di {{city}}',
      days_one: '{{count}} giorno',
      days_other: '{{count}} giorni',
    });
    await applyLanguage('it');

    const { result } = renderHook(() => UI_HOST.useTranslation(), { wrapper: Weather });
    const { t, locale } = result.current;
    const days = { one: '{{count}} day', other: '{{count}} days' };

    expect(locale).toBe('it');
    expect(t('title', 'The weather of {{city}}', { city: 'Torino' })).toBe('Il meteo di Torino');
    expect(t('days', days, { count: 1 })).toBe('1 giorno');
    expect(t('days', days, { count: 4 })).toBe('4 giorni');
    expect(t('empty', 'Nothing yet')).toBe('Nothing yet');
  });

  it('says the English to a reader of English', () => {
    const { result } = renderHook(() => UI_HOST.useTranslation(), { wrapper: Weather });
    const { t } = result.current;

    expect(t('title', 'The weather of {{city}}', { city: 'Turin' })).toBe('The weather of Turin');
    expect(t('days', { one: '{{count}} day', other: '{{count}} days' }, { count: 2 })).toBe(
      '2 days',
    );
  });
});
