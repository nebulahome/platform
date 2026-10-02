/**
 * The packet-manager: every installed package, installed, started in order, kept running, and
 * removed (PACKAGES.md 11, ARCHITECTURE.md 4.5).
 *
 * **Where packages come from.** The system packages ship in the image (`PACKET_MANAGER_BUILTIN_DIR`)
 * and are installed from there on every start, their row following the image's release. The
 * others are releases from the package index, unpacked into `packages/<id>/<version>/` of the data
 * directory, and read from there on start.
 *
 * **Running.** A `node` package is a child process ({@link PackageProcess}), `starting` until it
 * announces the RPC methods it registered - or until a while has passed and it still runs - then
 * `running`. A `container` package is its containers, handed to the supervisor as the package's
 * (`ownerKind: package`); a `none` package runs nothing. They start in dependency order; one whose
 * requirement is missing or not running is `waiting-dependency`, and starts once it runs. One that
 * leaves `running` takes what depends on it with it, back to waiting.
 *
 * **Changing them.** Installing plans with the dependency resolver - what the package needs first,
 * or why it cannot be installed - downloads and checks each archive, and starts them. Updating is
 * refused when a dependent's range excludes the new release, and rolled back to the release before
 * when the new one fails. Removing is refused while something needs the package, or for a system
 * package; it takes the package's devices and containers with it, and its data only when asked.
 * Every change is announced on `nebula.v1.pkg.<event>`, which is how the interface shows a
 * package's page and cards without a reload, and how `hub` holds and releases the vendors that
 * need it. Nothing else restarts.
 *
 * Operations are queued one after another: two installs racing over one row are not a case to
 * handle, only to rule out.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { satisfies } from 'semver';
import { z } from 'zod';

import type { BusClient } from '@nebulahome/bus';
import {
  blockedUpdate,
  busSubjects,
  catalogueReplySchema,
  compareVersions,
  ConflictError,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  composeVariableOf,
  dependentsOf,
  describeDependencyProblem,
  HUB_CATALOGUE_METHOD,
  HUB_SERVICE,
  managedReplySchema,
  NotFoundError,
  PACKAGE_SETTINGS_METHOD,
  packageManifestSchema,
  planInstall,
  startOrder,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  syncPackageReplySchema,
  unmetRequirements,
  type AvailablePackage,
  type Candidate,
  type Dependent,
  type DependencyNode,
  type InstalledNode,
  type InstalledPackage,
  type JsonObject,
  type PackageAnnounceRequest,
  type PackageDetail,
  type PackageIndex,
  type PackagePlanReply,
  type PackageRelation,
  type PackageRelease,
  type PackageRpcMethod,
  type PackageState,
} from '@nebulahome/contracts';
import { maskSealed, openSecrets } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';
import { renderContainers } from '@nebulahome/package-runtime';
import { SDK_VERSION } from '@nebulahome/package-sdk';

import type { PacketManagerConfig } from './config.js';
import { LogRing } from './domain/log-ring.js';
import type { PackageRow, PackageStore } from './persistence/packages.js';
import type { PackageIndexClient } from './services/index-client.js';
import { installRelease } from './services/installer.js';
import { packageFoldersIn, readPackageFiles, type PackageFiles } from './services/package-files.js';
import { PackageProcess, type ProcessState } from './services/package-process.js';

/** How long the supervisor and `core` have to answer. */
const CALL_TIMEOUT_MS = 10_000;

/** How long a new release has to run before an update counts as done and cannot roll back. */
const ROLLBACK_WINDOW_MS = 120_000;

/** What the packet-manager needs. */
export type PacketManagerOptions = {
  readonly config: PacketManagerConfig;
  readonly store: PackageStore;
  readonly client: BusClient;
  readonly logger: PlatformLogger;
  readonly index: PackageIndexClient;
  readonly secretsKey: Buffer;

  /** The runner a `node` package is started with. */
  readonly runner: string;

  /** The data directory's `packages/` and `cache/packages/`. */
  readonly packagesDir: string;
  readonly cacheDir: string;

  readonly fetch?: typeof fetch;
};

/** One installed package, as the service holds it. */
type Entry = {
  row: PackageRow;
  files: PackageFiles;
  process: PackageProcess | undefined;
  rpcMethods: PackageRpcMethod[];
  announce: NodeJS.Timeout | undefined;

  /** What the platform itself says about a package with no process of its own. */
  readonly notes: LogRing;

  /** The release to go back to if the one just updated to fails, until it has run a while. */
  rollbackTo: { readonly version: string; readonly untilMs: number } | undefined;
};

/**
 * A package's settings as its compose file's variables: `NEBULA_SETUP_<KEY>`, each value as text.
 *
 * @param settings - The settings, secrets opened.
 * @returns The variables.
 */
function composeValuesOf(settings: JsonObject): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      composeVariableOf(key),
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
}

/**
 * Says whether a value is the mask a sealed secret is served as.
 *
 * @param value - The value.
 * @returns True for `{ "$sealed": true }`.
 */
function isMask(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && '$sealed' in value && value.$sealed === true
  );
}

/**
 * Where a release comes from, by its archive's address: a file of the local folder, or the index.
 *
 * @param url - The archive's address.
 * @returns The source.
 */
function sourceOf(url: string): 'index' | 'local' {
  return url.startsWith('file:') ? 'local' : 'index';
}

/**
 * A package's build: its version and the archive it was unpacked from.
 *
 * @param row - Its row.
 * @returns `<version>+<first 8 of the archive's SHA-256>`, or the version alone without one.
 */
function buildOf(row: Pick<PackageRow, 'version' | 'artifactSha256'>): string {
  return row.artifactSha256 === null
    ? row.version
    : `${row.version}+${row.artifactSha256.slice(0, 8)}`;
}

