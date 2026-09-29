/**
 * Loading a package's interface: once per release, its stylesheet in place of the last one's,
 * and the shared modules there before its module runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importModule } from '@/packages/import-module';
import { loadPackageUi } from '@/packages/loader';
import { aPackage } from '@/testing/package-fixtures';

vi.mock('@/packages/import-module', () => ({ importModule: vi.fn() }));

/** What a package's module exports. */
const DEFINITION = { cards: {} };

beforeEach(() => {
  vi.mocked(importModule).mockReset();
  document.head.innerHTML = '';
});

describe('loadPackageUi', () => {
  it('imports a release once, from the folder of its entry, after the shared modules', async () => {
    vi.mocked(importModule).mockImplementation(() => {
      // The module reads the interface's copies as it is evaluated.
      expect(
        (globalThis as { __nebula?: { modules: Record<string, unknown> } }).__nebula?.modules[
          'react'
        ],
      ).toBeDefined();

      return Promise.resolve({ default: DEFINITION });
    });

    const found = aPackage({ id: 'broker-a' });

    await expect(loadPackageUi(found)).resolves.toBe(DEFINITION);
    await expect(loadPackageUi(found)).resolves.toBe(DEFINITION);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(importModule).toHaveBeenCalledWith('/api/v1/packages/broker-a/ui/1.0.0/index.js');
  });

  it("puts a new release's stylesheet in place of the old one", async () => {
    vi.mocked(importModule).mockResolvedValue({ default: DEFINITION });

    await loadPackageUi(aPackage({ id: 'broker-b', version: '1.0.0' }));
    await loadPackageUi(aPackage({ id: 'broker-b', version: '1.1.0' }));

    const links = document.head.querySelectorAll('link[data-package="broker-b"]');

    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/api/v1/packages/broker-b/ui/1.1.0/index.css');
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it('refuses a module that is not an interface, and tries again next time', async () => {
    vi.mocked(importModule).mockResolvedValueOnce({ default: 'nope' });
    vi.mocked(importModule).mockResolvedValueOnce({ default: DEFINITION });

    const found = aPackage({ id: 'broker-c' });

    await expect(loadPackageUi(found)).rejects.toThrow(/definePackageUi/u);
    await expect(loadPackageUi(found)).resolves.toBe(DEFINITION);
  });

  it('refuses a package that adds nothing to the interface', async () => {
    await expect(loadPackageUi(aPackage({ id: 'broker-d', ui: null }))).rejects.toThrow(
      /adds nothing/u,
    );
    expect(importModule).not.toHaveBeenCalled();
  });
});
