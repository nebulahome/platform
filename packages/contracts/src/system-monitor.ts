/**
 * The system monitor: how the machine the platform runs on is doing.
 *
 * `core` samples the host every few seconds - the processor, the memory, the volume the data
 * lives on and the network - keeps the last quarter of an hour of samples in memory, and hands
 * them to the API over the bus. The same readings, averaged over a minute, are the state of the
 * system entities, which belong to the one device the platform creates for itself.
 *
 * Not called telemetry, and not health, on purpose. Telemetry is the numeric history of the
 * house's own sensors (`history.telemetry`), and health is the liveness endpoint every service
 * answers; a page named after either would promise something other than what it shows.
 *
 * Defined in ARCHITECTURE.md 4.1.
 */
import { z } from 'zod';

import type { entityRegistrationSchema } from './registration.js';
import { timestampSchema } from './timestamp.js';

/**
 * The id of the device the platform creates for itself, and the `source` of its entities.
 *
 * The same word on purpose: the devices page groups entities under a device by their source, so
 * the system entities land under the system device with nothing to translate.
 */
export const SYSTEM_DEVICE_ID = 'system';

/**
 * Device ids the platform keeps for itself.
 *
 * A device id becomes the `source` of every entity it has, and these two are the sources of the
 * entities the platform produces: a device called `system` would have its entities mistaken for
 * the platform's own, and the other way round.
 */
export const RESERVED_DEVICE_IDS: readonly string[] = [SYSTEM_DEVICE_ID, 'derived'];

/** How many samples `core` keeps: a quarter of an hour at the default ten seconds. */
export const SYSTEM_SAMPLE_WINDOW = 90;

/** A byte count. Safe integers go to eight petabytes, which is more disk than a house has. */
const byteCountSchema = z.int().min(0);

/** One reading of the host, taken every sample interval. */
export const systemMonitorSampleSchema = z.object({
  /** When it was taken. */
  at: timestampSchema,

  /** How busy the processor was since the sample before, across every core. */
  cpuPercent: z.number().min(0).max(100),

  /** Memory in use: the total less what the system could hand out without swapping. */
  memoryUsedBytes: byteCountSchema,
  memoryTotalBytes: byteCountSchema,

  /**
   * Bytes per second received and sent since the sample before. Null where the network cannot
   * be read on this platform, and on the sample after a counter went backwards - an interface
   * that restarted has no honest rate for that interval.
   */
  receiveRate: z.number().min(0).nullable(),
  transmitRate: z.number().min(0).nullable(),
});

/** One reading of the host. */
export type SystemMonitorSample = z.output<typeof systemMonitorSampleSchema>;

/** What a slice of the disk belongs to. */
export const DISK_CATEGORY_KINDS = ['core', 'package', 'backups'] as const;

/** What a slice of the disk belongs to. */
export type DiskCategoryKind = (typeof DISK_CATEGORY_KINDS)[number];

/** One named part of a category: the database, the map tiles. */
export const diskPartSchema = z.object({
  id: z.string().min(1).max(64),
  bytes: byteCountSchema,
});

/** One named part of a category. */
export type DiskPart = z.output<typeof diskPartSchema>;

/**
 * One slice of the disk the platform can account for.
 *
 * `core` is the platform itself: its database and what it keeps in its data directory. Each
 * installed package is one slice, and so are the backups, once either exists - the categories
 * are found in the data directory rather than listed here, so a package installed next year
 * appears without a release of this file.
 */
export const diskCategorySchema = z.object({
  /** `core`, `backups`, or `package:<id>`. */
  id: z.string().min(1).max(80),
  kind: z.enum(DISK_CATEGORY_KINDS),
  bytes: byteCountSchema,

  /** What it is made of, largest first; empty when it is one thing. */
  parts: z.array(diskPartSchema),
});

/** One slice of the disk the platform can account for. */
export type DiskCategory = z.output<typeof diskCategorySchema>;

/**
 * The volume the data lives on, and what is on it.
 *
 * The totals are read with every sample; the categories are counted by walking directories,
 * which is slow on a large disk, so they are counted every few minutes and carry their own
 * time. `otherBytes` is what is used and belongs to none of them - the operating system, other
 * programs - and never goes below zero: in development the database lives on Docker's own disk,
 * so the categories can add up to more than this volume holds.
 */
export const diskUsageSchema = z.object({
  totalBytes: byteCountSchema,
  freeBytes: byteCountSchema,
  usedBytes: byteCountSchema,
  otherBytes: byteCountSchema,
  categories: z.array(diskCategorySchema),

  /** When the categories were last counted; null until the first count has finished. */
  measuredAt: timestampSchema.nullable(),
});

