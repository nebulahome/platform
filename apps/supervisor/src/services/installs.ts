/**
 * The containers the owner installs from the containers page.
 *
 * An install answers at once and goes on after: the image is pulled - which can take minutes, and
 * whose progress the page shows on a card of its own - then the container is made and started.
 * Until Docker lists it running, the install is kept here; one that failed stays, with why, until
 * the owner has read it and dismissed it, or asks again under the same name. A container that was
 * made but would not start is removed again, so a failed install leaves nothing half-done behind.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  isNebulaError,
  type ContainerInstall,
  type ContainerInstallRequest,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

import type { DockerEngine } from '../docker/engine.js';
import { installCreateBody, installedFolder } from '../domain/install.js';
import type { PlatformContext } from '../domain/managed.js';
import { PullProgressTracker } from '../domain/pull-progress.js';

/** How far the pull must move before the page is told again, in percent. */
const PROGRESS_STEP = 5;

/** What the installs need. */
export type InstallsOptions = {
  readonly engine: DockerEngine;
  readonly logger: PlatformLogger;

  /** The data directory, as this process reaches it: a folder kept in it is made here. */
  readonly dataRoot: string;

  /** Makes the network the platform shares with the containers it makes. */
  readonly ensureNetwork: (context: PlatformContext) => Promise<void>;

  /** Told whenever an install moved, so the lists read again. */
  readonly onChange: (name: string) => void;
};

/** The containers being installed. */
export class Installs {
  readonly #options: InstallsOptions;
  readonly #installs = new Map<string, ContainerInstall>();

  /**
   * Creates the set, empty.
   *
   * @param options - The engine, the logger, the data directory and whom to tell.
   */
  public constructor(options: InstallsOptions) {
    this.#options = options;
  }

  /**
   * Every install still going, and every one that failed and was not dismissed.
   *
   * @returns The installs, oldest first.
   */
  public list(): ContainerInstall[] {
    return [...this.#installs.values()];
  }

  /**
   * Whether a name is taken by an install still going.
   *
   * @param name - The container's name.
   * @returns True while it is being pulled, made or started.
   */
  public isInstalling(name: string): boolean {
    const install = this.#installs.get(name);

    return install !== undefined && install.phase !== 'failed';
  }

  /**
   * Forgets an install that failed.
   *
   * @param name - The container's name.
   */
  public dismiss(name: string): void {
    if (this.#installs.get(name)?.phase === 'failed') {
      this.#installs.delete(name);
      this.#options.onChange(name);
    }
  }

  /**
   * Starts an install. The caller has checked the name is free.
   *
   * @param request - What the form said.
   * @param context - The platform.
   */
  public start(request: ContainerInstallRequest, context: PlatformContext): void {
    this.#installs.set(request.name, {
      name: request.name,
      image: `${request.image}:${request.tag}`,
      phase: 'pulling',
      progress: null,
      error: null,
      startedAt: new Date(),
    });
    this.#options.onChange(request.name);

    void this.#run(request, context);
  }

  /**
   * Pulls, makes and starts the container, recording where it stands.
   *
   * @param request - What the form said.
   * @param context - The platform.
   */
  async #run(request: ContainerInstallRequest, context: PlatformContext): Promise<void> {
    const { engine, logger } = this.#options;
    const tracker = new PullProgressTracker();
    let lastPercent: number | null = null;
    let id: string | null = null;

    try {
      await engine.pull(request.image, request.tag, (progress) => {
        tracker.add(progress);

        const percent = tracker.percent();

        if (percent !== null && (lastPercent === null || percent - lastPercent >= PROGRESS_STEP)) {
          lastPercent = percent;
          this.#record(request.name, { progress: percent });
        }
      });

      this.#record(request.name, { phase: 'creating', progress: null });

      if (request.network === 'platform') {
        await this.#options.ensureNetwork(context);
      }

      await this.#prepareFolders(request, context);

      id = await engine.createContainer(request.name, installCreateBody(request, context));
      this.#record(request.name, { phase: 'starting' });
      await engine.control(id, 'start');

      logger.info(
        { container: request.name, image: `${request.image}:${request.tag}` },
        'Installed a container',
      );
      this.#installs.delete(request.name);
      this.#options.onChange(request.name);
    } catch (error: unknown) {
      const message =
        isNebulaError(error) || error instanceof Error ? error.message : String(error);

      logger.error({ err: error, container: request.name }, 'Could not install a container');

      if (id !== null) {
        // Made but not started: nothing half-done stays behind under the name.
        await engine.removeContainer(id, true).catch((removal: unknown) => {
          logger.warn({ err: removal, container: request.name }, 'Could not remove it again');
        });
      }

      this.#record(request.name, {
        phase: 'failed',
        progress: null,
        error: message.slice(0, 1000),
      });
    }
  }

  /**
   * Makes the folders kept in the data directory, so Docker does not make them as root.
   *
   * @param request - What the form said.
   * @param context - The platform: a folder kept apart has none here.
   */
  async #prepareFolders(request: ContainerInstallRequest, context: PlatformContext): Promise<void> {
    if (context.dataMount.kind === 'separate') {
      return;
    }

    await Promise.all(
      request.volumes.flatMap((volume) =>
        volume.kind === 'data'
          ? [
              mkdir(path.join(this.#options.dataRoot, installedFolder(request.name, volume.name)), {
                recursive: true,
              }),
            ]
          : [],
      ),
    );
  }

  /**
   * Records where an install stands, and says so.
   *
   * @param name - The container's name.
   * @param fields - What changed.
   */
  #record(name: string, fields: Partial<ContainerInstall>): void {
    const install = this.#installs.get(name);

    if (install !== undefined) {
      this.#installs.set(name, { ...install, ...fields });
      this.#options.onChange(name);
    }
  }
}
