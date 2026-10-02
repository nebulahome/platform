/**
 * The forwarders against a stand-in for what the interface lends: a member there is called, one
 * missing is named with the SDK version it needs, and outside the interface it says so.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { cn } from '../components/index.js';
import { COMPONENTS_MODULE, UI_MODULE } from '../host.js';

import { usePackage, usePackageRpc } from './index.js';

/**
 * Lends a stand-in implementation, as the interface does before it imports a package.
 *
 * @param sdk - The SDK version it says it implements.
 * @param modules - What it lends, by module.
 */
function lend(sdk: string, modules: Record<string, Record<string, unknown>>): void {
  Reflect.set(globalThis, '__nebula', { version: 2, sdk, modules });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__nebula');
});

describe('the forwarders', () => {
  it('call what the interface lends', () => {
    lend('1.0.0', {
      [UI_MODULE]: {
        usePackage: () => ({ id: 'weather', version: '1.0.0', name: 'Weather' }),
        usePackageRpc: (method: string, input: unknown) => ({
          data: { method, input },
          error: null,
          isLoading: false,
          refetch: () => undefined,
        }),
      },
      [COMPONENTS_MODULE]: { cn: (...classes: unknown[]) => classes.filter(Boolean).join(' ') },
    });

    expect(usePackage()).toEqual({ id: 'weather', version: '1.0.0', name: 'Weather' });
    expect(usePackageRpc('forecast', { days: 3 }).data).toEqual({
      method: 'forecast',
      input: { days: 3 },
    });
    expect(cn('a', false, 'b')).toBe('a b');
  });

  it('name what the interface lacks, and the version it implements', () => {
    lend('0.9.0', { [UI_MODULE]: {} });

    expect(() => usePackage()).toThrow(
      'usePackage needs package SDK 1.0; this interface implements 0.9.0',
    );
  });

  it('say so outside the interface', () => {
    expect(() => usePackage()).toThrow(
      'usePackage is lent by the NebulaHome interface, and there is none here',
    );
  });
});
