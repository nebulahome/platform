/**
 * The icon catalogue as `api` serves and changes it.
 *
 * The built-in set is read once at start; the owner's rows are read once too, kept beside it,
 * and the catalogue served is the two laid together. Every write goes to the database first
 * and then to the copy held here, and the served catalogue is rebuilt from that copy - a
 * thousand and a half icons is small enough that rebuilding beats keeping two structures in
 * step, and one process is the only writer, so there is nothing to re-read.
 *
 * What an owner may change depends on where the icon came from. A built-in icon keeps its id
 * and its name: redrawing it is an *override*, kept as a row under the built-in id, and putting
 * the original back is deleting that row. A custom icon is the owner's entirely, its id
 * included - and a device that pointed at the old id follows it to the new one, in the same
 * transaction, so that nothing is ever left pointing at an icon that is no longer there.
 */
import { eq, sql } from 'drizzle-orm';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type IconCreate,
  type IconsQuery,
  type IconUpdate,
  type IconView,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import {
  IconCatalogue,
  IconSvgError,
  parseIconSvg,
  type BuiltinIcon,
  type IconRow,
} from '@nebulahome/icons';
import type { PlatformLogger } from '@nebulahome/logging';

/** Where the owner's icons are kept. */
export type IconStore = {
  /** Reads every row. */
  readonly list: () => Promise<IconRow[]>;
  readonly insert: (row: IconRow) => Promise<void>;

  /**
   * Replaces a row. When the row's id differs from `id`, every device and entity pointing at
   * the old id is moved to the new one in the same transaction.
   */
  readonly update: (id: string, row: IconRow) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;

  /** What points at an icon. */
  readonly countUses: (id: string) => Promise<IconUses>;
};

/** What points at an icon: the devices, the entities and the tags whose owner picked it. */
export type IconUses = {
  readonly devices: number;
  readonly entities: number;
  readonly tags: number;
};

/** A row of `registry.icons` as Drizzle reads it. */
type StoredIcon = typeof schema.registry.icons.$inferSelect;

/**
 * Turns a row of `registry.icons` into what the catalogue lays over the built-in set.
 *
 * @param row - As Drizzle reads it.
 * @returns The row, typed.
 */
function rowOf(row: StoredIcon): IconRow {
  return {
    id: row.id,
    kind: row.kind === 'override' ? 'override' : 'custom',
    name: row.name,
    keywords: row.keywords,
    node: row.node as IconRow['node'],
    frame: row.frame as IconRow['frame'],
  };
}

/**
 * The store over the registry.
 *
 * @param db - The database.
 * @returns The store.
 */
export function createIconStore(db: Database): IconStore {
  const { icons, devices, entities, tags } = schema.registry;

  return {
    /**
     * Reads every row.
     *
     * @returns The rows, typed.
     */
    list: async (): Promise<IconRow[]> => (await db.select().from(icons)).map(rowOf),

    /**
     * Writes a new row.
     *
     * @param row - The row.
     */
    insert: async (row): Promise<void> => {
      await db.insert(icons).values({ ...row, keywords: [...row.keywords] });
    },

    /**
     * Replaces a row, moving the devices, the entities and the tags along when its id changes.
     *
     * @param id - The row's id as it is.
     * @param row - The row as it should be.
     */
    update: async (id, row): Promise<void> => {
      // In one transaction with the rows that point at it: a device, an entity or a tag must
      // never point at an id with nothing behind it, not even between two statements.
      await db.transaction(async (tx) => {
        await tx
          .update(icons)
          .set({ ...row, keywords: [...row.keywords], updatedAt: new Date() })
          .where(eq(icons.id, id));

        if (row.id !== id) {
          await tx.update(devices).set({ icon: row.id }).where(eq(devices.icon, id));
          await tx.update(entities).set({ icon: row.id }).where(eq(entities.icon, id));
          await tx.update(tags).set({ icon: row.id }).where(eq(tags.icon, id));
        }
      });
    },

    /**
     * Deletes a row.
     *
     * @param id - Which row.
     */
    remove: async (id): Promise<void> => {
      await db.delete(icons).where(eq(icons.id, id));
    },

    /**
     * Counts the devices, the entities and the tags pointing at an icon.
     *
     * @param id - The icon id.
     * @returns How many of each.
     */
    countUses: async (id): Promise<IconUses> => {
      const [[onDevices], [onEntities], [onTags]] = await Promise.all([
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(devices)
          .where(eq(devices.icon, id)),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(entities)
          .where(eq(entities.icon, id)),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(tags)
          .where(eq(tags.icon, id)),
      ]);

      return {
        devices: onDevices?.total ?? 0,
        entities: onEntities?.total ?? 0,
        tags: onTags?.total ?? 0,
      };
    },
  };
}

