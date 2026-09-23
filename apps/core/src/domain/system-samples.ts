/**
 * The arithmetic of the system monitor, apart from the reading of the machine.
 *
 * Everything the machine reports is a counter or a total - processor time since boot, bytes
 * since the interface came up, blocks on a volume - and what a person wants is a rate or a
 * share. Turning one into the other is where the mistakes are made (a counter that restarts, a
 * division by an interval of zero), so it lives here, where a test can reach it without a
 * machine.
 */
import type {
  DiskCategory,
  DiskUsage,
  SystemMonitorSample,
  SystemReading,
} from '@nebula-home/contracts';

/** The processor time of every core added together, in milliseconds. */
export type CpuTotals = {
  /** Time spent doing anything but waiting. */
  readonly busy: number;

  /** All the time counted, idle included. */
  readonly total: number;
};

/** What `os.cpus()` reports for one core. */
export type CoreTimes = {
  readonly times: {
    readonly user: number;
    readonly nice: number;
    readonly sys: number;
    readonly idle: number;
    readonly irq: number;
  };
};

/**
 * Adds up the time of every core.
 *
 * @param cores - What `os.cpus()` returned.
 * @returns The busy and total time, across all of them.
 */
export function totalCpuTimes(cores: readonly CoreTimes[]): CpuTotals {
  let busy = 0;
  let total = 0;

  for (const core of cores) {
    const { user, nice, sys, idle, irq } = core.times;

    busy += user + nice + sys + irq;
    total += user + nice + sys + idle + irq;
  }

  return { busy, total };
}

/**
 * How busy the processor was between two readings.
 *
 * @param before - The earlier totals.
 * @param after - The later totals.
 * @returns A percentage between 0 and 100; 0 when no time was counted in between.
 */
export function cpuPercent(before: CpuTotals, after: CpuTotals): number {
  const total = after.total - before.total;

  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, ((after.busy - before.busy) / total) * 100));
}

/**
 * Bytes per second between two readings of one counter.
 *
 * @param before - The earlier count.
 * @param after - The later count.
 * @param elapsedMs - How far apart the two were taken.
 * @returns The rate, or null when the counter went backwards - an interface that restarted, or
 * a 32-bit counter that wrapped - or no time passed. Neither has an honest rate.
 */
export function byteRate(before: number, after: number, elapsedMs: number): number | null {
  if (elapsedMs <= 0 || after < before) {
    return null;
  }

  return ((after - before) * 1000) / elapsedMs;
}

/** The most recent samples, oldest first, up to a fixed number. */
export class SampleWindow {
  readonly #capacity: number;
  #samples: SystemMonitorSample[] = [];

  /**
   * Builds an empty window.
   *
   * @param capacity - How many samples it keeps before dropping the oldest.
   */
  public constructor(capacity: number) {
    this.#capacity = capacity;
  }

  /**
   * Adds a sample, dropping the oldest when the window is full.
   *
   * @param sample - The newest reading.
   */
  public push(sample: SystemMonitorSample): void {
    this.#samples = [...this.#samples, sample].slice(-this.#capacity);
  }

  /**
   * Every sample held.
   *
   * @returns A copy, oldest first.
   */
  public all(): SystemMonitorSample[] {
    return [...this.#samples];
  }

  /**
   * The samples taken after a moment.
   *
   * @param time - The moment; a sample taken exactly then is excluded.
   * @returns Those samples, oldest first.
   */
  public since(time: Date): SystemMonitorSample[] {
    return this.#samples.filter((sample) => sample.at.getTime() > time.getTime());
  }
}

/** Each system entity's reading, or null when it has none to give. */
export type SystemReadings = Readonly<Record<SystemReading, number | null>>;

/**
 * The mean of some numbers, or null for none.
 *
 * @param values - The numbers.
 * @returns Their mean.
 */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The share of a volume in use, the way `df` counts it.
 *
 * Used over used-plus-available rather than over the total: a Linux volume keeps a few percent
 * for root, and a disk that nobody else can write to is full for every purpose that matters here.
 *
 * @param disk - The volume.
 * @returns A percentage, or null for a volume with no room at all.
 */
export function diskPercent(disk: Pick<DiskUsage, 'usedBytes' | 'freeBytes'>): number | null {
  const room = disk.usedBytes + disk.freeBytes;

  return room === 0 ? null : (disk.usedBytes / room) * 100;
}

/**
 * What the system entities read over a stretch of samples.
 *
 * The processor, the memory and the network are averaged, so a busy few seconds does not
 * decide an automation. The disk is not: it barely moves, and its latest reading is its truth.
 *
 * @param samples - The samples taken since the last state.
 * @param disk - The volume as it stands, or null when it could not be read.
 * @returns One reading per entity.
 */
export function averageReadings(
  samples: readonly SystemMonitorSample[],
  disk: Pick<DiskUsage, 'usedBytes' | 'freeBytes'> | null,
): SystemReadings {
  return {
    cpu: mean(samples.map((sample) => sample.cpuPercent)),
    memory: mean(
      samples
        .filter((sample) => sample.memoryTotalBytes > 0)
        .map((sample) => (sample.memoryUsedBytes / sample.memoryTotalBytes) * 100),
    ),
    disk: disk === null ? null : diskPercent(disk),
    download: mean(samples.flatMap((sample) => sample.receiveRate ?? [])),
    upload: mean(samples.flatMap((sample) => sample.transmitRate ?? [])),
  };
}

/**
 * Rounds a reading to the digits the entity displays.
 *
 * @param value - The reading.
 * @param digits - How many decimal places.
 * @returns The rounded number.
 */
export function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;

  return Math.round(value * scale) / scale;
}

/** Where a category sorts: the platform first, then packages, then backups. */
const CATEGORY_ORDER: Readonly<Record<DiskCategory['kind'], number>> = {
  core: 0,
  package: 1,
  backups: 2,
};

/**
 * Puts the volume and the counted categories together.
 *
 * @param volume - The volume's size and free space, and what is in use.
 * @param volume.totalBytes - Its size.
 * @param volume.freeBytes - What an unprivileged process could still write.
 * @param volume.usedBytes - What is in use.
 * @param categories - What the platform could account for.
 * @param measuredAt - When the categories were counted, or null before the first count.
 * @returns The disk as the page draws it.
 */
export function composeDiskUsage(
  volume: { readonly totalBytes: number; readonly freeBytes: number; readonly usedBytes: number },
  categories: readonly DiskCategory[],
  measuredAt: Date | null,
): DiskUsage {
  const accounted = categories.reduce((sum, category) => sum + category.bytes, 0);

  return {
    totalBytes: volume.totalBytes,
    freeBytes: volume.freeBytes,
    usedBytes: volume.usedBytes,
    otherBytes: Math.max(0, volume.usedBytes - accounted),
    categories: [...categories].sort(
      (left, right) =>
        CATEGORY_ORDER[left.kind] - CATEGORY_ORDER[right.kind] || left.id.localeCompare(right.id),
    ),
    measuredAt,
  };
}
