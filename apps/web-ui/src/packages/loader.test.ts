/**
 * Loading a package's interface: its entry once per release, its stylesheet in place of the last
 * one's, what the interface lends there before its module runs, and each component from its own
 * loader.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { importModule } from '@/packages/import-module';
import { loadPackageComponent, loadPackageUi } from '@/packages/loader';
import { aPackage } from '@/testing/package-fixtures';

vi.mock('@/packages/import-module', () => ({ importModule: vi.fn() }));

/**
 * A card, for the loaders.
 *
 * @returns Nothing drawn.
 */
function BrokerCard(): null {
  return null;
}

/**
 * An entry as the SDK's build generates it.
 *
 * @param fields - What differs.
 * @returns The entry.
 */
function entry(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'nebula.ui',
    sdk: '1.0.0',
    page: undefined,
    cards: { broker: async () => Promise.resolve({ default: BrokerCard }) },
    entityViews: {},
    ...fields,
  };
}

// The first load imports what the interface lends - the whole UI library - lazily. Paid here,
// with room, rather than inside the first test's 5 s while the monorepo tests in parallel.
beforeAll(async () => {
  await import('@/packages/shared-modules');
}, 60_000);

beforeEach(() => {
  vi.mocked(importModule).mockReset();
  document.head.innerHTML = '';
});

describe('loadPackageUi', () => {
  it('imports a release once, from the folder of its entry, after what the interface lends', async () => {
    vi.mocked(importModule).mockImplementation(() => {
      // The module reads the interface's copies as it is evaluated.
      const nebula = (
        globalThis as { __nebula?: { sdk: string; modules: Record<string, unknown> } }
      ).__nebula;

      expect(nebula?.modules['react']).toBeDefined();
      expect(nebula?.modules['@nebulahome/package-sdk/ui@1']).toBeDefined();
      expect(nebula?.modules['@nebulahome/package-sdk/components@1']).toBeDefined();
      expect(nebula?.sdk).toMatch(/^1\./u);

      return Promise.resolve({ default: entry() });
    });

    const found = aPackage({ id: 'broker-a' });

    await expect(loadPackageUi(found)).resolves.toMatchObject({ sdk: '1.0.0' });
    await loadPackageUi(found);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(importModule).toHaveBeenCalledWith(
      '/api/v1/packages/broker-a/ui/1.0.0%2B3f2a9c1d/index.js',
    );
  });

  it("puts a new build's stylesheet in place of the old one", async () => {
    vi.mocked(importModule).mockResolvedValue({ default: entry() });

    await loadPackageUi(aPackage({ id: 'broker-b', version: '1.0.0', build: '1.0.0+3f2a9c1d' }));
    // The same version, built again: another address, imported afresh.
    await loadPackageUi(aPackage({ id: 'broker-b', version: '1.0.0', build: '1.0.0+77e01b2c' }));

    const links = document.head.querySelectorAll('link[data-package="broker-b"]');

    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(
      '/api/v1/packages/broker-b/ui/1.0.0%2B77e01b2c/index.css',
    );
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it('refuses a module the SDK did not build, and tries again next time', async () => {
    vi.mocked(importModule).mockResolvedValueOnce({ default: { cards: {} } });
    vi.mocked(importModule).mockResolvedValueOnce({ default: entry() });

    const found = aPackage({ id: 'broker-c' });

    await expect(loadPackageUi(found)).rejects.toThrow(/package-sdk/u);
    await expect(loadPackageUi(found)).resolves.toMatchObject({ sdk: '1.0.0' });
  });

  it('refuses a package built against a newer SDK major', async () => {
    vi.mocked(importModule).mockResolvedValueOnce({ default: entry({ sdk: '2.0.0' }) });

    await expect(loadPackageUi(aPackage({ id: 'broker-e' }))).rejects.toThrow(
      /needs package SDK 2\.0\.0; this interface implements 1\./u,
    );
  });

  it('refuses a package that adds nothing to the interface', async () => {
    await expect(loadPackageUi(aPackage({ id: 'broker-d', ui: null }))).rejects.toThrow(
      /adds nothing/u,
    );
    expect(importModule).not.toHaveBeenCalled();
  });
});

describe('loadPackageComponent', () => {
  it('loads the component a target names from its loader, and nothing for one not drawn', async () => {
    vi.mocked(importModule).mockResolvedValue({ default: entry() });

    const found = aPackage({ id: 'broker-f' });

    await expect(loadPackageComponent(found, { kind: 'card', cardId: 'broker' })).resolves.toBe(
      BrokerCard,
    );
    await expect(loadPackageComponent(found, { kind: 'page' })).resolves.toBeNull();
    await expect(
      loadPackageComponent(found, { kind: 'entityView', type: 'recording' }),
    ).resolves.toBeNull();
  });

  it('refuses a loader whose module holds no component', async () => {
    vi.mocked(importModule).mockResolvedValue({
      default: entry({ cards: { broker: async () => Promise.resolve({ default: 'nope' }) } }),
    });

    await expect(
      loadPackageComponent(aPackage({ id: 'broker-g' }), { kind: 'card', cardId: 'broker' }),
    ).rejects.toThrow(/not a component/u);
  });
});
