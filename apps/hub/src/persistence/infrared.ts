/**
 * What the Infrared broker keeps: the remotes the house learned and their buttons, in the
 * registry's `infrared_remotes` and `infrared_buttons` tables.
 *
 * A button's code is kept in the platform's shape and read back through the contract, so a row
 * written by an older hub that the contract no longer takes is left out rather than failing every
 * remote. `hub` is the tables' only writer: the owner's changes reach it over the bus through
 * `api`. Behind an interface, so the broker's tests keep them in memory.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import {
  ConflictError,
  iconIdSchema,
  INFRARED_REMOTE_KINDS,
  infraredCodeSchema,
  NotFoundError,
  type InfraredCode,
  type InfraredRemoteKind,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** A remote. */
export type StoredInfraredRemote = {
  readonly id: string;
  readonly name: string;
  readonly kind: InfraredRemoteKind;

  /** The instance its codes are sent through; null once it was removed. */
  readonly blasterId: string | null;
  readonly columns: number;
};

/** A button of a remote. */
export type StoredInfraredButton = {
  readonly id: string;
  readonly remoteId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly cell: number;
  readonly code: InfraredCode;
  readonly lastPressedAt: Date | null;
};

/** A remote to save: new when it has no id. */
type NewRemote = Omit<StoredInfraredRemote, 'id'> & { readonly id?: string | undefined };

/** A button to save: new when it has no id. Its last press is the broker's to note. */
type NewButton = Omit<StoredInfraredButton, 'id' | 'lastPressedAt'> & {
  readonly id?: string | undefined;
};

/** What the broker keeps. */
export type InfraredStore = {
  remotes: () => Promise<StoredInfraredRemote[]>;
  buttons: () => Promise<StoredInfraredButton[]>;

  /**
   * Saves a remote, new when it has no id.
   *
   * @throws {NotFoundError} When the remote to change is not there.
   */
  saveRemote: (remote: NewRemote) => Promise<StoredInfraredRemote>;

  /** Removes a remote and its buttons. */
  removeRemote: (id: string) => Promise<boolean>;

  /**
   * Saves a button, new when it has no id.
   *
   * @throws {ConflictError} When another button of its remote is in its cell.
   * @throws {NotFoundError} When the button to change is not there.
   */
  saveButton: (button: NewButton) => Promise<StoredInfraredButton>;
  removeButton: (id: string) => Promise<boolean>;
  notePressed: (id: string, at: Date) => Promise<void>;
};

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

const remotes = schema.registry.infraredRemotes;
const buttons = schema.registry.infraredButtons;

/**
 * Whether a failure is PostgreSQL refusing a duplicate, however deep the driver wrapped it.
 *
 * @param error - Whatever was thrown.
 * @returns True for a unique violation.
 */
function isDuplicate(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }

    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
}

/**
 * The refusal of a second button in one cell.
 *
 * @param button - The button refused.
 * @param button.remoteId - Its remote.
 * @param button.cell - The cell.
 * @returns The error.
 */
function takenCellError(button: { remoteId: string; cell: number }): ConflictError {
  return new ConflictError(`Cell ${String(button.cell)} of the remote holds another button`, {
    details: { remoteId: button.remoteId, cell: button.cell },
  });
}

/**
 * Reads a remote row; a kind the contract no longer takes reads as other.
 *
 * @param row - The row.
 * @returns The remote.
 */
function remoteOf(row: typeof remotes.$inferSelect): StoredInfraredRemote {
  return {
    id: row.id,
    name: row.name,
    kind: (INFRARED_REMOTE_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as InfraredRemoteKind)
      : 'other',
    blasterId: row.blasterIntegrationId,
    columns: row.columnCount,
  };
}

/**
 * Reads a button row; one whose code the contract no longer takes is left out.
 *
 * @param row - The row.
 * @returns The button, or undefined.
 */
function buttonOf(row: typeof buttons.$inferSelect): StoredInfraredButton | undefined {
  const code = infraredCodeSchema.safeParse(row.code);

  return code.success
    ? {
        id: row.id,
        remoteId: row.remoteId,
        name: row.name,
        icon: iconIdSchema.safeParse(row.icon).success ? row.icon : null,
        cell: row.cell,
        code: code.data,
        lastPressedAt: row.lastPressedAt,
      }
    : undefined;
}

/** The broker's tables in the registry. */
class DatabaseInfraredStore implements InfraredStore {
  readonly #db: Database;

