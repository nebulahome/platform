/**
 * Working out aliases from their parts, and sending each command where its parts come from.
 *
 * An alias is made of parts; each part takes its value from a source - stored here, read from an
 * entity, combined from several, a formula, or a function of the alias's code. The engine works
 * every part out, puts the capability states together, and writes them through ingest like any
 * other entity's (ARCHITECTURE.md §6.3). A command to an alias goes to the parts it touches: a
 * stored part takes the new value here, an entity part has the command forwarded to its entity,
 * and a formula or code part refuses it, since nothing can set what is worked out - unless the part
 * has an action for that command: then only the action runs (a stored part still keeps the value).
 * A part's actions also run when its value changes ({@link AliasActions}).
 *
 * **An alias changes while `core` runs.** The API writes an alias's rows and then asks the
 * engine to take them in ({@link AliasEngine.sync}); removing one goes through the engine
 * ({@link AliasEngine.remove}), which deletes the rows and forgets the alias in the same step.
 *
 * **One run at a time per alias.** Code may wait (an HTTP request, a history read), so working an
 * alias out is asynchronous; runs of one alias are chained, and the changes that arrive while one
 * runs collapse into a single run after it.
 */
import { eq } from 'drizzle-orm';

import {
  aliasCapabilities,
  aliasExpressionNames,
  aliasScalarFromState,
  busSubjects,
  evaluateAliasExpression,
  ValidationError,
  type AliasBinding,
  type AliasPartConfig,
  type AliasPartDef,
  type AliasPartValue,
  type CapabilityName,
  type CapabilityState,
  type ChangeContext,
  type EntityId,
  type JsonObject,
  type JsonValue,
  type LibraryEvent,
  type StateReport,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { AliasCatalog, AliasDefinition } from '../domain/alias-catalog.js';
import { aliasDescendants } from '../domain/alias-graph.js';
import {
  applyCapabilityCommand,
  assembleState,
  combine,
  fitPart,
  partsTouchedBy,
  readPart,
  stateField,
  type PartValue,
} from '../domain/alias-values.js';
import { validateCommand } from '../domain/command-validation.js';
import type { EntityDirectory } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';
import {
  eraseAlias,
  loadAlias,
  loadAliases,
  storePartValues,
  type CustomFieldsLookup,
} from '../persistence/alias-loader.js';
import { loadEntityRecord } from '../persistence/registry-loader.js';

import { AliasActions, type RunActions } from './alias-actions.js';
import { ingestReport, type StateIngestOptions } from './state-ingest.js';

/** What runs an alias's code parts (`alias-code-runtime.ts`). */
export type AliasCodeRunner = {
  /**
   * Runs the function a code part names.
   *
   * @param alias - The alias.
   * @param def - The part.
   * @param config - Its configuration.
   * @param partValues - The values of its parts worked out so far this run.
   * @returns What it returned, fitted to the part, or a failure saying where.
   */
  readonly run: (
    alias: AliasDefinition,
    def: AliasPartDef,
    config: Extract<AliasPartConfig, { from: 'code' }>,
    partValues: ReadonlyMap<string, PartValue>,
  ) => Promise<{ readonly value: unknown } | { readonly error: AliasFailure }>;

  /** Forgets what is kept for an alias that changed or went (its compiled code, its memory). */
  readonly forget: (aliasId: string) => void;

  /** Whether an alias's code reads the time, so it must run every minute. */
  readonly readsTime: (alias: AliasDefinition) => boolean;
};

/** Why an alias could not be worked out: what, and where. */
export type AliasFailure = {
  readonly message: string;
  readonly part?: string | null;
  readonly function?: string | null;
  readonly line?: number | null;
  readonly column?: number | null;
  readonly inputs?: Readonly<Record<string, JsonValue>>;
};

/** What the engine needs to run. */
export type AliasEngineOptions = {
  readonly db: Database;
  readonly directory: EntityDirectory;
  readonly registry: EntityRegistry;
  readonly catalog: AliasCatalog;
  readonly ingest: StateIngestOptions;
  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;

  /** The fields of package entity types, for custom aliases. */
  readonly customFields?: CustomFieldsLookup;

  /** Runs code parts; without it a code part fails, saying so. */
  readonly code?: AliasCodeRunner;

  /** Runs the steps of a part's actions; without it the actions do nothing. */
  readonly runActions?: RunActions;
};

/** Sends a command on to another entity, as the dispatcher does. */
export type AliasForward = (
  entityId: EntityId,
  capability: CapabilityName,
  command: JsonObject,
) => Promise<void>;

/** A failure while a part is worked out. */
class PartFailure extends Error {
  public readonly failure: AliasFailure;

  /**
   * @param failure - What and where.
   */
  public constructor(failure: AliasFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

/** What is known about an alias that is failing: since when, and how often. */
type FailingSince = { readonly message: string; readonly since: Date; count: number };

/** How long a failing alias's count waits before it is written again. */
const ERROR_WRITE_INTERVAL_MS = 60_000;

/**
 * No custom fields: for an engine that runs no custom alias.
 *
 * @returns Nothing.
 */
const NO_CUSTOM_FIELDS: CustomFieldsLookup = () => undefined;

/**
 * The alias engine: debounce, work out, and route commands.
 */
export class AliasEngine {
  readonly #options: AliasEngineOptions;
  readonly #timers = new Map<EntityId, ReturnType<typeof setTimeout>>();
  readonly #running = new Map<EntityId, Promise<void>>();
  readonly #again = new Set<EntityId>();

  /** Each failing alias's failure, by alias id; absent while it works. */
  readonly #failing = new Map<string, FailingSince & { writtenAt: number }>();

  /** The aliases whose evaluation has been written since `core` started. */
  readonly #written = new Set<string>();

  /** For a lamp with a colour and a colour temperature: the one set last. */
  readonly #active = new Map<EntityId, 'color' | 'color_temp'>();

  /** The aliases worked out at least once since `core` started: a change before that is none. */
  readonly #seen = new Set<string>();

  /** The actions of their parts. */
  readonly #actions: AliasActions;

  #minuteTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * @param options - Collaborators.
   */
  public constructor(options: AliasEngineOptions) {
    this.#options = options;
    this.#actions = new AliasActions({
      db: options.db,
      logger: options.logger,
      run: options.runActions,
      /**
       * An entity's reading, for a name an action's formula reads.
       *
       * @param name - The name.
       * @returns The reading, or null when there is none now.
       */
      bind: (name) => this.#binding(name, 'ignore_missing'),
      /**
       * Says something on the bus.
       *
       * @param subject - Where.
       * @param event - What.
       */
      publish: (subject, event) => {
        options.ingest.client.publish(subject, event);
      },
    });
  }

  /**
   * Loads every alias from the database into the catalogue, works each enabled one out once, and
   * starts the minute that re-runs code reading the time.
   *
   * @returns How many were loaded.
   */
  public async load(): Promise<number> {
    const aliases = await loadAliases(this.#options.db, this.#customFields());
    this.#options.catalog.replaceAll(aliases);

    for (const alias of aliases) {
      if (alias.isEnabled) {
        this.#schedule(alias, 0);
      }
    }

    this.#minuteTimer ??= setInterval(() => {
      this.#everyMinute();
    }, 60_000);
    this.#minuteTimer.unref();

    return aliases.length;
  }

  /** Stops the minute timer, every pending run's timer, and every action going. */
  public stop(): void {
    this.#actions.stop();

    if (this.#minuteTimer !== undefined) {
      clearInterval(this.#minuteTimer);
      this.#minuteTimer = undefined;
    }

    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }

    this.#timers.clear();
  }

  /**
   * Takes in one alias the API has just written or changed, and works it out at once.
   *
   * The rows are read back rather than handed over, so what runs is what was committed. The
   * directory learns the entity - its capabilities, whether it is enabled - so commands route
   * to it; the catalogue learns the definition, so what it reads wakes it.
   *
   * @param entityId - The alias entity.
   * @returns False when its rows are already gone - a removal overtook the request - and the
   * alias has been forgotten instead.
   */
  public async sync(entityId: EntityId): Promise<boolean> {
    const [alias, record] = await Promise.all([
      loadAlias(this.#options.db, entityId, this.#customFields()),
      loadEntityRecord(this.#options.db, entityId),
    ]);

    this.#cancel(entityId);

    if (alias === undefined || record === undefined) {
      this.#forget(entityId, record?.rowId);

      return false;
    }

    this.#options.code?.forget(alias.id);
    this.#actions.forget(alias.id);
    // A new setup: what the edit itself changes is not a change its actions answer.
    this.#seen.delete(alias.id);
    this.#options.directory.set(record);
    this.#options.catalog.upsert(alias);

    if (alias.isEnabled) {
      await this.recompute(alias);
    }

    return true;
  }

  /**
   * Deletes an alias and forgets it, in one step.
   *
   * @param entityId - The alias entity.
   * @throws {NotFoundError} When no alias is that entity.
   */
  public async remove(entityId: EntityId): Promise<void> {
    const alias = this.#options.catalog.getByEntity(entityId);
    const rowId = await eraseAlias(this.#options.db, entityId);

    this.#cancel(entityId);
    this.#forget(entityId, rowId);

    if (alias !== undefined) {
      this.#options.code?.forget(alias.id);
      this.#actions.forget(alias.id);
      this.#failing.delete(alias.id);
      this.#seen.delete(alias.id);
    }
  }

  /**
   * Schedules every alias that reads a changed entity, directly or through other aliases.
   *
   * @param entityId - The entity whose state just changed.
   */
  public onSourceChanged(entityId: EntityId): void {
    const descendants = aliasDescendants(this.#options.catalog.edges(), entityId);

    for (const aliasEntityId of descendants) {
      const alias = this.#options.catalog.getByEntity(aliasEntityId);

      if (alias?.isEnabled === true) {
        this.#schedule(alias, alias.debounceMs);
      }
    }
  }

  /**
   * Applies a command to an alias: stored parts take it here, entity parts have it forwarded, and
   * a part with an action for it runs that action instead of forwarding or refusing it.
   *
   * @param entityId - The alias entity.
   * @param capability - The capability named in the command.
   * @param command - The command body.
   * @param context - What caused it: the change it makes carries it.
   * @param forward - Sends the command on to an entity a part comes from.
   * @throws {ValidationError} When the alias is unknown or disabled, the command is not one it
   * takes, or a part it touches is worked out (a formula, code) and so cannot be set.
   */
  public async applyCommand(
    entityId: EntityId,
    capability: CapabilityName,
    command: JsonObject,
    context: ChangeContext | undefined,
    forward: AliasForward,
  ): Promise<void> {
    const alias = this.#options.catalog.getByEntity(entityId);

    if (alias === undefined) {
      throw new ValidationError(`Entity ${entityId} is derived and has no adapter to command`, {
        details: { entityId, source: 'derived' },
      });
    }

    if (!alias.isEnabled) {
      throw new ValidationError(`Entity ${entityId} is disabled`, { details: { entityId } });
    }

    const record = this.#options.directory.require(entityId);
    const previous = this.#options.registry.get(entityId)?.state ?? {};
    const name = typeof command['command'] === 'string' ? command['command'] : '';
    let next: CapabilityState;

    // A reading (a sensor, a text, a tracker) has no command of its own; a stored one takes
    // `set_value`, which only an alias accepts - a real sensor never sees it.
    if (name === 'set_value' && READINGS.has(capability)) {
      const def = alias.defs.find((candidate) => candidate.capability === capability);

      if (def === undefined) {
        throw new ValidationError(`${entityId} has no ${capability} to set`);
      }

      const reading: Record<string, unknown> = {
        ...(previous as Record<string, object | undefined>)[capability],
        [def.fields[0] ?? 'value']: command['value'],
      };

      next = { ...previous, [capability]: reading };
    } else {
      const validated = validateCommand(record, capability, command);
      next = applyCapabilityCommand(previous, capability, validated);
    }

    const touched = partsTouchedBy(alias.defs, alias.parts, capability, name);
    const acting = this.#actions.forCommand(alias, touched, command, context);
    const readOnly = touched.find((def) => {
      const from = alias.parts[def.key]?.from;
      return !acting.has(def.key) && (from === 'formula' || from === 'code');
    });

    if (readOnly !== undefined) {
      throw new ValidationError(
        `${readOnly.label} is worked out by ${alias.parts[readOnly.key]?.from === 'code' ? 'code' : 'a formula'}: it cannot be set`,
        { details: { entityId, part: readOnly.key } },
      );
    }

    // Forward first: when an entity refuses, nothing stored has changed.
    const targets = new Set<EntityId>();

    for (const def of touched) {
      const config = alias.parts[def.key];

      if (acting.has(def.key)) {
        // Its action does what the command does: sending it on is the action's, if it wants.
        continue;
      }

      if (config?.from === 'entity') {
        targets.add(config.entity);
      } else if (config?.from === 'entities') {
        config.entities.forEach((target) => targets.add(target));
      }
    }

    // eslint-disable-next-line no-await-in-loop -- each entity in turn, the first refusal stops it
    for (const target of targets) await forward(target, capability, command);

    const stored = new Map<string, JsonValue>();

    for (const def of touched) {
      const config = alias.parts[def.key];

      if (config?.from !== 'stored' || def.kind === 'press') {
        continue;
      }

      const value = readPart(def, next);

      if (value !== undefined) {
        stored.set(def.key, value as JsonValue);
      }
    }

    if (capability === 'color_hs' && name === 'set_color') {
      this.#active.set(entityId, 'color');
    } else if (capability === 'color_temp') {
      this.#active.set(entityId, 'color_temp');
    }

    if (stored.size > 0) {
      const parts = { ...alias.parts };

      for (const [key, value] of stored) {
        const config = parts[key];

        if (config?.from === 'stored') {
          parts[key] = { ...config, value: value as AliasPartValue };
        }
      }

      this.#options.catalog.upsert({ ...alias, parts });

      void storePartValues(this.#options.db, alias.id, stored).catch((cause: unknown) => {
        this.#options.logger.warn({ err: cause, entityId }, 'Could not keep the stored value');
      });

      await this.recompute(this.#options.catalog.getByEntity(entityId) ?? alias, context);
    } else if (targets.size === 0 && touched.some((def) => def.kind === 'press')) {
      // A stored press: nothing to hold, but the press is a change automations hear.
      ingestReport(
        this.#options.ingest,
        record,
        {
          entityId,
          state: previous,
          isAvailable: true,
          attributes: { pressedAt: new Date().toISOString() },
        },
        this.#options.newTraceId(),
        context,
      );
    }

    this.#actions.startForCommand(alias, acting, command, context);
  }

  /**
   * Works one alias out now and writes the result, after any run of it in progress.
   *
   * @param alias - The definition.
   * @param context - What caused it, when a command did.
   * @returns Once written.
   */
  public async recompute(alias: AliasDefinition, context?: ChangeContext): Promise<void> {
    const running = this.#running.get(alias.entityId);

    if (running !== undefined) {
      this.#again.add(alias.entityId);
      await running;
      return;
    }

    const run = this.#run(alias, context).finally(() => {
      this.#running.delete(alias.entityId);

      if (this.#again.delete(alias.entityId)) {
        const current = this.#options.catalog.getByEntity(alias.entityId);

        if (current?.isEnabled === true) {
          void this.recompute(current);
        }
      }
    });

    this.#running.set(alias.entityId, run);
    await run;
  }

  /**
   * Works one alias out: every part, then the state, then the write.
   *
   * @param alias - The definition.
   * @param context - What caused it, when a command did.
   */
  async #run(alias: AliasDefinition, context?: ChangeContext): Promise<void> {
    if (!alias.isEnabled) {
      return;
    }

    const record = this.#options.directory.get(alias.entityId);

    if (record === undefined) {
      return;
    }

    const previous = this.#options.registry.get(alias.entityId);
    const values = new Map<string, PartValue>();
    const capabilities = aliasCapabilities(alias.type, Object.keys(alias.parts));
    let state: CapabilityState;

    try {
      // Code parts last: their functions may read the other parts of this round.
      const ordered = [...alias.defs].sort(
        (a, b) =>
          Number(alias.parts[a.key]?.from === 'code') - Number(alias.parts[b.key]?.from === 'code'),
      );

      for (const def of ordered) {
        const config = alias.parts[def.key];

        if (config === undefined) {
          continue;
        }

        // eslint-disable-next-line no-await-in-loop -- in order: code reads the parts before it
        const value = await this.#partValue(alias, def, config, values, previous?.state);

        if (value !== undefined) {
          values.set(def.key, value);
        } else if (def.isRequired && def.kind !== 'press') {
          throw new PartFailure({ message: `${def.label} has no value`, part: def.key });
        }
      }

      state = assembleState(
        capabilities,
        alias.defs,
        alias.parts,
        values,
        this.#active.get(alias.entityId) ?? 'color_temp',
      );
    } catch (error: unknown) {
      const failure =
        error instanceof PartFailure
          ? error.failure
          : { message: error instanceof Error ? error.message : 'Could not be worked out' };

      this.#writeUnavailable(alias, failure);
      return;
    }

    const report: StateReport = {
      entityId: alias.entityId,
      state,
      isAvailable: true,
      attributes: {},
    };

    if (this.#seen.has(alias.id)) {
      this.#actions.onValues(alias, (def) => readPart(def, previous?.state), values, context);
    }

    this.#seen.add(alias.id);
    ingestReport(
      this.#options.ingest,
      record,
      report,
      this.#options.newTraceId(),
      context ?? { type: 'alias', id: alias.id },
    );
    void this.#persistEvaluation(alias, null);
  }

  /**
   * Works out one part from its source.
   *
   * @param alias - The alias.
   * @param def - The part.
   * @param config - Its source and settings.
   * @param values - The parts worked out so far this run.
   * @param previous - The alias's state before this run.
   * @returns The value, or undefined when there is none and the alias keeps going without it.
   * @throws {PartFailure} When the part cannot be worked out and the alias must say so.
   */
  async #partValue(
    alias: AliasDefinition,
    def: AliasPartDef,
    config: AliasPartConfig,
    values: ReadonlyMap<string, PartValue>,
    previous: CapabilityState | undefined,
  ): Promise<PartValue | undefined> {
    const policy = alias.fallbackPolicy;
    const kept = readPart(def, previous);

    switch (config.from) {
      case 'stored': {
        // What a command left in the state wins over the setup's value, which it also updates.
        return config.value ?? kept ?? (def.initial as PartValue);
      }
      case 'entity': {
        const source = this.#options.registry.get(config.entity);

        if (source?.isAvailable !== true) {
          if (policy === 'unavailable') {
            throw new PartFailure({
              message: `${config.entity} is ${source === undefined ? 'not in this house' : 'unavailable'}`,
              part: def.key,
            });
          }

          return policy === 'last_known' ? (readPart(def, source?.state) ?? kept) : kept;
        }

        const value = readPart(def, source.state);

        if (value === undefined) {
          throw new PartFailure({
            message: `${config.entity} gives nothing a ${def.label.toLowerCase()} can be`,
            part: def.key,
          });
        }

        return value;
      }
      case 'entities': {
        const present: PartValue[] = [];

        for (const target of config.entities) {
          const source = this.#options.registry.get(target);

          if (source?.isAvailable === true || policy === 'last_known') {
            const value = readPart(def, source?.state);

            if (value !== undefined) {
              present.push(value);
            }
          } else if (policy === 'unavailable') {
            throw new PartFailure({
              message: `${target} is ${source === undefined ? 'not in this house' : 'unavailable'}`,
              part: def.key,
            });
          }
        }

        return combine(config.rule, present) ?? kept;
      }
      case 'formula': {
        const bindings = new Map<string, AliasBinding>();

        for (const name of aliasExpressionNames(config.formula)) {
          bindings.set(name, this.#binding(name, policy));
        }

        const result = evaluateAliasExpression(config.formula, bindings);

        if (!result.ok) {
          throw new PartFailure({
            message: result.error,
            part: def.key,
            inputs: inputsOf(bindings),
          });
        }

        try {
          return fitPart(def, config, result.value);
        } catch (error: unknown) {
          throw new PartFailure({
            message: error instanceof Error ? error.message : 'Does not fit',
            part: def.key,
            inputs: inputsOf(bindings),
          });
        }
      }
      case 'code': {
        if (this.#options.code === undefined) {
          throw new PartFailure({ message: 'Code is not running here', part: def.key });
        }

        const ran = await this.#options.code.run(alias, def, config, values);

        if ('error' in ran) {
          throw new PartFailure({ ...ran.error, part: def.key });
        }

        if (ran.value === null) {
          return kept === undefined && def.isRequired ? undefined : (null as PartValue);
        }

        try {
          return fitPart(def, config, ran.value);
        } catch (error: unknown) {
          throw new PartFailure({
            message: error instanceof Error ? error.message : 'Does not fit',
            part: def.key,
            function: config.function,
          });
        }
      }
    }
  }

  /**
   * The value a formula name binds to: an entity's reading, or one of its fields.
   *
   * @param name - An entity id (`sensor.x`), or an entity id and a field (`climate.x.mode`).
   * @param policy - What a silent entity gives.
   * @returns The scalar, or null when there is none now.
   */
  #binding(name: string, policy: AliasDefinition['fallbackPolicy']): AliasBinding {
    const [domain, object, field] = name.split('.');
    const entityId = `${domain ?? ''}.${object ?? ''}` as EntityId;
    const source = this.#options.registry.get(entityId);

    if (source === undefined || (!source.isAvailable && policy !== 'last_known')) {
      return null;
    }

    const value =
      field === undefined ? aliasScalarFromState(source.state) : stateField(source.state, field);

    return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
      ? value
      : null;
  }

  /**
   * Re-runs every enabled alias whose code reads the time.
   */
  #everyMinute(): void {
    const code = this.#options.code;

    if (code === undefined) {
      return;
    }

    for (const alias of this.#options.catalog.all()) {
      if (alias.isEnabled && code.readsTime(alias)) {
        this.#schedule(alias, 0);
      }
    }
  }

  /**
   * Debounces working out one alias.
   *
   * The definition is looked up again when the timer fires rather than kept from when it was
   * set: an edit saved inside the debounce window must be what is worked out, and an alias
   * removed inside it must not be at all.
   *
   * @param alias - The definition.
   * @param delayMs - How long to wait.
   */
  #schedule(alias: AliasDefinition, delayMs: number): void {
    this.#cancel(alias.entityId);

    const timer = setTimeout(() => {
      this.#timers.delete(alias.entityId);

      const current = this.#options.catalog.getByEntity(alias.entityId);

      if (current !== undefined) {
        void this.recompute(current).catch((cause: unknown) => {
          this.#options.logger.warn({ err: cause, entityId: alias.entityId }, 'Alias run failed');
        });
      }
    }, delayMs);

    this.#timers.set(alias.entityId, timer);
  }

  /**
   * Drops a pending run of one alias.
   *
   * @param entityId - The alias entity.
   */
  #cancel(entityId: EntityId): void {
    const timer = this.#timers.get(entityId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(entityId);
    }
  }

  /**
   * Forgets everything held in memory about an alias whose rows are gone.
   *
   * @param entityId - The alias entity.
   * @param rowId - Its row id, when known, which buffered state writes are keyed by.
   */
  #forget(entityId: EntityId, rowId: string | undefined): void {
    this.#options.catalog.remove(entityId);
    this.#options.directory.remove(entityId);
    this.#options.registry.remove(entityId);
    this.#active.delete(entityId);

    if (rowId !== undefined) {
      this.#options.ingest.stateCache.discard((row) => row.entityId === rowId);
    }
  }

  /**
   * Marks an alias unavailable and records why.
   *
   * @param alias - The definition.
   * @param failure - Why it could not be worked out.
   */
  #writeUnavailable(alias: AliasDefinition, failure: AliasFailure): void {
    const record = this.#options.directory.get(alias.entityId);

    if (record === undefined) {
      return;
    }

    const previous = this.#options.registry.get(alias.entityId);
    const report: StateReport = {
      entityId: alias.entityId,
      state: previous?.state ?? {},
      isAvailable: false,
      attributes: {},
    };

    ingestReport(this.#options.ingest, record, report, this.#options.newTraceId(), {
      type: 'alias',
      id: alias.id,
    });
    void this.#persistEvaluation(alias, failure);
  }

  /**
   * Persists the last error and when it was worked out, without blocking the hot path: on every
   * change of whether it fails, and while it fails at most once a minute (for the count).
   *
   * @param alias - The alias.
   * @param failure - Why it failed, or null when it worked.
   */
  async #persistEvaluation(alias: AliasDefinition, failure: AliasFailure | null): Promise<void> {
    const now = Date.now();
    const known = this.#failing.get(alias.id);
    let flipped: boolean;
    let lastError: JsonObject | null = null;

    if (failure === null) {
      flipped = known !== undefined;
      this.#failing.delete(alias.id);
    } else {
      const same = known?.message === failure.message;
      const entry =
        known !== undefined && same
          ? { ...known, count: known.count + 1 }
          : { message: failure.message, since: new Date(now), count: 1, writtenAt: 0 };

      flipped = !same;

      if (!flipped && now - entry.writtenAt < ERROR_WRITE_INTERVAL_MS) {
        this.#failing.set(alias.id, entry);
        return;
      }

      entry.writtenAt = now;
      this.#failing.set(alias.id, entry);
      lastError = {
        message: failure.message,
        part: failure.part ?? null,
        function: failure.function ?? null,
        line: failure.line ?? null,
        column: failure.column ?? null,
        since: entry.since.toISOString(),
        count: entry.count,
        inputs: (failure.inputs ?? {}) as JsonObject,
      };
    }

    if (!flipped && failure === null && this.#written.has(alias.id)) {
      // Working, as it was: the evaluated-at time is not worth a write on every change.
      return;
    }

    this.#written.add(alias.id);

    try {
      await this.#options.db
        .update(schema.registry.aliases)
        .set({ lastError, lastEvaluatedAt: new Date(now) })
        .where(eq(schema.registry.aliases.id, alias.id));
    } catch (cause) {
      this.#options.logger.warn(
        { err: cause, aliasId: alias.id },
        'Failed to persist alias evaluation',
      );

      return;
    }

    if (flipped) {
      const event: LibraryEvent = { kind: 'aliases' };

      this.#options.ingest.client.publish(busSubjects.libraryEvent(), event);
    }
  }

  /**
   * The package entity types' fields, for custom aliases.
   *
   * @returns The lookup.
   */
  #customFields(): CustomFieldsLookup {
    return this.#options.customFields ?? NO_CUSTOM_FIELDS;
  }
}

/** The capabilities that are readings: a stored one is set with `set_value`. */
const READINGS: ReadonlySet<CapabilityName> = new Set([
  'sensor_numeric',
  'sensor_binary',
  'sensor_text',
  'location',
]);

/**
 * The values a formula read, for the failure's replay.
 *
 * @param bindings - The bindings.
 * @returns Them, as JSON.
 */
function inputsOf(bindings: ReadonlyMap<string, AliasBinding>): Record<string, JsonValue> {
  return Object.fromEntries(bindings);
}
