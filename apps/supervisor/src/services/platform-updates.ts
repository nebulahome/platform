/**
 * Nebula Home's own updates, restart and shutdown, from the supervisor's side
 * (docs/releases-and-updates.md 4).
 *
 * It asks GitHub for the releases every six hours and on Check now; an update pulls the release's
 * image and starts the throwaway updater container from it (`updater.ts`), which replaces the
 * platform's container while this one stops. Restart and shutdown are the Docker daemon's
 * `restart` and `stop` of the platform's own container, so they complete although the supervisor
 * stops with it; without the socket a restart is s6's `halt`, which the `unless-stopped` policy
 * follows with a start, and a shutdown cannot be done.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ConflictError,
  platformUpdateOutcomeSchema,
  ValidationError,
  type PlatformReleasesReply,
  type PlatformUpdateOutcome,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { InspectedContainer } from '../docker/engine-schemas.js';
import type { DockerEngine } from '../docker/engine.js';
import { fetchPlatformReleases, type PlatformReleases } from '../registry/github-releases.js';

import { PLATFORM_STOP_GRACE_SECONDS } from './platform-updater.js';

/** What it needs. */
export type PlatformUpdatesOptions = {
  readonly engine: DockerEngine;
  readonly logger: PlatformLogger;

  /** The version running. */
  readonly version: string;

  /** The platform's data folder, where the updater writes how the last update ended. */
  readonly dataRoot: string;

  /** The socket inside this container, to find where it comes from on the host. */
  readonly socketPath: string;

  /** Whether Docker can be reached now. */
  readonly isDockerAvailable: () => boolean;

  /** The platform's own container, inspected; null outside a container. */
  readonly self: () => InspectedContainer | null;

  /** Replaced by a test. */
  readonly fetch?: typeof fetch;
};

/** A release this platform names: CalVer, a beta or not. */
const VERSION = /^\d{4}\.\d{1,2}\.\d+(?:-beta\.\d+)?$/;

/** s6's way of ending the container. */
const HALT = '/run/s6/basedir/bin/halt';

/** Nebula Home's own updates, restart and shutdown. */
export class PlatformUpdates {
  readonly #options: PlatformUpdatesOptions;
  #releases: PlatformReleases = { stable: null, beta: null, dev: null };
  #checkedAt: Date | null = null;
  #error: string | null = null;
  #isUpdating = false;

  /**
   * Builds it without asking anything.
   *
   * @param options - The engine, the version, the data folder and the platform's container.
   */
  public constructor(options: PlatformUpdatesOptions) {
    this.#options = options;
  }

