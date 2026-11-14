/**
 * Replacing a container with one made the same way on another image.
 *
 * The old container is renamed, not removed, until the new one runs: a new container that cannot
 * be made or started, or does not stay up - it stops or restarts in its first seconds, or its
 * health check says unhealthy - gives its name back, and the old one is started again, as it was.
 * Only once the new one is up is the old removed - its volumes stay, since the new container
 * mounts them.
 */
import { setTimeout as delay } from 'node:timers/promises';

import { UpstreamError, type JsonObject } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';
import type { ExtraNetwork } from '../domain/recreate.js';

/** How long a new container must keep running before the old one is removed. */
const SETTLE_MS = 10_000;

/** How long past that a health check still starting is waited for. */
const HEALTH_WAIT_MS = 2 * 60_000;

/** How often the new container is looked at meanwhile. */
const LOOK_EVERY_MS = 1000;

/** What a replacement needs. */
export type ReplaceOptions = {
  readonly engine: DockerEngine;
  readonly logger: PlatformLogger;

  /** The container being replaced. */
  readonly id: string;
  readonly name: string;

  /** Whether it was running: the new one is started only then. */
  readonly wasRunning: boolean;

  /** The new container's configuration. */
  readonly body: JsonObject;

  /** Networks the new container joins after it is made. */
  readonly networks?: readonly ExtraNetwork[];

  /** How long a started container must keep running; 10 seconds when not said. */
  readonly settleMs?: number;
};

/**
 * Waits for a container just started to show it stays up: running, never restarted, for the
 * settle time - or healthy, when it has a health check, which is waited for a while longer.
 *
 * @param engine - The engine.
 * @param id - The container.
 * @param settleMs - How long it must keep running.
 * @returns Why it did not stay up; null when it did.
 */
async function whyNotUp(
  engine: DockerEngine,
  id: string,
  settleMs: number,
): Promise<string | null> {
  const settledAt = Date.now() + settleMs;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- one look after another, until it is clear
    const { State: state, RestartCount: restarts = 0 } = await engine.inspectContainer(id);
    const health = state.Health?.Status;

    if (state.Status !== 'running' || restarts > 0) {
      return `it did not stay running (${state.Status}, restarted ${String(restarts)} times)`;
    }

    if (health === 'unhealthy') {
      return 'its health check says it is unhealthy';
    }

    if (
      health === 'healthy' ||
      (Date.now() >= settledAt &&
        (health !== 'starting' || Date.now() >= settledAt + HEALTH_WAIT_MS))
    ) {
      return null;
    }

    // eslint-disable-next-line no-await-in-loop -- see above
    await delay(LOOK_EVERY_MS);
  }
}

/**
 * Replaces a container.
 *
 * @param options - The engine, the old container, and how the new one is made.
 * @returns The new container's id.
 * @throws {Error} What went wrong, once the old container has been put back.
 */
export async function replaceContainer(options: ReplaceOptions): Promise<string> {
  const { engine, logger, name } = options;
  const aside = `${name}-nebula-old-${Date.now().toString(36)}`;

  await engine.renameContainer(options.id, aside);

  let created: string | null = null;

  try {
    if (options.wasRunning) {
      await engine.control(options.id, 'stop');
    }

    created = await engine.createContainer(name, options.body);

    const id = created;

    await Promise.all(
      (options.networks ?? []).map(async (network) =>
        engine.connectNetwork(network.name, id, network.aliases),
      ),
    );

    if (options.wasRunning) {
      await engine.control(created, 'start');

      // A new image that crashes would otherwise leave nothing to go back to.
      const why = await whyNotUp(engine, created, options.settleMs ?? SETTLE_MS);

      if (why !== null) {
        throw new UpstreamError(`${name} on its new image did not start: ${why}`, {
          details: { container: name },
        });
      }
    }
  } catch (error: unknown) {
    logger.warn(
      { err: error, container: name },
      'Could not replace the container; putting it back',
    );

    if (created !== null) {
      await engine.removeContainer(created).catch((cleanup: unknown) => {
        logger.error({ err: cleanup, container: name }, 'Could not remove the failed replacement');
      });
    }

    await engine.renameContainer(options.id, name);

    if (options.wasRunning) {
      await engine.control(options.id, 'start');
    }

    throw error;
  }

  await engine.removeContainer(options.id).catch((error: unknown) => {
    // The new container runs; the old one left behind is clutter, not a failure.
    logger.warn({ err: error, container: aside }, 'Could not remove the replaced container');
  });

  return created;
}
