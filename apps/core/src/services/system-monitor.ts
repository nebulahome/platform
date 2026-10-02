/**
 * The system monitor: sampling the machine, and turning the samples into entity states.
 *
 * Three clocks, because the three things move at different speeds. The machine is sampled every
 * few seconds, into a window of the last quarter of an hour that the settings page draws. The
 * system entities take a new state once a minute, the mean of the samples in between, so an
 * automation reads a minute rather than a moment. The disk is counted every few minutes, because
 * counting it means walking directories.
 *
 * The entity states go through {@link ingestReport}, the path every report takes, so they are
 * validated, fanned out and written to history like any device's - the only difference is that
 * `core` is the one reporting.
 */
import {
  parseEntityId,
  SYSTEM_ENTITIES,
  SYSTEM_SAMPLE_WINDOW,
  type DiskCategory,
  type DiskUsage,
  type StateReport,
  type SystemMonitorSample,
  type SystemMonitorSnapshot,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { NetworkCounters } from '../domain/network-counters.js';
import {
  averageReadings,
  byteRate,
  composeDiskUsage,
  cpuPercent,
  roundTo,
  SampleWindow,
  type CpuTotals,
} from '../domain/system-samples.js';
import { countDiskCategories, databaseSize } from '../persistence/disk-usage.js';

import { ingestReport, type StateIngestOptions } from './state-ingest.js';
import type { SystemProbes, VolumeReading } from './system-probes.js';

/** How often the disk is counted, unless told otherwise. */
const DEFAULT_DISK_INTERVAL_MS = 5 * 60 * 1000;

/** What the system monitor needs. */
export type SystemMonitorOptions = {
  /** What reads the machine. */
  readonly probes: SystemProbes;

  /** The database, whose size is part of the platform's share of the disk. */
  readonly db: Database;

  /** The data directory: the volume it is on is the one measured, and its contents counted. */
  readonly dataDir: string;

  /** The ingest pipeline the entity states go through. */
  readonly ingest: StateIngestOptions;

  readonly logger: PlatformLogger;

  /** A fresh trace id for each round of states. */
  readonly newTraceId: () => string;

  readonly sampleIntervalMs: number;
  readonly publishIntervalMs: number;

  /** How often the disk is counted; five minutes by default. */
  readonly diskIntervalMs?: number;

  /** The clock; the wall one by default. */
  readonly now?: () => Date;
};

/** Samples the machine and reports what it found. */
export class SystemMonitor {
  readonly #options: SystemMonitorOptions;
  readonly #now: () => Date;
  readonly #window = new SampleWindow(SYSTEM_SAMPLE_WINDOW);
  #timers: NodeJS.Timeout[] = [];
  #cpu: CpuTotals | undefined;
  #network: { readonly counters: NetworkCounters; readonly at: Date } | undefined;
  #volume: VolumeReading | undefined;
  #categories: DiskCategory[] = [];
  #measuredAt: Date | null = null;
  #lastPublishedAt: Date;
  #isSampling = false;
  #isCounting = false;

  /**
   * Builds the monitor without starting it.
   *
   * @param options - The probes, the database, the pipeline and the clocks.
   */
  public constructor(options: SystemMonitorOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
    this.#lastPublishedAt = this.#now();
  }

  /**
   * Takes the first readings and starts the three clocks.
   *
   * The first sample needs something to compare with - the processor and the network are
   * counters - so the baseline is read here and the first sample comes one interval later.
   */
  public async start(): Promise<void> {
    this.#cpu = this.#options.probes.readCpu();

    const counters = await this.#options.probes.readNetwork();

    this.#network = counters === undefined ? undefined : { counters, at: this.#now() };
    this.#volume = await this.#options.probes.readVolume(this.#options.dataDir);
    this.#lastPublishedAt = this.#now();

    void this.countDisk();

    this.#timers = [
      setInterval(() => {
        void this.sample();
      }, this.#options.sampleIntervalMs),
      setInterval(() => {
        this.publish();
      }, this.#options.publishIntervalMs),
      setInterval(() => {
        void this.countDisk();
      }, this.#options.diskIntervalMs ?? DEFAULT_DISK_INTERVAL_MS),
    ];
  }

  /** Stops the clocks. What was sampled stays readable. */
  public stop(): void {
    for (const timer of this.#timers) {
      clearInterval(timer);
    }

    this.#timers = [];
  }

  /**
   * Reads the machine once and adds the reading to the window.
   *
   * Skipped while the previous one is still running, which only a machine struggling badly
   * enough to take ten seconds over `netstat` would cause - and a second one piling on would
   * not help it.
   *
   * @returns The sample taken, or undefined when one was already under way.
   */
  public async sample(): Promise<SystemMonitorSample | undefined> {
    if (this.#isSampling) {
      return undefined;
    }

    this.#isSampling = true;

    try {
      const { probes, dataDir } = this.#options;
      const cpu = probes.readCpu();
      const memory = probes.readMemory();
      const [counters, volume] = await Promise.all([
        probes.readNetwork(),
        probes.readVolume(dataDir),
      ]);
      const at = this.#now();
      const previous = this.#network;
      const elapsedMs = previous === undefined ? 0 : at.getTime() - previous.at.getTime();

      const sample: SystemMonitorSample = {
        at,
        cpuPercent: this.#cpu === undefined ? 0 : cpuPercent(this.#cpu, cpu),
        memoryUsedBytes: memory.usedBytes,
        memoryTotalBytes: memory.totalBytes,
        receiveRate:
          counters === undefined || previous === undefined
            ? null
            : byteRate(previous.counters.receivedBytes, counters.receivedBytes, elapsedMs),
        transmitRate:
          counters === undefined || previous === undefined
            ? null
            : byteRate(previous.counters.transmittedBytes, counters.transmittedBytes, elapsedMs),
      };

      this.#cpu = cpu;
      this.#network = counters === undefined ? undefined : { counters, at };
      this.#volume = volume;
      this.#window.push(sample);

      return sample;
    } finally {
      this.#isSampling = false;
    }
  }

  /**
   * Gives each system entity the mean of the samples since the last time.
   *
   * A reading with nothing behind it - the network on a platform it cannot be read on - makes
   * its entity unavailable rather than zero: "no traffic" and "cannot tell" are different
   * answers, and an automation should be able to tell them apart.
   */
  public publish(): void {
    const samples = this.#window.since(this.#lastPublishedAt);

    if (samples.length === 0) {
      return;
    }

    this.#lastPublishedAt = samples.at(-1)?.at ?? this.#now();

    const readings = averageReadings(samples, this.#disk());
    const { ingest, newTraceId } = this.#options;
    const traceId = newTraceId();

    for (const entity of SYSTEM_ENTITIES) {
      const record = ingest.directory.get(parseEntityId(entity.entityId));

      if (record?.isEnabled !== true) {
        continue;
      }

      const value = readings[entity.reading];
      const report: StateReport =
        value === null
          ? {
              entityId: record.entityId,
              state: ingest.registry.get(record.entityId)?.state ?? {},
              isAvailable: false,
              attributes: {},
            }
          : {
              entityId: record.entityId,
              state: { sensor_numeric: { value: roundTo(value, entity.displayPrecision) } },
              isAvailable: true,
              attributes: {},
            };

      ingestReport(ingest, record, report, traceId);
    }
  }

  /**
   * Counts what the platform keeps on disk.
   *
   * A database that cannot say its size still leaves the data directory worth counting, so the
   * two fail apart. Skipped while a count is already running.
   */
  public async countDisk(): Promise<void> {
    if (this.#isCounting) {
      return;
    }

    this.#isCounting = true;

    try {
      const databaseBytes = await databaseSize(this.#options.db).catch((error: unknown) => {
        this.#options.logger.warn({ err: error }, 'Could not read the size of the database');

        return undefined;
      });

      this.#categories = await countDiskCategories({
        dataDir: this.#options.dataDir,
        databaseBytes,
      });
      this.#measuredAt = this.#now();
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Could not count what is on the disk');
    } finally {
      this.#isCounting = false;
    }
  }

  /**
   * Everything the monitor knows, for the settings page.
   *
   * @returns The host, the window, the network totals and the disk.
   */
  public snapshot(): SystemMonitorSnapshot {
    return {
      host: this.#options.probes.readHost(),
      sampleIntervalMs: this.#options.sampleIntervalMs,
      samples: this.#window.all(),
      network:
        this.#network === undefined
          ? null
          : {
              interface: this.#network.counters.interface,
              receivedBytes: this.#network.counters.receivedBytes,
              transmittedBytes: this.#network.counters.transmittedBytes,
            },
      disk: this.#disk(),
    };
  }

  /**
   * The disk as it last read.
   *
   * @returns The volume and the categories, or null before the volume could be read.
   */
  #disk(): DiskUsage | null {
    return this.#volume === undefined
      ? null
      : composeDiskUsage(this.#volume, this.#categories, this.#measuredAt);
  }
}
