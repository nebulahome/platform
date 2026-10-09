/**
 * The automation engine and the scene engine in a running `core`, against a real broker and a
 * real database: a change wakes an automation, its command reaches the adapter, the change that
 * command produces is credited to the run, and every run leaves a row with its trace.
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
  applySceneReplySchema,
  busSubjects,
  CORE_APPLY_SCENE_METHOD,
  CORE_SERVICE,
  CORE_SYNC_AUTOMATION_METHOD,
  CORE_TRIGGER_AUTOMATION_METHOD,
  parseEntityId,
  syncAutomationReplySchema,
  triggerAutomationReplySchema,
  type AutomationDefinition,
} from '@nebulahome/contracts';
import { createDatabase, schema, type DatabaseHandle } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import type { CoreConfig } from '@/config.js';
import { CoreService } from '@/service.js';

import { FakeAdapter } from './support/fake-adapter.js';
import { insertFixture, removeFixture, type Fixture } from './support/fixtures.js';

const NATS_URL = 'nats://localhost:4222';
const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const suffix = ulid().toLowerCase().slice(0, 10);
const motion = parseEntityId(`binary_sensor.motion_${suffix}`);
const lamp = parseEntityId(`light.lamp_${suffix}`);
const relay = parseEntityId(`switch.relay_${suffix}`);

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'core-automations', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param callback - Called to accept the write.
       */
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

/**
 * Polls until a query returns rows that satisfy a predicate.
 *
 * @param query - The query.
 * @param predicate - What the rows must satisfy.
 * @param timeoutMs - How long to wait.
 * @returns The rows.
 */
