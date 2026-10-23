/**
 * The containers the owner installs from the containers page.
 *
 * An install answers at once and goes on after: the image is pulled - which can take minutes, and
 * whose progress the page shows on a card of its own - then the container is made and started.
 * Until Docker lists it running, the install is kept here; one that failed stays, with why, until
 * the owner has read it and dismissed it, or asks again under the same name. A container that was
 * made but would not start is removed again, so a failed install leaves nothing half-done behind.
 *
 * Docker alone knows the container once it runs, so each one is also recorded - what the form
 * said, on the tag it was last updated to - in `containers/installed/.installs.json`: a backup
 * takes the record with the folders, and a restore that brings them back makes again the
 * containers Docker no longer has. Around the swap of those folders the running ones are stopped
 * and started again, so none writes into a folder the restore moved away.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CONTAINERS_DIRECTORY, INSTALLED_CONTAINERS_DIRECTORY } from '@nebulahome/config';
import {
  containerInstallRequestSchema,
  isNebulaError,
  type ContainerInstall,
  type ContainerInstallRequest,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';
import { installCreateBody, installedFolder } from '../domain/install.js';
import type { PlatformContext } from '../domain/managed.js';
import { PullProgressTracker } from '../domain/pull-progress.js';

/** How far the pull must move before the page is told again, in percent. */
const PROGRESS_STEP = 5;

/** The record of the installs, beside their folders: a container's name never starts with a dot. */
const RECORD_FILE = '.installs.json';

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
  readonly #records = new Map<string, ContainerInstallRequest>();
  #saving: Promise<void> = Promise.resolve();
  #suspended: string[] = [];

  /**
   * Creates the set, empty.
   *
   * @param options - The engine, the logger, the data directory and whom to tell.
   */
  public constructor(options: InstallsOptions) {
    this.#options = options;
  }

  /**
   * Reads the record of the installs again: at start, and after a restore brought another back.
   */
  public async load(): Promise<void> {
    this.#records.clear();

    let entries: unknown;

    try {
      entries = JSON.parse(await readFile(this.#recordPath(), 'utf8'));
    } catch {
      // None yet: nothing was installed here since installs were recorded.
      return;
    }

    for (const entry of Array.isArray(entries) ? entries : []) {
      const parsed = containerInstallRequestSchema.safeParse(entry);

      if (parsed.success) {
        this.#records.set(parsed.data.name, parsed.data);
      } else {
        this.#options.logger.warn({ entry }, 'Skipped an install record that does not read');
      }
    }
  }

  /**
   * The names of the containers recorded.
   *
   * @returns Them.
   */
  public recorded(): string[] {
    return [...this.#records.keys()];
  }

  /**
   * Drops a container from the record, once the owner removed it.
   *
   * @param name - The container.
   */
  public async forget(name: string): Promise<void> {
    if (this.#records.delete(name)) {
      await this.#save();
    }
  }

  /**
   * Records the tag a container was updated to, so a restore makes it on that one.
   *
   * @param name - The container.
   * @param tag - The tag it runs now.
   */
  public async retag(name: string, tag: string): Promise<void> {
    const record = this.#records.get(name);

    if (record !== undefined && record.tag !== tag) {
      this.#records.set(name, { ...record, tag });
      await this.#save();
    }
  }

  /**
   * Stops the installed containers that run, before a restore swaps the folders they keep.
   *
   * @param running - The names of the installed containers that run.
   */
  public async suspend(running: readonly string[]): Promise<void> {
    this.#suspended = [...running];

    for (const name of this.#suspended) {
      // eslint-disable-next-line no-await-in-loop -- one at a time, so the log says which failed
      await this.#options.engine.control(name, 'stop').catch((error: unknown) => {
        this.#options.logger.warn({ err: error, container: name }, 'Could not stop it');
      });
    }
  }

  /**
   * After a restore: starts again what {@link suspend} stopped, reads the restored record, and
   * installs again every recorded container Docker no longer has.
   *
   * @param existing - The name of every container Docker has now.
   * @param context - The platform, or null while Docker cannot be reached.
   */
  public async resume(
    existing: ReadonlySet<string>,
    context: PlatformContext | null,
  ): Promise<void> {
    const names = this.#suspended;

    this.#suspended = [];

    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop -- one at a time, as they were stopped
      await this.#options.engine.control(name, 'start').catch((error: unknown) => {
        this.#options.logger.warn({ err: error, container: name }, 'Could not start it again');
      });
    }

    await this.load();

    const missing = [...this.#records.values()].filter((record) => !existing.has(record.name));

    if (context === null) {
      if (missing.length > 0) {
        this.#options.logger.warn(
          { containers: missing.map((record) => record.name) },
          'Docker cannot be reached: the restored installs were not made again',
        );
      }

      return;
    }

    for (const record of missing.filter((each) => !this.isInstalling(each.name))) {
      this.#options.logger.info(
        { container: record.name },
        'Installing again a restored container',
      );
      this.start(record, context);
    }
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
      this.#records.set(request.name, request);
      await this.#save();
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
   * Where the record of the installs is kept.
   *
   * @returns `containers/installed/.installs.json` of the data directory.
   */
  #recordPath(): string {
    return path.join(
      this.#options.dataRoot,
      CONTAINERS_DIRECTORY,
      INSTALLED_CONTAINERS_DIRECTORY,
      RECORD_FILE,
    );
  }

  /**
   * Writes the record whole, one write after another: a container that runs but is not recorded
   * is only one a restore does not make again, so a failure is logged, not thrown.
   *
   * @returns Once written, or given up on.
   */
  async #save(): Promise<void> {
    const file = this.#recordPath();

    this.#saving = this.#saving.then(async () => {
      try {
        await mkdir(path.dirname(file), { recursive: true });
        // The environment may hold passwords: the owner's alone, as the archive that takes it is.
        await writeFile(`${file}.tmp`, JSON.stringify([...this.#records.values()], null, 2), {
          mode: 0o600,
        });
        await rename(`${file}.tmp`, file);
      } catch (error: unknown) {
        this.#options.logger.warn({ err: error }, 'Could not record the installs');
      }
    });

    return this.#saving;
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
