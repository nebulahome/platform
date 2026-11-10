/**
 * Running the code parts of aliases: the host the interpreter reads the house through, and what
 * is kept between runs.
 *
 * An alias's code is compiled and checked once per text. A part from code runs its function
 * against a host made over the registry (entities, and the parts of this round), the house (the
 * clock, its time zone and position), the history and HTTP. What the code keeps in `mem` stays
 * here between runs; it is written to the alias's row at most once every 10 seconds, and on
 * shutdown ({@link AliasCodeRuntime.flush}). The GET cache and the write rate limit of each
 * alias's HTTP last across runs too.
 */
import {
  aliasCodeExpectation,
  aliasScalarFromState,
  checkCode,
  compile,
  fitReturn,
  HttpPolicy,
  MAX_HTTP_RESPONSE_BYTES,
  MAX_HTTP_TIMEOUT_SECONDS,
  runFunction,
  type AliasPartConfig,
  type AliasPartDef,
  type CheckResult,
  type CodeHost,
  type CompileResult,
  type EntityId,
  type EntityState,
  type HistoryKind,
  type HttpReply,
  type HttpRequest,
  type JsonObject,
  type JsonValue,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { AliasDefinition } from '../domain/alias-catalog.js';
import { stateField, type PartValue } from '../domain/alias-values.js';
import type { House } from '../domain/automation/schedule.js';
import type { EntityDirectory } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';
import {
  loadEntityLabels,
  readTelemetrySummary,
  type EntityLabel,
  type TelemetrySummary,
} from '../persistence/alias-code-reads.js';
import { storeMemory } from '../persistence/alias-loader.js';
import { loadHouse } from '../persistence/automation-store.js';

import type { AliasCodeRunner, AliasFailure } from './alias-engine.js';

/** What the runtime needs. */
export type AliasCodeRuntimeOptions = {
  readonly db: Database;
  readonly registry: EntityRegistry;

  /** Where an entity id is turned into the row its history is keyed on. */
  readonly directory: EntityDirectory;
  readonly logger: PlatformLogger;
};

/** How often an alias's mem is written to its row at most. */
export const MEMORY_WRITE_INTERVAL_MS = 10_000;

/** How long a history summary, and the house's time zone and position, are reused. */
const REUSE_MS = 60_000;

/** One alias's code as of one text: compiled, checked, and the labels of what it reads. */
type Compiled = {
  readonly code: string;
  readonly compiled: CompileResult;
  readonly check: CheckResult;
  labels?: ReadonlyMap<string, EntityLabel>;
};

/** One alias's mem, and what its row holds. */
type Held = {
  mem: JsonObject;

  /** The mem, as JSON. */
  text: string;

  /** What the row holds, as JSON. */
  stored: string;

  /** The definition's memory this was last held against: a new one is a definition read back. */
  from: JsonObject;
  writtenAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/** What a run gives the engine. */
type Ran = { readonly value: unknown } | { readonly error: AliasFailure };

/**
 * The code runner the alias engine is given.
 */
export class AliasCodeRuntime implements AliasCodeRunner {
  readonly #options: AliasCodeRuntimeOptions;
  readonly #compiled = new Map<string, Compiled>();
  readonly #held = new Map<string, Held>();
  readonly #http = new Map<string, HttpPolicy>();
  readonly #history = new Map<
    string,
    { readonly summary: TelemetrySummary; readonly until: number }
  >();

  #house: { readonly house: House; readonly until: number } | undefined;

  /**
   * @param options - Collaborators.
   */
  public constructor(options: AliasCodeRuntimeOptions) {
    this.#options = options;
  }

  /**
   * Runs the function a code part names.
   *
   * @param alias - The alias.
   * @param def - The part.
   * @param config - Its configuration.
   * @param partValues - The values of its parts worked out so far this run.
   * @returns What it returned, fitted to the part, or a failure saying where, with what it read.
   */
  public async run(
    alias: AliasDefinition,
    def: AliasPartDef,
    config: Extract<AliasPartConfig, { from: 'code' }>,
    partValues: ReadonlyMap<string, PartValue>,
  ): Promise<Ran> {
    const name = config.function;
    const entry = this.#entry(alias);

    if (!entry.compiled.ok) {
      const [problem] = entry.compiled.problems;

      return {
        error: {
          message: problem?.message ?? 'The code cannot be read',
          function: name,
          line: problem?.line ?? null,
          column: problem?.column ?? null,
        },
      };
    }

    // shortcut: names and units are read once per code text, so a rename shows after the alias's next save or a restart; re-read them on a timer if that matters.
    entry.labels ??= await loadEntityLabels(this.#options.db, entry.check.reads.entityIds);

    const house = await this.#currentHouse();
    const held = this.#heldFor(alias);
    const inputs: Record<string, JsonValue> = {};
    const result = await runFunction(entry.compiled.program, name, {
      host: this.#host(alias, partValues, house, entry.labels, inputs),
      mem: held.mem,
      trace: false,
      trial: false,
      httpPolicy: this.#policyFor(alias.id),
    });

    if (result.kind !== 'value') {
      return {
        error: {
          message: result.error?.message ?? 'The code stopped',
          function: name,
          line: result.error?.line ?? null,
          column: result.error?.column ?? null,
          inputs,
        },
      };
    }

    this.#keep(alias.id, held, result.mem);

    const fitted = fitReturn(result.value, aliasCodeExpectation(def, config));

    return fitted.ok
      ? { value: fitted.value }
      : { error: { message: fitted.message, function: name, inputs } };
  }

  /**
   * Forgets an alias's compiled code; its mem stays while a write of it is still due, since the
   * definition read back holds the older one.
   *
   * @param aliasId - The alias.
   */
  public forget(aliasId: string): void {
    this.#compiled.delete(aliasId);

    const held = this.#held.get(aliasId);

    if (held?.timer === undefined && held?.text === held?.stored) {
      this.#held.delete(aliasId);
    }
  }

  /**
   * Whether an alias's code reads the time, so it must run every minute.
   *
   * @param alias - The alias.
   * @returns True when a part comes from code that reads the clock.
   */
  public readsTime(alias: AliasDefinition): boolean {
    return (
      Object.values(alias.parts).some((config) => config.from === 'code') &&
      this.#entry(alias).check.uses.time
    );
  }

  /**
   * Writes every mem not yet written, at once: for shutdown.
   *
   * @returns Once written, or failed and said.
   */
  public async flush(): Promise<void> {
    await Promise.all(
      [...this.#held].map(([aliasId, held]) => {
        clearTimeout(held.timer);
        held.timer = undefined;

        return this.#write(aliasId, held);
      }),
    );
  }

  /**
   * An alias's code compiled and checked, from the cache while its text is the same.
   *
   * @param alias - The alias.
   * @returns The entry.
   */
  #entry(alias: AliasDefinition): Compiled {
    const known = this.#compiled.get(alias.id);

    if (known?.code === alias.code) {
      return known;
    }

    const parts = alias.defs.flatMap((def) => {
      const config = alias.parts[def.key];

      return config?.from === 'code'
        ? [
            {
              key: def.key,
              functionName: config.function,
              expectation: aliasCodeExpectation(def, config),
            },
          ]
        : [];
    });
    const entry: Compiled = {
      code: alias.code,
      compiled: compile(alias.code),

      // Only what it reads and uses matters here: the API refused the code when it had problems.
      check: checkCode(alias.code, {
        parts,

        /**
         * Every entity counts as known here.
         *
         * @returns True.
         */
        knownEntity: () => true,
        partKeys: Object.keys(alias.parts),
      }),
    };

    this.#compiled.set(alias.id, entry);

    return entry;
  }

  /**
   * The host one run reads the house through, noting each value it reads for a failure's replay.
   *
   * @param alias - The alias, for its fallback policy.
   * @param partValues - The parts of this round.
   * @param house - The house's time zone and position.
   * @param labels - The names and units of the entities the code reads.
   * @param inputs - Where what the run reads is noted: entity ids, `entity.field`, `part.key`.
   * @returns The host.
   */
  #host(
    alias: AliasDefinition,
    partValues: ReadonlyMap<string, PartValue>,
    house: House,
    labels: ReadonlyMap<string, EntityLabel>,
    inputs: Record<string, JsonValue>,
  ): CodeHost {
    const { registry } = this.#options;

    /**
     * An entity as code sees it: nothing when it is not there, or silent and not kept.
     *
     * @param entityId - The entity.
     * @returns Its state, or undefined.
     */
    const live = (entityId: string): EntityState | undefined => {
      const source = registry.get(entityId as EntityId);

      return source === undefined || (!source.isAvailable && alias.fallbackPolicy !== 'last_known')
        ? undefined
        : source;
    };

    return {
      /**
       * An entity's scalar.
       *
       * @param entityId - The entity.
       * @returns The scalar, or null.
       */
      entity: (entityId) => {
        const value = aliasScalarFromState(live(entityId)?.state);
        const scalar =
          typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
            ? value
            : null;

        inputs[entityId] = scalar;

        return scalar;
      },

      /**
       * One field of an entity's state, or else of its attributes.
       *
       * @param entityId - The entity.
       * @param field - The field, in snake case.
       * @returns The value, or null.
       */
      field: (entityId, field) => {
        const source = live(entityId);
        const value = (stateField(source?.state, field) ??
          source?.attributes[field] ??
          null) as JsonValue;

        inputs[`${entityId}.${field}`] = value;

        return value;
      },

      /**
       * Another part's value this round.
       *
       * @param key - The part.
       * @returns The value, or null when it has none yet.
       */
      part: (key) => {
        const value = (partValues.get(key) ?? null) as JsonValue;

        inputs[`part.${key}`] = value;

        return value;
      },

      /**
       * Whether an entity is reachable.
       *
       * @param entityId - The entity.
       * @returns True when it is.
       */
      available: (entityId) => registry.get(entityId as EntityId)?.isAvailable === true,

      /**
       * When an entity's state last changed.
       *
       * @param entityId - The entity.
       * @returns Unix milliseconds, or null.
       */
      lastChanged: (entityId) => registry.get(entityId as EntityId)?.lastChanged.getTime() ?? null,

      /**
       * An entity's name.
       *
       * @param entityId - The entity.
       * @returns The name, or null.
       */
      nameOf: (entityId) => labels.get(entityId)?.name ?? null,

      /**
       * An entity's unit.
       *
       * @param entityId - The entity.
       * @returns The unit, or null.
       */
      unitOf: (entityId) => labels.get(entityId)?.unit ?? null,

      /**
       * The current instant.
       *
       * @returns Unix milliseconds.
       */
      now: () => Date.now(),
      timeZone: house.timeZone,

      /**
       * Where the house is.
       *
       * @returns The position, or null.
       */
      position: () => house.position,

      /**
       * A summary of an entity's recent readings.
       *
       * @param kind - Which summary.
       * @param entityId - The entity.
       * @param minutes - How far back.
       * @returns The number, or null.
       */
      history: (kind, entityId, minutes) => this.#historyOf(kind, entityId, minutes),

      /**
       * Sends a request.
       *
       * @param request - The request, already checked by the library.
       * @returns The answer.
       */
      http: (request) => send(request),
    };
  }

  /**
   * The house's time zone and position, read again once a minute.
   *
   * @returns The house.
   */
  async #currentHouse(): Promise<House> {
    if (this.#house === undefined || this.#house.until <= Date.now()) {
      this.#house = { house: await loadHouse(this.#options.db), until: Date.now() + REUSE_MS };
    }

    return this.#house.house;
  }

  /**
   * A summary of an entity's readings over the last minutes, reused for a minute.
   *
   * @param kind - Which summary.
   * @param entityId - The entity.
   * @param minutes - How far back.
   * @returns The number, or null when there is no reading or no such entity.
   */
  async #historyOf(kind: HistoryKind, entityId: string, minutes: number): Promise<number | null> {
    // An entity linked to another keeps no history while linked: its id reads the other's.
    const record = this.#options.directory.resolve(entityId as EntityId);

    if (record === undefined) {
      return null;
    }

    const key = `${record.rowId} ${String(minutes)}`;
    const now = Date.now();
    const known = this.#history.get(key);

    if (known !== undefined && known.until > now) {
      return known.summary[kind];
    }

    const summary = await readTelemetrySummary(
      this.#options.db,
      record.rowId,
      new Date(now - minutes * 60_000),
    );

    for (const [stored, entry] of this.#history) {
      if (entry.until <= now) {
        this.#history.delete(stored);
      }
    }

    this.#history.set(key, { summary, until: now + REUSE_MS });

    return summary[kind];
  }

  /**
   * An alias's HTTP policy, kept across its runs.
   *
   * @param aliasId - The alias.
   * @returns The policy.
   */
  #policyFor(aliasId: string): HttpPolicy {
    let policy = this.#http.get(aliasId);

    if (policy === undefined) {
      policy = new HttpPolicy();
      this.#http.set(aliasId, policy);
    }

    return policy;
  }

  /**
   * An alias's mem: the one held here, unless the definition read back holds another than the
   * row had - the API reset or edited it - which then wins.
   *
   * @param alias - The alias.
   * @returns The held mem.
   */
  #heldFor(alias: AliasDefinition): Held {
    const known = this.#held.get(alias.id);

    if (
      known !== undefined &&
      (known.from === alias.memory || JSON.stringify(alias.memory) === known.stored)
    ) {
      known.from = alias.memory;

      return known;
    }

    clearTimeout(known?.timer);

    const text = JSON.stringify(alias.memory);
    const held: Held = {
      mem: alias.memory,
      text,
      stored: text,
      from: alias.memory,
      writtenAt: 0,
      timer: undefined,
    };

    this.#held.set(alias.id, held);

    return held;
  }

  /**
   * Holds the mem a run left, and has it written when it changed: at once the first time, then
   * at most once every 10 seconds, the newest each time.
   *
   * @param aliasId - The alias.
   * @param held - Its held mem.
   * @param mem - The mem the run left.
   */
  #keep(aliasId: string, held: Held, mem: JsonObject): void {
    const text = JSON.stringify(mem);

    if (text === held.text) {
      return;
    }

    held.mem = mem;
    held.text = text;

    if (held.timer !== undefined) {
      return;
    }

    held.timer = setTimeout(
      () => {
        held.timer = undefined;
        void this.#write(aliasId, held);
      },
      Math.max(0, held.writtenAt + MEMORY_WRITE_INTERVAL_MS - Date.now()),
    );
    held.timer.unref();
  }

  /**
   * Writes a held mem to the alias's row, when it differs from what the row holds.
   *
   * @param aliasId - The alias.
   * @param held - Its held mem.
   */
  async #write(aliasId: string, held: Held): Promise<void> {
    const { mem, text } = held;

    if (text === held.stored) {
      return;
    }

    held.writtenAt = Date.now();

    try {
      await storeMemory(this.#options.db, aliasId, mem);
      held.stored = text;
    } catch (cause: unknown) {
      this.#options.logger.warn({ err: cause, aliasId }, 'Could not keep the alias code memory');
    }
  }
}

