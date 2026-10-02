/**
 * Wiring `core`'s bus services onto an in-memory broker.
 *
 * The end-to-end test covers the happy path against real infrastructure. What it cannot cover
 * cheaply is the set of things `core` **refuses**: a report from a package that does not own the
 * entity, a command for a derived entity, an adapter that never answers. Each of those needs a
 * misbehaving counterpart, and building one out of a real broker and a real database per case
 * would cost seconds per assertion.
 *
 * Excluded from the build in `tsconfig.build.json`: nothing in a running service should be able
 * to import it.
 */
import { Writable } from 'node:stream';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import type { CapabilityName, EntityId, JsonObject, SourceRef } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { EntityDirectory, type EntityRecord } from '../domain/entity-directory.js';
import { EntityRegistry } from '../domain/entity-registry.js';
import { BatchWriter } from '../persistence/batch-writer.js';
import type { EntityStateRow, StateHistoryRow } from '../persistence/history-writer.js';

/**
 * A logger that writes nowhere.
 *
 * A test asserting on behaviour should not also be a test of what got printed.
 *
 * @returns A logger bound to a discarding stream.
 */
export function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'core-test', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param callback - Signals completion.
       */
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

/** How one entity's configuration differs from the default. */
export type EntityRecordOptions = {
  /** Who owns it. Defaults to `pkg-weather`. */
  readonly source?: SourceRef;

  /** Whether the owner has left it enabled. Defaults to true. */
  readonly isEnabled?: boolean;

  /** What it declares it can do, with the device limits for each. Defaults to `on_off`. */
  readonly capabilities?: Readonly<Partial<Record<CapabilityName, JsonObject>>>;
};

/**
 * Builds one entity's configuration.
 *
 * @param entityId - The entity.
 * @param options - What differs from the default.
 * @returns The record, as the directory would hold it.
 */
export function entityRecord(entityId: EntityId, options: EntityRecordOptions = {}): EntityRecord {
  const capabilities = options.capabilities ?? { on_off: {} };

  return {
    entityId,
    rowId: `row-${entityId}`,
    source: options.source ?? 'pkg-weather',
    isEnabled: options.isEnabled ?? true,
    capabilities: new Map(
      Object.entries(capabilities).map(([capability, params]) => [
        capability as CapabilityName,
        params,
      ]),
    ),
  };
}

/** Everything a bus service in `core` is wired to, plus what the writers received. */
export type CoreHarness = {
  /** The in-memory broker. */
  readonly transport: FakeTransport;

  /** `core`'s own client, the one the services publish and serve on. */
  readonly client: BusClient;

  /** The registry the ingest pipeline writes to. */
  readonly registry: EntityRegistry;

  /** The configured entities. */
  readonly directory: EntityDirectory;

  /** The history writer, whose rows land in {@link historyRows}. */
  readonly history: BatchWriter<StateHistoryRow>;

  /** The recovery-cache writer, whose rows land in {@link cacheRows}. */
  readonly stateCache: BatchWriter<EntityStateRow>;

  /** Every history row the pipeline produced. */
  readonly historyRows: StateHistoryRow[];

  /** Every recovery-cache row the pipeline produced. */
  readonly cacheRows: EntityStateRow[];

  /** The logger the services report rejections to. */
  readonly logger: PlatformLogger;

  /**
   * Builds a second client, so a test can play somebody other than `core`.
   *
   * @param source - The identity to publish under.
   * @returns A client stamping that identity on its envelopes.
   */
  readonly clientFor: (source: string) => BusClient;
};

/**
 * Wires a registry, a directory and two capturing writers onto an in-memory broker.
 *
 * @param now - The clock, injected so a test asserting on `lastChanged` need not use the wall one.
 * @returns The harness.
 */
export function createCoreHarness(now?: () => Date): CoreHarness {
  const transport = new FakeTransport();
  const logger = silentLogger();

  const historyRows: StateHistoryRow[] = [];
  const cacheRows: EntityStateRow[] = [];

  return {
    transport,
    logger,
    historyRows,
    cacheRows,
    registry: new EntityRegistry(now),
    directory: new EntityDirectory(),

    client: new BusClient({ transport, source: 'core', logger, requestTimeoutMs: 200 }),

    history: new BatchWriter<StateHistoryRow>({
      name: 'state_history',
      logger,
      batchSize: 1,

      /**
       * Records the rows instead of writing them.
       *
       * @param rows - The buffered rows.
       * @returns A promise that settles immediately.
       */
      write: async (rows): Promise<void> => {
        historyRows.push(...rows);

        await Promise.resolve();
      },
    }),

    stateCache: new BatchWriter<EntityStateRow>({
      name: 'entity_states',
      logger,
      batchSize: 1,

      /**
       * Records the rows instead of writing them.
       *
       * @param rows - The buffered rows.
       * @returns A promise that settles immediately.
       */
      write: async (rows): Promise<void> => {
        cacheRows.push(...rows);

        await Promise.resolve();
      },
    }),

    /**
     * Builds a client under another identity.
     *
     * @param source - The identity to publish under.
     * @returns The client.
     */
    clientFor: (source: string): BusClient =>
      new BusClient({ transport, source, logger, requestTimeoutMs: 200 }),
  };
}
