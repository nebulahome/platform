/**
 * Replacing the platform's own container with one on a newer image (docs/releases-and-updates.md
 * 4), run by the throwaway updater container - the supervisor lives inside the container being
 * replaced, so it cannot do this itself.
 *
 * The new image is tagged with the reference the old container runs, so compose sees no change.
 * The old container is stopped and its data and database volumes copied aside, because the new
 * version migrates the database and the old one refuses a database newer than itself. The new
 * container is made like the old (`domain/recreate.ts`) and must turn healthy; if it does not,
 * it is removed, the volumes are copied back, the old image takes its name back and the old
 * container starts again. The outcome is written where the page reads it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PlatformUpdateOutcome } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { InspectedContainer } from '../docker/engine-schemas.js';
import type { DockerEngine } from '../docker/engine.js';
import { planRecreate } from '../domain/recreate.js';

/** The folders whose volumes are copied aside: what a migration or the new version changes. */
export const SNAPSHOT_FOLDERS = ['/data', '/var/lib/postgresql/data'] as const;

/** Longer than the services' own shutdown, and PostgreSQL's after them (docker-compose.yml). */
export const PLATFORM_STOP_GRACE_SECONDS = 45;

/** What an update needs. */
export type PlatformUpdateOptions = {
  readonly engine: Pick<
    DockerEngine,
    | 'inspectContainer'
    | 'inspectImage'
    | 'tagImage'
    | 'control'
    | 'createVolume'
    | 'removeVolume'
    | 'createContainer'
    | 'connectNetwork'
    | 'renameContainer'
    | 'removeContainer'
    | 'wait'
  >;
  readonly logger: PlatformLogger;

  /** The platform's container. */
  readonly targetId: string;

  /** The new image, `nebulahome/platform:2026.11.0`. */
  readonly image: string;
  readonly fromVersion: string;
  readonly toVersion: string;

  /** Where the outcome is written: the platform's data folder, as the updater mounts it. */
  readonly dataDir: string;

  /** How long the new container has to turn healthy. */
  readonly healthTimeoutMs?: number;

  /** How often its health is read. */
  readonly pollMs?: number;

  /** The clock. */
  readonly now?: () => Date;
};

/** Five minutes: the health check starts after two and runs every thirty seconds. */
const HEALTH_TIMEOUT_MS = 5 * 60_000;

/** One volume copied aside. */
type Snapshot = { readonly source: string; readonly copy: string };

/**
 * Waits a while.
 *
 * @param ms - How long.
 * @returns Once it passed.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * What a mount is to `docker run -v`: a volume's name, or the host's folder.
 *
 * @param mount - The mount.
 * @param mount.Type - `volume` or `bind`.
 * @param mount.Name - A volume's name.
 * @param mount.Source - A bind's folder.
 * @returns It, or undefined for a mount that cannot be copied.
 */
function sourceOf(mount: InspectedContainer['Mounts'][number]): string | undefined {
  return mount.Type === 'volume' ? mount.Name : mount.Type === 'bind' ? mount.Source : undefined;
}

/**
 * Copies one folder's content into another in a throwaway container of the new image.
 *
 * @param options - The engine and the image.
 * @param from - What is copied.
 * @param to - Where, emptied first.
 * @throws {Error} When the copy fails.
 */
async function copy(options: PlatformUpdateOptions, from: string, to: string): Promise<void> {
  const { engine } = options;
  const id = await engine.createContainer(`nebulahome-copy-${Date.now().toString(36)}`, {
    Image: options.image,
    Entrypoint: ['sh', '-c', 'find /to -mindepth 1 -delete && cp -a /from/. /to/'],
    Cmd: [],
    Labels: { 'io.nebulahome.platform': 'true' },
    HostConfig: { Binds: [`${from}:/from:ro`, `${to}:/to`] },
  });

  try {
    await engine.control(id, 'start');

    const code = await engine.wait(id);

    if (code !== 0) {
      throw new Error(`Copying ${from} to ${to} exited with ${String(code)}`);
    }
  } finally {
    await engine.removeContainer(id).catch(() => undefined);
  }
}

/**
 * Waits for a container to turn healthy.
 *
 * @param options - The engine and how long.
 * @param id - The container.
 * @throws {Error} When it stops, turns unhealthy or takes too long.
 */
async function waitHealthy(options: PlatformUpdateOptions, id: string): Promise<void> {
  const deadline = Date.now() + (options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- one look after another, until it settles
    const { State: state } = await options.engine.inspectContainer(id);

    if (state.Health?.Status === 'healthy') {
      return;
    }

    if (state.Health?.Status === 'unhealthy' || state.Running === false) {
      throw new Error(
        `The new version did not start: it is ${state.Health?.Status ?? state.Status}`,
      );
    }

    // eslint-disable-next-line no-await-in-loop -- see above
    await sleep(options.pollMs ?? 5000);
  }

  throw new Error('The new version did not turn healthy in time');
}

