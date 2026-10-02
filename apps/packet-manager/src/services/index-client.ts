/**
 * The package index: what there is to install.
 *
 * One JSON document at `PACKAGE_INDEX_URL` (PACKAGES.md 10), read when asked and trusted for a
 * few hours, then read again. A document that is not the index's shape is refused whole: an
 * index half read would offer a release with the wrong digest. Beside it, the releases of the
 * platform's local folder, read on every ask: a release there wins over the index's of the same
 * version. An installation without the internet, or without an index set, offers what the local
 * folder holds and nothing else, and says why.
 */
import {
  compareVersions,
  packageIndexSchema,
  type PackageIndex,
  type PackageIndexEntry,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** How long one read of the index may take. */
const INDEX_TIMEOUT_MS = 20_000;

/** What reading the index gave. */
export type IndexRead = {
  readonly index: PackageIndex | null;
  readonly checkedAt: Date | null;
  readonly error: string | null;
};

/** What the client needs. */
export type IndexClientOptions = {
  /** The index's address; undefined when none is set. */
  readonly url: string | undefined;
  readonly ttlMs: number;
  readonly logger: PlatformLogger;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;

  /** The local folder's releases, read on every ask; none when not said. */
  readonly local?: () => Promise<readonly PackageIndexEntry[]>;
};

/**
 * The index with the local folder's releases in it: a package's local releases first, and its
 * index releases of other versions after them.
 *
 * @param index - The index; null when none was read.
 * @param local - The local folder's packages.
 * @param at - When, for an index made of local releases alone.
 * @returns The index; null when there is neither.
 */
function withLocal(
  index: PackageIndex | null,
  local: readonly PackageIndexEntry[],
  at: Date,
): PackageIndex | null {
  if (local.length === 0) {
    return index;
  }

  const packages = new Map((index?.packages ?? []).map((entry) => [entry.id, entry]));

  for (const entry of local) {
    const indexed = packages.get(entry.id);
    const versions = new Set(entry.versions.map((release) => release.version));

    packages.set(
      entry.id,
      indexed === undefined
        ? entry
        : {
            ...indexed,
            versions: [
              ...entry.versions,
              ...indexed.versions.filter((release) => !versions.has(release.version)),
            ].sort((left, right) => compareVersions(right.version, left.version)),
          },
    );
  }

  return { generatedAt: index?.generatedAt ?? at, packages: [...packages.values()] };
}

/** The package index, read and kept. */
export class PackageIndexClient {
  readonly #options: IndexClientOptions;
  #last: IndexRead = { index: null, checkedAt: null, error: null };
  #reading: Promise<IndexRead> | undefined;

  /**
   * Makes a client that has read nothing yet.
   *
   * @param options - The address, how long to trust it, the logger.
   */
  public constructor(options: IndexClientOptions) {
    this.#options = options;
  }

  /**
   * The index, read again when it is older than the trust, with the local folder's releases.
   *
   * @param force - Whether to read it whatever its age.
   * @returns What was read, and when; the last good index is kept through a failed read.
   */
  public async read(force = false): Promise<IndexRead> {
    const [remote, local] = await Promise.all([
      this.#remote(force),
      this.#options.local?.() ?? Promise.resolve([]),
    ]);
    const at = new Date((this.#options.now ?? Date.now)());

    return {
      index: withLocal(remote.index, local, at),
      checkedAt: remote.checkedAt ?? at,
      // An index never set is no problem while the local folder offers something.
      error: this.#options.url === undefined && local.length > 0 ? null : remote.error,
    };
  }

  /**
   * The index alone, read again when it is older than the trust.
   *
   * @param force - Whether to read it whatever its age.
   * @returns What was read.
   */
  async #remote(force: boolean): Promise<IndexRead> {
    const now = (this.#options.now ?? Date.now)();
    const checkedAt = this.#last.checkedAt?.getTime();

    if (!force && checkedAt !== undefined && now - checkedAt < this.#options.ttlMs) {
      return this.#last;
    }

    this.#reading ??= this.#fetch().finally(() => {
      this.#reading = undefined;
    });

    return this.#reading;
  }

  /**
   * Reads the index.
   *
   * @returns What was read.
   */
  async #fetch(): Promise<IndexRead> {
    const { url, logger } = this.#options;
    const at = new Date((this.#options.now ?? Date.now)());

    if (url === undefined) {
      this.#last = {
        index: null,
        checkedAt: at,
        error: 'No package index is set: PACKAGE_INDEX_URL',
      };

      return this.#last;
    }

    try {
      const response = await (this.#options.fetch ?? globalThis.fetch)(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`The package index answered HTTP ${String(response.status)}`);
      }

      const parsed = packageIndexSchema.safeParse(await response.json());

      if (!parsed.success) {
        throw new Error(
          `The package index is not an index: ${parsed.error.issues[0]?.message ?? 'its shape is wrong'}`,
        );
      }

      this.#last = { index: parsed.data, checkedAt: at, error: null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      logger.warn({ err: error, url }, 'Could not read the package index');
      this.#last = { index: this.#last.index, checkedAt: at, error: message };
    }

    return this.#last;
  }
}