/** The volume the data lives on, and what is on it. */
export type DiskUsage = z.output<typeof diskUsageSchema>;

/** The machine itself. */
export const systemHostSchema = z.object({
  hostname: z.string(),

  /** Node's name for it: `linux`, `win32`, `darwin`. */
  platform: z.string(),

  /** The operating system as a person would name it: `Windows 11 Pro`, `Linux 6.8.0`. */
  osName: z.string(),
  arch: z.string(),
  uptimeSeconds: z.number().min(0),
  cpuModel: z.string(),
  cpuCount: z.int().min(1),
});

/** The machine itself. */
export type SystemHost = z.output<typeof systemHostSchema>;

/** What the network has carried since it was counted from, and through which interface. */
export const networkTotalsSchema = z.object({
  /** The interface measured, or null where every interface is summed (Windows). */
  interface: z.string().nullable(),
  receivedBytes: byteCountSchema,
  transmittedBytes: byteCountSchema,
});

/** What the network has carried. */
export type NetworkTotals = z.output<typeof networkTotalsSchema>;

/**
 * Everything the system monitor knows, as `core` answers it and the API serves it.
 *
 * No path on the filesystem is in it: where the data directory is is the server's business,
 * and a page that showed it would be handing out a map of the machine.
 */
export const systemMonitorSnapshotSchema = z.object({
  host: systemHostSchema,

  /** How far apart the samples are, so a chart can space them without guessing. */
  sampleIntervalMs: z.int().min(1),

  /** Oldest first. Empty for a few seconds after `core` starts. */
  samples: z.array(systemMonitorSampleSchema).max(SYSTEM_SAMPLE_WINDOW),

  /** Null where the network cannot be read on this platform. */
  network: networkTotalsSchema.nullable(),

  /** Null when the data volume could not be read at all. */
  disk: diskUsageSchema.nullable(),
});

/** Everything the system monitor knows. */
export type SystemMonitorSnapshot = z.output<typeof systemMonitorSnapshotSchema>;

/** Asks `core` for the system monitor. There is nothing to ask with. */
export const systemMonitorRequestSchema = z.strictObject({});

/** Asks `core` for the system monitor. */
export type SystemMonitorRequest = z.output<typeof systemMonitorRequestSchema>;

/** Which reading a system entity carries. */
export const SYSTEM_READINGS = ['cpu', 'memory', 'disk', 'download', 'upload'] as const;

/** Which reading a system entity carries. */
export type SystemReading = (typeof SYSTEM_READINGS)[number];

/** One system entity: what it registers as, and which reading is its state. */
export type SystemEntityDefinition = z.input<typeof entityRegistrationSchema> & {
  readonly reading: SystemReading;
};

/**
 * The entities the system device has, one per reading.
 *
 * The disk is one entity, not one per category: an automation wants to know the disk is
 * filling up, and which package filled it is a question for the page. Percentages rather than
 * bytes for the three that have a ceiling, so "above 90" means the same thing on every machine.
 */
export const SYSTEM_ENTITIES = [
  {
    reading: 'cpu',
    entityId: 'sensor.system_cpu_usage',
    name: 'Processor usage',
    icon: 'cpu',
    unitOfMeasurement: '%',
    stateClass: 'measurement',
    displayPrecision: 0,
    capabilities: { sensor_numeric: {} },
  },
  {
    reading: 'memory',
    entityId: 'sensor.system_memory_usage',
    name: 'Memory usage',
    icon: 'memory-stick',
    unitOfMeasurement: '%',
    stateClass: 'measurement',
    displayPrecision: 0,
    capabilities: { sensor_numeric: {} },
  },
  {
    reading: 'disk',
    entityId: 'sensor.system_disk_usage',
    name: 'Disk usage',
    icon: 'hard-drive',
    unitOfMeasurement: '%',
    stateClass: 'measurement',
    displayPrecision: 0,
    capabilities: { sensor_numeric: {} },
  },
  {
    reading: 'download',
    entityId: 'sensor.system_network_download',
    name: 'Network download',
    icon: 'download',
    deviceClass: 'data_rate',
    unitOfMeasurement: 'B/s',
    stateClass: 'measurement',
    displayPrecision: 0,
    capabilities: { sensor_numeric: {} },
  },
  {
    reading: 'upload',
    entityId: 'sensor.system_network_upload',
    name: 'Network upload',
    icon: 'upload',
    deviceClass: 'data_rate',
    unitOfMeasurement: 'B/s',
    stateClass: 'measurement',
    displayPrecision: 0,
    capabilities: { sensor_numeric: {} },
  },
] as const satisfies readonly SystemEntityDefinition[];