/**
 * Says what points at an icon, for the refusal to remove it.
 *
 * @param uses - The counts.
 * @returns "2 devices and 1 entity", or just the parts that are not zero.
 */
function describeUses(uses: IconUses): string {
  const parts = [
    uses.devices === 0 ? null : `${String(uses.devices)} device${uses.devices === 1 ? '' : 's'}`,
    uses.entities === 0
      ? null
      : `${String(uses.entities)} entit${uses.entities === 1 ? 'y' : 'ies'}`,
    uses.tags === 0 ? null : `${String(uses.tags)} tag${uses.tags === 1 ? '' : 's'}`,
  ].filter((part) => part !== null);

  return parts.join(' and ');
}

/** What the service needs. */
export type IconServiceOptions = {
  readonly store: IconStore;
  readonly builtin: readonly BuiltinIcon[];
  readonly logger: PlatformLogger;
};

/**
 * Reads a drawing out of an uploaded file, or says what is wrong with it.
 *
 * @param svg - The file's text.
 * @returns The elements.
 * @throws {ValidationError} Naming the `svg` field, so the form can put the message under it.
 */
function nodeOf(svg: string): IconRow['node'] {
  try {
    return parseIconSvg(svg).node;
  } catch (error: unknown) {
    if (error instanceof IconSvgError) {
      throw new ValidationError('The drawing could not be read', {
        details: { issues: [{ path: 'svg', message: error.message }] },
        cause: error,
      });
    }

    throw error;
  }
}

/** The icon catalogue as `api` serves and changes it. */
export class IconService {
  readonly #options: IconServiceOptions;
  readonly #rows: Map<string, IconRow>;
  #catalogue: IconCatalogue;

  /**
   * Holds the rows that were read.
   *
   * @param options - Its collaborators.
   * @param rows - The owner's rows, as read at start.
   */
  private constructor(options: IconServiceOptions, rows: readonly IconRow[]) {
    this.#options = options;
    this.#rows = new Map(rows.map((row) => [row.id, row]));
    this.#catalogue = this.#rebuild();
  }

