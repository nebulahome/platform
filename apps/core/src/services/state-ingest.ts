/**
 * The ingest pipeline: what happens to every state report an adapter publishes.
 *
 * Validate against the capability schema, check the reporter owns the entity, merge into the
 * registry, and - only if something actually changed - emit the event and append the history
 * row (ARCHITECTURE.md 4.1). This is the hottest path in the system: a house with a dozen power
 * meters runs it several times a second, all day.
 *
 * A numeric sensor's reading also goes to the durable telemetry stream, sampled - see
 * {@link TelemetrySampler} - so the series a chart is drawn from exists whichever adapter, engine
 * or monitor the reading came from. Before a change is judged, since a value that held is a point
 * in the series too.
 */
import type { BusClient, BusSubscription, MessageContext } from '@nebula-home/bus';
import {
  BUS_PATTERNS,
  busSubjects,
  stateReportSchema,
  type EntityId,
  type StateReport,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

import type { EntityDirectory, EntityRecord } from '../domain/entity-directory.js';
import type { EntityRegistry, IngestResult } from '../domain/entity-registry.js';
import type { TelemetrySampler } from '../domain/telemetry-sampler.js';
import type { BatchWriter } from '../persistence/batch-writer.js';
import type { EntityStateRow, StateHistoryRow } from '../persistence/history-writer.js';

/** Everything the ingest pipeline writes to. */
export type StateIngestOptions = {
  /** The bus client, used to subscribe and to fan out the resulting events. */
  readonly client: BusClient;

  /** The in-memory registry, the single writer of which is this pipeline. */
  readonly registry: EntityRegistry;

  /** Configured entities, consulted for ownership and the row identifier. */
  readonly directory: EntityDirectory;

  /** Where history rows are buffered. */
  readonly history: BatchWriter<StateHistoryRow>;

  /** Where recovery-cache rows are buffered. */
  readonly stateCache: BatchWriter<EntityStateRow>;

  /** Where rejected reports are recorded. */
  readonly logger: PlatformLogger;

  /**
   * Decides which numeric readings go to the telemetry stream.
   *
   * Optional: unit tests that only exercise state ingest publish no telemetry.
   */
  readonly telemetry?: TelemetrySampler;

  /**
   * Called after a notable change, so the alias engine can recompute descendants.
   *
   * Optional: unit tests that only exercise ingest do not need an engine.
   */
  readonly onNotableChange?: (entityId: EntityId) => void;
};

/**
 * Builds the history row for one change.
 *
 * @param record - The entity's configuration, which carries the uuid the hypertable references.
 * @param result - What the report did.
 * @returns The row to append.
 */
function toHistoryRow(record: EntityRecord, result: IngestResult): StateHistoryRow {
  return {
    time: result.current.lastUpdated,
    entityId: record.rowId,
    state: result.current.state,
    previousState: result.previous?.state ?? null,
    attributes: result.current.attributes,
    isAvailable: result.current.isAvailable,
    source: result.current.source,
    contextId: result.current.context?.id ?? null,
    contextType: result.current.context?.type ?? null,
  };
}

/**
 * Builds the recovery-cache row for one change.
 *
 * @param record - The entity's configuration.
 * @param result - What the report did.
 * @returns The row to upsert.
 */
function toCacheRow(record: EntityRecord, result: IngestResult): EntityStateRow {
  return {
    entityId: record.rowId,
    state: result.current.state,
    attributes: result.current.attributes,
    isAvailable: result.current.isAvailable,
    lastChanged: result.current.lastChanged,
    lastUpdated: result.current.lastUpdated,
    source: result.current.source,
    contextId: result.current.context?.id ?? null,
    contextType: result.current.context?.type ?? null,
  };
}

/**
 * Sends a numeric sensor's reading to the telemetry stream, when the sampler keeps it.
 *
 * Read off the merged state rather than the report, so a report that carried only another
 * capability still counts as the sensor saying its value again. An unreachable sensor's last
 * value is not a reading, and is not sent.
 *
 * @param options - The pipeline's collaborators.
 * @param record - The entity's configuration.
 * @param result - What the report did.
 * @param traceId - The unit of work the report belongs to.
 */
function publishReading(
  options: StateIngestOptions,
  record: EntityRecord,
  result: IngestResult,
  traceId: string,
): void {
  const value = result.current.state.sensor_numeric?.value;

  if (
    options.telemetry === undefined ||
    value === undefined ||
    !result.current.isAvailable ||
    !record.capabilities.has('sensor_numeric')
  ) {
    return;
  }

  const observedAt = result.current.lastUpdated;

  if (options.telemetry.take(result.entityId, value, observedAt)) {
    options.client.publish(
      busSubjects.telemetry(result.entityId),
      { entityId: result.entityId, value, observedAt },
      { traceId },
    );
  }
}

/**
 * Applies one report and emits whatever it produced.
 *
 * Exported so that the resynchronisation path and, later, the engines can push a state through
 * exactly the same pipeline rather than a parallel one that drifts from it.
 *
 * @param options - The pipeline's collaborators.
 * @param record - The entity's configuration.
 * @param report - What was observed.
 * @param traceId - The unit of work this report belongs to.
 * @returns What the report did, or undefined when nothing was notable.
 */
export function ingestReport(
  options: StateIngestOptions,
  record: EntityRecord,
  report: StateReport,
  traceId: string,
): IngestResult | undefined {
  const result = options.registry.apply(report, { source: record.source });

  publishReading(options, record, result, traceId);

  if (!result.isNotable) {
    // A sensor reporting the same value for the fortieth time. It updated, it did not change,
    // and an automation triggering on change must not fire on it.
    return undefined;
  }

  options.client.publish(
    busSubjects.stateChanged(result.entityId),
    { entityId: result.entityId, current: result.current, previous: result.previous },
    { traceId },
  );

  // A picture's state says only which picture it is: a robot's map is drawn again every few
  // seconds while it cleans, and a row each time would bury what the device's activity says.
  if (!isPicture(result.entityId)) {
    options.history.add(toHistoryRow(record, result));
  }

  options.stateCache.add(toCacheRow(record, result));
  options.onNotableChange?.(result.entityId);

  return result;
}

/**
 * Says whether an entity is a picture, whose changes are not history.
 *
 * @param entityId - The entity.
 * @returns True for an image entity.
 */
function isPicture(entityId: string): boolean {
  return entityId.startsWith('image.');
}

/**
 * Rejects a report whose publisher does not own the entity it is about.
 *
 * One adapter must not be able to write another adapter's entities. Without this, any installed
 * package could report `lock.front_door` as unlocked, and the interface would believe it.
 *
 * @param record - The entity's configuration, which names the owner.
 * @param publisher - The `source` on the envelope that carried the report.
 * @returns True when the publisher is the owner.
 */
function isOwner(record: EntityRecord, publisher: string): boolean {
  return record.source === publisher;
}

/**
 * Subscribes to every state report and runs the pipeline on each one.
 *
 * @param options - The pipeline's collaborators.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startStateIngest(options: StateIngestOptions): BusSubscription {
  /**
   * Handles one report.
   *
   * @param report - The validated report.
   * @param context - The subject it arrived on and who published it.
   */
  const onReport = (report: StateReport, context: MessageContext): void => {
    // The entity is named twice - in the subject, for routing, and in the payload, for the
    // handler. A disagreement means a misrouted or hand-built message, and guessing which of the
    // two to believe is how a report ends up applied to the wrong light.
    if (context.subject !== busSubjects.stateReport(report.entityId)) {
      context.logger.warn(
        { subject: context.subject, entityId: report.entityId },
        'Rejected a report whose subject and payload name different entities',
      );

      return;
    }

    const record = options.directory.get(report.entityId);

    if (record === undefined) {
      context.logger.warn(
        { entityId: report.entityId, source: context.header.source },
        'Rejected a report for an entity that is not registered',
      );

      return;
    }

    if (!isOwner(record, context.header.source)) {
      context.logger.warn(
        { entityId: report.entityId, owner: record.source, publisher: context.header.source },
        'Rejected a report from a package that does not own the entity',
      );

      return;
    }

    if (!record.isEnabled) {
      return;
    }

    ingestReport(options, record, report, context.header.traceId);
  };

  return options.client.subscribe(BUS_PATTERNS.allStateReports, stateReportSchema, onReport);
}
