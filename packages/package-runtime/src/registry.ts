/**
 * What `hub` has available to run: the transports it can open and the integrations it can load.
 *
 * One class for both, because they differ only in what the failure says. Keyed by id - a
 * transport by its name, an integration by its bundle kind - and populated at startup, before
 * any instance is resolved against it.
 */
import { ConflictError, NotFoundError } from '@nebulahome/contracts';

/** Anything a registry can hold: something that knows its own id. */
export type Identified = { readonly id: string };

/** What `hub` has available to run, of one kind. */
export class Registry<TEntry extends Identified> {
  readonly #entries = new Map<string, TEntry>();
  readonly #label: string;

  /**
   * Creates an empty registry.
   *
   * @param label - What it holds, named the way an owner would recognise it in an error.
   */
  public constructor(label: string) {
    this.#label = label;
  }

  /**
   * How many entries are registered.
   *
   * @returns The number of registered entries.
   */
  public get size(): number {
    return this.#entries.size;
  }

  /**
   * Adds one entry.
   *
   * @param entry - What to register.
   * @throws {ConflictError} When something is already registered under that id. Two bundles
   * claiming one kind would otherwise resolve by load order, which is directory order, which is
   * not a decision anybody made.
   */
  public register(entry: TEntry): void {
    if (this.#entries.has(entry.id)) {
      throw new ConflictError(`A ${this.#label} is already registered as ${entry.id}`, {
        details: { label: this.#label, id: entry.id },
      });
    }

    this.#entries.set(entry.id, entry);
  }

  /**
   * Looks one up.
   *
   * @param id - What to look for.
   * @returns The entry, or undefined when nothing is registered under that id.
   */
  public get(id: string): TEntry | undefined {
    return this.#entries.get(id);
  }

  /**
   * Looks one up, insisting that it exists.
   *
   * @param id - What to look for.
   * @returns The entry.
   * @throws {NotFoundError} When nothing is registered under that id. `hub` turns this into a
   * failed instance carrying the message, rather than refusing to start: one bundle that is not
   * installed must not take the rest of the house down with it.
   */
  public require(id: string): TEntry {
    const entry = this.#entries.get(id);

    if (entry === undefined) {
      throw new NotFoundError(`No ${this.#label} is registered as ${id}`, {
        details: { label: this.#label, id, available: this.ids() },
      });
    }

    return entry;
  }

  /**
   * Lists what is registered.
   *
   * @returns The ids, in registration order.
   */
  public ids(): string[] {
    return [...this.#entries.keys()];
  }
}
