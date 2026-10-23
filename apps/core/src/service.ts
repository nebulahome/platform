/**
 * Assembling `core` out of its parts, and taking it apart again.
 *
 * Startup order matters and is not arbitrary:
 *
 * 1. load the registry, so there is something to answer with;
 * 2. start serving, so a request arriving during startup is answered rather than timed out;
 * 3. ask the adapters to resynchronise, which produces reports the ingest pipeline is by then
 *    already listening for.
 *
 * Doing (3) before (2) would drop every report the adapters sent in reply.
 *
 * The system device and its entities are written before (1), so the registry loads them like
 * any other, and the system monitor starts once the ingest pipeline its states go through exists.
 */
import {
  ensureTelemetryStream,
  newTraceId,
  BusClient,
  type BusConnection,
  type BusSubscription,
} from '@nebulahome/bus';
import { resolveDataLayout } from '@nebulahome/config';
import type { EntityId, StateReport } from '@nebulahome/contracts';
import { secretsKeyFrom, type Database } from '@nebulahome/db';
import { withTraceId, type PlatformLogger } from '@nebulahome/logging';

import type { CoreConfig } from './config.js';
import { SERVICE_NAME, SERVICE_VERSION } from './config.js';
import { AliasCatalog } from './domain/alias-catalog.js';
import { ChangeAttribution } from './domain/change-attribution.js';
import { EntityDirectory, type EntityRecord } from './domain/entity-directory.js';
import { EntityRegistry, type IngestResult } from './domain/entity-registry.js';
import { PackageTypes } from './domain/package-types.js';
import { TelemetrySampler } from './domain/telemetry-sampler.js';
import { loadHouse } from './persistence/automation-store.js';
import type { BatchWriter } from './persistence/batch-writer.js';
import {
  createHistoryWriter,
  createStateCacheWriter,
  type EntityStateRow,
  type StateHistoryRow,
} from './persistence/history-writer.js';
import { loadRegistry } from './persistence/registry-loader.js';
import { ensureSystemDevice, syncSunEntities } from './persistence/system-entities.js';
import { AliasEngine } from './services/alias-engine.js';
import { startAliasService } from './services/alias-service.js';
import { AutomationEngine } from './services/automation-engine.js';
import { startAutomationService } from './services/automation-service.js';
import { createCommandDispatcher } from './services/command-dispatch.js';
import { startCommandRouter } from './services/command-router.js';
import { startContainersService } from './services/containers.js';
import { startHistoryService } from './services/history-service.js';
import { LinkEngine } from './services/link-engine.js';
import { startLinkService, syncLinks } from './services/link-service.js';
import { loadPackageTypes, startPackagesService } from './services/packages.js';
import { startRegistrationService } from './services/registration.js';
import { requestResync } from './services/resync.js';
import { SceneEngine } from './services/scene-engine.js';
import { startSceneService } from './services/scene-service.js';
import { startStateIngest } from './services/state-ingest.js';
import { startEntityReadService, startSnapshotService } from './services/state-queries.js';
import { SunMonitor } from './services/sun-monitor.js';
import { startSystemMonitorService } from './services/system-monitor-service.js';
import { SystemMonitor } from './services/system-monitor.js';
import { createSystemProbes } from './services/system-probes.js';
import { runTelemetryIngest } from './services/telemetry-ingest.js';

/** What the service is built from. */
export type CoreServiceOptions = {
  /** The validated environment. */
  readonly config: CoreConfig;

  /** A connected, schema-checked database handle. */
  readonly db: Database;

  /** A connected bus. */
  readonly bus: BusConnection;

  /** The service logger. */
  readonly logger: PlatformLogger;
};

/**
 * A change, told under another address that means the same entity.
 *
 * @param result - The change.
 * @param address - The address of an entity linked to the one that changed.
 * @returns The same change, named by that address.
 */
function asAddress(result: IngestResult, address: EntityId): IngestResult {
  return {
    ...result,
    entityId: address,
    current: { ...result.current, entityId: address },
    previous: result.previous === undefined ? undefined : { ...result.previous, entityId: address },
  };
}

/** `core`, assembled. */
export class CoreService {
  readonly #options: CoreServiceOptions;
  readonly #registry = new EntityRegistry();
  readonly #shutdown = new AbortController();

  #directory = new EntityDirectory();
  #aliases = new AliasCatalog();
  #aliasEngine: AliasEngine | undefined;
  #automationEngine: AutomationEngine | undefined;
  #systemMonitor: SystemMonitor | undefined;
  #sunMonitor: SunMonitor | undefined;
  #client: BusClient | undefined;
  #subscriptions: BusSubscription[] = [];
  #history: BatchWriter<StateHistoryRow> | undefined;
  #stateCache: BatchWriter<EntityStateRow> | undefined;
  #telemetry: Promise<void> | undefined;
  readonly #attribution = new ChangeAttribution();

