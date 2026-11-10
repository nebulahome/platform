/**
 * `core` taking in an alias the API wrote, and removing one.
 *
 * The API writes an alias's rows; until `core` is told, the directory does not route to it and
 * the catalogue does not recompute it. These tests write the rows the way the API does, ask on
 * the bus, and check what `core` then holds - and that removing goes through `core` in one step.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { Writable } from 'node:stream';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_REMOVE_ALIAS_METHOD,
  CORE_SERVICE,
  CORE_SYNC_ALIAS_METHOD,
  parseEntityId,
  removeAliasReplySchema,
  syncAliasReplySchema,
  type EntityId,
} from '@nebulahome/contracts';
import { createDatabase, schema, type Database } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { AliasCatalog } from '@/domain/alias-catalog.js';
import { EntityDirectory } from '@/domain/entity-directory.js';
import { EntityRegistry } from '@/domain/entity-registry.js';
import type { BatchWriter } from '@/persistence/batch-writer.js';
import {
  createHistoryWriter,
  createStateCacheWriter,
  type EntityStateRow,
} from '@/persistence/history-writer.js';
import { AliasCodeRuntime } from '@/services/alias-code-runtime.js';
import { AliasEngine } from '@/services/alias-engine.js';
import { startAliasService } from '@/services/alias-service.js';
import type { ActionsRunRequest } from '@/services/automation-engine.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

const suffix = ulid().toLowerCase().slice(0, 10);
const helper = parseEntityId(`alias.helper_${suffix}`);
const doubled = parseEntityId(`alias.doubled_${suffix}`);
const counter = parseEntityId(`alias.counter_${suffix}`);
const acting = parseEntityId(`alias.acting_${suffix}`);

let helperRowId: string | undefined;
let code: AliasCodeRuntime;
let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let caller: BusClient;
let directory: EntityDirectory;
let registry: EntityRegistry;
let catalog: AliasCatalog;
let stateCache: BatchWriter<EntityStateRow>;
let serving: { unsubscribe: () => void }[];
let engine: AliasEngine;
let actingAliasId: string | undefined;

/** The steps of every action run `core` started, as the automation engine would get them. */
const actionRuns: ActionsRunRequest[] = [];

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'core-aliases', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * Writes an alias's rows the way the API does: the entity, the definition, what it reads and
 * its capabilities, and no state.
 *
 * @param entityId - The alias entity.
 * @param fields - What it behaves as, its parts, and what it reads.
 * @param fields.behavesAs - Its type.
 * @param fields.parts - Its parts.
 * @param fields.reads - The entity ids it reads.
 * @param fields.capabilities - The capabilities it declares, with their params.
 * @param fields.code - Its code, when a part comes from code.
 * @param fields.memory - What its code keeps between runs.
 * @returns The entity's row id.
 */
async function writeAlias(
  entityId: EntityId,
  fields: {
    readonly behavesAs: string;
    readonly parts: Record<string, unknown>;
    readonly reads?: readonly string[];
    readonly capabilities: Record<string, Record<string, unknown>>;
    readonly code?: string;
    readonly memory?: Record<string, unknown>;
  },
): Promise<string> {
  const [entity] = await database.db
    .insert(schema.registry.entities)
    .values({ entityId, source: 'derived', name: entityId })
    .returning({ id: schema.registry.entities.id });

  if (entity === undefined) {
    throw new Error('Could not insert the alias entity');
  }

  const [alias] = await database.db
    .insert(schema.registry.aliases)
    .values({
      entityId: entity.id,
      behavesAs: fields.behavesAs,
      parts: fields.parts,
      ...(fields.code === undefined ? {} : { code: fields.code }),
      ...(fields.memory === undefined ? {} : { memory: fields.memory }),
    })
    .returning({ id: schema.registry.aliases.id });

  if (alias === undefined) {
    throw new Error('Could not insert the alias row');
  }

  for (const read of fields.reads ?? []) {
    // One read per alias in these tests, written in order: the loop is only a way to write none.
    await database.db
      .insert(schema.registry.aliasReads)
      .values({ aliasId: alias.id, entityId: read });
  }

  for (const [capability, params] of Object.entries(fields.capabilities)) {
    await database.db
      .insert(schema.registry.entityCapabilities)
      .values({ entityId: entity.id, capability, params });
  }

  return entity.id;
}

/**
 * Asks `core` to take in an alias.
 *
 * @param entityId - The alias entity.
 * @returns Whether it was there to take in.
 */
async function sync(entityId: EntityId): Promise<boolean> {
  const reply = await caller.request(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_ALIAS_METHOD),
    { entityId },
    syncAliasReplySchema,
  );

  return reply.isLoaded;
}

/**
 * Asks `core` to remove an alias.
 *
 * @param entityId - The alias entity.
 * @returns What `core` says it removed.
 */
async function remove(entityId: EntityId): Promise<string> {
  const reply = await caller.request(
    busSubjects.service(CORE_SERVICE, CORE_REMOVE_ALIAS_METHOD),
    { entityId },
    removeAliasReplySchema,
  );

  return reply.entityId;
}

