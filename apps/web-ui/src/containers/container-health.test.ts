/**
 * The health strip of a container's page, and the line its hero says: a failing healthcheck said
 * as such, a newer image offered, and who waits for it.
 */
import { describe, expect, it } from 'vitest';

import type { ContainerDetail } from '@nebulahome/contracts';

import { containerSummary } from '@/testing/container-fixtures';

import {
  containerImageHealth,
  containerPill,
  containerPurpose,
  containerRuntimeHealth,
  containerUsedByHealth,
} from './container-health';

/**
 * A container as its page reads it.
 *
 * @param fields - What differs.
 * @returns The container.
 */
function detail(fields: Partial<ContainerDetail> = {}): ContainerDetail {
  return {
    ...containerSummary(),
    command: null,
    restartPolicy: 'unless-stopped',
    networkMode: 'bridge',
    hostname: null,
    networks: [],
    ports: [],
    mounts: [],
    devices: [],
    env: [],
    labels: {},
    sampleIntervalMs: 10_000,
    samples: [],
    warnings: [],
    webPort: null,
    ...fields,
  };
}

describe('the health of a container', () => {
  it('says a failing healthcheck rather than "running"', () => {
    expect(containerPill({ state: 'running', health: 'unhealthy' })).toEqual({
      tone: 'warning',
      label: 'Unhealthy',
    });
    expect(containerRuntimeHealth(detail({ state: 'running', health: 'unhealthy' }))).toMatchObject(
      { tone: 'warning', value: 'Unhealthy' },
    );
    expect(containerPill({ state: 'exited', health: null }).label).toBe('Stopped');
  });

  it('offers a newer image, and says the one running', () => {
    const container = detail({
      version: '1.40',
      update: {
        installedVersion: '1.40',
        latestVersion: '1.41',
        isAvailable: true,
        checkedAt: new Date(),
        error: null,
        isInstalling: false,
        progress: null,
      },
    });

    expect(containerImageHealth(container)).toEqual({
      tone: 'info',
      value: '1.41 ready',
      detail: 'Running 1.40',
    });
  });

  it('says what runs it, and that it waits while its integration does not work', () => {
    const container = detail({
      managedBy: {
        ownerKind: 'vendor',
        vendorId: 'zigbee2mqtt',
        dependencyId: 'bridge',
        isReleased: false,
      },
    });

    expect(containerPurpose(container)).toBe('Runs the bridge for the zigbee2mqtt integration.');
    expect(
      containerUsedByHealth(container, {
        name: 'Zigbee2MQTT',
        isWorking: false,
        problem: 'The integration can’t reach MQTT',
      }),
    ).toEqual({ tone: 'warning', value: 'Waiting', detail: 'The integration can’t reach MQTT' });
    expect(containerUsedByHealth(detail(), null).value).toBe('Nothing');
  });
});
