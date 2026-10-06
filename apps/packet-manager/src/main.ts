/**
 * Entry point of the `packet-manager` service.
 *
 * The same order as every service: the environment, the schema version, the bus - retried until it
 * is there - then the packages, read and started in order, and the methods served. On a signal
 * every package's process is stopped before the service leaves, so none is left behind with no
 * one to restart it.
 */
import { fileURLToPath } from 'node:url';

import { BusClient, connectBus } from '@nebulahome/bus';
import { loadConfigOrExit, resolveDataLayout } from '@nebulahome/config';
import { ERROR_CODES, EXIT_CODES, isNebulaError, MQTT_BROKER_SERVICE } from '@nebulahome/contracts';
import { assertSchemaVersion, createDatabase, secretsKeyFrom } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { servePacketManager } from './bus-service.js';
import {
  INTEGRATION_RUNTIME_VERSION,
  integrationIndexUrlOf,
  localIntegrationsDirectory,
  localPackagesDirectory,
  packageIndexUrlOf,
  packetManagerEnvSchema,
  SERVICE_NAME,
  SERVICE_VERSION,
} from './config.js';
import { IntegrationManager } from './integrations/integration-manager.js';
import { databaseHubInstallationStore } from './persistence/hub-installations.js';
import { databasePackageStore } from './persistence/packages.js';
import { PacketManager } from './service.js';
import { CommunityHubClient } from './services/hub-client.js';
import { HubReporter } from './services/hub-reporter.js';
import { IntegrationIndexClient, PackageIndexClient } from './services/index-client.js';
import { LocalIntegrationReleases, LocalReleases } from './services/local-releases.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 20_000;

/** Signals that mean "stop". */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Ends the process after a bounded wait, whatever the shutdown is doing.
 *
 * @param logger - Where the timeout is reported.
 * @returns The timer, cleared on a clean shutdown.
 */
function armShutdownTimeout(logger: PlatformLogger): NodeJS.Timeout {
  return setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown did not finish in time, exiting');
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  }, SHUTDOWN_TIMEOUT_MS);
}

/**
 * Starts the service and keeps it running until it is asked to stop.
 *
 * @returns A promise that settles once the service is serving.
 */
async function start(): Promise<void> {
  const config = loadConfigOrExit(packetManagerEnvSchema);
  const logger = createLogger({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });
  const database = createDatabase({
    connectionString: config.DATABASE_URL,
    applicationName: SERVICE_NAME,
    maxConnections: 4,
  });

  try {
    await assertSchemaVersion(database.db);
  } catch (error: unknown) {
    if (isNebulaError(error) && error.code === ERROR_CODES.SCHEMA_VERSION_MISMATCH) {
      logger.fatal(
        { details: error.details },
        'Refusing to start: run `pnpm db:migrate` and start again',
      );
      await database.close();
      process.exit(EXIT_CODES.SCHEMA_VERSION_MISMATCH);
    }

    throw error;
  }

  const startupAbort = new AbortController();

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      startupAbort.abort();
    });
  }

  const bus = await connectBus({
    url: config.NATS_URL,
    name: SERVICE_NAME,
    logger,
    signal: startupAbort.signal,
  });
  const client = new BusClient({ transport: bus.transport, source: SERVICE_NAME, logger });
  const layout = resolveDataLayout(config);
  const localFolder = localPackagesDirectory(config);
  const local = new LocalReleases(localFolder, logger);
  const localIntegrationsFolder = localIntegrationsDirectory(config);
  const localIntegrations = new LocalIntegrationReleases(localIntegrationsFolder, logger);
  const secretsKey = secretsKeyFrom(config.NEBULA_SECRETS_KEY);
  const hub = new CommunityHubClient({ url: config.COMMUNITY_HUB_URL, logger });
  const reporter = new HubReporter({
    hub,
    store: databaseHubInstallationStore(database.db),
    secretsKey,
    platformVersion: config.NEBULA_PLATFORM_VERSION,
    logger,
    isEnabled: config.COMMUNITY_HUB_REPORT_INSTALLS,
  });
  const service = new PacketManager({
    config,
    store: databasePackageStore(database.db),
    client,
    logger,
    index: new PackageIndexClient({
      url: packageIndexUrlOf(config),
      ttlMs: config.PACKET_MANAGER_INDEX_TTL_MS,
      logger,

      /**
       * The local folder's releases.
       *
       * @returns Them, in the index's shape.
       */
      local: async () => local.entries(),
    }),
    hub,
    reporter,
    secretsKey,
    runner:
      config.PACKET_MANAGER_RUNNER ??
      fileURLToPath(import.meta.resolve('@nebulahome/package-host/run')),
    packagesDir: layout.packages,
    cacheDir: `${layout.cache}/packages`,
    externalServices: new Set(config.NEBULA_MQTT_URL === undefined ? [] : [MQTT_BROKER_SERVICE]),
  });

  const integrations = new IntegrationManager({
    index: new IntegrationIndexClient({
      url: integrationIndexUrlOf(config),
      ttlMs: config.PACKET_MANAGER_INDEX_TTL_MS,
      logger,

      /**
       * The local integrations folder's releases.
       *
       * @returns Them, in the index's shape.
       */
      local: async () => localIntegrations.entries(),
    }),
    hub,
    client,
    logger,
    integrationsDir: layout.integrations,
    cacheDir: `${layout.cache}/integrations`,
    runtimeVersion: INTEGRATION_RUNTIME_VERSION,
    downloadTimeoutMs: config.PACKET_MANAGER_DOWNLOAD_TIMEOUT_MS,
    reporter,
  });

  // Served before the packages start: each announces itself to the service as it comes up.
  const subscriptions = servePacketManager(client, service, integrations);

  await service.start();
  logger.info(
    {
      platform: service.platformVersion,
      integrationRuntime: INTEGRATION_RUNTIME_VERSION,
      localFolder: localFolder ?? null,
      localIntegrationsFolder: localIntegrationsFolder ?? null,
      hubReports: config.COMMUNITY_HUB_URL !== undefined && config.COMMUNITY_HUB_REPORT_INSTALLS,
    },
    'The packet-manager is serving',
  );

  let isStopping = false;

  /**
   * Stops everything.
   *
   * @param signal - Which signal asked for it.
   */
  const shutdown = (signal: string): void => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    logger.info({ signal }, 'Shutting down');

    const timeout = armShutdownTimeout(logger);

    void (async (): Promise<void> => {
      try {
        for (const subscription of subscriptions) {
          subscription.unsubscribe();
        }

        reporter.stop();
        await service.stop();
        await client.drain();
        await database.close();
      } catch (error: unknown) {
        logger.error({ err: error }, 'Shutdown did not complete cleanly');
      } finally {
        clearTimeout(timeout);
        process.exit(EXIT_CODES.SUCCESS);
      }
    })();
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
}

await start();
