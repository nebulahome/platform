/**
 * Installing integrations: the Community Hub's integrations searched, and a vendor's bundle
 * installed, updated, reinstalled and removed without `hub` restarting.
 *
 * What fits this platform is the integrations index's word - the release, its SDK range, its
 * archive and digest - and the Hub's search only says what there is and how it is liked. The
 * local integrations folder's files are releases too, offered first on a search, and a rebuild of
 * the version installed (other bytes, same version) is a new build to reinstall.
 *
 * An install unpacks a build beside the one running - `hub/integrations/<vendor>/<build>/` - and
 * asks `hub` to load it (`svc.hub.vendor_load`). Only once `hub` says the build loaded is the
 * marker written that makes it current, and the builds before it deleted; a build that does not
 * load is deleted, and the copy that ran before runs on. Removing deletes the vendor's folder and
 * asks `hub` to let go of it. What the vendor's devices, accounts and settings were is `api`'s to
 * remove first: this service holds none of them.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { satisfies } from 'semver';

import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  catalogueReplySchema,
  compareVersions,
  ConflictError,
  HUB_CATALOGUE_METHOD,
  HUB_SERVICE,
  HUB_VENDOR_LOAD_METHOD,
  NotFoundError,
  PACKAGE_SEARCH_PAGE_SIZE,
  semverSchema,
  vendorLoadReplySchema,
  type BundleOrigin,
  type IntegrationAvailableReply,
  type IntegrationIndexEntry,
  type IntegrationInstall,
  type IntegrationInstallReply,
  type IntegrationListing,
  type IntegrationRelease,
  type IntegrationRemoveReply,
  type IntegrationSearchReply,
  type IntegrationSearchRequest,
  type VendorLoadReply,
  type VendorLoadRequest,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { InstallMarker } from '@nebulahome/package-runtime';

import type { CommunityHubClient, HubItem } from '../services/hub-client.js';
import type { InstallReporter } from '../services/hub-reporter.js';
import type { IntegrationIndexClient, IntegrationIndexRead } from '../services/index-client.js';
import { installVendorRelease } from '../services/installer.js';

import { readMarker, readMarkers, removeOtherBuilds, writeMarker } from './markers.js';

/** How long `hub` has to load a build: its modules are imported, its discovery started again. */
const VENDOR_LOAD_TIMEOUT_MS = 60_000;

/** How long `hub` has to say which vendors it runs. */
const CATALOGUE_TIMEOUT_MS = 3000;

/**
 * How old a read of the index may be before a search reads it again for an integration the Hub
 * lists and it lacks: one published since the index was read is installable at once.
 */
const INDEX_RECHECK_MS = 60_000;

/** How many of the local folder's integrations one search lists at most. */
const LOCAL_LISTINGS_LIMIT = 50;

/** What the manager needs. */
export type IntegrationManagerOptions = {
  readonly index: IntegrationIndexClient;
  readonly hub: CommunityHubClient;
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /** The data directory's `hub/integrations/`, and where archives are unpacked first. */
  readonly integrationsDir: string;
  readonly cacheDir: string;

  /** The integration contract this platform's `hub` implements: the integration SDK's version. */
  readonly runtimeVersion: string;

  readonly downloadTimeoutMs: number;

  /** Where an install from the index is reported to the Hub; none in a test. */
  readonly reporter?: InstallReporter;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
};

/** What `hub` runs of a vendor, as far as a listing needs it. */
type Running = { readonly origin: BundleOrigin; readonly version: string };

/** What installing an integration would take here. */
type Availability = Pick<
  IntegrationListing,
  | 'latest'
  | 'newestVersion'
  | 'installedVersion'
  | 'isBuiltIn'
  | 'hasUpdate'
  | 'hasNewBuild'
  | 'unavailableReason'
>;

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
 * Cuts a sentence to the length a reply keeps.
 *
 * @param text - The sentence.
 * @param length - The most characters kept.
 * @returns It, cut.
 */