/**
 * Writes the outcome where the page reads it.
 *
 * @param options - Where.
 * @param outcome - What happened.
 */
async function record(
  options: PlatformUpdateOptions,
  outcome: PlatformUpdateOutcome,
): Promise<void> {
  const folder = path.join(options.dataDir, 'updates');

  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'last.json'), `${JSON.stringify(outcome, null, 2)}\n`);
}

/**
 * Replaces the platform's container with one on the new image, or puts the old one back.
 *
 * @param options - The engine, the container, the image and the versions.
 * @returns How it ended, also written to `updates/last.json`.
 */
export async function updatePlatform(
  options: PlatformUpdateOptions,
): Promise<PlatformUpdateOutcome> {
  const { engine, logger } = options;
  const now = options.now ?? ((): Date => new Date());
  const old = await engine.inspectContainer(options.targetId);
  const oldImage = await engine.inspectImage(old.Image);
  const reference = old.Config.Image;
  const name = old.Name.replace(/^\//, '');
  const snapshots: Snapshot[] = [];
  let created: string | null = null;
  let aside: string | null = null;

  /**
   * The outcome, written.
   *
   * @param status - How it ended.
   * @param error - Why, when it failed.
   * @returns It.
   */
  const done = async (
    status: PlatformUpdateOutcome['status'],
    error: string | null,
  ): Promise<PlatformUpdateOutcome> => {
    const outcome: PlatformUpdateOutcome = {
      fromVersion: options.fromVersion,
      toVersion: options.toVersion,
      status,
      finishedAt: now(),
      error,
    };

    await record(options, outcome).catch((writeError: unknown) => {
      logger.error({ err: writeError }, 'Could not write how the update ended');
    });

    return outcome;
  };

  try {
    await engine.tagImage(options.image, reference);
    await engine.control(old.Id, 'stop', PLATFORM_STOP_GRACE_SECONDS);

    for (const mount of old.Mounts) {
      const source = sourceOf(mount);

      if (
        source === undefined ||
        !(SNAPSHOT_FOLDERS as readonly string[]).includes(mount.Destination)
      ) {
        continue;
      }

      const slug = mount.Destination === '/data' ? 'data' : 'postgres';
      const snapshot = {
        source,
        copy: `nebulahome-pre-${options.fromVersion}-${slug}`.replaceAll(/[^\w.-]/g, '-'),
      };

      // eslint-disable-next-line no-await-in-loop -- one volume after another
      await engine.createVolume(snapshot.copy, { 'io.nebulahome.platform': 'true' });
      // eslint-disable-next-line no-await-in-loop -- see above
      await copy(options, snapshot.source, snapshot.copy);
      snapshots.push(snapshot);
    }

    const plan = planRecreate(old, oldImage, reference);

    aside = `${name}-nebula-old-${Date.now().toString(36)}`;
    await engine.renameContainer(old.Id, aside);
    created = await engine.createContainer(name, plan.body);

    const id = created;

    await Promise.all(
      plan.networks.map(async (network) =>
        engine.connectNetwork(network.name, id, network.aliases),
      ),
    );
    await engine.control(id, 'start');
    await waitHealthy(options, id);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);

    logger.error({ err: error }, 'The update failed; putting the old version back');

    try {
      if (created !== null) {
        await engine.removeContainer(created);
      }

      for (const snapshot of snapshots) {
        // eslint-disable-next-line no-await-in-loop -- one volume after another
        await copy(options, snapshot.copy, snapshot.source);
      }

      await engine.tagImage(old.Image, reference);

      if (aside !== null) {
        await engine.renameContainer(old.Id, name);
      }

      await engine.control(old.Id, 'start');
    } catch (rollbackError: unknown) {
      logger.fatal({ err: rollbackError }, 'Could not put the old version back');

      return done(
        'failed',
        `${reason}; putting the old version back failed too: ${
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }. The copies are kept: ${snapshots.map((each) => each.copy).join(', ')}`,
      );
    }

    await Promise.all(
      snapshots.map(async (each) => engine.removeVolume(each.copy).catch(() => undefined)),
    );

    return done('rolled_back', reason);
  }

  await engine.removeContainer(old.Id).catch((error: unknown) => {
    logger.warn({ err: error }, 'Could not remove the old container');
  });
  await Promise.all(
    snapshots.map(async (each) => engine.removeVolume(each.copy).catch(() => undefined)),
  );

  return done('success', null);
}