beforeAll(async () => {
  const logger = silent();
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'core-alias-test' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'core-aliases',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  directory = new EntityDirectory();
  registry = new EntityRegistry();
  catalog = new AliasCatalog();

  // Never started: what matters here is what is buffered, and a flush would write it.
  stateCache = createStateCacheWriter({ db: database.db, logger, batchSize: 1000 });

  const client = new BusClient({ transport: bus.transport, source: 'core', logger });

  code = new AliasCodeRuntime({ db: database.db, registry, directory, logger });

  engine = new AliasEngine({
    db: database.db,
    directory,
    registry,
    catalog,
    ingest: {
      client,
      registry,
      directory,
      history: createHistoryWriter({ db: database.db, logger, batchSize: 1000 }),
      stateCache,
      logger,
    },
    logger,
    newTraceId: () => ulid(),
    code,
    /**
     * Records an action run and says it went well, as the automation engine would.
     *
     * @param request - The steps and on whose behalf.
     * @returns A run that succeeded at once.
     */
    runActions: (request) => {
      actionRuns.push(request);
      const now = new Date();

      return Promise.resolve({
        result: 'success',
        error: null,
        steps: [],
        startedAt: now,
        finishedAt: now,
      });
    },
  });

  caller = new BusClient({
    transport: bus.transport,
    source: 'api',
    logger,
    requestTimeoutMs: 5000,
  });
  serving = startAliasService({ client, engine, logger });
});

afterAll(async () => {
  for (const subscription of serving) {
    subscription.unsubscribe();
  }

  await database.db
    .delete(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, [helper, doubled, counter, acting]));

  if (actingAliasId !== undefined) {
    await database.db
      .delete(schema.history.aliasActionRuns)
      .where(eq(schema.history.aliasActionRuns.aliasId, actingAliasId));
  }

  if (helperRowId !== undefined) {
    await database.db
      .delete(schema.history.telemetry)
      .where(eq(schema.history.telemetry.entityId, helperRowId));
  }

  await bus.close();
  await database.close();
});

describe('taking in an alias the API wrote', () => {
  it('routes to a stored switch and gives it its stored state, with no restart', async () => {
    await writeAlias(helper, {
      behavesAs: 'switch',
      parts: { on: { from: 'stored', value: false } },
      capabilities: { on_off: { isAssumed: false } },
    });

    expect(directory.get(helper)).toBeUndefined();
    expect(await sync(helper)).toBe(true);

    expect(directory.get(helper)?.capabilities.has('on_off')).toBe(true);
    expect(catalog.getByEntity(helper)?.parts['on']?.from).toBe('stored');
    expect(registry.get(helper)?.state).toEqual({ on_off: { isOn: false } });
    expect(stateCache.pending).toBe(1);
  });

  it('computes a calculated alias at once, from what its source holds', async () => {
    const [source] = await database.db
      .select({ id: schema.registry.entities.id })
      .from(schema.registry.entities)
      .where(eq(schema.registry.entities.entityId, helper));

    if (source === undefined) {
      throw new Error('The helper written above is missing');
    }

    await writeAlias(doubled, {
      behavesAs: 'sensor',
      parts: { value: { from: 'formula', formula: `${helper} ? 2 : 1` } },
      reads: [helper],
      capabilities: { sensor_numeric: {} },
    });

    expect(await sync(doubled)).toBe(true);
    expect(registry.get(doubled)?.state).toEqual({ sensor_numeric: { value: 1 } });
  });

  it('says so, and holds nothing, when the rows are already gone', async () => {
    const ghost = parseEntityId(`alias.ghost_${suffix}`);

    expect(await sync(ghost)).toBe(false);
    expect(directory.get(ghost)).toBeUndefined();
  });
});

