/**
 * The forwarders against a stand-in for what the interface lends: a member there is called, one
 * missing is named with the SDK version it needs, and outside the interface it says so.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { cn } from '../components/index.js';
import { COMPONENTS_MODULE, UI_MODULE } from '../host.js';

import {
  useAreas,
  useEntityPicture,
  usePackage,
  usePackageRpc,
  useStateHistory,
  useTelemetry,
  useTranslation,
} from './index.js';

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

  it('name 1.2 for what 1.2 added', () => {
    lend('1.1.0', { [UI_MODULE]: {} });

    const read = { entityIds: ['sensor.hall_temperature'], window: { lastMs: 3_600_000 } };

    expect(() => useStateHistory(read)).toThrow(
      'useStateHistory needs package SDK 1.2; this interface implements 1.1.0',
    );
    expect(() => useTelemetry(read)).toThrow('useTelemetry needs package SDK 1.2');
    expect(() => useAreas()).toThrow('useAreas needs package SDK 1.2');
    expect(() => useEntityPicture('camera.porch')).toThrow(
      'useEntityPicture needs package SDK 1.2',
    );
  });

  it('say so outside the interface', () => {
    expect(() => usePackage()).toThrow(
      'usePackage is lent by the NebulaHome interface, and there is none here',
    );
  });
});

describe('useTranslation', () => {
  it('says the English, filled in, where no interface lends it', () => {
    const { t, locale } = useTranslation();

    expect(locale).toBe('en');
    expect(t('greeting', 'Hello, {{name}}', { name: 'Ada' })).toBe('Hello, Ada');
    expect(
      t('clients', { one: '{{count}} client', other: '{{count}} clients' }, { count: 1 }),
    ).toBe('1 client');
    expect(
      t('clients', { one: '{{count}} client', other: '{{count}} clients' }, { count: 3 }),
    ).toBe('3 clients');
    expect(t('missing', 'Left {{as}} it is')).toBe('Left {{as}} it is');
  });

  it('says it through the interface when it lends it', () => {
    lend('1.1.0', {
      [UI_MODULE]: {
        useTranslation: () => ({ t: (key: string) => `it:${key}`, locale: 'it' }),
      },
    });

    const { t, locale } = useTranslation();

    expect(locale).toBe('it');
    expect(t('greeting', 'Hello')).toBe('it:greeting');
  });

  it('says the English in an interface older than it', () => {
    lend('1.0.0', { [UI_MODULE]: {} });

    expect(useTranslation().t('greeting', 'Hello')).toBe('Hello');
  });
});
