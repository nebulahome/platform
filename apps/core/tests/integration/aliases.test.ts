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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  ConflictError,
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
import { AliasEngine } from '@/services/alias-engine.js';
import { startAliasService } from '@/services/alias-service.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

const suffix = ulid().toLowerCase().slice(0, 10);
const helper = parseEntityId(`alias.helper_${suffix}`);
const doubled = parseEntityId(`alias.doubled_${suffix}`);

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let caller: BusClient;
let directory: EntityDirectory;
let registry: EntityRegistry;
let catalog: AliasCatalog;
let stateCache: BatchWriter<EntityStateRow>;
let serving: { unsubscribe: () => void }[];

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
 * Writes an alias's rows the way the API does: the entity, the definition, its sources and
 * its capabilities, and no state.
 *
 * @param entityId - The alias entity.
 * @param fields - The expression and the capability, and what it reads.
 * @param fields.expression - The formula, or the empty string for a stored helper.
 * @param fields.capability - The one capability it declares.
 * @param fields.sources - What the formula reads, by variable name and entity row.
 * @returns The entity's row id.
 */
async function writeAlias(
  entityId: EntityId,
  fields: {
    readonly expression: string;
    readonly capability: string;
    readonly sources?: readonly { variableName: string; rowId: string }[];
  },
): Promise<string> {
  const [entity] = await database.db
    .insert(schema.registry.entities)
    .values({
      entityId,
      source: 'derived',
      name: entityId,
      config: { alias: { domain: fields.expression === '' ? 'switch' : 'sensor' } },
    })
    .returning({ id: schema.registry.entities.id });

  if (entity === undefined) {
    throw new Error('Could not insert the alias entity');
  }

  const [alias] = await database.db
    .insert(schema.registry.aliases)
    .values({ entityId: entity.id, capability: fields.capability, expression: fields.expression })
    .returning({ id: schema.registry.aliases.id });

  if (alias === undefined) {
    throw new Error('Could not insert the alias row');
  }

  for (const source of fields.sources ?? []) {
    // One source per alias in these tests, written in order: the loop is only a way to write none.
    await database.db
      .insert(schema.registry.aliasSources)
      .values({ aliasId: alias.id, variableName: source.variableName, entityId: source.rowId });
  }

  await database.db
    .insert(schema.registry.entityCapabilities)
    .values({ entityId: entity.id, capability: fields.capability, params: {} });

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
  const engine = new AliasEngine({
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

  // The reader first: it restricts the deletion of what it reads.
  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, doubled));
  await database.db
    .delete(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, [helper, doubled]));

  await bus.close();
  await database.close();
});

describe('taking in an alias the API wrote', () => {
  it('routes to a stored helper and gives it a resting state, with no restart', async () => {
    await writeAlias(helper, { expression: '', capability: 'on_off' });

    expect(directory.get(helper)).toBeUndefined();
    expect(await sync(helper)).toBe(true);

    expect(directory.get(helper)?.capabilities.has('on_off')).toBe(true);
    expect(catalog.getByEntity(helper)?.expression).toBe('');
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
      expression: 'on ? 2 : 1',
      capability: 'sensor_numeric',
      sources: [{ variableName: 'on', rowId: source.id }],
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

describe('removing an alias', () => {
  it('refuses while another alias reads it, naming that alias, and keeps everything', async () => {
    const refusal = remove(helper);

    await expect(refusal).rejects.toBeInstanceOf(ConflictError);
    await expect(refusal).rejects.toMatchObject({
      details: { dependents: [{ entityId: doubled, name: doubled }] },
    });
    expect(directory.get(helper)).toBeDefined();
  });

  it('deletes the rows and forgets the alias in the same step', async () => {
    expect(await remove(doubled)).toBe(doubled);
    expect(await remove(helper)).toBe(helper);

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