/**
 * Reads an answer's body, stopping one chunk past the largest the library takes: a larger one
 * fails the run, so the rest is never worth holding.
 *
 * @param response - The answer.
 * @returns The body as text.
 */
async function readCapped(response: Response): Promise<string> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();

  if (reader === undefined) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (size <= MAX_HTTP_RESPONSE_BYTES) {
    // eslint-disable-next-line no-await-in-loop -- a stream is read one chunk after the other
    const chunk = await reader.read();

    if (chunk.done) {
      return new TextDecoder().decode(Buffer.concat(chunks));
    }

    chunks.push(chunk.value);
    size += chunk.value.byteLength;
  }

  await reader.cancel();

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Sends one request of code; the timeout covers the body too.
 *
 * @param request - The request, already checked by the library.
 * @returns The answer, header names in lower case.
 * @throws {Error} When there is no answer in time or the request cannot be made, saying why.
 */
async function send(request: HttpRequest): Promise<HttpReply> {
  const timeoutMs = Math.min(request.timeoutMs, MAX_HTTP_TIMEOUT_SECONDS * 1000);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === null ? {} : { body: request.body }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      text: await readCapped(response),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`no answer within ${String(timeoutMs / 1000)} s`, { cause: error });
    }

    throw error instanceof Error && error.cause instanceof Error ? error.cause : error;
  }
}
