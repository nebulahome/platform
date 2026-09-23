import { describe, expect, it } from 'vitest';

import type { SystemMonitorSample } from '@nebula-home/contracts';

import {
  averageReadings,
  byteRate,
  composeDiskUsage,
  cpuPercent,
  diskPercent,
  roundTo,
  SampleWindow,
  totalCpuTimes,
} from './system-samples.js';

/**
 * A sample with every field set, for tests that vary one of them.
 *
 * @param second - Seconds past noon it was taken at.
 * @param fields - What differs from the default.
 * @returns The sample.
 */
function sample(second: number, fields: Partial<SystemMonitorSample> = {}): SystemMonitorSample {
  return {
    at: new Date(Date.UTC(2026, 8, 23, 12, 0, second)),
    cpuPercent: 10,
    memoryUsedBytes: 4,
    memoryTotalBytes: 16,
    receiveRate: 100,
    transmitRate: 50,
    ...fields,
  };
}

describe('cpuPercent', () => {
  it('is the busy share of the time counted between two readings, over every core', () => {
    const before = totalCpuTimes([
      { times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } },
      { times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } },
    ]);
    const after = totalCpuTimes([
      { times: { user: 175, nice: 0, sys: 75, idle: 900, irq: 0 } },
      { times: { user: 100, nice: 0, sys: 50, idle: 1000, irq: 0 } },
    ]);

    // 100 busy out of 300 counted.
    expect(cpuPercent(before, after)).toBeCloseTo(33.33, 2);
  });

  it('is zero when no time was counted, rather than a division by zero', () => {
    const same = { busy: 10, total: 20 };

    expect(cpuPercent(same, same)).toBe(0);
  });
});

describe('byteRate', () => {
  it('is bytes per second between two readings', () => {
    expect(byteRate(1000, 21_000, 10_000)).toBe(2000);
  });

  it('has no rate across a counter that went backwards', () => {
    // An interface that restarted counts from zero again; the difference would be a large
    // negative number, and pretending it was zero would be a lie of its own.
    expect(byteRate(50_000, 100, 10_000)).toBeNull();
  });

  it('has no rate when no time passed', () => {
    expect(byteRate(0, 100, 0)).toBeNull();
  });
});

describe('SampleWindow', () => {
  it('keeps the newest samples, oldest first, up to its size', () => {
    const window = new SampleWindow(2);

    window.push(sample(0));
    window.push(sample(10));
    window.push(sample(20));

    expect(window.all().map((each) => each.at.getUTCSeconds())).toEqual([10, 20]);
  });

  it('hands out the samples taken after a moment, not at it', () => {
    const window = new SampleWindow(10);

    window.push(sample(0));
    window.push(sample(10));
    window.push(sample(20));

    expect(
      window
        .since(new Date(Date.UTC(2026, 8, 23, 12, 0, 10)))
        .map((each) => each.at.getUTCSeconds()),
    ).toEqual([20]);
  });
});

describe('averageReadings', () => {
  it('averages the processor, the memory and the network, and reads the disk as it is', () => {
    const readings = averageReadings(
      [
        sample(0, { cpuPercent: 10, memoryUsedBytes: 4, receiveRate: 100, transmitRate: 10 }),
        sample(10, { cpuPercent: 30, memoryUsedBytes: 8, receiveRate: 300, transmitRate: 30 }),
      ],
      { usedBytes: 30, freeBytes: 70 },
    );

    expect(readings).toEqual({ cpu: 20, memory: 37.5, disk: 30, download: 200, upload: 20 });
  });

  it('leaves a reading nothing measured without a value, rather than at zero', () => {
    // "No traffic" and "cannot tell" are different answers to an automation.
    const readings = averageReadings([sample(0, { receiveRate: null, transmitRate: null })], null);

    expect([readings.download, readings.upload, readings.disk]).toEqual([null, null, null]);
  });

  it('skips a missing rate without dragging the mean down', () => {
    const readings = averageReadings(
      [sample(0, { receiveRate: null }), sample(10, { receiveRate: 400 })],
      null,
    );

    expect(readings.download).toBe(400);
  });
});

describe('diskPercent', () => {
  it('counts what is used against what could be used, as df does', () => {
    // Root's reserve is in neither: a volume nobody else may write to is full for our purposes.
    expect(diskPercent({ usedBytes: 45, freeBytes: 45 })).toBe(50);
  });

  it('has no share for a volume with no room at all', () => {
    expect(diskPercent({ usedBytes: 0, freeBytes: 0 })).toBeNull();
  });
});

describe('roundTo', () => {
  it('rounds to the digits the entity shows', () => {
    expect([roundTo(12.345, 0), roundTo(12.345, 1), roundTo(12.5, 0)]).toEqual([12, 12.3, 13]);
  });
});

describe('composeDiskUsage', () => {
  it('puts the platform first, then packages, then backups, and calls the rest other', () => {
    const disk = composeDiskUsage(
      { totalBytes: 1000, freeBytes: 400, usedBytes: 600 },
      [
        { id: 'backups', kind: 'backups', bytes: 50, parts: [] },
        { id: 'package:nvr', kind: 'package', bytes: 100, parts: [] },
        { id: 'core', kind: 'core', bytes: 150, parts: [] },
      ],
      null,
    );

    expect(disk.categories.map((category) => category.id)).toEqual([
      'core',
      'package:nvr',
      'backups',
    ]);
    expect(disk.otherBytes).toBe(300);
  });

  it('never leaves other below zero when the categories are on another disk', () => {
    // In development the database lives on Docker's own disk, not on the volume measured.
    const disk = composeDiskUsage(
      { totalBytes: 1000, freeBytes: 900, usedBytes: 100 },
      [{ id: 'core', kind: 'core', bytes: 500, parts: [] }],
      null,
    );

    expect(disk.otherBytes).toBe(0);
  });
});
