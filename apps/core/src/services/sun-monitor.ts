/**
 * The sun over the house, as two entities of the system device: its elevation and its azimuth.
 *
 * Worked out here every minute from where the house stands (`sun.ts` in the contracts: no
 * service is asked, nothing leaves the house) and handed to the ingest pipeline like any other
 * reading, so the elevation has a history, can be read by an alias and wakes the automations
 * that wait for it to change. Each report carries the phase of the sun and whether it is rising
 * as attributes.
 *
 * The entities exist only while the house has a position: given one, they are written on the
 * system device; cleared, they are deleted - unless an alias reads one, which keeps it,
 * unavailable, as a removed container's entity is kept.
 */
import {
  busSubjects,
  parseEntityId,
  SUN_ENTITIES,
  SYSTEM_DEVICE_ID,
  sunPhaseLabel,
  sunState,
  type GeoPosition,
  type StateReport,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { SYSTEM_DEVICE_NAME, syncSunEntities } from '../persistence/system-entities.js';

import { ingestReport, type StateIngestOptions } from './state-ingest.js';

/** What the monitor needs. */
export type SunMonitorOptions = {
  readonly db: Database;

  /** The ingest pipeline the readings go through, with its directory, registry and cache. */
  readonly ingest: StateIngestOptions;

  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;

  /** The clock. */
  readonly now?: () => Date;

  /** How often the sun is read again: a minute unless said. */
  readonly intervalMs?: number;
};

/** A minute: the sun moves about a quarter of a degree in one. */
const MINUTE_MS = 60_000;

/**
 * Rounds to a tenth.
 *
 * @param value - The number.
 * @returns It, to one decimal.
 */
function toTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The sun's entities, kept in step with the house. */
export class SunMonitor {
  readonly #options: SunMonitorOptions;
  readonly #now: () => Date;
  #position: GeoPosition | null = null;
  #timer: NodeJS.Timeout | undefined;

  /**
   * Builds the monitor without starting it.
   *
   * @param options - The database, the ingest pipeline and the clock.
   */
  public constructor(options: SunMonitorOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Starts reading the sun, at the turn of each minute.
   *
   * The entities are already in step with the house: `core` writes them before it loads the
   * registry, so they are in the directory this reads.
   *
   * @param position - Where the house stands, or null.
   */
  public start(position: GeoPosition | null): void {
    this.#position = position;
    this.publish();
    this.#schedule();
  }

  /**
   * Takes in a change of the house's position: writes or removes the entities, then reads the
   * sun at once.
   *
   * @param position - Where the house now stands, or null.
   */
  public async sync(position: GeoPosition | null): Promise<void> {
    const { db, ingest, logger } = this.#options;
    const outcome = await syncSunEntities(db, position !== null, logger);

    for (const entity of outcome.written) {
      ingest.directory.set({
        entityId: entity.entityId,
        rowId: entity.rowId,
        source: 'system',
        isEnabled: true,
        capabilities: entity.capabilities,
      });
    }

    const rowIds = new Set(outcome.removed.map((entity) => entity.rowId));

    for (const entity of outcome.removed) {
      ingest.directory.remove(entity.entityId);
      ingest.registry.remove(entity.entityId);
    }

    ingest.stateCache.discard((row) => rowIds.has(row.entityId));

    if (outcome.written.length > 0 || outcome.removed.length > 0) {
      ingest.client.publish(busSubjects.deviceEvent('updated'), {
        deviceId: SYSTEM_DEVICE_ID,
        source: 'system',
        name: SYSTEM_DEVICE_NAME,
        entityIds: outcome.written.map((entity) => entity.entityId),
      });
      logger.info(
        { written: outcome.written.length, removed: outcome.removed.length },
        position === null
          ? 'The house has no position: the sun entities are gone'
          : 'The house has a position: the sun entities are there',
      );
    }

    this.#position = position;
    this.publish();
  }

  /**
   * Reports where the sun stands now. Without a position, an entity still there - kept for an
   * alias - is reported unavailable.
   */
  public publish(): void {
    const { ingest, newTraceId } = this.#options;
    const traceId = newTraceId();
    const position = this.#position;
    const state = position === null ? null : sunState(this.#now(), position);

    for (const entity of SUN_ENTITIES) {
      const record = ingest.directory.get(parseEntityId(entity.entityId));

      if (record?.isEnabled !== true) {
        continue;
      }

      const report: StateReport =
        state === null
          ? {
              entityId: record.entityId,
              state: ingest.registry.get(record.entityId)?.state ?? {},
              isAvailable: false,
              attributes: {},
            }
          : {
              entityId: record.entityId,
              state: { sensor_numeric: { value: toTenth(state[entity.reading]) } },
              isAvailable: true,
              attributes: { phase: sunPhaseLabel(state), isRising: state.isRising },
            };

      ingestReport(ingest, record, report, traceId);
    }
  }

  /** Stops reading the sun. */
  public stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Sets the next reading for the turn of the next minute. */
  #schedule(): void {
    const intervalMs = this.#options.intervalMs ?? MINUTE_MS;
    const delay = intervalMs - (this.#now().getTime() % intervalMs);

    this.#timer = setTimeout(() => {
      try {
        this.publish();
      } catch (error: unknown) {
        this.#options.logger.warn({ err: error }, 'Could not report where the sun is');
      }

      this.#schedule();
    }, delay);
    this.#timer.unref();
  }
}