  /**
   * Hands a change to everything in this process that reacts to one: aliases reading the
   * entity recompute, and automations watching it may wake.
   *
   * @param result - What changed.
   */
  readonly #onChange = (result: IngestResult): void => {
    // A linked entity changes under every address that means it: an automation watching the
    // address of an entity linked to it is woken, and sees the address it watches.
    for (const address of this.#directory.addressesOf(result.entityId)) {
      const change = address === result.entityId ? result : asAddress(result, address);

      this.#aliasEngine?.onSourceChanged(change.entityId);
      this.#automationEngine?.onStateChanged(change);
    }
  };

  #linkEngine: LinkEngine | undefined;

  /**
   * Builds the service without starting anything.
   *
   * @param options - Configuration, database, bus and logger.
   */
  public constructor(options: CoreServiceOptions) {
    this.#options = options;
  }

  /**
   * The in-memory registry, exposed so an integration test can assert on what was ingested.
   *
   * @returns The registry this service is the single writer of.
   */
  public get registry(): EntityRegistry {
    return this.#registry;
  }

  /**
   * The configured entities, exposed for the same reason.
   *
   * @returns The directory loaded at startup.
   */
  public get directory(): EntityDirectory {
    return this.#directory;
  }

  /**
   * Loads the registry, starts serving, and asks the adapters to resynchronise.
   *
   * @returns A promise that settles once the service is serving. The resynchronisation it
   * triggers is still in flight: waiting for it would mean a service that cannot start while one
   * adapter is down, and the whole point of marking those entities unavailable is that it can.
   */
  public async start(): Promise<void> {
    const { config, db, bus, logger } = this.#options;
    const startupLogger = withTraceId(logger, newTraceId());

    const client = new BusClient({
      transport: bus.transport,
      source: SERVICE_NAME,
      logger,
      requestTimeoutMs: config.CORE_COMMAND_TIMEOUT_MS,
    });

    this.#client = client;

    const probes = createSystemProbes({ netDevPath: config.CORE_NET_DEV_PATH, logger });
    const host = probes.readHost();

    await ensureSystemDevice(
      db,
      {
        manufacturer: 'NebulaHome',
        model: `${host.osName} · ${host.arch}`,
        swVersion: SERVICE_VERSION,
        hwVersion: host.cpuModel,
        externalId: host.hostname,
      },
      startupLogger,
    );

    // The sun's entities follow the house's position; written before the registry is read, so
    // the directory holds them from the start.
    const house = await loadHouse(db);

    await syncSunEntities(db, house.position !== null, startupLogger);

    const loaded = await loadRegistry(db, startupLogger);

    this.#directory = loaded.directory;

    for (const state of loaded.states) {
      this.#registry.seed(state);
    }

    startupLogger.info(
      {
        entities: loaded.directory.size,
        recoveredStates: loaded.states.length,
        discardedStates: loaded.discardedStates,
      },
      'Registry rebuilt from the database',
    );

    const history = createHistoryWriter({
      db,
      logger,
      batchSize: config.CORE_HISTORY_BATCH_SIZE,
      flushIntervalMs: config.CORE_HISTORY_FLUSH_INTERVAL_MS,
    });

    const stateCache = createStateCacheWriter({
      db,
      logger,
      batchSize: config.CORE_HISTORY_BATCH_SIZE,
      flushIntervalMs: config.CORE_HISTORY_FLUSH_INTERVAL_MS,
    });

    history.start();
    stateCache.start();

    this.#history = history;
    this.#stateCache = stateCache;

    // Before anything can report: the ingest pipeline publishes numeric readings to the stream,
    // and a reading published before the stream exists is captured by nothing.
    await ensureTelemetryStream({ connection: bus.connection, logger });

    const packageTypes = new PackageTypes();
    const packages = await loadPackageTypes(db, packageTypes);

    startupLogger.info({ packages }, 'Package entity types loaded');

    const ingest = {
      client,
      registry: this.#registry,
      directory: this.#directory,
      history,
      stateCache,
      telemetry: new TelemetrySampler(),
      packageTypes,
      logger,
      attribution: this.#attribution,
      onNotableChange: this.#onChange,
      links: {
        /**
         * Hands a source's report to the link engine.
         *
         * @param record - The source.
         * @param report - What it said.
         * @param traceId - The unit of work.
         */
        report: (record: EntityRecord, report: StateReport, traceId: string): void => {
          this.#linkEngine?.report(record, report, traceId);
        },
      },
    };

    const linkEngine = new LinkEngine({
      directory: this.#directory,
      registry: this.#registry,
      ingest,
      logger,
      newTraceId,
    });

    this.#linkEngine = linkEngine;
    startupLogger.info({ linked: linkEngine.start() }, 'Linked entities read through another');

    const aliasEngine = new AliasEngine({
      db,
      directory: this.#directory,
      registry: this.#registry,
      catalog: this.#aliases,
      ingest,
      logger,
      newTraceId,
    });

    this.#aliasEngine = aliasEngine;
    const aliasCount = await aliasEngine.load();

    startupLogger.info({ aliases: aliasCount }, 'Alias catalogue loaded');

    const systemMonitor = new SystemMonitor({
      probes,
      db,
      dataDir: resolveDataLayout(config).root,
      ingest,
      logger,
      newTraceId,
      sampleIntervalMs: config.CORE_SYSTEM_SAMPLE_INTERVAL_MS,
      publishIntervalMs: config.CORE_SYSTEM_PUBLISH_INTERVAL_MS,
    });

    this.#systemMonitor = systemMonitor;
    await systemMonitor.start();

    const sunMonitor = new SunMonitor({ db, ingest, logger, newTraceId });

    this.#sunMonitor = sunMonitor;
    sunMonitor.start(house.position);

    const dispatcher = createCommandDispatcher({
      client,
      directory: this.#directory,
      aliases: this.#aliases,
      aliasEngine,
      commandTimeoutMs: config.CORE_COMMAND_TIMEOUT_MS,
      packageTypes,
      attribution: this.#attribution,
      links: linkEngine,
    });

    const sceneEngine = new SceneEngine({
      db,
      registry: this.#registry,
      dispatcher,
      logger,
    });

    const automationEngine = new AutomationEngine({
      db,
      client,
      registry: this.#registry,
      directory: this.#directory,
      dispatcher,
      scenes: sceneEngine,
      logger,
      newTraceId,
      secretsKey: secretsKeyFrom(config.NEBULA_SECRETS_KEY),
    });

    this.#automationEngine = automationEngine;
    const automationCount = await automationEngine.load();

    startupLogger.info({ automations: automationCount }, 'Automations loaded');

    this.#subscriptions = [
      startStateIngest(ingest),
      startSnapshotService({ client, registry: this.#registry }),
      ...startHistoryService({ client, db, directory: this.#directory }),
      startEntityReadService({ client, registry: this.#registry }),
      startCommandRouter({
        client,
        directory: this.#directory,
        aliases: this.#aliases,
        aliasEngine,
        commandTimeoutMs: config.CORE_COMMAND_TIMEOUT_MS,
        packageTypes,
        dispatcher,
      }),
      startPackagesService({
        client,
        db,
        directory: this.#directory,
        registry: this.#registry,
        stateCache,
        packageTypes,
        logger,
        onNotableChange: this.#onChange,
      }),
      ...startRegistrationService({
        client,
        db,
        directory: this.#directory,
        registry: this.#registry,
        stateCache,
        logger,
        /**
         * Reads every link again after a released device took linked entities with it.
         *
         * @returns A promise that settles once the links are in line.
         */
        onLinksChanged: async (): Promise<void> => {
          await syncLinks({ db, directory: this.#directory, engine: linkEngine });
        },
      }),
      ...startLinkService({ client, db, directory: this.#directory, engine: linkEngine, logger }),
      startContainersService({
        client,
        db,
        directory: this.#directory,
        registry: this.#registry,
        stateCache,
        logger,
        onNotableChange: this.#onChange,
      }),
      ...startAliasService({ client, engine: aliasEngine, logger }),
      startSystemMonitorService({ client, monitor: systemMonitor }),
      startSceneService({ client, engine: sceneEngine }),
      ...startAutomationService({ client, engine: automationEngine, sun: sunMonitor, logger }),
    ];

    this.#telemetry = runTelemetryIngest({
      connection: bus.connection,
      db,
      directory: this.#directory,
      logger,
      signal: this.#shutdown.signal,
      batchSize: config.CORE_TELEMETRY_BATCH_SIZE,
    });

    // Changes wake automations once the adapters have answered, or the grace has run out.
    const goLive = setTimeout(() => {
      automationEngine.goLive();
    }, config.CORE_AUTOMATION_STARTUP_GRACE_MS);

    // Deliberately not awaited: a resynchronisation waits out the command timeout for every
    // adapter that is not running, and the service is already serving by this point.
    void requestResync({
      client,
      directory: this.#directory,
      registry: this.#registry,
      logger: startupLogger,
      timeoutMs: config.CORE_COMMAND_TIMEOUT_MS,
      reason: 'startup',
      onNotableChange: this.#onChange,
      links: linkEngine,
    })
      .catch((error: unknown) => {
        startupLogger.error({ err: error }, 'Startup resynchronisation failed');
      })
      .finally(() => {
        clearTimeout(goLive);
        automationEngine.goLive();
      });

    logger.info({ service: SERVICE_NAME }, 'Core is serving');
  }

  /**
   * Stops serving, drains what is buffered and closes every connection.
   *
   * Order matters here too: stop accepting new work, then write what is already buffered, then
   * close the connections the writing needed (RULES.md 9).
   *
   * @returns A promise that settles once everything is closed.
   */
  public async stop(): Promise<void> {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }

    this.#subscriptions = [];
    this.#systemMonitor?.stop();
    this.#sunMonitor?.stop();
    this.#shutdown.abort();

    // Before the writers drain: a cancelled run is still written down.
    await this.#automationEngine?.stop();

    await Promise.allSettled([
      this.#history?.stop() ?? Promise.resolve(),
      this.#stateCache?.stop() ?? Promise.resolve(),
      this.#telemetry ?? Promise.resolve(),
    ]);

    await this.#client?.drain();

    this.#options.logger.info({ service: SERVICE_NAME }, 'Core has stopped');
  }
}
