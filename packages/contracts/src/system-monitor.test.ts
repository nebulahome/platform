import { describe, expect, it } from 'vitest';

import { entityRegistrationSchema } from './registration.js';
import {
  SYSTEM_ENTITIES,
  SYSTEM_READINGS,
  SYSTEM_SAMPLE_WINDOW,
  systemMonitorSnapshotSchema,
} from './system-monitor.js';

/**
 * A snapshot with every field present, for tests that vary one of them.
 *
 * @param samples - How many samples it carries.
 * @returns The snapshot, as `core` would send it over the bus.
 */
function snapshot(samples = 2): Record<string, unknown> {
  return {
    host: {
      hostname: 'nebula',
      platform: 'linux',
      osName: 'Linux 6.8.0',
      arch: 'x64',
      uptimeSeconds: 3600,
      cpuModel: 'Intel(R) N100',
      cpuCount: 4,
    },
    sampleIntervalMs: 10_000,
    samples: Array.from({ length: samples }, (unused, index) => ({
      at: new Date(Date.UTC(2026, 8, 23, 12, 0, index * 10)).toISOString(),
      cpuPercent: 12.5,
      memoryUsedBytes: 4_000_000_000,
      memoryTotalBytes: 16_000_000_000,
      receiveRate: 1200,
      transmitRate: null,
    })),
    network: { interface: 'eth0', receivedBytes: 10_000, transmittedBytes: 2000 },
    disk: {
      totalBytes: 500_000_000_000,
      freeBytes: 300_000_000_000,
      usedBytes: 200_000_000_000,
      otherBytes: 199_000_000_000,
      categories: [
        {
          id: 'core',
          kind: 'core',
          bytes: 1_000_000_000,
          parts: [{ id: 'database', bytes: 900_000_000 }],
        },
      ],
      measuredAt: null,
    },
  };
}

describe('SYSTEM_ENTITIES', () => {
  it('registers every entity the way a device would register it', () => {
    // `core` writes these rows itself, but through the same schema `hub` is held to: a unit that
    // does not belong to the class would be refused from a device and must be refused here.
    for (const entity of SYSTEM_ENTITIES) {
      expect(entityRegistrationSchema.safeParse(entity).success, entity.entityId).toBe(true);
    }
  });

  it('carries each reading exactly once, under ids that do not repeat', () => {
    expect(SYSTEM_ENTITIES.map((entity) => entity.reading).sort()).toEqual(
      [...SYSTEM_READINGS].sort(),
    );
    expect(new Set(SYSTEM_ENTITIES.map((entity) => entity.entityId)).size).toBe(
      SYSTEM_ENTITIES.length,
    );
  });
});

describe('systemMonitorSnapshotSchema', () => {
  it('reads a snapshot off the wire, with its times as dates', () => {
    const parsed = systemMonitorSnapshotSchema.parse(snapshot());

    expect(parsed.samples[1]?.at).toBeInstanceOf(Date);
    expect(parsed.samples[0]?.transmitRate).toBeNull();
  });

  it('refuses more samples than the window holds', () => {
    expect(systemMonitorSnapshotSchema.safeParse(snapshot(SYSTEM_SAMPLE_WINDOW + 1)).success).toBe(
      false,
    );
  });

  it('accepts a machine whose network and disk could not be read', () => {
    expect(
      systemMonitorSnapshotSchema.safeParse({ ...snapshot(), network: null, disk: null }).success,
    ).toBe(true);
  });
});
