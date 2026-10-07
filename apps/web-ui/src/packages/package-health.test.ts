/**
 * The health strip of a package's page: a failure said with how it ended, what it waits for, who
 * waits for it, and whether a newer release is out.
 */
import { describe, expect, it } from 'vitest';

import type { ApiPackageDetail } from '@nebulahome/contracts';

import { aPackage } from '@/testing/package-fixtures';

import {
  listed,
  packageNeedsHealth,
  packageRuntimeHealth,
  packageUpdatesHealth,
  packageUsedByHealth,
} from './package-health';

/**
 * A package as its page reads it.
 *
 * @param overrides - What differs.
 * @returns The package.
 */
function detail(overrides: Partial<ApiPackageDetail> = {}): ApiPackageDetail {
  return { ...aPackage(), setup: null, config: {}, ...overrides };
}

describe('the health strip of a package', () => {
  it('says how its process ended, and what it waits for', () => {
    expect(
      packageRuntimeHealth(detail({ state: 'failed', lastError: 'Exited with code 1' })),
    ).toEqual({ tone: 'danger', value: 'Failed', detail: 'Exited with code 1' });
    expect(
      packageRuntimeHealth(detail({ state: 'waiting-dependency', problems: ['MQTT is stopped'] })),
    ).toMatchObject({ tone: 'warning', detail: 'MQTT is stopped' });
  });

  it('says what it needs is running, or which is not', () => {
    const mqtt = { kind: 'package' as const, id: 'mqtt', name: 'MQTT' };

    expect(packageNeedsHealth(detail(), [])).toMatchObject({ value: 'Nothing' });
    expect(
      packageNeedsHealth(detail({ dependsOn: [mqtt] }), [{ id: 'mqtt', state: 'running' }]),
    ).toMatchObject({ tone: 'success', value: 'MQTT' });
    expect(
      packageNeedsHealth(detail({ dependsOn: [mqtt] }), [{ id: 'mqtt', state: 'failed' }]),
    ).toMatchObject({ tone: 'warning', value: '1 not running' });
  });

  it('counts who waits for it while it does not run', () => {
    const user = { kind: 'vendor' as const, id: 'zigbee2mqtt', name: 'Zigbee2MQTT' };

    expect(packageUsedByHealth(detail({ state: 'failed', usedBy: [user] }))).toEqual({
      tone: 'warning',
      value: '1 waiting',
      detail: 'Zigbee2MQTT cannot work without it',
    });
    expect(packageUsedByHealth(detail({ state: 'running', usedBy: [user] }))).toMatchObject({
      tone: 'success',
    });
  });

  it('says a newer release is out, and that the latest is installed', () => {
    expect(packageUpdatesHealth(detail({ version: '1.0.0' }), '1.1.0', false, true)).toMatchObject({
      tone: 'info',
      value: 'v1.1.0 ready',
    });
    expect(
      packageUpdatesHealth(detail({ version: '1.0.0' }), undefined, false, true),
    ).toMatchObject({ tone: 'success', value: 'Up to date' });
  });

  it('names several in a sentence', () => {
    expect(listed(['MQTT', 'Matter', 'NVR'])).toBe('MQTT, Matter and NVR');
  });
});