  /**
   * Reads the owner's rows and lays them over the built-in set.
   *
   * @param options - Its collaborators.
   * @returns The service, ready to serve.
   */
  public static async load(options: IconServiceOptions): Promise<IconService> {
    const rows = await options.store.list();
    const service = new IconService(options, rows);

    options.logger.info(
      { builtin: options.builtin.length, rows: rows.length, total: service.#catalogue.size },
      'Icon catalogue loaded',
    );

    return service;
  }

  /**
   * Says whether an id names an icon.
   *
   * @param id - The id.
   * @returns True when it does.
   */
  public has(id: string): boolean {
    return this.#catalogue.has(id);
  }

  /**
   * Reads one icon.
   *
   * @param id - The id.
   * @returns The icon, or undefined when there is none.
   */
  public get(id: string): IconView | undefined {
    return this.#catalogue.get(id);
  }

  /**
   * Answers `GET /icons`: the ids asked for, or a search, or the first page.
   *
   * @param query - What was asked.
   * @returns The icons.
   */
  public list(query: IconsQuery): IconView[] {
    if (query.ids !== undefined) {
      return this.#catalogue.byIds(query.ids);
    }

    return this.#catalogue.search(query.q ?? '', query.limit);
  }

  /**
   * Adds a custom icon.
   *
   * @param body - What the form collected.
   * @returns The icon as it is now served.
   * @throws {ConflictError} When the id is already an icon, built in or the owner's.
   * @throws {ValidationError} When the drawing cannot be read.
   */
  public async create(body: IconCreate): Promise<IconView> {
    if (this.#catalogue.has(body.id)) {
      throw new ConflictError('An icon already has that id', { details: { id: body.id } });
    }

    const row: IconRow = {
      id: body.id,
      kind: 'custom',
      name: body.name,
      keywords: body.keywords,
      node: nodeOf(body.svg),
      frame: body.frame,
    };

    await this.#options.store.insert(row);
    this.#rows.set(row.id, row);
    this.#catalogue = this.#rebuild();

    return this.#served(row.id);
  }

  /**
   * Changes an icon: a built-in one's drawing or keywords, a custom one's anything.
   *
   * @param id - Which icon.
   * @param body - What to change.
   * @returns The icon as it is now served.
   * @throws {NotFoundError} When there is no such icon.
   * @throws {ValidationError} When a built-in icon's id or name is being changed, or a drawing
   * cannot be read.
   * @throws {ConflictError} When a custom icon is being moved onto an id that is taken.
   */
  public async update(id: string, body: IconUpdate): Promise<IconView> {
    const current = this.#catalogue.get(id);

    if (current === undefined) {
      throw new NotFoundError('No icon has that id', { details: { id } });
    }

    const isBuiltin = this.#catalogue.isBuiltin(id);

    if (isBuiltin && (body.id !== undefined || body.name !== undefined)) {
      throw new ValidationError('The id and the name of a built-in icon cannot change', {
        details: { issues: [{ path: body.id === undefined ? 'name' : 'id', message: 'Fixed' }] },
      });
    }

    const nextId = body.id ?? id;

    if (nextId !== id && this.#catalogue.has(nextId)) {
      throw new ConflictError('An icon already has that id', { details: { id: nextId } });
    }

    const existing = this.#rows.get(id);
    const row: IconRow = {
      id: nextId,
      kind: isBuiltin ? 'override' : 'custom',
      name: isBuiltin ? current.name : (body.name ?? current.name),
      keywords: body.keywords ?? current.keywords,
      node: body.svg === undefined ? current.node : nodeOf(body.svg),
      frame: body.frame ?? current.frame,
    };

    if (existing === undefined) {
      await this.#options.store.insert(row);
    } else {
      await this.#options.store.update(id, row);
      this.#rows.delete(id);
    }

    this.#rows.set(nextId, row);
    this.#catalogue = this.#rebuild();

    return this.#served(nextId);
  }

  /**
   * Removes a custom icon, or puts a built-in one's original drawing back.
   *
   * @param id - Which icon.
   * @returns A promise that settles once it is gone.
   * @throws {NotFoundError} When there is no such icon.
   * @throws {ValidationError} When the icon is built in and not overridden: there is nothing
   * to remove.
   * @throws {ConflictError} When a device still points at a custom icon, saying how many.
   */
  public async remove(id: string): Promise<void> {
    if (!this.#catalogue.has(id)) {
      throw new NotFoundError('No icon has that id', { details: { id } });
    }

    const row = this.#rows.get(id);

    if (row === undefined) {
      throw new ValidationError('A built-in icon cannot be removed', { details: { id } });
    }

    if (row.kind === 'custom') {
      const uses = await this.#options.store.countUses(id);

      if (uses.devices + uses.entities + uses.tags > 0) {
        throw new ConflictError(`${describeUses(uses)} still use this icon`, {
          details: { id, ...uses },
        });
      }
    }

    await this.#options.store.remove(id);
    this.#rows.delete(id);
    this.#catalogue = this.#rebuild();
  }

  /**
   * Lays the rows over the built-in set again.
   *
   * @returns The catalogue to serve.
   */
  #rebuild(): IconCatalogue {
    return new IconCatalogue(this.#options.builtin, [...this.#rows.values()]);
  }

  /**
   * Reads an icon that was just written.
   *
   * @param id - Its id.
   * @returns The icon.
   * @throws {NotFoundError} Never, in practice: the row was written a moment ago. Thrown rather
   * than cast so a bug in the rebuild is loud.
   */
  #served(id: string): IconView {
    const view = this.#catalogue.get(id);

    if (view === undefined) {
      throw new NotFoundError('The icon was written but is not served', { details: { id } });
    }

    return view;
  }
}