describe('the actions of a part', () => {
  it('runs the action a command names instead of refusing it, and records the run', async () => {
    const scene = { type: 'scene', sceneKey: 'evening' };

    await writeAlias(acting, {
      behavesAs: 'switch',
      parts: {
        on: {
          from: 'formula',
          formula: 'true',
          actions: [{ id: 'off', when: { kind: 'command', command: 'turn_off' }, then: [scene] }],
        },
      },
      capabilities: { on_off: { isAssumed: false } },
    });
    expect(await sync(acting)).toBe(true);

    // Without an action, a part worked out by a formula still refuses what it has none for.
    await expect(
      engine.applyCommand(acting, 'on_off', { command: 'turn_on' }, undefined, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow(/cannot be set/u);

    await engine.applyCommand(acting, 'on_off', { command: 'turn_off' }, { type: 'user' }, () =>
      Promise.reject(new Error('Nothing is forwarded')),
    );

    expect(actionRuns.at(-1)?.steps).toEqual([scene]);

    const aliasId = catalog.getByEntity(acting)?.id ?? '';

    actingAliasId = aliasId;

    await vi.waitFor(async () => {
      const rows = await database.db
        .select()
        .from(schema.history.aliasActionRuns)
        .where(eq(schema.history.aliasActionRuns.aliasId, aliasId));

      expect(rows).toEqual([
        expect.objectContaining({ part: 'on', actionId: 'off', result: 'success' }),
      ]);
    });

    // Gone again, with the state it left waiting to be written.
    expect(await remove(acting)).toBe(acting);
  });
});

describe('a part from code', () => {
  it('runs its function over history, keeps its mem across a save and writes it', async () => {
    const [source] = await database.db
      .select({ id: schema.registry.entities.id })
      .from(schema.registry.entities)
      .where(eq(schema.registry.entities.entityId, helper));

    if (source === undefined) {
      throw new Error('The helper written above is missing');
    }

    helperRowId = source.id;

    const now = Date.now();

    await database.db.insert(schema.history.telemetry).values([
      { time: new Date(now - 5 * 60_000), entityId: source.id, value: 1 },
      { time: new Date(now - 60_000), entityId: source.id, value: 3 },
    ]);

    const rowId = await writeAlias(counter, {
      behavesAs: 'sensor',
      parts: { value: { from: 'code', function: 'value' } },
      code: [
        'def value():',
        '    mem["runs"] = (mem["runs"] or 0) + 1',
        `    return mem["runs"] * 10 + avg_over("${helper}", 60)`,
        '',
      ].join('\n'),
      memory: { runs: 2 },
      capabilities: { sensor_numeric: {} },
    });
    const [alias] = await database.db
      .select({ id: schema.registry.aliases.id })
      .from(schema.registry.aliases)
      .where(eq(schema.registry.aliases.entityId, rowId));

    if (alias === undefined) {
      throw new Error('The code alias was not written');
    }

    const aliasId = alias.id;

    /**
     * The mem the alias's row holds.
     *
     * @returns The memory column.
     */
    const stored = async (): Promise<unknown> =>
      (
        await database.db
          .select({ memory: schema.registry.aliases.memory })
          .from(schema.registry.aliases)
          .where(eq(schema.registry.aliases.id, aliasId))
      )[0]?.memory;

    expect(await sync(counter)).toBe(true);
    expect(registry.get(counter)?.state).toEqual({ sensor_numeric: { value: 32 } });

    await code.flush();
    expect(await stored()).toEqual({ runs: 3 });

    // Saved again with the mem as it was: the run goes on from it.
    expect(await sync(counter)).toBe(true);
    expect(registry.get(counter)?.state).toEqual({ sensor_numeric: { value: 42 } });

    // The API resets the mem: the row's wins.
    await database.db
      .update(schema.registry.aliases)
      .set({ memory: {} })
      .where(eq(schema.registry.aliases.id, aliasId));
    expect(await sync(counter)).toBe(true);
    expect(registry.get(counter)?.state).toEqual({ sensor_numeric: { value: 12 } });

    await code.flush();
    expect(await stored()).toEqual({ runs: 1 });
    expect(await remove(counter)).toBe(counter);
  });
});

describe('a device that goes', () => {
  it('leaves its aliases on the shared Aliases device, which itself cannot go', async () => {
    const lamp = parseEntityId(`alias.lamp_${suffix}`);
    const [device] = await database.db
      .insert(schema.registry.devices)
      .values({ source: 'virtual', externalId: `lamp_${suffix}`, name: 'Lamp' })
      .returning({ id: schema.registry.devices.id });
    const [shared] = await database.db
      .select({ id: schema.registry.devices.id })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.externalId, 'aliases'));

    if (device === undefined || shared === undefined) {
      throw new Error('Could not write the devices');
    }

    await database.db
      .insert(schema.registry.entities)
      .values({ entityId: lamp, source: 'derived', name: 'Lamp', deviceId: device.id });
    await database.db
      .delete(schema.registry.devices)
      .where(eq(schema.registry.devices.id, device.id));

    const [moved] = await database.db
      .select({ deviceId: schema.registry.entities.deviceId })
      .from(schema.registry.entities)
      .where(eq(schema.registry.entities.entityId, lamp));

    await database.db
      .delete(schema.registry.entities)
      .where(eq(schema.registry.entities.entityId, lamp));

    expect(moved?.deviceId).toBe(shared.id);
    await expect(
      database.db.delete(schema.registry.devices).where(eq(schema.registry.devices.id, shared.id)),
    ).rejects.toThrow();
  });
});

describe('removing an alias', () => {
  it('deletes the rows and forgets the alias in the same step, even one another reads', async () => {
    expect(await remove(helper)).toBe(helper);
    expect(await remove(doubled)).toBe(doubled);

    const rows = await database.db
      .select({ id: schema.registry.entities.id })
      .from(schema.registry.entities)
      .where(inArray(schema.registry.entities.entityId, [helper, doubled]));

    expect(rows).toEqual([]);
    expect(directory.get(helper)).toBeUndefined();
    expect(catalog.getByEntity(doubled)).toBeUndefined();
    expect(registry.get(helper)).toBeUndefined();
    expect(stateCache.pending).toBe(0);
  });
});