/** The packages. */
export class PacketManager {
  readonly #options: PacketManagerOptions;
  readonly #entries = new Map<string, Entry>();
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * Makes the service, holding nothing until {@link start}.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: PacketManagerOptions) {
    this.#options = options;
  }

  /**
   * Reads every package - the image's and those installed - and starts them in order.
   *
   * @returns Once they have been started, or found waiting.
   */
  public async start(): Promise<void> {
    await this.#serially(async () => {
      await mkdir(this.#options.packagesDir, { recursive: true });
      await this.#load();
      await this.#reconcileContainers();

      const order = startOrder(this.#nodes());

      for (const problem of order.problems) {
        this.#options.logger.error(
          { problem: describeDependencyProblem(problem) },
          'Some packages need each other and none of them can start',
        );
      }

      for (const id of order.order) {
        const entry = this.#entries.get(id);

        if (
          entry !== undefined &&
          entry.row.state !== 'stopped' &&
          entry.row.state !== 'disabled'
        ) {
          // One after another: each may be what the next one needs.
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.#startOne(entry);
        }
      }
    });
  }

  /**
   * Stops every package's process, on shutdown. Their rows keep the state they had, so each starts
   * again with the service.
   *
   * @returns Once every process has exited.
   */
  public async stop(): Promise<void> {
    await Promise.all(
      [...this.#entries.values()].map(async (entry) => {
        clearTimeout(entry.announce);
        await entry.process?.stop();
      }),
    );
  }

  /**
   * Every installed package.
   *
   * @returns Their views.
   */
  public async list(): Promise<InstalledPackage[]> {
    const vendors = await this.#vendors();

    return [...this.#entries.values()]
      .sort((left, right) => left.row.id.localeCompare(right.row.id))
      .map((entry) => this.#viewOf(entry, vendors));
  }

  /**
   * One installed package, with its setup and what is saved, secrets masked.
   *
   * @param packageId - The package.
   * @returns Its view.
   * @throws {NotFoundError} When it is not installed.
   */
  public async get(packageId: string): Promise<PackageDetail> {
    const entry = this.#require(packageId);

    return {
      ...this.#viewOf(entry, await this.#vendors()),
      setup: entry.files.setup,
      config: maskSealed(entry.row.config),
      root: entry.files.root,
    };
  }

  /**
   * What the index offers, each with its newest release that works with this platform.
   *
   * @returns The packages, and whether the index could be read.
   */
  public async available(): Promise<{
    items: AvailablePackage[];
    checkedAt: Date | null;
    error: string | null;
  }> {
    const read = await this.#options.index.read();

    return {
      items: (read.index?.packages ?? []).map((entry): AvailablePackage => {
        const fitting = entry.versions
          .filter((release) => this.#fits(release))
          .sort((left, right) => compareVersions(right.version, left.version));
        const newest = [...entry.versions].sort((left, right) =>
          compareVersions(right.version, left.version),
        )[0];
        const latest = fitting[0];
        const row = this.#entries.get(entry.id)?.row;
        const installed = row?.version ?? null;

        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          category: entry.category,
          repository: entry.repository,
          icon: entry.icon ?? null,
          latest:
            latest === undefined
              ? null
              : {
                  version: latest.version,
                  requires: latest.requires,
                  provides: latest.provides,
                  publishedAt: latest.publishedAt,
                  changelogUrl: latest.changelogUrl ?? null,
                  source: sourceOf(latest.artifact.url),
                },
          newestVersion: newest?.version ?? '0.0.0',
          installedVersion: installed,
          hasUpdate:
            installed !== null &&
            latest !== undefined &&
            compareVersions(latest.version, installed) > 0,
          hasNewBuild: row !== undefined && this.#newBuild(read.index, row) !== undefined,
        };
      }),
      checkedAt: read.checkedAt,
      error: read.error,
    };
  }

  /**
   * What installing a package would take.
   *
   * @param packageId - The package.
   * @param version - A release; the newest that fits when not said.
   * @returns What would be installed, or why it cannot be.
   */
  public async plan(packageId: string, version?: string): Promise<PackagePlanReply> {
    const read = await this.#options.index.read();
    const plan = this.#planWith(read.index, packageId, version);
    const names = this.#namesFrom(read.index);

    return {
      install: plan.install.map((candidate) => ({
        id: candidate.id,
        version: candidate.version,
        name: names.get(candidate.id) ?? candidate.id,
      })),
      problems: plan.problems.map((problem) =>
        describeDependencyProblem(problem, (id) => names.get(id) ?? id),
      ),
    };
  }

  /**
   * Installs a package and what it needs, and starts them.
   *
   * @param packageId - The package.
   * @param version - A release; the newest that fits when not said.
   * @returns The packages installed, the one asked for last.
   * @throws {ConflictError} When it cannot be installed, saying why.
   */
  public async install(packageId: string, version?: string): Promise<InstalledPackage[]> {
    return this.#serially(async () => {
      const read = await this.#options.index.read(true);
      const plan = this.#planWith(read.index, packageId, version);
      const names = this.#namesFrom(read.index);

      if (plan.problems.length > 0) {
        throw new ConflictError(
          plan.problems
            .map((problem) => describeDependencyProblem(problem, (id) => names.get(id) ?? id))
            .join('; '),
          { details: { reason: 'cannot-install', packageId } },
        );
      }

      const installed: Entry[] = [];

      for (const candidate of plan.install) {
        // One after another: a download each, and each the next one's requirement.
        // eslint-disable-next-line no-await-in-loop -- see above
        installed.push(await this.#installCandidate(read.index, candidate));
      }

      await this.#reconcileContainers();

      for (const entry of installed) {
        // eslint-disable-next-line no-await-in-loop -- in order, see above
        await this.#startOne(entry);
      }

      const vendors = await this.#vendors();

      return installed.map((entry) => this.#viewOf(entry, vendors));
    });
  }

  /**
   * Updates a package to the newest release that fits, rolling back if it fails to run.
   *
   * @param packageId - The package.
   * @returns It, as it now stands.
   * @throws {ConflictError} When there is no newer release, or a dependent's range excludes it.
   */
  public async update(packageId: string): Promise<InstalledPackage> {
    return this.#serially(async () => {
      const entry = this.#require(packageId);

      if (entry.row.source === 'builtin') {
        throw new ConflictError(`${entry.files.manifest.name} is updated with the platform`, {
          details: { reason: 'system', packageId },
        });
      }

      const read = await this.#options.index.read(true);
      const release = this.#newestRelease(read.index, packageId);
      const rebuilt = this.#newBuild(read.index, entry.row);

      if (
        rebuilt !== undefined &&
        (release === undefined || compareVersions(release.version, entry.row.version) <= 0)
      ) {
        await this.#reinstall(entry, rebuilt);

        return this.#viewOf(entry, await this.#vendors());
      }

      if (release === undefined || compareVersions(release.version, entry.row.version) <= 0) {
        throw new ConflictError(
          `${entry.files.manifest.name} ${entry.row.version} is the newest release`,
          {
            details: { reason: 'up-to-date', packageId },
          },
        );
      }

      const blocked = blockedUpdate(
        packageId,
        release.version,
        await this.#dependents(),
        satisfies,
      );

      if (blocked.length > 0) {
        throw new ConflictError(
          blocked.map((problem) => describeDependencyProblem(problem)).join('; '),
          {
            details: { reason: 'required-by', packageId },
          },
        );
      }

      const files = await installRelease(
        { id: packageId, version: release.version, artifact: release.artifact },
        this.#options.packagesDir,
        {
          timeoutMs: this.#options.config.PACKET_MANAGER_DOWNLOAD_TIMEOUT_MS,
          ...this.#fetchOption(),
        },
      );
      const previous = entry.row.version;

      await this.#stopProcess(entry);
      await this.#options.store.update(packageId, {
        version: files.manifest.version,
        runtime: files.manifest.runtime,
        manifest: files.manifest,
        previousVersion: previous,
        source: sourceOf(release.artifact.url),
        artifactSha256: release.artifact.sha256,
        state: 'installed',
        lastError: null,
      });
      entry.row = {
        ...entry.row,
        version: files.manifest.version,
        runtime: files.manifest.runtime,
        previousVersion: previous,
        source: sourceOf(release.artifact.url),
        artifactSha256: release.artifact.sha256,
        state: 'installed',
      };
      entry.files = files;
      entry.process = undefined;
      entry.rollbackTo = { version: previous, untilMs: Date.now() + ROLLBACK_WINDOW_MS };
      await this.#removeOldReleases(packageId, [files.manifest.version, previous]);
      this.#publish('installed', entry);
      await this.#reconcileContainers();
      await this.#startOne(entry);

      return this.#viewOf(entry, await this.#vendors());
    });
  }

  /**
   * Removes a package: its process, its containers, its devices, its release - and its data when
   * asked.
   *
   * @param packageId - The package.
   * @param isDataRemoved - Whether its data folder goes too.
   * @returns Once it is gone.
   * @throws {ConflictError} For a system package, or one something needs.
   */
  public async remove(packageId: string, isDataRemoved: boolean): Promise<void> {
    await this.#serially(async () => {
      const entry = this.#require(packageId);

      if (entry.row.isSystem) {
        throw new ConflictError(
          `${entry.files.manifest.name} is part of the platform and is not removed`,
          {
            details: { reason: 'system', packageId },
          },
        );
      }

      const needing = dependentsOf(packageId, this.#nodes(), await this.#dependents());

      if (needing.length > 0) {
        throw new ConflictError(
          `${entry.files.manifest.name} is needed by ${needing.map((each) => each.id).join(', ')}`,
          {
            details: {
              reason: 'required-by',
              packageId,
              dependents: needing.map((each) => ({ kind: each.kind, id: each.id })),
            },
          },
        );
      }

      await this.#stopProcess(entry);
      await this.#options.store.remove(packageId);
      this.#entries.delete(packageId);

      // With its row gone, `core` forgets its types and removes every device it had.
      await this.#options.client
        .request(
          busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
          { packageId, devices: [] },
          syncPackageReplySchema,
          { timeoutMs: CALL_TIMEOUT_MS },
        )
        .catch((error: unknown) => {
          this.#options.logger.warn(
            { err: error, package: packageId },
            'Could not remove its devices',
          );
        });
      await this.#reconcileContainers();
      await this.#removeContainers(packageId, entry);

      const folder = path.join(this.#options.packagesDir, packageId);

      if (isDataRemoved) {
        await rm(folder, { recursive: true, force: true });
        await rm(path.join(this.#options.cacheDir, packageId), { recursive: true, force: true });
      } else {
        await this.#removeOldReleases(packageId, []);
      }

      this.#options.client.publish(busSubjects.packageEvent('removed'), {
        packageId,
        version: entry.row.version,
        state: entry.row.state,
      });
      this.#options.logger.info({ package: packageId, isDataRemoved }, 'Removed a package');
    });
  }

  /**
   * Starts a package the owner stopped, or that failed.
   *
   * @param packageId - The package.
   * @returns It, as it now stands.
   */
  public async startPackage(packageId: string): Promise<InstalledPackage> {
    return this.#serially(async () => {
      const entry = this.#require(packageId);

      await this.#startOne(entry);

      return this.#viewOf(entry, await this.#vendors());
    });
  }

  /**
   * Stops a package, and what depends on it; it stays stopped until started.
   *
   * @param packageId - The package.
   * @returns It, as it now stands.
   */
  public async stopPackage(packageId: string): Promise<InstalledPackage> {
    return this.#serially(async () => {
      const entry = this.#require(packageId);

      await this.#stopProcess(entry);
      await this.#setState(entry, 'stopped', null);
      await this.#reconcileContainers();

      return this.#viewOf(entry, await this.#vendors());
    });
  }

  /**
   * Restarts a package.
   *
   * @param packageId - The package.
   * @returns It, as it now stands.
   */
  public async restartPackage(packageId: string): Promise<InstalledPackage> {
    return this.#serially(async () => {
      const entry = this.#require(packageId);

      await this.#stopProcess(entry);
      await this.#startOne(entry);

      return this.#viewOf(entry, await this.#vendors());
    });
  }

  /**
   * Saves what the owner configured, and starts the package again with it - or, when every
   * field that changed is live and the package runs, hands it the settings instead.
   *
   * @param packageId - The package.
   * @param values - The settings, secrets sealed by `api`.
   * @returns It, as it now stands.
   */
  public async configure(packageId: string, values: JsonObject): Promise<InstalledPackage> {
    return this.#serially(async () => {
      const entry = this.#require(packageId);
      const previous = entry.row.config;
      // A secret the owner left as it was comes back as the mask it was served as: the sealed
      // value kept here is the one that holds.
      const kept: JsonObject = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          isMask(value) && previous[key] !== undefined ? previous[key] : value,
        ]),
      );
      const changed = [...new Set([...Object.keys(previous), ...Object.keys(kept)])].filter(
        (key) => !isDeepStrictEqual(previous[key], kept[key]),
      );
      const live = new Set(
        [
          ...(entry.files.setup?.transport.fields ?? []),
          ...(entry.files.setup?.options.fields ?? []),
        ]
          .filter((field) => field.isLive === true)
          .map((field) => field.key),
      );

      await this.#options.store.update(packageId, { config: kept });
      entry.row = { ...entry.row, config: kept };

      if (
        entry.row.state === 'running' &&
        changed.length > 0 &&
        changed.every((key) => live.has(key)) &&
        (await this.#tellSettings(entry, changed))
      ) {
        this.#publish('configured', entry);

        return this.#viewOf(entry, await this.#vendors());
      }

      if (entry.row.state !== 'stopped' && entry.row.state !== 'disabled') {
        await this.#stopProcess(entry);
        await this.#reconcileContainers();
        await this.#startOne(entry);
      }

      return this.#viewOf(entry, await this.#vendors());
    });
  }

  /**
   * A package's log.
   *
   * @param packageId - The package.
   * @param tail - How many lines at most.
   * @param since - Only after this cursor.
   * @returns The lines.
   */
  public logs(packageId: string, tail: number, since?: string): ReturnType<LogRing['read']> {
    const entry = this.#require(packageId);

    return (entry.process?.logs ?? entry.notes).read(tail, since);
  }

  /**
   * Takes a package process's announcement: it runs, with these methods.
   *
   * @param request - Which package, which release, which methods.
   * @returns Once recorded.
   */
  public async announce(request: PackageAnnounceRequest): Promise<void> {
    await this.#serially(async () => {
      const entry = this.#require(request.packageId);

      entry.rpcMethods = request.rpcMethods;
      clearTimeout(entry.announce);

      if (entry.row.state === 'starting') {
        await this.#running(entry);
      }
    });
  }

  /**
   * This platform's release, which each package's range is checked against.
   *
   * @returns The version.
   */
  public get platformVersion(): string {
    return this.#options.config.NEBULA_PLATFORM_VERSION;
  }

  /**
   * The package SDK version this platform implements, without a prerelease: a platform that
   * implements `1.0.0-rc.2` runs what was built against `^1.0.0`.
   *
   * @returns The version.
   */
  public get sdkVersion(): string {
    return SDK_VERSION.split('-')[0] ?? SDK_VERSION;
  }

  /**
   * Says whether a release works with this platform: its NebulaHome range, and the SDK it was
   * built with.
   *
   * @param release - Its ranges.
   * @param release.platform - The NebulaHome versions it works with.
   * @param release.sdk - The SDK versions it was built against.
   * @returns True when both are met.
   */
  #fits(release: { readonly platform: string; readonly sdk: string }): boolean {
    return (
      satisfies(this.platformVersion, release.platform) && satisfies(this.sdkVersion, release.sdk)
    );
  }

  // --- loading ------------------------------------------------------------------------------

  /** Reads the image's packages and the installed ones into the entries. */
  async #load(): Promise<void> {
    const { store, logger, config } = this.#options;
    const rows = new Map((await store.list()).map((row) => [row.id, row]));

    for (const root of await packageFoldersIn(config.PACKET_MANAGER_BUILTIN_DIR)) {
      let files: PackageFiles;

      try {
        // eslint-disable-next-line no-await-in-loop -- a handful of folders, read once
        files = await readPackageFiles(root);
      } catch (error: unknown) {
        logger.error({ err: error, root }, 'A package the platform ships does not hold together');
        continue;
      }

      const { manifest } = files;
      const row = rows.get(manifest.id);

      if (row === undefined) {
        // eslint-disable-next-line no-await-in-loop -- see above
        await store.insert({
          id: manifest.id,
          manifest,
          source: 'builtin',
          isSystem: true,
          state: 'installed',
          artifactSha256: null,
        });
      } else if (row.version !== manifest.version || row.source !== 'builtin') {
        // eslint-disable-next-line no-await-in-loop -- see above
        await store.update(manifest.id, {
          version: manifest.version,
          runtime: manifest.runtime,
          manifest,
          previousVersion: row.version === manifest.version ? row.previousVersion : row.version,
        });
      }

      rows.delete(manifest.id);
      this.#entries.set(
        manifest.id,
        this.#entryOf(
          // eslint-disable-next-line no-await-in-loop -- see above
          (await store.list()).find((each) => each.id === manifest.id) ?? this.#rowFor(manifest),
          files,
        ),
      );
    }

    for (const row of rows.values()) {
      if (row.source === 'builtin') {
        // The image no longer ships it: kept as it was, and not run, until an image ships it again.
        logger.warn(
          { package: row.id },
          'A system package the image no longer ships is left as it is',
        );
        continue;
      }

      const root = path.join(this.#options.packagesDir, row.id, row.version);

      try {
        // eslint-disable-next-line no-await-in-loop -- one folder per installed package
        this.#entries.set(row.id, this.#entryOf(row, await readPackageFiles(root)));
      } catch (error: unknown) {
        const parsed = packageManifestSchema.safeParse(row.manifest);

        logger.error(
          { err: error, package: row.id, root },
          'An installed package’s files are missing',
        );

        if (parsed.success) {
          const entry = this.#entryOf(row, {
            root,
            manifest: parsed.data,
            setup: null,
            compose: null,
          });

          this.#entries.set(row.id, entry);
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.#setState(
            entry,
            'failed',
            'Its files are missing from the data directory: install it again',
          );
        }
      }
    }
  }

  /**
   * A row for a package just inserted, for the entry.
   *
   * @param manifest - Its manifest.
   * @returns The row as it was written.
   */
  #rowFor(manifest: PackageFiles['manifest']): PackageRow {
    const now = new Date();

    return {
      id: manifest.id,
      version: manifest.version,
      runtime: manifest.runtime,
      state: 'installed',
      source: 'builtin',
      isSystem: true,
      manifest: manifest as unknown as JsonObject,
      config: {},
      previousVersion: null,
      artifactSha256: null,
      lastStartedAt: null,
      lastError: null,
      installedAt: now,
      updatedAt: now,
    };
  }

  /**
   * An entry for a row and its files.
   *
   * @param row - The row.
   * @param files - The folder, read.
   * @returns The entry.
   */
  #entryOf(row: PackageRow, files: PackageFiles): Entry {
    return {
      row,
      files,
      process: undefined,
      rpcMethods: [],
      announce: undefined,
      notes: new LogRing(200),
      rollbackTo: undefined,
    };
  }

  // --- running ------------------------------------------------------------------------------

  /**
   * Starts one package, or records why it waits.
   *
   * @param entry - The package.
   * @returns Once started, or found waiting.
   */
  async #startOne(entry: Entry): Promise<void> {
    const { manifest } = entry.files;

    if (!satisfies(this.platformVersion, manifest.platform)) {
      await this.#setState(
        entry,
        'failed',
        `It needs NebulaHome ${manifest.platform}; this is ${this.platformVersion}`,
      );

      return;
    }

    if (!satisfies(this.sdkVersion, manifest.sdk)) {
      await this.#setState(
        entry,
        'failed',
        describeDependencyProblem(
          { kind: 'sdk', by: manifest.id, range: manifest.sdk, version: this.sdkVersion },
          () => manifest.name,
        ),
      );

      return;
    }

    const problems = unmetRequirements(manifest.id, manifest.requires, this.#nodes(), {
      platformVersion: this.platformVersion,
      satisfies,
    });

    if (problems.length > 0) {
      const names = this.#installedNames();

      await this.#setState(
        entry,
        'waiting-dependency',
        problems
          .map((problem) => describeDependencyProblem(problem, (id) => names.get(id) ?? id))
          .join('; '),
      );

      return;
    }

    if (manifest.runtime !== 'node' || manifest.server === undefined) {
      entry.notes.push(
        'stdout',
        `${manifest.name} ${manifest.version} started: it runs no process of its own`,
      );
      await this.#running(entry);

      return;
    }

    const { dataDir, cacheDir } = this.#foldersOf(manifest.id);

    try {
      await mkdir(dataDir, { recursive: true });
      await mkdir(cacheDir, { recursive: true });
    } catch (error: unknown) {
      await this.#setState(
        entry,
        'failed',
        `${manifest.name}'s folders could not be made: ${error instanceof Error ? error.message : String(error)}`,
      );

      return;
    }

    entry.process ??= new PackageProcess(
      {
        id: manifest.id,
        runner: this.#options.runner,
        entry: path.resolve(entry.files.root, manifest.server.entry),
        cwd: entry.files.root,
        env: this.#environmentOf(entry),
      },
      {
        logger: this.#options.logger,

        /**
         * Follows the process, one change after another with the operations.
         *
         * @param state - Where it stands.
         */
        onState: (state) => {
          void this.#serially(async () => this.#processState(entry, state));
        },
      },
    );
    await this.#setState(entry, 'starting', null);
    entry.process.start();
    clearTimeout(entry.announce);
    entry.announce = setTimeout(() => {
      // Running without announcing - a package with no methods, run by an older runner - is running.
      void this.#serially(async () => {
        if (entry.row.state === 'starting' && entry.process?.isRunning === true) {
          await this.#running(entry);
        }
      });
    }, this.#options.config.PACKET_MANAGER_ANNOUNCE_TIMEOUT_MS);
    entry.announce.unref();
  }

  /**
   * Where a package keeps what it keeps, and what it can make again.
   *
   * @param packageId - The package.
   * @returns `packages/<id>/data/` and `cache/packages/<id>/` of the data directory.
   */
  #foldersOf(packageId: string): { dataDir: string; cacheDir: string } {
    return {
      dataDir: path.join(this.#options.packagesDir, packageId, 'data'),
      cacheDir: path.join(this.#options.cacheDir, packageId),
    };
  }

  /**
   * What a package's process environment is.
   *
   * @param entry - The package.
   * @returns The environment: only what the package is given.
   */
  #environmentOf(entry: Entry): Record<string, string> {
    const { manifest } = entry.files;
    const { config } = this.#options;
    const { dataDir, cacheDir } = this.#foldersOf(manifest.id);

    return {
      ...(config.PATH === undefined ? {} : { PATH: config.PATH }),
      ...(config.TZ === undefined ? {} : { TZ: config.TZ }),
      NODE_ENV: config.NODE_ENV,
      LOG_LEVEL: config.LOG_LEVEL,
      HOME: dataDir,
      NATS_URL: config.NATS_URL,
      NEBULA_PACKAGE_ID: manifest.id,
      NEBULA_PACKAGE_VERSION: manifest.version,
      NEBULA_PACKAGE_DATA_DIR: dataDir,
      NEBULA_PACKAGE_CACHE_DIR: cacheDir,
      NEBULA_PACKAGE_SETTINGS: JSON.stringify(this.#settingsOf(entry)),
      NEBULA_PLATFORM_VERSION: this.platformVersion,
    };
  }

  /**
   * A package's settings, secrets opened, over its setup's constants and its fields' defaults:
   * a default holds until the owner saves another value.
   *
   * @param entry - The package.
   * @returns The settings.
   */
  #settingsOf(entry: Entry): JsonObject {
    const setup = entry.files.setup;
    const defaults = Object.fromEntries(
      [...(setup?.transport.fields ?? []), ...(setup?.options.fields ?? [])].flatMap(
        (field): [string, JsonObject[string]][] =>
          'default' in field && field.default !== undefined ? [[field.key, field.default]] : [],
      ),
    );

    return {
      ...(setup?.transport.constants ?? {}),
      ...(setup?.options.constants ?? {}),
      ...defaults,
      ...openSecrets(entry.row.config, this.#options.secretsKey),
    };
  }

  /**
   * Follows what a package's process says.
   *
   * @param entry - The package.
   * @param state - Where its process stands.
   * @returns Once recorded.
   */
  async #processState(entry: Entry, state: ProcessState): Promise<void> {
    switch (state.kind) {
      case 'starting': {
        if (entry.row.state !== 'starting') {
          await this.#setState(entry, 'starting', entry.row.lastError);
        }

        return;
      }

      case 'exited': {
        entry.rpcMethods = [];
        await this.#setState(entry, 'starting', `${state.reason} - starting again`);

        return;
      }

      case 'failed': {
        entry.rpcMethods = [];

        if (entry.rollbackTo !== undefined && Date.now() < entry.rollbackTo.untilMs) {
          await this.#rollBack(entry, state.reason);

          return;
        }

        await this.#setState(entry, 'failed', state.reason);

        return;
      }

      case 'stopped': {
        entry.rpcMethods = [];
      }
    }
  }

  /**
   * Goes back to the release before an update that fails to run.
   *
   * @param entry - The package.
   * @param reason - Why the new one failed.
   * @returns Once the old one is starting.
   */
  async #rollBack(entry: Entry, reason: string): Promise<void> {
    const target = entry.rollbackTo;

    entry.rollbackTo = undefined;

    if (target === undefined) {
      return;
    }

    const failedVersion = entry.row.version;
    const files = await readPackageFiles(
      path.join(this.#options.packagesDir, entry.row.id, target.version),
    );

    this.#options.logger.warn(
      { package: entry.row.id, failed: failedVersion, back: target.version, reason },
      'An updated package failed to run; going back to the release before',
    );
    await this.#options.store.update(entry.row.id, {
      version: target.version,
      runtime: files.manifest.runtime,
      manifest: files.manifest,
      previousVersion: failedVersion,
      // The archive of the release gone back to is not kept: its build is its version.
      artifactSha256: null,
      lastError: `${failedVersion} failed to run (${reason}); went back to ${target.version}`,
    });
    entry.row = {
      ...entry.row,
      version: target.version,
      previousVersion: failedVersion,
      artifactSha256: null,
    };
    entry.files = files;
    entry.process = undefined;
    await this.#startOne(entry);
  }

  /**
   * Records that a package runs, and starts what was waiting for it.
   *
   * @param entry - The package.
   * @returns Once they are started.
   */
  async #running(entry: Entry): Promise<void> {
    await this.#setState(entry, 'running', null, { lastStartedAt: new Date() });

    for (const waiting of this.#entries.values()) {
      if (waiting.row.state === 'waiting-dependency') {
        // eslint-disable-next-line no-await-in-loop -- one after another, each maybe the next's need
        await this.#startOne(waiting);
      }
    }
  }

  /**
   * Stops a package's process, when it has one.
   *
   * @param entry - The package.
   * @returns Once it has exited.
   */
  async #stopProcess(entry: Entry): Promise<void> {
    clearTimeout(entry.announce);
    entry.announce = undefined;
    await entry.process?.stop();
    entry.rpcMethods = [];
  }

  /**
   * Changes a package's state, records it, says it, and stops what depended on it when it no
   * longer runs.
   *
   * @param entry - The package.
   * @param state - Its new state.
   * @param lastError - Why, when it did not go well; null otherwise.
   * @param extra - Anything else to record.
   * @param extra.lastStartedAt - When it started, once it runs.
   * @returns Once recorded.
   */
  async #setState(
    entry: Entry,
    state: PackageState,
    lastError: string | null,
    extra: { readonly lastStartedAt?: Date } = {},
  ): Promise<void> {
    const was = entry.row.state;

    entry.row = { ...entry.row, state, lastError, ...extra };
    await this.#options.store.update(entry.row.id, { state, lastError, ...extra });

    if (state === 'running' && was !== 'running') {
      this.#publish('started', entry);
    }

    if (was === 'running' && state !== 'running') {
      this.#publish('stopped', entry);

      for (const dependent of this.#entries.values()) {
        const needs =
          dependent.row.id !== entry.row.id &&
          (entry.row.id in dependent.files.manifest.requires.packages ||
            dependent.files.manifest.requires.services.some((service) =>
              entry.files.manifest.provides.includes(service),
            ));

        if (needs && (dependent.row.state === 'running' || dependent.row.state === 'starting')) {
          // eslint-disable-next-line no-await-in-loop -- one after another, as they started
          await this.#stopProcess(dependent);
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.#setState(
            dependent,
            'waiting-dependency',
            `${entry.files.manifest.name} is not running`,
          );
        }
      }
    }
  }

  /**
   * Hands a running package a live change of its settings.
   *
   * @param entry - The package.
   * @param changed - The keys that changed.
   * @returns Whether it took them; when it did not, it is started again instead.
   */
  async #tellSettings(entry: Entry, changed: readonly string[]): Promise<boolean> {
    try {
      await this.#options.client.request(
        busSubjects.service(entry.row.id, PACKAGE_SETTINGS_METHOD),
        { values: this.#settingsOf(entry), changed },
        z.unknown(),
      );

      return true;
    } catch (error: unknown) {
      this.#options.logger.warn(
        { err: error, package: entry.row.id },
        'A package did not take its settings live; starting it again',
      );

      return false;
    }
  }

  /**
   * Says a package's event.
   *
   * @param event - What happened.
   * @param entry - The package.
   */
  #publish(event: 'installed' | 'started' | 'stopped' | 'configured', entry: Entry): void {
    this.#options.client.publish(busSubjects.packageEvent(event), {
      packageId: entry.row.id,
      version: entry.row.version,
      state: entry.row.state,
    });
  }

  // --- containers ---------------------------------------------------------------------------

  /**
   * Hands the supervisor every container the packages that should run declare, and every
   * compose project they run, whole.
   */
  async #reconcileContainers(): Promise<void> {
    const vendors = [...this.#entries.values()]
      .filter(
        (entry) =>
          entry.files.manifest.containers.length > 0 &&
          entry.row.state !== 'stopped' &&
          entry.row.state !== 'disabled',
      )
      .flatMap((entry) => {
        try {
          return [
            {
              vendorId: entry.row.id,
              containers: renderContainers(
                entry.row.id,
                entry.files.manifest.containers,
                this.#settingsOf(entry),
                'package',
              ),
            },
          ];
        } catch (error: unknown) {
          entry.notes.push('stderr', error instanceof Error ? error.message : String(error));

          return [];
        }
      });

    const composeProjects = [...this.#entries.values()].flatMap((entry) =>
      entry.files.compose === null ||
      entry.row.state === 'stopped' ||
      entry.row.state === 'disabled'
        ? []
        : [
            {
              packageId: entry.row.id,
              file: entry.files.compose,
              values: composeValuesOf(this.#settingsOf(entry)),
            },
          ],
    );

    try {
      await this.#options.client.request(
        busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.reconcile),
        { ownerKind: 'package', vendors, composeProjects },
        managedReplySchema,
        { timeoutMs: CALL_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      // No supervisor - development without Docker - is no container, not a failure of the rest.
      this.#options.logger.debug({ err: error }, 'Could not hand the packages’ containers over');
    }
  }

  /**
   * Removes the containers a removed package ran.
   *
   * @param packageId - The package.
   * @param entry - What it was.
   * @returns Once asked.
   */
  async #removeContainers(packageId: string, entry: Entry): Promise<void> {
    for (const dependency of entry.files.manifest.containers) {
      const name =
        dependency.id === packageId
          ? `nebulahome-pkg-${packageId}`
          : `nebulahome-pkg-${packageId}-${dependency.id}`;

      // eslint-disable-next-line no-await-in-loop -- one container after another
      await this.#options.client
        .request(
          busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.remove),
          { name, removeVolumes: false },
          z.unknown(),
          { timeoutMs: CALL_TIMEOUT_MS },
        )
        .catch((error: unknown) => {
          this.#options.logger.warn(
            { err: error, container: name },
            'Could not remove a package’s container',
          );
        });
    }
  }

  // --- installing ---------------------------------------------------------------------------

  /**
   * Plans an install against the index.
   *
   * @param index - The index; null when it could not be read.
   * @param packageId - The package.
   * @param version - A release, or the newest.
   * @returns The plan.
   */
  #planWith(
    index: PackageIndex | null,
    packageId: string,
    version: string | undefined,
  ): ReturnType<typeof planInstall> {
    const available = new Map<string, Candidate[]>(
      (index?.packages ?? []).map((entry) => [
        entry.id,
        entry.versions.map((release) => ({
          id: entry.id,
          version: release.version,
          platform: release.platform,
          sdk: release.sdk,
          requires: release.requires,
          provides: release.provides,
        })),
      ]),
    );

    return planInstall(packageId, version, {
      installed: this.#nodes(),
      available,
      platformVersion: this.platformVersion,
      sdkVersion: this.sdkVersion,
      satisfies,
    });
  }

  /**
   * Installs one release of a plan: downloads, checks, unpacks and records it.
   *
   * @param index - The index it is in.
   * @param candidate - The release.
   * @returns Its entry.
   * @throws {NotFoundError} When the index does not have it after all.
   */
  async #installCandidate(index: PackageIndex | null, candidate: Candidate): Promise<Entry> {
    const release = index?.packages
      .find((entry) => entry.id === candidate.id)
      ?.versions.find((each) => each.version === candidate.version);

    if (release === undefined) {
      throw new NotFoundError(`The index has no ${candidate.id} ${candidate.version}`);
    }

    const files = await installRelease(
      { id: candidate.id, version: candidate.version, artifact: release.artifact },
      this.#options.packagesDir,
      {
        timeoutMs: this.#options.config.PACKET_MANAGER_DOWNLOAD_TIMEOUT_MS,
        ...this.#fetchOption(),
      },
    );
    const existing = this.#entries.get(candidate.id);

    if (existing === undefined) {
      await this.#options.store.insert({
        id: candidate.id,
        manifest: files.manifest,
        source: sourceOf(release.artifact.url),
        isSystem: false,
        state: 'installed',
        artifactSha256: release.artifact.sha256,
      });
    } else {
      await this.#options.store.update(candidate.id, {
        version: files.manifest.version,
        runtime: files.manifest.runtime,
        manifest: files.manifest,
        source: sourceOf(release.artifact.url),
        artifactSha256: release.artifact.sha256,
        state: 'installed',
      });
    }

    const row = (await this.#options.store.list()).find((each) => each.id === candidate.id);

    if (row === undefined) {
      throw new Error(`${candidate.id} was installed and its row is not there`);
    }

    const entry = this.#entryOf(row, files);

    this.#entries.set(candidate.id, entry);
    this.#publish('installed', entry);
    this.#options.logger.info(
      { package: candidate.id, version: candidate.version },
      'Installed a package',
    );

    return entry;
  }

  /**
   * The newest release of a package that works with this platform and its SDK.
   *
   * @param index - The index.
   * @param packageId - The package.
   * @returns The release, or undefined.
   */
  #newestRelease(index: PackageIndex | null, packageId: string) {
    return index?.packages
      .find((entry) => entry.id === packageId)
      ?.versions.filter((release) => this.#fits(release))
      .sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  /**
   * Another build of the version a package has installed, in the local folder: the same version,
   * other bytes.
   *
   * @param index - The index, the local folder's releases in it.
   * @param row - The package's row.
   * @returns The release, or undefined when there is none.
   */
  #newBuild(index: PackageIndex | null, row: PackageRow): PackageRelease | undefined {
    return index?.packages
      .find((entry) => entry.id === row.id)
      ?.versions.find(
        (release) =>
          release.version === row.version &&
          sourceOf(release.artifact.url) === 'local' &&
          release.artifact.sha256 !== row.artifactSha256 &&
          this.#fits(release),
      );
  }

  /**
   * Installs another build of the version a package runs: its process stopped, the archive
   * unpacked over the release's folder, and started again. There is no going back to the build
   * before - it is a build being tried.
   *
   * @param entry - The package.
   * @param release - The build, from the local folder.
   * @returns Once it is starting.
   */
  async #reinstall(entry: Entry, release: PackageRelease): Promise<void> {
    await this.#stopProcess(entry);

    const files = await installRelease(
      { id: entry.row.id, version: release.version, artifact: release.artifact },
      this.#options.packagesDir,
      {
        timeoutMs: this.#options.config.PACKET_MANAGER_DOWNLOAD_TIMEOUT_MS,
        ...this.#fetchOption(),
      },
    );

    await this.#options.store.update(entry.row.id, {
      runtime: files.manifest.runtime,
      manifest: files.manifest,
      source: 'local',
      artifactSha256: release.artifact.sha256,
      state: 'installed',
      lastError: null,
    });
    entry.row = {
      ...entry.row,
      runtime: files.manifest.runtime,
      source: 'local',
      artifactSha256: release.artifact.sha256,
      state: 'installed',
    };
    entry.files = files;
    entry.process = undefined;
    entry.rollbackTo = undefined;
    this.#publish('installed', entry);
    this.#options.logger.info(
      { package: entry.row.id, version: release.version, build: buildOf(entry.row) },
      'Installed another build of a package',
    );
    await this.#reconcileContainers();
    await this.#startOne(entry);
  }

  /**
   * Deletes the unpacked releases of a package but some.
   *
   * @param packageId - The package.
   * @param keep - The versions to keep, and `data`.
   * @returns Once deleted.
   */
  async #removeOldReleases(packageId: string, keep: readonly string[]): Promise<void> {
    const folder = path.join(this.#options.packagesDir, packageId);
    let names: string[];

    try {
      names = await readdir(folder);
    } catch {
      return;
    }

    await Promise.all(
      names
        .filter((name) => name !== 'data' && !keep.includes(name))
        .map(async (name) => rm(path.join(folder, name), { recursive: true, force: true })),
    );
  }

  /**
   * The HTTP client to download with, when one was handed in.
   *
   * @returns The option.
   */
  #fetchOption(): { readonly fetch?: typeof fetch } {
    return this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch };
  }

  // --- dependencies and views ---------------------------------------------------------------

  /**
   * The installed packages, as the resolver reads them.
   *
   * @returns One node per package.
   */
  #nodes(): InstalledNode[] {
    return [...this.#entries.values()].map((entry) => ({
      id: entry.row.id,
      version: entry.row.version,
      requires: entry.files.manifest.requires,
      provides: entry.files.manifest.provides,
      isRunning: entry.row.state === 'running',
    }));
  }

  /**
   * The vendors the hub has loaded, with what each requires.
   *
   * @returns Them; none when the hub does not answer.
   */
  async #vendors(): Promise<Dependent[]> {
    try {
      const reply = await this.#options.client.request(
        busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
        {},
        catalogueReplySchema,
        { timeoutMs: 3000 },
      );

      return reply.vendors.map((vendor) => ({
        kind: 'vendor' as const,
        id: vendor.id,
        requires: vendor.requires,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Everything with requirements: the installed packages and the vendors.
   *
   * @returns The dependents.
   */
  async #dependents(): Promise<Dependent[]> {
    return [
      ...[...this.#entries.values()].map((entry) => ({
        kind: 'package' as const,
        id: entry.row.id,
        requires: entry.files.manifest.requires,
      })),
      ...(await this.#vendors()),
    ];
  }

  /**
   * The installed packages' names, by id.
   *
   * @returns The names.
   */
  #installedNames(): Map<string, string> {
    return new Map(
      [...this.#entries.values()].map((entry) => [entry.row.id, entry.files.manifest.name]),
    );
  }

  /**
   * The names the index and the installed packages give, by id.
   *
   * @param index - The index.
   * @returns The names.
   */
  #namesFrom(index: PackageIndex | null): Map<string, string> {
    return new Map([
      ...(index?.packages ?? []).map((entry): [string, string] => [entry.id, entry.name]),
      ...this.#installedNames(),
    ]);
  }

  /**
   * One package's view.
   *
   * @param entry - The package.
   * @param vendors - The vendors, with their requirements.
   * @returns The view.
   */
  #viewOf(entry: Entry, vendors: readonly Dependent[]): InstalledPackage {
    const { manifest } = entry.files;
    const nodes: DependencyNode[] = this.#nodes();
    const names = this.#installedNames();
    const packages = [...this.#entries.values()].map((each) => ({
      kind: 'package' as const,
      id: each.row.id,
      requires: each.files.manifest.requires,
    }));
    const usedBy: PackageRelation[] = dependentsOf(manifest.id, nodes, [
      ...packages,
      ...vendors,
    ]).map((dependent) => ({
      kind: dependent.kind,
      id: dependent.id,
      name: names.get(dependent.id) ?? dependent.id,
    }));
    const dependsOn: PackageRelation[] = [
      ...Object.keys(manifest.requires.packages),
      ...manifest.requires.services.flatMap((service) =>
        nodes
          .filter((node) => node.id !== manifest.id && node.provides.includes(service))
          .map((node) => node.id),
      ),
    ]
      .filter((id, index, all) => all.indexOf(id) === index)
      .map((id) => ({ kind: 'package' as const, id, name: names.get(id) ?? id }));
    const problems =
      entry.row.state === 'running'
        ? []
        : unmetRequirements(manifest.id, manifest.requires, this.#nodes(), {
            platformVersion: this.platformVersion,
            satisfies,
          }).map((problem) => describeDependencyProblem(problem, (id) => names.get(id) ?? id));

    return {
      id: manifest.id,
      version: entry.row.version,
      build: buildOf(entry.row),
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      runtime: manifest.runtime,
      state: entry.row.state,
      source: entry.row.source,
      isSystem: entry.row.isSystem,
      repository: manifest.repository ?? null,
      url: manifest.url ?? null,
      color: manifest.color ?? null,
      hasLogo: manifest.logo !== undefined,
      ui: manifest.ui ?? null,
      entityTypes: manifest.entityTypes,
      requires: manifest.requires,
      provides: manifest.provides,
      hasSetup: entry.files.setup !== null,
      previousVersion: entry.row.previousVersion,
      lastStartedAt: entry.row.lastStartedAt,
      lastError: entry.row.lastError,
      installedAt: entry.row.installedAt,
      updatedAt: entry.row.updatedAt,
      rpcMethods: entry.rpcMethods,
      problems,
      usedBy,
      dependsOn,
    };
  }

  /**
   * One package, or a refusal.
   *
   * @param packageId - The package.
   * @returns Its entry.
   * @throws {NotFoundError} When it is not installed.
   */
  #require(packageId: string): Entry {
    const entry = this.#entries.get(packageId);

    if (entry === undefined) {
      throw new NotFoundError(`No package ${packageId} is installed`, { details: { packageId } });
    }

    return entry;
  }

  /**
   * Runs an operation after the ones already queued.
   *
   * @param operation - The operation.
   * @returns What it gives.
   */
  async #serially<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);

    this.#queue = next.catch(() => undefined);

    return next;
  }
}
