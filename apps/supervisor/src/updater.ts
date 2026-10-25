/**
 * Entry point of the throwaway updater container (docs/releases-and-updates.md 4).
 *
 * The supervisor starts it from the new image when the owner updates Nebula Home: it replaces the
 * platform's container, or puts the old one back (`services/platform-updater.ts`), writes how it
 * ended to the data folder, and exits; Docker removes it.
 */
import { loadConfigOrExit } from '@nebulahome/config';
import { EXIT_CODES } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { updaterEnvSchema } from './config.js';
import { DockerEngine } from './docker/engine.js';
import { updatePlatform } from './services/platform-updater.js';

const config = loadConfigOrExit(updaterEnvSchema);
const logger = createLogger({
  service: 'updater',
  version: config.NEBULA_VERSION,
  level: config.LOG_LEVEL,
  pretty: false,
});
const outcome = await updatePlatform({
  engine: new DockerEngine({
    socketPath: config.SUPERVISOR_DOCKER_SOCKET,
    timeoutMs: config.SUPERVISOR_DOCKER_TIMEOUT_MS,
  }),
  logger,
  targetId: config.NEBULA_UPDATER_TARGET,
  image: config.NEBULA_UPDATER_IMAGE,
  fromVersion: config.NEBULA_UPDATER_FROM,
  toVersion: config.NEBULA_UPDATER_TO,
  dataDir: config.NEBULA_UPDATER_DATA,
});

logger.info(outcome, 'The update ended');
process.exitCode = outcome.status === 'success' ? EXIT_CODES.SUCCESS : EXIT_CODES.UNHANDLED_ERROR;