async function until<TRow>(
  query: () => Promise<TRow[]>,
  predicate: (rows: TRow[]) => boolean,
  timeoutMs = 10_000,
): Promise<TRow[]> {
  const deadline = Date.now() + timeoutMs;
  let rows: TRow[] = [];

  while (Date.now() < deadline) {
    rows = await query();

    if (predicate(rows)) {
      return rows;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return rows;
}

describe('automations in a running core', () => {
  let database: DatabaseHandle;
  let bus: BusConnection;
  let service: CoreService;
  let adapter: FakeAdapter;
  let caller: BusClient;
  let fixture: Fixture;

  const packageId = `pkg-auto-${suffix}`;
  const ids: Record<string, string> = {};
  let sceneId = '';

  /**
   * Writes an automation row, as the API does.
   *
   * @param key - Its key.
   * @param definition - What it says.
   * @param mode - How it runs when woken while running; parallel lets it wake itself.
   * @returns Its id.
   */
  const insertAutomation = async (
    key: string,
    definition: AutomationDefinition,
    mode: 'single' | 'parallel' = 'single',
  ): Promise<string> => {
    const [row] = await database.db
      .insert(schema.registry.automations)
      .values({ key: `${key}_${suffix}`, name: key, definition, mode })
      .returning({ id: schema.registry.automations.id });

    if (row === undefined) {
      throw new Error(`Could not insert ${key}`);
    }

    ids[key] = row.id;

    return row.id;
  };

  /**
   * Reads one automation's runs.
   *
   * @param key - Which automation.
   * @returns Its run rows.
   */
  const runsOf = (key: string) =>
    database.db
      .select()
      .from(schema.history.automationRuns)
      .where(eq(schema.history.automationRuns.automationId, ids[key] ?? ''));

  beforeAll(async () => {
    database = createDatabase({
      connectionString: DATABASE_URL,
      applicationName: 'core-automations',
    });

    fixture = await insertFixture(database.db, packageId, [
      { entityId: motion, name: 'Motion', capabilities: { sensor_binary: {} } },
      { entityId: lamp, name: 'Lamp', capabilities: { on_off: {} } },
      { entityId: relay, name: 'Relay', capabilities: { on_off: {} } },
    ]);

    await insertAutomation('lamp_on_motion', {
      triggers: { type: 'state', entityId: motion, to: 'on' },
      then: [
        { type: 'command', entityId: lamp, capability: 'on_off', params: { command: 'turn_on' } },
      ],
    });
    await insertAutomation('never_true', {
      triggers: { type: 'manual' },
      if: { type: 'state', entityId: lamp, state: 'unavailable' },
      then: [
        { type: 'command', entityId: lamp, capability: 'on_off', params: { command: 'turn_off' } },
      ],
    });
    await insertAutomation(
      'toggles_itself',
      {
        triggers: { op: 'or', items: [{ type: 'manual' }, { type: 'state', entityId: relay }] },
        then: [
          { type: 'command', entityId: relay, capability: 'on_off', params: { command: 'toggle' } },
        ],
      },
      'parallel',
    );

    const [scene] = await database.db
      .insert(schema.registry.scenes)
      .values({ key: `lamp_off_${suffix}`, name: 'Lamp off' })
      .returning({ id: schema.registry.scenes.id });

    sceneId = scene?.id ?? '';
    await database.db.insert(schema.registry.sceneEntities).values({
      sceneId,
      entityId: fixture.rowIds.get(lamp) ?? '',
      targetState: { on_off: { isOn: false } },
    });

    await insertAutomation('applies_scene', {
      triggers: { type: 'manual' },
      then: [{ type: 'scene', sceneKey: `lamp_off_${suffix}` }],
    });

    bus = await connectBus({
      url: NATS_URL,
      name: 'core-automations',
      logger: silentLogger(),
      signal: AbortSignal.timeout(20_000),
    });

    adapter = new FakeAdapter({
      transport: bus.transport,
      packageId,
      logger: silentLogger(),
      entities: [
        { entityId: motion, state: { sensor_binary: { isOn: false } } },
        { entityId: lamp, state: { on_off: { isOn: false } } },
        { entityId: relay, state: { on_off: { isOn: false } } },
      ],
    });
    adapter.start();

    caller = new BusClient({
      transport: bus.transport,
      source: 'core-automations',
      logger: silentLogger(),
      requestTimeoutMs: 5000,
    });

    const config: CoreConfig = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL,
      NATS_URL,
      CORE_COMMAND_TIMEOUT_MS: 2000,
      CORE_HISTORY_FLUSH_INTERVAL_MS: 100,
      CORE_HISTORY_BATCH_SIZE: 1,
      CORE_TELEMETRY_BATCH_SIZE: 100,
      CORE_SYSTEM_SAMPLE_INTERVAL_MS: 1000,
      CORE_SYSTEM_PUBLISH_INTERVAL_MS: 1000,
      CORE_NET_DEV_PATH: '/proc/net/dev',
      CORE_AUTOMATION_STARTUP_GRACE_MS: 0,
    };

    service = new CoreService({ config, db: database.db, bus, logger: silentLogger() });
    await service.start();

    // Let the startup resynchronisation report every entity before anything changes.
    await until(
      () => Promise.resolve([service.registry.get(relay)]),
      (rows) => rows[0] !== undefined,
    );
  });

  afterAll(async () => {
    adapter.stop();
    await service.stop();
    await bus.close();

    const automationIds = Object.values(ids);

    await database.db
      .delete(schema.history.automationRuns)
      .where(inArray(schema.history.automationRuns.automationId, automationIds));
    await database.db
      .delete(schema.registry.automations)
      .where(inArray(schema.registry.automations.id, automationIds));
    await database.db.delete(schema.registry.scenes).where(eq(schema.registry.scenes.id, sceneId));
    await removeFixture(database.db, fixture);
    await database.close();
  });

  it('turns the lamp on when motion is seen, and credits the change to the run', async () => {
    adapter.report(motion, { sensor_binary: { isOn: true } });

    const runs = await until(
      () => runsOf('lamp_on_motion'),
      (rows) => rows.length > 0,
    );

    expect(adapter.received.some((command) => command.entityId === lamp)).toBe(true);
    expect(runs[0]).toMatchObject({ result: 'success', trigger: { kind: 'state', to: 'on' } });
    expect((runs[0]?.trace as { type: string }[]).map((step) => step.type)).toEqual([
      'state',
      'command',
    ]);

    const history = await until(
      () =>
        database.db
          .select()
          .from(schema.history.stateHistory)
          .where(eq(schema.history.stateHistory.entityId, fixture.rowIds.get(lamp) ?? '')),
      (rows) => rows.some((row) => row.contextType === 'automation'),
    );

    expect(history.find((row) => row.contextType === 'automation')?.contextId).toBe(runs[0]?.id);
  });

  it('runs on request, and records a run whose checks said no as skipped', async () => {
    const reply = await caller.request(
      busSubjects.service(CORE_SERVICE, CORE_TRIGGER_AUTOMATION_METHOD),
      { automationId: ids['never_true'] },
      triggerAutomationReplySchema,
    );

    expect(reply.outcome).toBe('started');

    const runs = await until(
      () => runsOf('never_true'),
      (rows) => rows.length > 0,
    );

    expect(runs[0]).toMatchObject({ id: reply.runId, result: 'condition_not_met' });
  });

  it('stops an automation that keeps waking itself', async () => {
    await caller.request(
      busSubjects.service(CORE_SERVICE, CORE_TRIGGER_AUTOMATION_METHOD),
      { automationId: ids['toggles_itself'] },
      triggerAutomationReplySchema,
    );

    const runs = await until(
      () => runsOf('toggles_itself'),
      (rows) => rows.some((row) => row.result === 'failed'),
    );
    const refused = runs.find((row) => row.result === 'failed');

    expect(refused?.error).toMatch(/waking itself/);
    expect(adapter.received.filter((command) => command.entityId === relay).length).toBeLessThan(6);
  });

  it('applies a scene from an automation, through the scene engine', async () => {
    await caller.request(
      busSubjects.service(CORE_SERVICE, CORE_TRIGGER_AUTOMATION_METHOD),
      { automationId: ids['applies_scene'] },
      triggerAutomationReplySchema,
    );

    const runs = await until(
      () => runsOf('applies_scene'),
      (rows) => rows.length > 0,
    );

    expect(runs[0]).toMatchObject({ result: 'success' });
    expect(adapter.received.at(-1)).toMatchObject({
      entityId: lamp,
      command: { command: 'turn_off' },
    });
  });

  it('applies a scene for the API, leaving alone what it is told to skip', async () => {
    const reply = await caller.request(
      busSubjects.service(CORE_SERVICE, CORE_APPLY_SCENE_METHOD),
      {
        sceneId,
        skip: [{ entityId: lamp, reason: 'You may not control this entity' }],
        context: { type: 'scene', id: sceneId },
        deadlineMs: 10_000,
      },
      applySceneReplySchema,
    );

    expect(reply).toMatchObject({
      applied: 0,
      failed: 1,
      members: [{ entityId: lamp, error: 'You may not control this entity', sent: [] }],
    });
  });

  it('takes in an edited automation, and lets a disabled one go', async () => {
    await database.db
      .update(schema.registry.automations)
      .set({ isEnabled: false })
      .where(eq(schema.registry.automations.id, ids['lamp_on_motion'] ?? ''));

    const reply = await caller.request(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_AUTOMATION_METHOD),
      { automationId: ids['lamp_on_motion'] },
      syncAutomationReplySchema,
    );

    expect(reply).toEqual({ isLoaded: false, problems: [] });
  });
});