function clipped(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/**
 * The message of a failure, for a reply.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return clipped(error instanceof Error ? error.message : String(error), 1024);
}

/**
 * Says whether an integration of the index is one a search asked for: the words in its id, name,
 * description or a model, whatever their case.
 *
 * @param entry - The integration.
 * @param q - The words; every integration when not said.
 * @returns True when it matches.
 */
function matchesSearch(entry: IntegrationIndexEntry, q: string | undefined): boolean {
  if (q === undefined) {
    return true;
  }

  const wanted = q.toLowerCase();

  return [entry.id, entry.name, entry.description ?? '', ...entry.models].some((text) =>
    text.toLowerCase().includes(wanted),
  );
}

/** The integrations a house installs. */
export class IntegrationManager {
  readonly #options: IntegrationManagerOptions;
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * Makes the manager, which reads everything when asked.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: IntegrationManagerOptions) {
    this.#options = options;
  }

  /**
   * Searches the Community Hub's integrations, each with what installing it here would take. On
   * the first page the local folder's integrations that match come first, those the Hub does not
   * list. A Hub that cannot be asked says why, and the local folder's files are listed still.
   *
   * @param request - What to look for, and from which page on.
   * @returns What was found.
   */
  public async search(request: IntegrationSearchRequest): Promise<IntegrationSearchReply> {
    const [first, asked, markers, running] = await Promise.all([
      this.#options.index.read(),
      this.#options.hub
        .search('integration', {
          q: request.q,
          cursor: request.cursor,
          limit: PACKAGE_SEARCH_PAGE_SIZE,
        })
        .then(
          (page) => ({ page, error: null }),
          (error: unknown) => ({ page: null, error: messageOf(error) }),
        ),
      readMarkers(this.#options.integrationsDir),
      this.#running(),
    ]);
    let read = first;
    let entries = new Map((read.index?.integrations ?? []).map((entry) => [entry.id, entry]));
    const listed = asked.page?.items ?? [];

    if (
      listed.some((item) => !entries.has(item.id)) &&
      Date.now() - (read.checkedAt?.getTime() ?? 0) > INDEX_RECHECK_MS
    ) {
      read = await this.#options.index.read(true);
      entries = new Map((read.index?.integrations ?? []).map((entry) => [entry.id, entry]));
    }

    const hubIds = new Set(listed.map((item) => item.id));
    const local =
      request.cursor === undefined
        ? [...entries.values()]
            .filter(
              (entry) =>
                !hubIds.has(entry.id) &&
                entry.versions.some((release) => sourceOf(release.artifact.url) === 'local') &&
                matchesSearch(entry, request.q),
            )
            .slice(0, LOCAL_LISTINGS_LIMIT)
        : [];

    /**
     * What installing one would take, from what is installed and what runs.
     *
     * @param id - The vendor.
     * @param entry - What the index says of it.
     * @returns Its availability.
     */
    const availability = (id: string, entry: IntegrationIndexEntry | undefined): Availability =>
      this.#availabilityOf(entry, read, markers.get(id), running.get(id));

    return {
      items: [
        ...local.map((entry): IntegrationListing => ({
          id: entry.id,
          name: clipped(entry.name, 128),
          description: clipped(entry.description ?? '', 512),
          repository: entry.repository,
          color: entry.color ?? null,
          logo: null,
          isOfficial: false,
          downloads: 0,
          stars: 0,
          internetRequired: entry.internetRequired,
          origin: 'local',
          ...availability(entry.id, entry),
        })),
        ...listed.map((item) => this.#listingOfHub(item, entries.get(item.id), availability)),
      ],
      nextCursor: asked.page?.nextCursor ?? null,
      hubError: asked.error,
    };
  }

  /**
   * Every integration the platform installed, and the update the index offers it.
   *
   * @returns Them, and why the index could not be read, when it could not.
   */
  public async available(): Promise<IntegrationAvailableReply> {
    const [read, markers] = await Promise.all([
      this.#options.index.read(),
      readMarkers(this.#options.integrationsDir),
    ]);
    const entries = new Map((read.index?.integrations ?? []).map((entry) => [entry.id, entry]));

    return {
      items: [...markers].map(([vendorId, marker]) => {
        const entry = entries.get(vendorId);
        const latest = this.#latestOf(entry);

        return {
          vendorId,
          installedVersion: marker.version,
          source: marker.source,
          latestVersion: latest?.version ?? null,
          hasUpdate: latest !== undefined && isNewer(latest.version, marker.version),
          hasNewBuild: this.#rebuildOf(entry, marker) !== undefined,
        };
      }),
      error: read.error,
    };
  }

  /**
   * Installs an integration's bundle - or updates it, or reinstalls a rebuild of the version
   * installed - and has `hub` load it.
   *
   * @param vendorId - The vendor.
   * @param version - A release; a rebuild of the version installed, else the newest that fits,
   *   when not said.
   * @param requestedBy - The account that asked.
   * @returns What was done, and the build `hub` runs.
   * @throws {NotFoundError} When the index and the local folder have no such integration.
   * @throws {ConflictError} When no release of it fits, or the build did not load.
   */
  public async install(
    vendorId: string,
    version?: string,
    requestedBy?: string,
  ): Promise<IntegrationInstallReply> {
    return this.#serially(async () => {
      const { integrationsDir, logger } = this.#options;
      const read = await this.#options.index.read(true);
      const entry = read.index?.integrations.find((each) => each.id === vendorId);

      if (entry === undefined) {
        throw new NotFoundError(
          read.error === null
            ? `The integrations index has no ${vendorId}`
            : `The integrations index could not be read: ${read.error}`,
        );
      }

      const previous = await readMarker(integrationsDir, vendorId);
      const release = this.#releaseToInstall(entry, read, previous, version);
      const source = sourceOf(release.artifact.url);
      const { build, folder } = await installVendorRelease(
        { id: vendorId, version: release.version, artifact: release.artifact },
        integrationsDir,
        this.#options.cacheDir,
        {
          timeoutMs: this.#options.downloadTimeoutMs,
          ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
        },
      );
      const install: IntegrationInstall = {
        build,
        version: release.version,
        source,
        artifactSha256: release.artifact.sha256,
        installedAt: (this.#options.now?.() ?? new Date()).toISOString(),
        installedBy: requestedBy ?? null,
      };
      let reply: VendorLoadReply;

      try {
        reply = await this.#load({ vendorId, install });
      } catch (error: unknown) {
        await rm(folder, { recursive: true, force: true });

        throw error;
      }

      if (!reply.isLoaded || reply.origin !== 'installed' || reply.version !== release.version) {
        await rm(folder, { recursive: true, force: true });

        throw new ConflictError(
          `${entry.name} ${release.version} did not load${reply.failures.length > 0 ? `: ${reply.failures.join('; ')}` : ''}`,
          { details: { reason: 'did-not-load', vendorId, failures: reply.failures } },
        );
      }

      await writeMarker(integrationsDir, vendorId, install);
      await removeOtherBuilds(integrationsDir, vendorId, build);

      const action =
        previous === undefined
          ? 'installed'
          : previous.version === release.version
            ? 'reinstalled'
            : 'updated';

      if (source === 'index' && action !== 'reinstalled') {
        this.#options.reporter?.report({
          kind: 'integration',
          slug: vendorId,
          version: release.version,
          action: action === 'installed' ? 'install' : 'update',
        });
      }

      logger.info(
        { vendorId, version: release.version, build, action },
        'Installed an integration',
      );

      return { vendorId, action, install, warnings: reply.failures };
    });
  }

  /**
   * Removes an installed integration's bundle, and has `hub` let go of it.
   *
   * @param vendorId - The vendor.
   * @returns Whether a copy under development comes back only once `hub` restarts.
   * @throws {NotFoundError} When the platform did not install it.
   */
  public async remove(vendorId: string): Promise<IntegrationRemoveReply> {
    return this.#serially(async () => {
      const { integrationsDir, logger } = this.#options;

      if ((await readMarker(integrationsDir, vendorId)) === undefined) {
        throw new NotFoundError(`${vendorId} was not installed by the platform`);
      }

      await rm(path.join(integrationsDir, vendorId), { recursive: true, force: true });

      const reply = await this.#load({ vendorId });

      logger.info({ vendorId }, 'Removed an integration');

      return { isRestartNeeded: reply.isRestartNeeded };
    });
  }

  /**
   * An integration of the Hub, with what installing it here would take.
   *
   * @param item - What the Hub says of it.
   * @param entry - What the index says of it, when it has it.
   * @param availability - What installing it would take.
   * @returns The listing.
   */
  #listingOfHub(
    item: HubItem,
    entry: IntegrationIndexEntry | undefined,
    availability: (id: string, entry: IntegrationIndexEntry | undefined) => Availability,
  ): IntegrationListing {
    const found = availability(item.id, entry);
    const latestVersion = semverSchema.safeParse(item.latestVersion);

    return {
      id: item.id,
      name: clipped(entry?.name ?? item.name, 128),
      description: clipped(entry?.description ?? item.description, 512),
      repository: entry?.repository ?? null,
      color: item.color ?? entry?.color ?? null,
      logo: item.logo,
      isOfficial: item.isOfficial,
      downloads: item.downloads,
      stars: item.stars,
      internetRequired: entry?.internetRequired ?? null,
      origin: 'hub',
      ...found,
      newestVersion: found.newestVersion ?? (latestVersion.success ? latestVersion.data : null),
    };
  }

  /**
   * What installing an integration would take here: the newest release of the index's that fits
   * this platform, whether one is installed and something newer is out, and why it cannot be
   * installed when it cannot.
   *
   * @param entry - What the index says of it; undefined when it lacks it.
   * @param read - The index, as read.
   * @param marker - How the platform installed it; undefined when it did not.
   * @param running - What `hub` runs of it.
   * @returns Its availability.
   */
  #availabilityOf(
    entry: IntegrationIndexEntry | undefined,
    read: IntegrationIndexRead,
    marker: InstallMarker | undefined,
    running: Running | undefined,
  ): Availability {
    const newest = sortedReleases(entry)[0];
    const latest = this.#latestOf(entry);
    const installed = marker?.version ?? null;

    return {
      latest:
        latest === undefined
          ? null
          : {
              version: latest.version,
              sdk: latest.sdk,
              requires: latest.requires,
              bundleKind: latest.bundleKind,
              publishedAt: latest.publishedAt,
              changelogUrl: latest.changelogUrl ?? null,
              source: sourceOf(latest.artifact.url),
            },
      newestVersion: newest?.version ?? null,
      installedVersion: installed,
      isBuiltIn: marker === undefined && running?.origin === 'development',
      hasUpdate: installed !== null && latest !== undefined && isNewer(latest.version, installed),
      hasNewBuild: marker !== undefined && this.#rebuildOf(entry, marker) !== undefined,
      unavailableReason:
        installed !== null || latest !== undefined
          ? null
          : clipped(this.#whyUnavailable(newest, read), 512),
    };
  }

  /**
   * The newest release of an integration that works with this platform.
   *
   * @param entry - What the index says of it.
   * @returns The release; undefined when none fits.
   */
  #latestOf(entry: IntegrationIndexEntry | undefined): IntegrationRelease | undefined {
    return sortedReleases(entry).find((release) => this.#fits(release));
  }

  /**
   * A local file of the version installed whose bytes are not the ones installed.
   *
   * @param entry - What the index says of the integration.
   * @param marker - How it was installed.
   * @returns The rebuild; undefined when there is none.
   */
  #rebuildOf(
    entry: IntegrationIndexEntry | undefined,
    marker: InstallMarker,
  ): IntegrationRelease | undefined {
    return entry?.versions.find(
      (release) =>
        release.version === marker.version &&
        sourceOf(release.artifact.url) === 'local' &&
        release.artifact.sha256 !== marker.artifactSha256,
    );
  }

  /**
   * The release an install takes: the one asked for, else a rebuild of the version installed,
   * else the newest that fits.
   *
   * @param entry - What the index says of the integration.
   * @param read - The index, as read.
   * @param marker - How it is installed now; undefined when it is not.
   * @param version - The release asked for, if one was.
   * @returns The release.
   * @throws {NotFoundError} When the release asked for is not in the index.
   * @throws {ConflictError} When it does not fit this platform, or none does.
   */
  #releaseToInstall(
    entry: IntegrationIndexEntry,
    read: IntegrationIndexRead,
    marker: InstallMarker | undefined,
    version: string | undefined,
  ): IntegrationRelease {
    if (version !== undefined) {
      const asked = entry.versions.find((release) => release.version === version);

      if (asked === undefined) {
        throw new NotFoundError(`The integrations index has no ${entry.id} ${version}`);
      }

      if (!this.#fits(asked)) {
        throw new ConflictError(this.#whyUnavailable(asked, read), {
          details: { reason: 'cannot-install', vendorId: entry.id },
        });
      }

      return asked;
    }

    const rebuilt = marker === undefined ? undefined : this.#rebuildOf(entry, marker);
    const latest = this.#latestOf(entry);

    if (
      rebuilt !== undefined &&
      (latest === undefined || compareVersions(latest.version, rebuilt.version) <= 0)
    ) {
      return rebuilt;
    }

    if (latest === undefined) {
      throw new ConflictError(this.#whyUnavailable(sortedReleases(entry)[0], read), {
        details: { reason: 'cannot-install', vendorId: entry.id },
      });
    }

    return latest;
  }

  /**
   * Says whether a release works with this platform's `hub`.
   *
   * @param release - The release.
   * @returns True when its SDK range takes the contract `hub` implements.
   */
  #fits(release: IntegrationRelease): boolean {
    return satisfies(this.#options.runtimeVersion, release.sdk);
  }

  /**
   * Why no release of an integration can be installed here.
   *
   * @param newest - Its newest release; undefined when the index lacks it.
   * @param read - The index, as read.
   * @returns The reason, in a sentence.
   */
  #whyUnavailable(newest: IntegrationRelease | undefined, read: IntegrationIndexRead): string {
    if (newest === undefined) {
      return read.error === null
        ? 'No release of it is in the integrations index yet'
        : `The integrations index could not be read: ${read.error}`;
    }

    return `Its newest release, ${newest.version}, is built for the integration SDK ${newest.sdk}; this NebulaHome has ${this.#options.runtimeVersion}`;
  }

  /**
   * Asks `hub` to make a vendor match the data directory.
   *
   * @param request - Which vendor, and the build unpacked.
   * @returns What `hub` runs of it now.
   */
  async #load(request: VendorLoadRequest): Promise<VendorLoadReply> {
    return this.#options.client.request(
      busSubjects.service(HUB_SERVICE, HUB_VENDOR_LOAD_METHOD),
      request,
      vendorLoadReplySchema,
      { timeoutMs: VENDOR_LOAD_TIMEOUT_MS },
    );
  }

  /**
   * What `hub` runs, by vendor; nothing when it does not answer.
   *
   * @returns Each vendor's origin and version.
   */
  async #running(): Promise<Map<string, Running>> {
    try {
      const reply = await this.#options.client.request(
        busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
        {},
        catalogueReplySchema,
        { timeoutMs: CATALOGUE_TIMEOUT_MS },
      );

      return new Map(
        reply.vendors.map((vendor) => [
          vendor.id,
          { origin: vendor.origin, version: vendor.version },
        ]),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * Runs one change at a time: two installs of one vendor must not unpack side by side.
   *
   * @param operation - The change.
   * @returns What it returns.
   */
  async #serially<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation, operation);

    this.#queue = next.catch(() => undefined);

    return next;
  }
}

/**
 * An integration's releases, newest first.
 *
 * @param entry - What the index says of it.
 * @returns Its releases; none when the index lacks it.
 */
function sortedReleases(entry: IntegrationIndexEntry | undefined): IntegrationRelease[] {
  return [...(entry?.versions ?? [])].sort((left, right) =>
    compareVersions(right.version, left.version),
  );
}

/**
 * Says whether one version is newer than another.
 *
 * @param candidate - The version offered.
 * @param installed - The version installed, as its marker says it.
 * @returns True when the candidate is newer.
 */
function isNewer(candidate: string, installed: string): boolean {
  return compareVersions(candidate, installed) > 0;
}
