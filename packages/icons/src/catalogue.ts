/**
 * The catalogue as it is served: the built-in set with the owner's rows laid over it.
 *
 * A row is an `override` - a built-in id drawn afresh - or a `custom` icon of the owner's own.
 * Either way the id is what a device points at, and this is the one place that decides what
 * the id draws, so that decision is made once and every page shows the same thing.
 *
 * Immutable: the API builds a new one after every write. A thousand and a half icons is a
 * small enough set that rebuilding beats keeping two structures in step.
 */
import type { IconFrame, IconNode, IconView } from '@nebula-home/contracts';

import type { BuiltinIcon } from './builtin.js';

/** One row of `registry.icons`, as the API reads it. */
export type IconRow = {
  readonly id: string;
  readonly kind: 'custom' | 'override';
  readonly name: string;
  readonly keywords: readonly string[];
  readonly node: IconNode;
  readonly frame: IconFrame;
};

/** An entry with what the search ranks it by, computed once. */
type Entry = {
  readonly view: IconView;
  readonly isCurated: boolean;
  readonly haystack: {
    readonly id: string;
    readonly name: string;
    readonly keywords: readonly string[];
  };
};

/** How well an entry matches, lower first. */
const NO_MATCH = Number.POSITIVE_INFINITY;

/**
 * Ranks one entry against a query: an exact id or name first, then a prefix, then a word
 * inside, then a keyword.
 *
 * @param entry - The entry.
 * @param query - Lower-cased, trimmed.
 * @returns The rank, or infinity for no match.
 */
function rankOf(entry: Entry, query: string): number {
  const { id, name, keywords } = entry.haystack;

  if (id === query || name === query) {
    return 0;
  }

  if (id.startsWith(query) || name.startsWith(query)) {
    return 1;
  }

  if (id.includes(query) || name.includes(query)) {
    return 2;
  }

  if (keywords.some((keyword) => keyword.startsWith(query))) {
    return 3;
  }

  if (keywords.some((keyword) => keyword.includes(query))) {
    return 4;
  }

  return NO_MATCH;
}

/** The catalogue as it is served. */
export class IconCatalogue {
  readonly #entries: readonly Entry[];
  readonly #byId: ReadonlyMap<string, Entry>;
  readonly #builtinIds: ReadonlySet<string>;

  /**
   * Lays the owner's rows over the built-in set.
   *
   * @param builtin - What ships with the platform, curated first.
   * @param rows - What the owner added or drew over, in any order.
   */
  public constructor(builtin: readonly BuiltinIcon[], rows: readonly IconRow[]) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const entries: Entry[] = builtin.map((icon) => {
      const row = rowsById.get(icon.id);
      rowsById.delete(icon.id);

      // Overridden: the owner's drawing and words, under the built-in name. A `custom` row
      // that happens to share a built-in id is treated the same way, because whichever kind it
      // says, the id is the built-in's and the name stays the built-in's.
      const view: IconView =
        row === undefined
          ? {
              id: icon.id,
              name: icon.name,
              keywords: [...icon.keywords],
              origin: 'builtin',
              isOverridden: false,
              node: icon.node,
              frame: icon.frame,
            }
          : {
              id: icon.id,
              name: icon.name,
              keywords: [...row.keywords],
              origin: 'builtin',
              isOverridden: true,
              node: row.node,
              frame: row.frame,
            };

      return { view, isCurated: icon.isCurated, haystack: haystackOf(view) };
    });

    // Whatever is left is the owner's own - including an override whose original a lucide
    // upgrade has since dropped, which must not take the owner's drawing down with it.
    for (const row of rowsById.values()) {
      const view: IconView = {
        id: row.id,
        name: row.name,
        keywords: [...row.keywords],
        origin: 'custom',
        isOverridden: false,
        node: row.node,
        frame: row.frame,
      };

      entries.push({ view, isCurated: false, haystack: haystackOf(view) });
    }

    this.#entries = entries;
    this.#byId = new Map(entries.map((entry) => [entry.view.id, entry]));
    this.#builtinIds = new Set(builtin.map((icon) => icon.id));
  }

  /**
   * How many icons there are.
   *
   * @returns The count, rows included.
   */
  public get size(): number {
    return this.#entries.length;
  }

  /**
   * Says whether an id names an icon.
   *
   * @param id - The id.
   * @returns True when it does.
   */
  public has(id: string): boolean {
    return this.#byId.has(id);
  }

  /**
   * Says whether an id is one that ships with the platform, overridden or not.
   *
   * @param id - The id.
   * @returns True for a built-in id.
   */
  public isBuiltin(id: string): boolean {
    return this.#builtinIds.has(id);
  }

  /**
   * Reads one icon.
   *
   * @param id - The id.
   * @returns The icon, or undefined when there is none.
   */
  public get(id: string): IconView | undefined {
    return this.#byId.get(id)?.view;
  }

  /**
   * Reads several icons, in the order asked, leaving out the ones that are not there.
   *
   * @param ids - The ids.
   * @returns The icons found.
   */
  public byIds(ids: readonly string[]): IconView[] {
    return ids.flatMap((id) => {
      const found = this.#byId.get(id);

      return found === undefined ? [] : [found.view];
    });
  }

  /**
   * Finds icons.
   *
   * An empty query lists the catalogue as it is ordered: the platform's own ids first, then
   * lucide's, then the owner's. A query ranks by how closely the id, the name or a keyword
   * matches, and breaks ties the same way.
   *
   * @param query - What was typed; blank for everything.
   * @param limit - How many at most.
   * @returns The best matches, in order.
   */
  public search(query: string, limit: number): IconView[] {
    const needle = query.trim().toLowerCase();

    if (needle === '') {
      return this.#entries.slice(0, limit).map((entry) => entry.view);
    }

    return this.#entries
      .map((entry, index) => ({ entry, index, rank: rankOf(entry, needle) }))
      .filter((scored) => scored.rank !== NO_MATCH)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .slice(0, limit)
      .map((scored) => scored.entry.view);
  }
}

/**
 * Lower-cases what an icon is searched by, once.
 *
 * @param view - The icon.
 * @returns Its id, name and keywords, lower-cased.
 */
function haystackOf(view: IconView): Entry['haystack'] {
  return {
    id: view.id.toLowerCase(),
    name: view.name.toLowerCase(),
    keywords: view.keywords.map((keyword) => keyword.toLowerCase()),
  };
}
