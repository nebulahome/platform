/**
 * Recomputing calculated aliases when their sources change, and applying commands to stored ones.
 *
 * Calculated aliases are read-only: the engine writes their state after evaluating the formula.
 * Stored helpers accept commands here in `core` and never forward them to an adapter
 * (ARCHITECTURE.md §6.3).
 *
 * **An alias changes while `core` runs.** The API writes an alias's rows and then asks the
 * engine to take them in ({@link AliasEngine.sync}); removing one goes through the engine
 * ({@link AliasEngine.remove}), which deletes the rows and forgets the alias in the same step.
 * Without either, an alias made in the interface would do nothing until the next restart - a
 * formula never computed, a helper whose switch answers "not registered" - and one removed
 * would go on being recomputed into rows that no longer exist.
 */
import { eq } from 'drizzle-orm';

import {
  ValidationError,
  type CapabilityName,
  type CapabilityState,
  type EntityId,
  type JsonObject,
  type StateReport,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import { isStoredAlias, type AliasCatalog, type AliasDefinition } from '../domain/alias-catalog.js';
import {
  aliasScalarFromState,
  evaluateAliasExpression,
  type AliasScalar,
} from '../domain/alias-expression.js';
import { aliasDescendants } from '../domain/alias-graph.js';
import { validateCommand } from '../domain/command-validation.js';
import type { EntityDirectory, EntityRecord } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';
import { eraseAlias, loadAlias, loadAliases } from '../persistence/alias-loader.js';
import { loadEntityRecord } from '../persistence/registry-loader.js';

import { ingestReport, type StateIngestOptions } from './state-ingest.js';

/** What the engine needs to run. */
export type AliasEngineOptions = {
  readonly db: Database;
  readonly directory: EntityDirectory;
  readonly registry: EntityRegistry;
  readonly catalog: AliasCatalog;
  readonly ingest: StateIngestOptions;
  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;
};

/** Command for a stored numeric alias — not on the shared sensor_numeric schema. */
const storedNumberCommandSchema = {
  /**
   * Validates `{ command: 'set_value', value: number }` against the alias's min/max.
   *
   * @param alias - The stored number helper.
   * @param command - The raw command object.
   * @returns The numeric value to write.
   * @throws {ValidationError} When the command is not `set_value`, or the value is out of bounds.
   */
  parse(alias: AliasDefinition, command: JsonObject): number {
    if (command['command'] !== 'set_value' || typeof command['value'] !== 'number') {
      throw new ValidationError('Stored number aliases accept only set_value with a number', {
        details: { entityId: alias.entityId },
      });
    }

    const value = command['value'];

    if (!Number.isFinite(value)) {
      throw new ValidationError('set_value requires a finite number', {
        details: { entityId: alias.entityId },
      });
    }

    if (alias.min !== null && value < alias.min) {
      throw new ValidationError(`Value must be at least ${String(alias.min)}`, {
        details: { entityId: alias.entityId },
      });
    }

    if (alias.max !== null && value > alias.max) {
      throw new ValidationError(`Value must be at most ${String(alias.max)}`, {
        details: { entityId: alias.entityId },
      });
    }

    return value;
  },
};

/**
 * The alias engine: debounce, recompute, and local command application.
 */
export class AliasEngine {
  readonly #options: AliasEngineOptions;
  readonly #timers = new Map<EntityId, ReturnType<typeof setTimeout>>();

  /**
   * @param options - Collaborators.
   */
  public constructor(options: AliasEngineOptions) {
    this.#options = options;
  }

  /**
   * Loads every alias from the database into the catalogue.
   *
   * @returns How many were loaded.
   */
  public async load(): Promise<number> {
    const aliases = await loadAliases(this.#options.db);
    this.#options.catalog.replaceAll(aliases);
    return aliases.length;
  }

  /**
   * Takes in one alias the API has just written or changed.
   *
   * The rows are read back rather than handed over, so what runs is what was committed. The
   * directory learns the entity - its capabilities, whether it is enabled - so commands route
   * to it; the catalogue learns the definition, so its sources wake it. A stored helper that
   * has never held a state starts from a resting one, written through ingest like any other,
   * which keeps `core` the one writer of entity state; a calculated alias is computed at once
   * rather than on its sources' next report, which for a slow sensor could be an hour away.
   *
   * @param entityId - The alias entity.
   * @returns False when its rows are already gone - a removal overtook the request - and the
   * alias has been forgotten instead.
   */
  public async sync(entityId: EntityId): Promise<boolean> {
    const [alias, record] = await Promise.all([
      loadAlias(this.#options.db, entityId),
      loadEntityRecord(this.#options.db, entityId),
    ]);

    this.#cancel(entityId);

    if (alias === undefined || record === undefined) {
      this.#forget(entityId, record?.rowId);

      return false;
    }

    this.#options.directory.set(record);
    this.#options.catalog.upsert(alias);

    if (!alias.isEnabled) {
      return true;
    }

    if (!isStoredAlias(alias)) {
      this.recompute(alias);
    } else if (this.#options.registry.get(entityId) === undefined) {
      const report: StateReport = {
        entityId,
        state: restingState(record, alias),
        isAvailable: true,
        attributes: {},
      };

      ingestReport(this.#options.ingest, record, report, this.#options.newTraceId());
    }

    return true;
  }

  /**
   * Deletes an alias and forgets it, in one step.
   *
   * The rows first: a refusal - another alias still reads this one - must leave everything as
   * it was. Then what `core` holds, directory before buffered writes, so that a recomputation
   * already on its way is refused by the directory rather than buffered behind the drop.
   *
   * @param entityId - The alias entity.
   * @throws {NotFoundError} When no alias produces that entity.
   * @throws {ConflictError} When another alias reads it; the details name those aliases.
   */
  public async remove(entityId: EntityId): Promise<void> {
    const rowId = await eraseAlias(this.#options.db, entityId);

    this.#cancel(entityId);
    this.#forget(entityId, rowId);
  }

  /**
   * Drops a pending recomputation of one alias.
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

    if (rowId !== undefined) {
      this.#options.ingest.stateCache.discard((row) => row.entityId === rowId);
    }
  }

  /**
   * Schedules recomputation of every calculated alias that depends on a changed entity.
   *
   * @param entityId - The entity whose state just changed.
   */
  public onSourceChanged(entityId: EntityId): void {
    const descendants = aliasDescendants(this.#options.catalog.edges(), entityId);

    for (const aliasEntityId of descendants) {
      const alias = this.#options.catalog.getByEntity(aliasEntityId);

      if (alias === undefined || !alias.isEnabled || isStoredAlias(alias)) {
        continue;
      }

      this.#schedule(alias);
    }
  }

  /**
   * Applies a command to a stored alias entity in core, without forwarding to a hub.
   *
   * @param entityId - The alias entity.
   * @param capability - The capability named in the command subject.
   * @param command - The command body.
   * @throws {ValidationError} When the entity is calculated, unknown, or the command is invalid.
   */
  public applyStoredCommand(
    entityId: EntityId,
    capability: CapabilityName,
    command: JsonObject,
  ): void {
    const alias = this.#options.catalog.getByEntity(entityId);

    if (alias === undefined) {
      throw new ValidationError(`Entity ${entityId} is derived and has no adapter to command`, {
        details: { entityId, source: 'derived' },
      });
    }

    if (!isStoredAlias(alias)) {
      throw new ValidationError(`Calculated alias ${entityId} rejects every command`, {
        details: { entityId },
      });
    }

    if (!alias.isEnabled) {
      throw new ValidationError(`Entity ${entityId} is disabled`, { details: { entityId } });
    }

    const record = this.#options.directory.require(entityId);
    let nextState: CapabilityState;

    // set_value exists only for a stored numeric alias row, not on sensor_numeric's shared
    // command schema — physical sensors never see it. The check is "this alias row is stored".
    if (capability === 'sensor_numeric' && alias.capability === 'sensor_numeric') {
      const value = storedNumberCommandSchema.parse(alias, command);
      nextState = {
        ...(this.#options.registry.get(entityId)?.state ?? {}),
        sensor_numeric: { value },
      };
    } else {
      const validated = validateCommand(record, capability, command);
      nextState = applyCapabilityCommand(
        this.#options.registry.get(entityId)?.state ?? {},
        capability,
        validated,
      );
    }

    const report: StateReport = {
      entityId,
      state: nextState,
      isAvailable: true,
      attributes: {},
    };

    ingestReport(this.#options.ingest, record, report, this.#options.newTraceId());
  }

  /**
   * Evaluates one calculated alias immediately and writes the result.
   *
   * @param alias - The definition.
   */
  public recompute(alias: AliasDefinition): void {
    if (isStoredAlias(alias) || !alias.isEnabled) {
      return;
    }

    const record = this.#options.directory.get(alias.entityId);

    if (record === undefined) {
      return;
    }

    const bindings = new Map<string, AliasScalar>();
    let missing = false;
    let anyAvailable = false;

    for (const source of alias.sources) {
      const current = this.#options.registry.get(source.entityId);

      if (!current?.isAvailable) {
        missing = true;

        if (alias.fallbackPolicy === 'ignore_missing') {
          continue;
        }

        if (alias.fallbackPolicy === 'last_known') {
          const scalar = aliasScalarFromState(current?.state);

          if (scalar !== undefined) {
            bindings.set(source.variableName, scalar);
            anyAvailable = true;
          }

          continue;
        }

        this.#writeUnavailable(alias, 'A source entity is unavailable');
        return;
      }

      const scalar = aliasScalarFromState(current.state);

      if (scalar === undefined) {
        missing = true;

        if (alias.fallbackPolicy === 'unavailable') {
          this.#writeUnavailable(alias, 'A source entity has no usable reading');
          return;
        }

        continue;
      }

      bindings.set(source.variableName, scalar);
      anyAvailable = true;
    }

    if (missing && alias.fallbackPolicy === 'ignore_missing' && !anyAvailable) {
      this.#writeUnavailable(alias, 'Every source entity is missing');
      return;
    }

    if (missing && alias.fallbackPolicy === 'last_known' && bindings.size < alias.sources.length) {
      // last_known with a partial set still evaluates what it has; if nothing bound, hold state.
      if (bindings.size === 0) {
        return;
      }
    }

    const evaluated = evaluateAliasExpression(alias.expression, bindings);

    if (!evaluated.ok) {
      this.#writeUnavailable(alias, evaluated.error);
      return;
    }

    const state = stateForCapability(alias.capability, evaluated.value);

    if (state === null) {
      this.#writeUnavailable(alias, 'Expression result does not match the capability');
      return;
    }

    const report: StateReport = {
      entityId: alias.entityId,
      state,
      isAvailable: true,
      attributes: {},
    };

    ingestReport(this.#options.ingest, record, report, this.#options.newTraceId());
    void this.#persistEvaluation(alias.id, null);
  }

  /**
   * Debounces recomputation for one alias.
   *
   * The definition is looked up again when the timer fires rather than kept from when it was
   * set: an edit saved inside the debounce window must be what is computed, and an alias
   * removed inside it must not be computed at all.
   *
   * @param alias - The definition.
   */
  #schedule(alias: AliasDefinition): void {
    this.#cancel(alias.entityId);

    const timer = setTimeout(() => {
      this.#timers.delete(alias.entityId);

      const current = this.#options.catalog.getByEntity(alias.entityId);

      if (current !== undefined) {
        this.recompute(current);
      }
    }, alias.debounceMs);

    this.#timers.set(alias.entityId, timer);
  }

  /**
   * Marks an alias unavailable and records the error.
   *
   * @param alias - The definition.
   * @param error - Why it failed.
   */
  #writeUnavailable(alias: AliasDefinition, error: string): void {
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

    ingestReport(this.#options.ingest, record, report, this.#options.newTraceId());
    void this.#persistEvaluation(alias.id, error);
  }

  /**
   * Persists last_error / last_evaluated_at without blocking the hot path.
   *
   * @param aliasId - The aliases row id.
   * @param error - The error message, or null on success.
   */
  async #persistEvaluation(aliasId: string, error: string | null): Promise<void> {
    try {
      await this.#options.db
        .update(schema.registry.aliases)
        .set({
          lastError: error,
          lastEvaluatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.registry.aliases.id, aliasId));
    } catch (cause) {
      this.#options.logger.warn({ err: cause, aliasId }, 'Failed to persist alias evaluation');
    }
  }
}

/**
 * Builds capability state from a scalar formula result.
 *
 * @param capability - The alias's primary capability.
 * @param value - The evaluated scalar.
 * @returns The state fragment, or null when the types do not match.
 */
export function stateForCapability(
  capability: CapabilityName,
  value: AliasScalar,
): CapabilityState | null {
  switch (capability) {
    case 'sensor_numeric':
      return typeof value === 'number' ? { sensor_numeric: { value } } : null;
    case 'sensor_binary':
      return typeof value === 'boolean' ? { sensor_binary: { isOn: value } } : null;
    case 'sensor_text':
      return typeof value === 'string'
        ? { sensor_text: { value: value.slice(0, 512) } }
        : { sensor_text: { value: String(value).slice(0, 512) } };
    default:
      return null;
  }
}

/**
 * The state a stored helper starts from, before anybody has commanded it: off, closed,
 * unlocked, idle, and a number at its lower bound - or zero, when zero is within its bounds.
 *
 * @param record - The helper's entity, whose declared capabilities say what it holds.
 * @param alias - Its definition, whose bounds a stored number starts within.
 * @returns The resting state.
 */
export function restingState(record: EntityRecord, alias: AliasDefinition): CapabilityState {
  const declared = record.capabilities;
  const state: CapabilityState = {};

  if (declared.has('on_off')) {
    state.on_off = { isOn: false };
  }

  if (declared.has('level')) {
    state.level = { level: 0 };
  }

  if (declared.has('sensor_numeric')) {
    const low = alias.min ?? 0;

    state.sensor_numeric = { value: alias.max !== null && low > alias.max ? alias.max : low };
  }

  if (declared.has('cover')) {
    state.cover = { position: 0, motion: 'stopped' };
  }

  if (declared.has('lock')) {
    state.lock = { lockState: 'unlocked' };
  }

  if (declared.has('thermostat')) {
    state.thermostat = {
      currentTemperature: 20,
      targetTemperature: 20,
      mode: 'off',
      action: 'off',
    };
  }

  if (declared.has('media_player')) {
    state.media_player = { playback: 'idle', volume: 0, isMuted: false };
  }

  return state;
}

/**
 * Applies a validated capability command to the previous state.
 *
 * @param previous - The entity's current capability state.
 * @param capability - Which capability was commanded.
 * @param command - The validated command object.
 * @returns The next capability state.
 * @throws {ValidationError} When the capability is not one a stored helper holds.
 */
function applyCapabilityCommand(
  previous: CapabilityState,
  capability: CapabilityName,
  command: JsonObject,
): CapabilityState {
  const next: CapabilityState = { ...previous };
  const name = command['command'];

  switch (capability) {
    case 'on_off': {
      const isOn =
        name === 'turn_on' ? true : name === 'turn_off' ? false : !(previous.on_off?.isOn ?? false);
      next.on_off = { isOn };
      break;
    }
    case 'level':
      next.level = { level: Number(command['level']) };
      break;
    case 'color_hs':
      next.color_hs = { hue: Number(command['hue']), saturation: Number(command['saturation']) };
      break;
    case 'color_temp':
      next.color_temp = { mireds: Number(command['mireds']) };
      break;
    case 'cover': {
      const position =
        name === 'open'
          ? 100
          : name === 'close'
            ? 0
            : name === 'set_position'
              ? Number(command['position'])
              : (previous.cover?.position ?? 0);
      const tilt = name === 'set_tilt' ? Number(command['tilt']) : previous.cover?.tilt;
      next.cover = {
        position,
        ...(tilt === undefined ? {} : { tilt }),
        motion:
          name === 'stop'
            ? 'stopped'
            : name === 'open'
              ? 'opening'
              : name === 'close'
                ? 'closing'
                : 'stopped',
      };
      break;
    }
    case 'lock':
      next.lock = { lockState: name === 'lock' ? 'locked' : 'unlocked' };
      break;
    case 'thermostat': {
      const current = previous.thermostat ?? {
        currentTemperature: 20,
        targetTemperature: 20,
        mode: 'off' as const,
        action: 'off' as const,
      };
      next.thermostat = {
        ...current,
        ...(name === 'set_target' ? { targetTemperature: Number(command['temperature']) } : {}),
        ...(name === 'set_mode' && typeof command['mode'] === 'string'
          ? { mode: command['mode'] as typeof current.mode }
          : {}),
      };
      break;
    }
    case 'media_player': {
      const current = previous.media_player ?? {
        playback: 'idle' as const,
        volume: 0,
        isMuted: false,
      };
      next.media_player = {
        ...current,
        ...(name === 'play' ? { playback: 'playing' as const } : {}),
        ...(name === 'pause' ? { playback: 'paused' as const } : {}),
        ...(name === 'stop' ? { playback: 'stopped' as const } : {}),
        ...(name === 'set_volume' ? { volume: Number(command['volume']) } : {}),
        ...(name === 'set_mute' ? { isMuted: Boolean(command['isMuted']) } : {}),
        ...(name === 'set_source' && typeof command['source'] === 'string'
          ? { source: command['source'] }
          : {}),
      };
      break;
    }
    default:
      throw new ValidationError(`Capability ${capability} cannot be commanded on a stored alias`);
  }

  return next;
}
