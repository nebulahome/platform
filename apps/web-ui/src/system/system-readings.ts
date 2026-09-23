/**
 * What the system monitor's numbers mean, before anything is drawn.
 *
 * The page decides how things look; what a share of the disk is, which slice comes first and
 * what a part is called are decided here, where a test can reach them without a browser
 * (RULES.md 15.1).
 */
import type {
  DiskCategory,
  DiskUsage,
  SystemMonitorSample,
  SystemMonitorSnapshot,
} from '@nebula-home/contracts';

/** One point of a chart: when, and the value then, or null for a gap. */
export type ChartPoint = {
  /** Milliseconds since the epoch, which is what a time axis scales. */
  readonly at: number;
  readonly value: number | null;
};

/** One point of the network chart: both directions at once. */
export type NetworkPoint = {
  readonly at: number;
  readonly download: number | null;
  readonly upload: number | null;
};

/**
 * The newest sample.
 *
 * @param snapshot - What the monitor answered.
 * @returns The last sample, or undefined in the seconds after `core` started.
 */
export function latestSample(snapshot: SystemMonitorSnapshot): SystemMonitorSample | undefined {
  return snapshot.samples.at(-1);
}

/**
 * The share of the memory in use.
 *
 * @param sample - One reading.
 * @returns A percentage, or null for a machine that reported no memory at all.
 */
export function memoryPercent(sample: SystemMonitorSample): number | null {
  return sample.memoryTotalBytes === 0
    ? null
    : (sample.memoryUsedBytes / sample.memoryTotalBytes) * 100;
}

/**
 * The processor over the window.
 *
 * @param samples - Oldest first.
 * @returns One point per sample.
 */
export function cpuSeries(samples: readonly SystemMonitorSample[]): ChartPoint[] {
  return samples.map((sample) => ({ at: sample.at.getTime(), value: sample.cpuPercent }));
}

/**
 * The memory over the window.
 *
 * @param samples - Oldest first.
 * @returns One point per sample.
 */
export function memorySeries(samples: readonly SystemMonitorSample[]): ChartPoint[] {
  return samples.map((sample) => ({ at: sample.at.getTime(), value: memoryPercent(sample) }));
}

/**
 * The network over the window, both directions.
 *
 * @param samples - Oldest first.
 * @returns One point per sample; a direction with no rate is a gap, not a zero.
 */
export function networkSeries(samples: readonly SystemMonitorSample[]): NetworkPoint[] {
  return samples.map((sample) => ({
    at: sample.at.getTime(),
    download: sample.receiveRate,
    upload: sample.transmitRate,
  }));
}

/**
 * The share of the volume in use, the way `df` counts it: against what could be used.
 *
 * @param disk - The volume.
 * @returns A percentage, or null for a volume with no room at all.
 */
export function diskPercent(disk: DiskUsage): number | null {
  const room = disk.usedBytes + disk.freeBytes;

  return room === 0 ? null : (disk.usedBytes / room) * 100;
}

/** What a slice of the disk bar is. */
export type DiskSegmentKind = DiskCategory['kind'] | 'other' | 'free';

/** One slice of the disk bar. */
export type DiskSegment = {
  readonly id: string;
  readonly kind: DiskSegmentKind;
  readonly label: string;
  readonly bytes: number;

  /** Its width, as a fraction of the whole bar. */
  readonly share: number;
};

/**
 * Names a category of the disk.
 *
 * @param category - The category.
 * @returns `NebulaHome`, `Backups`, or the package's id.
 */
export function categoryLabel(category: Pick<DiskCategory, 'id' | 'kind'>): string {
  if (category.kind === 'core') {
    return 'NebulaHome';
  }

  if (category.kind === 'backups') {
    return 'Backups';
  }

  return `Package ${category.id.replace(/^package:/, '')}`;
}

/** What each part of the platform is called on the page. */
const PART_LABELS: Readonly<Record<string, string>> = {
  database: 'Database',
  'map-tiles': 'Map tiles',
  files: 'Other files',
};

/**
 * Names a part of a category.
 *
 * @param id - The part, as `core` counted it: a directory name, or `database`.
 * @returns What the page calls it; a directory nobody named here keeps its own name.
 */
export function partLabel(id: string): string {
  return PART_LABELS[id] ?? id;
}

/**
 * Cuts the disk into the slices the bar draws: each category, what is used by anything else,
 * and what is free.
 *
 * The bar is the categories, the rest and the free space end to end. That is the volume, except
 * where a category is not on it - the database, in development, lives on Docker's own disk -
 * and then the bar is a little longer than the volume rather than a slice being cut short.
 *
 * @param disk - The volume and what the platform counted on it.
 * @returns The slices, in the order they are drawn; empty ones are left out.
 */
export function diskSegments(disk: DiskUsage): DiskSegment[] {
  const slices = [
    ...disk.categories.map((category) => ({
      id: category.id,
      kind: category.kind,
      label: categoryLabel(category),
      bytes: category.bytes,
    })),
    { id: 'other', kind: 'other' as const, label: 'Everything else', bytes: disk.otherBytes },
    { id: 'free', kind: 'free' as const, label: 'Free', bytes: disk.freeBytes },
  ].filter((slice) => slice.bytes > 0);
  const total = slices.reduce((sum, slice) => sum + slice.bytes, 0);

  return slices.map((slice) => ({ ...slice, share: total === 0 ? 0 : slice.bytes / total }));
}

/**
 * Whether some of what the platform counted is on another disk than the one measured.
 *
 * @param disk - The volume and the categories.
 * @returns True when the categories add up to more than the volume has in use.
 */
export function isPartlyElsewhere(disk: DiskUsage): boolean {
  return disk.categories.reduce((sum, category) => sum + category.bytes, 0) > disk.usedBytes;
}
