/**
 * Replacing a container with one made the same way on another image.
 *
 * The old container is renamed, not removed, until the new one runs: a new container that cannot
 * be made or started gives its name back, and the old one is started again, as it was. Only once
 * the new one is up is the old removed - its volumes stay, since the new container mounts them.
 */
import type { JsonObject } from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

import type { DockerEngine } from '../docker/engine.js';
import type { ExtraNetwork } from '../domain/recreate.js';

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
};

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
