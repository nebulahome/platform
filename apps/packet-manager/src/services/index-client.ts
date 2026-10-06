/**
 * The indexes: what there is to install.
 *
 * One JSON document each that the Community Hub serves - the package index (PACKAGES.md 10) and
 * the integrations index - read when asked and trusted for a few hours, then read again. Beside
 * each, the releases of the platform's local folder for it, read on every ask: a release there
 * wins over the index's of the same version. An installation without the internet, or without a
 * Hub set, offers what the local folder holds and nothing else, and says why.
 *
 * The package index is refused whole when it is not the index's shape: an index half read would
 * offer a release with the wrong digest. The integrations index is a loose document whose entries
 * are read one by one, so one this build cannot read is left out alone.
 */
import {
  compareVersions,
  integrationIndexDocumentSchema,
  integrationIndexEntrySchema,
  packageIndexSchema,
  type IntegrationIndex,
  type IntegrationIndexEntry,
  type PackageIndex,
  type PackageIndexEntry,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** How long one read of an index may take. */
const INDEX_TIMEOUT_MS = 20_000;

/** What reading an index gave. */
export type IndexReadOf<TIndex> = {
  readonly index: TIndex | null;
  readonly checkedAt: Date | null;
  readonly error: string | null;
};

/** What reading the package index gave. */
export type IndexRead = IndexReadOf<PackageIndex>;

/** What reading the integrations index gave. */
export type IntegrationIndexRead = IndexReadOf<IntegrationIndex>;

/** What a client needs. */
export type IndexClientOptions<TEntry> = {
  /** The index's address; undefined when none is set. */
  readonly url: string | undefined;
  readonly ttlMs: number;
  readonly logger: PlatformLogger;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;

  /** The local folder's releases, read on every ask; none when not said. */
  readonly local?: () => Promise<readonly TEntry[]>;
};

/** What makes one index's client: how its document is read, and how its entries are merged. */
type IndexShape<TIndex, TEntry> = {
  /** What it is called in a message: "the package index". */
  readonly label: string;

  /**
   * Reads the document.
   *
   * @param json - What the address answered.
   * @param logger - Where an entry left out is said.
   * @returns The index.
   * @throws {Error} When it is not the index's shape.
   */
  readonly parse: (json: unknown, logger: PlatformLogger) => TIndex;

  /** The index's entries. */
  readonly entriesOf: (index: TIndex) => readonly TEntry[];

  /** An index of these entries. */
  readonly indexOf: (generatedAt: Date, entries: TEntry[]) => TIndex;

  /** When it was generated. */
  readonly generatedAtOf: (index: TIndex) => Date;
};

/** An entry with releases by version, as both indexes have. */
type Versioned = {
  readonly id: string;
  readonly versions: readonly { readonly version: string }[];
};

/**
 * The index with the local folder's releases in it: an entry's local releases first, and its
 * index releases of other versions after them.
 *
 * @param shape - How the index is made.
 * @param index - The index; null when none was read.
 * @param local - The local folder's entries.
 * @param at - When, for an index made of local releases alone.
 * @returns The index; null when there is neither.
 */
function withLocal<TIndex, TEntry extends Versioned>(
  shape: IndexShape<TIndex, TEntry>,
  index: TIndex | null,
  local: readonly TEntry[],
  at: Date,
): TIndex | null {
  if (local.length === 0) {
    return index;
  }

  const entries = new Map(
    (index === null ? [] : shape.entriesOf(index)).map((entry) => [entry.id, entry]),
  );

  for (const entry of local) {
    const indexed = entries.get(entry.id);
    const versions = new Set(entry.versions.map((release) => release.version));

    entries.set(
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

  return shape.indexOf(index === null ? at : shape.generatedAtOf(index), [...entries.values()]);
}

/** One index, read and kept. */
class IndexClient<TIndex, TEntry extends Versioned> {
  readonly #options: IndexClientOptions<TEntry>;
  readonly #shape: IndexShape<TIndex, TEntry>;
  #last: IndexReadOf<TIndex> = { index: null, checkedAt: null, error: null };
  #reading: Promise<IndexReadOf<TIndex>> | undefined;

  /**
   * Makes a client that has read nothing yet.
   *
   * @param options - The address, how long to trust it, the logger.
   * @param shape - How the index is read.
   */
  protected constructor(options: IndexClientOptions<TEntry>, shape: IndexShape<TIndex, TEntry>) {
    this.#options = options;
    this.#shape = shape;
  }

  /**
   * The index, read again when it is older than the trust, with the local folder's releases.
   *
   * @param force - Whether to read it whatever its age.
   * @returns What was read, and when; the last good index is kept through a failed read.
   */
  public async read(force = false): Promise<IndexReadOf<TIndex>> {
    const [remote, local] = await Promise.all([
      this.#remote(force),
      this.#options.local?.() ?? Promise.resolve([]),
    ]);
    const at = new Date((this.#options.now ?? Date.now)());

    return {
      index: withLocal(this.#shape, remote.index, local, at),
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
  async #remote(force: boolean): Promise<IndexReadOf<TIndex>> {
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
  async #fetch(): Promise<IndexReadOf<TIndex>> {
    const { url, logger } = this.#options;
    const { label } = this.#shape;
    const at = new Date((this.#options.now ?? Date.now)());

    if (url === undefined) {
      this.#last = {
        index: null,
        checkedAt: at,
        error: 'No Community Hub is set: COMMUNITY_HUB_URL',
      };

      return this.#last;
    }

    try {
      const response = await (this.#options.fetch ?? globalThis.fetch)(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`${capitalised(label)} answered HTTP ${String(response.status)}`);
      }

      this.#last = {
        index: this.#shape.parse(await response.json(), logger),
        checkedAt: at,
        error: null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      logger.warn({ err: error, url }, `Could not read ${label}`);
      this.#last = { index: this.#last.index, checkedAt: at, error: message };
    }

    return this.#last;
  }
}

/**
 * A sentence's first word, capitalised.
 *
 * @param text - The text.
 * @returns It, capitalised.
 */
function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The package index, read and kept. */
export class PackageIndexClient extends IndexClient<PackageIndex, PackageIndexEntry> {
  /**
   * Makes a client that has read nothing yet.
   *
   * @param options - The address, how long to trust it, the logger.
   */
  public constructor(options: IndexClientOptions<PackageIndexEntry>) {
    super(options, {
      label: 'the package index',

      /**
       * Reads the document whole.
       *
       * @param json - What the address answered.
       * @returns The index.
       * @throws {Error} When it is not the index's shape.
       */
      parse: (json) => {
        const parsed = packageIndexSchema.safeParse(json);

        if (!parsed.success) {
          throw new Error(
            `The package index is not an index: ${parsed.error.issues[0]?.message ?? 'its shape is wrong'}`,
          );
        }

        return parsed.data;
      },

      /**
       * The index's entries.
       *
       * @param index - The index.
       * @returns Its packages.
       */
      entriesOf: (index) => index.packages,

      /**
       * An index of these entries.
       *
       * @param generatedAt - When it was generated.
       * @param packages - Its packages.
       * @returns The index.
       */
      indexOf: (generatedAt, packages) => ({ generatedAt, packages }),

      /**
       * When the index was generated.
       *
       * @param index - The index.
       * @returns When.
       */
      generatedAtOf: (index) => index.generatedAt,
    });
  }
}

/** The integrations index, read and kept. */
export class IntegrationIndexClient extends IndexClient<IntegrationIndex, IntegrationIndexEntry> {
  /**
   * Makes a client that has read nothing yet.
   *
   * @param options - The address, how long to trust it, the logger.
   */
  public constructor(options: IndexClientOptions<IntegrationIndexEntry>) {
    super(options, {
      label: 'the integrations index',

      /**
       * Reads the document, then each integration on its own.
       *
       * @param json - What the address answered.
       * @param logger - Where an integration left out is said.
       * @returns The index.
       * @throws {Error} When the document is not the index's shape, or of another format.
       */
      parse: (json, logger) => {
        const parsed = integrationIndexDocumentSchema.safeParse(json);

        if (!parsed.success) {
          throw new Error(
            `The integrations index is not an index this build reads: ${parsed.error.issues[0]?.message ?? 'its shape is wrong'}`,
          );
        }

        const integrations: IntegrationIndexEntry[] = [];
        const seen = new Set<string>();

        for (const raw of parsed.data.integrations) {
          const entry = integrationIndexEntrySchema.safeParse(raw);

          if (!entry.success || seen.has(entry.data.id)) {
            logger.warn(
              { issues: entry.error?.issues.slice(0, 3) ?? [] },
              'An integration of the index was left out',
            );
            continue;
          }

          seen.add(entry.data.id);
          integrations.push(entry.data);
        }

        return { generatedAt: parsed.data.generatedAt, integrations };
      },

      /**
       * The index's entries.
       *
       * @param index - The index.
       * @returns Its integrations.
       */
      entriesOf: (index) => index.integrations,

      /**
       * An index of these entries.
       *
       * @param generatedAt - When it was generated.
       * @param integrations - Its integrations.
       * @returns The index.
       */
      indexOf: (generatedAt, integrations) => ({ generatedAt, integrations }),

      /**
       * When the index was generated.
       *
       * @param index - The index.
       * @returns When.
       */
      generatedAtOf: (index) => index.generatedAt,
    });
  }
}
