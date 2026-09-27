/**
 * What a container's counters say about how busy it is.
 *
 * Docker hands over counters, not rates: the processor time the container has used since it
 * started, and the processor time of the whole machine. A share is the difference of two
 * readings, taken one sample interval apart, so it describes that interval rather than a moment
 * - the same way the system monitor measures the machine.
 *
 * The processor share is of the **whole machine**, 0 to 100, not Docker's own figure, which is
 * per core and reaches 400 on four: "above 90" must mean the same for a container as for the
 * machine it runs on.
 */
import type { ContainerStats } from '../docker/engine-schemas.js';

/** The two counters a processor share is the difference of. */
export type CpuCounters = {
  /** The container's processor time, in nanoseconds. */
  readonly container: number;

  /** The machine's, in nanoseconds; absent on an engine that does not say. */
  readonly system: number | undefined;
};

/**
 * The counters of one reading.
 *
 * @param stats - What Docker answered.
 * @returns The two counters.
 */
export function cpuCountersOf(stats: ContainerStats): CpuCounters {
  return {
    container: stats.cpu_stats.cpu_usage.total_usage,
    system: stats.cpu_stats.system_cpu_usage,
  };
}

/**
 * How much of the machine's processor a container used between two readings.
 *
 * @param previous - The earlier reading.
 * @param current - The later one.
 * @returns A percentage of the whole machine, or null when the two cannot be compared: the
 * machine's counter is missing, or went backwards (the container was restarted in between).
 */
export function cpuPercent(previous: CpuCounters, current: CpuCounters): number | null {
  if (previous.system === undefined || current.system === undefined) {
    return null;
  }

  const container = current.container - previous.container;
  const system = current.system - previous.system;

  if (container < 0 || system <= 0) {
    return null;
  }

  return Math.min(100, (container / system) * 100);
}

/**
 * How much memory a container uses, as `docker stats` counts it: what it holds, less the page
 * cache the kernel can take back at any moment.
 *
 * @param stats - What Docker answered.
 * @returns Bytes, or null when the engine did not say.
 */
export function memoryUsedOf(stats: ContainerStats): number | null {
  const usage = stats.memory_stats.usage;

  if (usage === undefined) {
    return null;
  }

  const detail = stats.memory_stats.stats ?? {};

  // cgroup v2 calls it `inactive_file`, v1 `total_inactive_file`, and older engines `cache`.
  const reclaimable =
    detail['inactive_file'] ?? detail['total_inactive_file'] ?? detail['cache'] ?? 0;

  return Math.max(0, usage - reclaimable);
}

/**
 * The memory a container may use: its limit, or the machine's when it has none.
 *
 * Docker reports no limit as the machine's whole memory, or as a number larger than it; either
 * way the machine is the honest ceiling.
 *
 * @param stats - What Docker answered.
 * @param machineBytes - The machine's memory.
 * @returns Bytes.
 */
export function memoryLimitOf(stats: ContainerStats, machineBytes: number): number {
  const limit = stats.memory_stats.limit;

  return limit === undefined || limit <= 0 || limit > machineBytes ? machineBytes : limit;
}

/**
 * The mean of some numbers.
 *
 * @param values - The numbers.
 * @returns Their mean, or null for none.
 */
export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