  /**
   * Keeps the handle.
   *
   * @param db - A connected database handle.
   */
  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Reads every remote.
   *
   * @returns The remotes.
   */
  async remotes(): Promise<StoredInfraredRemote[]> {
    return (await this.#db.select().from(remotes)).map(remoteOf);
  }

  /**
   * Reads every button.
   *
   * @returns The buttons whose code still holds.
   */
  async buttons(): Promise<StoredInfraredButton[]> {
    return (await this.#db.select().from(buttons)).flatMap((row) => buttonOf(row) ?? []);
  }

  /**
   * Saves a remote, new when it has no id.
   *
   * @param remote - The remote.
   * @returns It, saved.
   * @throws {NotFoundError} When the remote to change is not there.
   */
  async saveRemote(remote: NewRemote): Promise<StoredInfraredRemote> {
    const values = {
      name: remote.name,
      kind: remote.kind,
      blasterIntegrationId: remote.blasterId,
      columnCount: remote.columns,
    };
    const [row] =
      remote.id === undefined
        ? await this.#db.insert(remotes).values(values).returning()
        : await this.#db.update(remotes).set(values).where(eq(remotes.id, remote.id)).returning();

    if (row === undefined) {
      throw new NotFoundError(`There is no infrared remote ${remote.id ?? ''}`, {
        details: { id: remote.id ?? null },
      });
    }

    return remoteOf(row);
  }

  /**
   * Removes a remote; its buttons go with it.
   *
   * @param id - The remote.
   * @returns Whether there was one.
   */
  async removeRemote(id: string): Promise<boolean> {
    const removed = await this.#db
      .delete(remotes)
      .where(eq(remotes.id, id))
      .returning({ id: remotes.id });

    return removed.length > 0;
  }

  /**
   * Saves a button, new when it has no id.
   *
   * @param button - The button.
   * @returns It, saved.
   * @throws {ConflictError} When another button of its remote is in its cell.
   * @throws {NotFoundError} When the button to change is not there.
   */
  async saveButton(button: NewButton): Promise<StoredInfraredButton> {
    const values = {
      remoteId: button.remoteId,
      name: button.name,
      icon: button.icon,
      cell: button.cell,
      code: button.code,
    };
    let row: typeof buttons.$inferSelect | undefined;

    try {
      [row] =
        button.id === undefined
          ? await this.#db.insert(buttons).values(values).returning()
          : await this.#db.update(buttons).set(values).where(eq(buttons.id, button.id)).returning();
    } catch (error: unknown) {
      throw isDuplicate(error) ? takenCellError(button) : error;
    }

    const saved = row === undefined ? undefined : buttonOf(row);

    if (saved === undefined) {
      throw new NotFoundError(`There is no infrared button ${button.id ?? ''}`, {
        details: { id: button.id ?? null },
      });
    }

    return saved;
  }

  /**
   * Removes a button.
   *
   * @param id - The button.
   * @returns Whether there was one.
   */
  async removeButton(id: string): Promise<boolean> {
    const removed = await this.#db
      .delete(buttons)
      .where(eq(buttons.id, id))
      .returning({ id: buttons.id });

    return removed.length > 0;
  }

  /**
   * Notes when a button was sent.
   *
   * @param id - The button.
   * @param at - When.
   * @returns Once noted.
   */
  async notePressed(id: string, at: Date): Promise<void> {
    await this.#db.update(buttons).set({ lastPressedAt: at }).where(eq(buttons.id, id));
  }
}

/**
 * The broker's tables in the registry.
 *
 * @param db - A connected database handle.
 * @returns The store.
 */
export function databaseInfraredStore(db: Database): InfraredStore {
  return new DatabaseInfraredStore(db);
}

/** The broker's tables in memory, for tests: a cell held twice is refused as the table does. */
class MemoryInfraredStore implements InfraredStore {
  readonly #remotes = new Map<string, StoredInfraredRemote>();
  readonly #buttons = new Map<string, StoredInfraredButton>();

  /**
   * Reads every remote.
   *
   * @returns The remotes.
   */
  remotes(): Promise<StoredInfraredRemote[]> {
    return Promise.resolve([...this.#remotes.values()]);
  }

  /**
   * Reads every button.
   *
   * @returns The buttons.
   */
  buttons(): Promise<StoredInfraredButton[]> {
    return Promise.resolve([...this.#buttons.values()]);
  }

  /**
   * Saves a remote.
   *
   * @param remote - The remote.
   * @returns It.
   * @throws {NotFoundError} When the remote to change is not there.
   */
  saveRemote(remote: NewRemote): Promise<StoredInfraredRemote> {
    if (remote.id !== undefined && !this.#remotes.has(remote.id)) {
      return Promise.reject(new NotFoundError(`There is no infrared remote ${remote.id}`));
    }

    const saved = { ...remote, id: remote.id ?? randomUUID() };

    this.#remotes.set(saved.id, saved);

    return Promise.resolve(saved);
  }

  /**
   * Removes a remote and its buttons.
   *
   * @param id - The remote.
   * @returns Whether there was one.
   */
  removeRemote(id: string): Promise<boolean> {
    for (const button of [...this.#buttons.values()]) {
      if (button.remoteId === id) {
        this.#buttons.delete(button.id);
      }
    }

    return Promise.resolve(this.#remotes.delete(id));
  }

  /**
   * Saves a button.
   *
   * @param button - The button.
   * @returns It.
   * @throws {ConflictError} When another button of its remote is in its cell.
   * @throws {NotFoundError} When the button to change is not there.
   */
  saveButton(button: NewButton): Promise<StoredInfraredButton> {
    const previous = button.id === undefined ? undefined : this.#buttons.get(button.id);

    if (button.id !== undefined && previous === undefined) {
      return Promise.reject(new NotFoundError(`There is no infrared button ${button.id}`));
    }

    if (
      [...this.#buttons.values()].some(
        (other) =>
          other.id !== button.id &&
          other.remoteId === button.remoteId &&
          other.cell === button.cell,
      )
    ) {
      return Promise.reject(takenCellError(button));
    }

    const saved = {
      ...button,
      id: button.id ?? randomUUID(),
      lastPressedAt: previous?.lastPressedAt ?? null,
    };

    this.#buttons.set(saved.id, saved);

    return Promise.resolve(saved);
  }

  /**
   * Removes a button.
   *
   * @param id - The button.
   * @returns Whether there was one.
   */
  removeButton(id: string): Promise<boolean> {
    return Promise.resolve(this.#buttons.delete(id));
  }

  /**
   * Notes when a button was sent.
   *
   * @param id - The button.
   * @param at - When.
   * @returns Once noted.
   */
  notePressed(id: string, at: Date): Promise<void> {
    const button = this.#buttons.get(id);

    if (button !== undefined) {
      this.#buttons.set(id, { ...button, lastPressedAt: at });
    }

    return Promise.resolve();
  }
}

/**
 * The broker's tables in memory, for tests.
 *
 * @returns The store.
 */
export function memoryInfraredStore(): InfraredStore {
  return new MemoryInfraredStore();
}
