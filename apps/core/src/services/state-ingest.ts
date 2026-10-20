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
import type { BusClient, BusSubscription, MessageContext } from '@nebulahome/bus';
import {
  BUS_PATTERNS,
  busSubjects,
  stateReportSchema,
  type ChangeContext,
  type StateReport,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { ChangeAttribution } from '../domain/change-attribution.js';
import { isLinked, type EntityDirectory, type EntityRecord } from '../domain/entity-directory.js';
import type { EntityRegistry, IngestResult } from '../domain/entity-registry.js';
import { customStateProblem, type PackageTypes } from '../domain/package-types.js';
import type { TelemetrySampler } from '../domain/telemetry-sampler.js';
import type { BatchWriter } from '../persistence/batch-writer.js';
import type { EntityStateRow, StateHistoryRow } from '../persistence/history-writer.js';

import { announceChange, type ChangeObserver } from './state-events.js';

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
   * Called after a notable change, so the alias engine can recompute descendants and the
   * automation engine can see what fired. Must not block and must not throw.
   *
   * Optional: unit tests that only exercise ingest do not need an engine.
   */
  readonly onNotableChange?: ChangeObserver;

  /**
   * The causes of recent commands, read when their entities report so the change carries what
   * caused it. Optional: without it no change is attributed.
   */
  readonly attribution?: ChangeAttribution;

  /**
   * The packages' entity types, which a `custom` entity's report is checked against.
   *
   * Optional: without them a custom report is held to the capability's own shape alone.
   */
  readonly packageTypes?: PackageTypes;

  /**
   * Where a report about one side of a link goes instead of the registry: the entity it is about
   * is read through another, or others read through it, and what it says is one source among
   * several. Optional: without it every report is ingested as it is.
   */
  readonly links?: LinkRouter;
};

/** What takes the reports of linked entities. */
export type LinkRouter = {
  /**
   * Takes one report of a source of a linked entity.
   *
   * @param record - The source the report is about.
   * @param report - What it said.
   * @param traceId - The unit of work.
   */
  readonly report: (record: EntityRecord, report: StateReport, traceId: string) => void;
};

/** What ingesting a report is told besides the report. */
export type IngestExtra = {
  /** Who produced the state, when it is not the entity's owner: the source a link read it from. */
  readonly source?: string;

  /**
   * Whether the source of a linked entity changed with this report: written to history even when
   * the state did not change, so the history says which way it came in from then on.
   */
  readonly isSourceSwitch?: boolean;
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
 * @param context - What caused it, when the caller knows. Otherwise the cause a recent command
 * to the entity left behind, if any.
 * @param extra - Who produced it, for a linked entity, and whether its source changed.
 * @returns What the report did, or undefined when nothing was notable.
 */
export function ingestReport(
  options: StateIngestOptions,
  record: EntityRecord,
  report: StateReport,
  traceId: string,
  context?: ChangeContext,
  extra: IngestExtra = {},
): IngestResult | undefined {
  const cause = context ?? options.attribution?.of(report.entityId);
  const result = options.registry.apply(report, {
    source: extra.source ?? record.source,
    ...(cause === undefined ? {} : { context: cause }),
  });

  publishReading(options, record, result, traceId);

  if (!result.isNotable) {
    // A sensor reporting the same value for the fortieth time. It updated, it did not change,
    // and an automation triggering on change must not fire on it.
    if (extra.isSourceSwitch === true) {
      // Nothing changed but the way in: the history says so, and nobody is woken.
      options.history.add(toHistoryRow(record, result));
      options.stateCache.add(toCacheRow(record, result));
    }

    return undefined;
  }

  // A picture's state says only which picture it is: a robot's map is drawn again every few
  // seconds while it cleans, and a row each time would bury what the device's activity says.
  if (!isPicture(result.entityId)) {
    options.history.add(toHistoryRow(record, result));
  }

  options.stateCache.add(toCacheRow(record, result));
  announceChange(options.client, result, traceId, options.onNotableChange);

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
 * What is wrong with a `custom` entity's report against its package's entity type, if anything.
 *
 * @param options - Where the types are.
 * @param record - The entity's configuration: its `custom` parameters name the type.
 * @param report - The report.
 * @returns A sentence, or undefined when it holds - or is not a custom report.
 */
function customProblemOf(
  options: StateIngestOptions,
  record: EntityRecord,
  report: StateReport,
): string | undefined {
  const values = report.state.custom?.values;
  const params = record.capabilities.get('custom') as
    { packageId?: unknown; type?: unknown } | undefined;

  if (
    values === undefined ||
    options.packageTypes === undefined ||
    typeof params?.packageId !== 'string' ||
    typeof params.type !== 'string'
  ) {
    return undefined;
  }

  const type = options.packageTypes.get(params.packageId, params.type);

  return type === undefined
    ? `the ${params.packageId} package's ${params.type} is not known`
    : customStateProblem(type, values);
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

    const problem = customProblemOf(options, record, report);

    if (problem !== undefined) {
      context.logger.warn(
        { entityId: report.entityId, source: context.header.source, problem },
        'Rejected a report that its entity type does not hold',
      );

      return;
    }

    if (options.links !== undefined && isLinked(record)) {
      // One source among several: what the entity reads is the link's to decide.
      options.links.report(record, report, context.header.traceId);

      return;
    }

    ingestReport(options, record, report, context.header.traceId);
  };

  return options.client.subscribe(BUS_PATTERNS.allStateReports, stateReportSchema, onReport);
}
