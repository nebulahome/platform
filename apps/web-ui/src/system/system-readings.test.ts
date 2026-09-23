import { describe, expect, it } from 'vitest';

import type { DiskUsage, SystemMonitorSample } from '@nebula-home/contracts';

import {
  categoryLabel,
  diskPercent,
  diskSegments,
  isPartlyElsewhere,
  memoryPercent,
  networkSeries,
  partLabel,
} from './system-readings';

/** A volume of 1000 bytes: the platform's 100, 300 of everything else, 600 free. */
const DISK: DiskUsage = {
  totalBytes: 1000,
  freeBytes: 600,
  usedBytes: 400,
  otherBytes: 300,
  categories: [
    { id: 'core', kind: 'core', bytes: 100, parts: [{ id: 'database', bytes: 100 }] },
    { id: 'backups', kind: 'backups', bytes: 0, parts: [] },
  ],
  measuredAt: null,
};

/**
 * A sample with the fields a test varies.
 *
 * @param fields - What differs from the default.
 * @returns The sample.
 */
function sample(fields: Partial<SystemMonitorSample>): SystemMonitorSample {
  return {
    at: new Date('2026-09-23T12:00:00.000Z'),
    cpuPercent: 5,
    memoryUsedBytes: 4,
    memoryTotalBytes: 16,
    receiveRate: null,
    transmitRate: null,
    ...fields,
  };
}

describe('diskSegments', () => {
  it('draws the platform, everything else and the free space end to end, leaving out empty slices', () => {
    expect(diskSegments(DISK).map((segment) => [segment.id, segment.label, segment.share])).toEqual(
      [
        ['core', 'NebulaHome', 0.1],
        ['other', 'Everything else', 0.3],
        ['free', 'Free', 0.6],
      ],
    );
  });

  it('lengthens the bar rather than cutting a slice short when a category is elsewhere', () => {
    const disk: DiskUsage = { ...DISK, usedBytes: 50, otherBytes: 0, freeBytes: 50 };

    expect(isPartlyElsewhere(disk)).toBe(true);
    expect(diskSegments(disk).reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
  });
});

describe('diskPercent', () => {
  it('counts what is used against what could be used', () => {
    expect(diskPercent(DISK)).toBe(40);
  });
});

describe('the names on the page', () => {
  it('names each kind of category, a package by its id', () => {
    expect([
      categoryLabel({ id: 'core', kind: 'core' }),
      categoryLabel({ id: 'package:nvr', kind: 'package' }),
      categoryLabel({ id: 'backups', kind: 'backups' }),
    ]).toEqual(['NebulaHome', 'Package nvr', 'Backups']);
  });

  it('names the parts it knows, and leaves a directory it does not under its own name', () => {
    expect([
      partLabel('database'),
      partLabel('cache/maps'),
      partLabel('hub/integrations'),
      partLabel('exports/daily'),
    ]).toEqual(['Database', 'Map tiles', 'Integrations', 'exports/daily']);
  });
});

describe('the series', () => {
  it('reads the memory as a share of what the machine has', () => {
    expect(memoryPercent(sample({ memoryUsedBytes: 4, memoryTotalBytes: 16 }))).toBe(25);
  });

  it('leaves a gap where the network has no rate, rather than a zero', () => {
    expect(networkSeries([sample({ receiveRate: null, transmitRate: 20 })])).toEqual([
      { at: Date.parse('2026-09-23T12:00:00.000Z'), download: null, upload: 20 },
    ]);
  });
});
