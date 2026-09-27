import { describe, expect, it } from 'vitest';

import type { ContainerStats } from '../docker/engine-schemas.js';

import { cpuPercent, meanOf, memoryLimitOf, memoryUsedOf } from './stats.js';

/**
 * One reading of the memory counters.
 *
 * @param memory - What `memory_stats` holds.
 * @returns The reading.
 */
function reading(memory: ContainerStats['memory_stats']): ContainerStats {
  return { cpu_stats: { cpu_usage: { total_usage: 0 } }, memory_stats: memory };
}

describe('cpuPercent', () => {
  it("is the container's share of the whole machine between two readings", () => {
    expect(
      cpuPercent({ container: 1_000, system: 100_000 }, { container: 6_000, system: 200_000 }),
    ).toBe(5);
  });

  it('says nothing across a restart, when the counter went back to zero', () => {
    expect(cpuPercent({ container: 9_000, system: 1 }, { container: 10, system: 2 })).toBe(null);
  });

  it('says nothing when the engine does not count the machine', () => {
    expect(
      cpuPercent({ container: 1, system: undefined }, { container: 2, system: undefined }),
    ).toBe(null);
  });
});

describe('memoryUsedOf', () => {
  it('leaves out the page cache the kernel can take back', () => {
    expect(memoryUsedOf(reading({ usage: 500, stats: { inactive_file: 120 } }))).toBe(380);
  });

  it('reads the older names for it too', () => {
    expect(memoryUsedOf(reading({ usage: 500, stats: { cache: 100 } }))).toBe(400);
  });

  it('says nothing when the engine does not count it', () => {
    expect(memoryUsedOf(reading({}))).toBe(null);
  });
});

describe('memoryLimitOf', () => {
  it("is the container's limit when it has one", () => {
    expect(memoryLimitOf(reading({ limit: 256 }), 1024)).toBe(256);
  });

  it("is the machine's memory when the limit is none, or larger than the machine", () => {
    expect(memoryLimitOf(reading({ limit: 9_000_000 }), 1024)).toBe(1024);
    expect(memoryLimitOf(reading({}), 1024)).toBe(1024);
  });
});

describe('meanOf', () => {
  it('is null for nothing', () => {
    expect(meanOf([])).toBe(null);
    expect(meanOf([2, 4])).toBe(3);
  });
});