  /** Asks GitHub for the releases; a failure is kept to show, never thrown. */
  public async check(): Promise<void> {
    try {
      this.#releases = await fetchPlatformReleases({
        timeoutMs: 15_000,
        userAgent: `NebulaHome/${this.#options.version} (+https://github.com/nebulahome/platform)`,
        ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
      });
      this.#error = null;
    } catch (error: unknown) {
      this.#error = error instanceof Error ? error.message : String(error);
      this.#options.logger.warn({ err: error }, "Could not read Nebula Home's releases");
    } finally {
      this.#checkedAt = new Date();
    }
  }

  /**
   * The releases, and whether Nebula Home can update itself here.
   *
   * @param check - Whether to ask GitHub again first.
   * @returns What the page shows.
   */
  public async releases(check: boolean): Promise<PlatformReleasesReply> {
    if (check || this.#checkedAt === null) {
      await this.check();
    }

    return {
      installedVersion: this.#options.version,
      ...this.#releases,
      checkedAt: this.#checkedAt,
      error: this.#error,
      refusal: this.#refusal(),
      lastUpdate: await this.#lastUpdate(),
    };
  }

  /**
   * Updates Nebula Home: pulls the release's image and starts the updater from it.
   *
   * @param version - The release.
   * @throws {ValidationError} For a version that is not a release's.
   * @throws {ConflictError} When it cannot update here, saying why.
   */
  public async update(version: string): Promise<void> {
    if (!VERSION.test(version)) {
      throw new ValidationError(`${version} is not a release of Nebula Home`);
    }

    const refusal = this.#refusal();
    const self = this.#options.self();

    if (refusal !== null || self === null) {
      throw new ConflictError(refusal ?? 'Nebula Home does not run in a container here', {
        details: { reason: 'cannot-update' },
      });
    }

    const { engine, logger } = this.#options;
    const repository = repositoryOf(self.Config.Image);
    const image = `${repository}:${version}`;

    this.#isUpdating = true;

    try {
      logger.info({ image }, 'Pulling the new version of Nebula Home');
      await engine.pull(repository, version, () => undefined);

      const pulled = await engine.inspectImage(image);
      const label = pulled?.Config?.Labels['org.opencontainers.image.version'];

      if (label !== version) {
        throw new ConflictError(`${image} says it is ${label ?? 'no version'}, not ${version}`, {
          details: { reason: 'wrong-image' },
        });
      }

      const id = await engine.createContainer(`nebulahome-updater-${Date.now().toString(36)}`, {
        Image: image,
        Entrypoint: ['node', '/app/apps/supervisor/dist/updater.js'],
        Cmd: [],
        Env: [
          `NEBULA_UPDATER_TARGET=${self.Id}`,
          `NEBULA_UPDATER_IMAGE=${image}`,
          `NEBULA_UPDATER_FROM=${this.#options.version}`,
          `NEBULA_UPDATER_TO=${version}`,
          'NEBULA_UPDATER_DATA=/data',
          'SUPERVISOR_DOCKER_SOCKET=/var/run/docker.sock',
        ],
        Labels: { 'io.nebulahome.platform': 'true', 'io.nebulahome.updater': 'true' },
        HostConfig: {
          AutoRemove: true,
          Binds: [
            `${this.#hostSourceOf(self, this.#options.socketPath)}:/var/run/docker.sock`,
            `${this.#hostSourceOf(self, this.#options.dataRoot)}:/data`,
          ],
        },
      });

      await engine.control(id, 'start');
      logger.info({ version }, 'The updater runs: Nebula Home stops for the update');
    } catch (error: unknown) {
      this.#isUpdating = false;
      throw error;
    }
  }

  /**
   * Restarts the platform's container.
   *
   * @throws {ConflictError} Outside the container, where there is nothing to restart.
   */
  public restart(): void {
    const self = this.#options.self();

    if (self === null || !this.#options.isDockerAvailable()) {
      if (!existsSync(HALT)) {
        throw new ConflictError('Nebula Home does not run in its container here', {
          details: { reason: 'not-in-container' },
        });
      }

      this.#halt();

      return;
    }

    // Not awaited: the daemon stops this process with the container before it answers.
    void this.#options.engine
      .control(self.Id, 'restart', PLATFORM_STOP_GRACE_SECONDS)
      .catch((error: unknown) => {
        this.#options.logger.error({ err: error }, 'Could not restart the platform');
      });
  }

  /**
   * Stops the platform's container until it is started again.
   *
   * @throws {ConflictError} Without Docker: a stop the restart policy would undo.
   */
  public shutdown(): void {
    const self = this.#options.self();

    if (self === null || !this.#options.isDockerAvailable()) {
      throw new ConflictError(
        'Shutting down needs the Docker socket: without it the container would start again',
        { details: { reason: 'unreachable' } },
      );
    }

    void this.#options.engine
      .control(self.Id, 'stop', PLATFORM_STOP_GRACE_SECONDS)
      .catch((error: unknown) => {
        this.#options.logger.error({ err: error }, 'Could not shut the platform down');
      });
  }

  /**
   * Why Nebula Home cannot update itself here.
   *
   * @returns The reason, in English; null when it can.
   */
  #refusal(): string | null {
    if (this.#isUpdating) {
      return 'An update is running';
    }

    if (!this.#options.isDockerAvailable()) {
      return 'Updating needs the Docker socket, which this container is not given';
    }

    return this.#options.self() === null ? 'Nebula Home does not run in a container here' : null;
  }

  /**
   * How the last update ended, as the updater wrote it.
   *
   * @returns It, or null when there was none.
   */
  async #lastUpdate(): Promise<PlatformUpdateOutcome | null> {
    try {
      const text = await readFile(
        path.join(this.#options.dataRoot, 'updates', 'last.json'),
        'utf8',
      );

      return platformUpdateOutcomeSchema.parse(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /**
   * Where a folder of this container comes from on the host: a volume's name or a host folder.
   *
   * @param self - This container.
   * @param folder - The folder, or a file in it, inside this container.
   * @returns What `-v` takes.
   * @throws {ConflictError} When it is not mounted.
   */
  #hostSourceOf(self: InspectedContainer, folder: string): string {
    const mount = self.Mounts.find((each) => each.Destination === folder);
    const source = mount?.Type === 'volume' ? mount.Name : mount?.Source;

    if (source === undefined) {
      throw new ConflictError(`${folder} is not mounted into the platform's container`, {
        details: { reason: 'not-mounted' },
      });
    }

    return source;
  }

  /** Ends the container through s6, for the restart policy to start it again. */
  #halt(): void {
    this.#options.logger.warn('No Docker socket: restarting through s6');
    spawn(HALT, { detached: true, stdio: 'ignore' })
      .on('error', (error) => {
        this.#options.logger.error({ err: error }, 'Could not restart through s6');
      })
      .unref();
  }
}

/**
 * The repository of an image reference, without its tag or digest.
 *
 * @param reference - `nebulahome/platform:latest`, `registry:5000/x/y@sha256:…`.
 * @returns `nebulahome/platform`.
 */
export function repositoryOf(reference: string): string {
  const withoutDigest = reference.split('@')[0] ?? reference;
  const at = withoutDigest.lastIndexOf(':');

  return at > withoutDigest.lastIndexOf('/') ? withoutDigest.slice(0, at) : withoutDigest;
}
