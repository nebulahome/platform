/**
 * Automations through the API against a real database: a write tells `core`, Run asks it, and
 * the runs `core` wrote are read back - the latest on the automation, the rest a page at a time.
 *
 * `core` here is the harness's: it records what it was asked. The runs are written straight into
 * `history.automation_runs`, as `core` writes them.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  automationRunSchema,
  automationViewSchema,
  pageSchema,
  triggerAutomationReplySchema,
} from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import {
  automationsSynced,
  automationsTriggered,
  bearerFor,
  buildTestServer,
  stopHub,
} from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const suffix = randomUUID().slice(0, 8).replaceAll('-', '_');
const userId = randomUUID();
const writer = [
  { key: 'automation:read', scope: '*' },
  { key: 'automation:write', scope: '*' },
  { key: 'automation:trigger', scope: '*' },
];

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let automationId = '';

/**
 * Calls the API as a person holding the given grants.
 *
 * @param method - The method.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @returns The status and the body.
 */
async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: await bearerFor(userId, ...writer) },
    ...(payload === undefined ? {} : { payload }),
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-automations' });
  // `created_by` names a real user: the one pressing save, here a throwaway one.
  const [role] = await database.db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .limit(1);

  await database.db.insert(schema.auth.users).values({
    id: userId,
    username: `auto_${suffix}`,
    displayName: 'Automations',
    passwordHash: 'x',
    roleId: role?.id ?? '',
  });
  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();
  await database.db
    .delete(schema.history.automationRuns)
    .where(eq(schema.history.automationRuns.automationId, automationId));
  await database.db
    .delete(schema.registry.automations)
    .where(eq(schema.registry.automations.id, automationId));
  await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, userId));
  await database.close();
});

describe('automations through the API', () => {
  it('creates one and tells core', async () => {
    const { status, body } = await call('POST', '/automations', {
      key: `evening_${suffix}`,
      name: 'Evening',
      definition: {
        triggers: { type: 'manual' },
        then: [{ type: 'wait_duration', durationMs: 1000 }],
      },
    });

    expect(status).toBe(201);

    const automation = automationViewSchema.parse(body);

    automationId = automation.id;
    expect(automation.lastRun).toBeNull();
    expect(automationsSynced).toContain(`sync:${automationId}`);
  });

  it('runs it on request, as the person who pressed Run', async () => {
    const { status, body } = await call('POST', `/automations/${automationId}/trigger`);

    expect(status).toBe(202);
    expect(triggerAutomationReplySchema.parse(body).outcome).toBe('started');
    expect(automationsTriggered.at(-1)).toEqual({ automationId, userId });
  });

  it('reads back the runs core wrote, newest first, and the latest on the automation', async () => {
    const at = (minutes: number): Date => new Date(Date.UTC(2026, 9, 9, 18, minutes));

    await database.db.insert(schema.history.automationRuns).values(
      [1, 2, 3].map((minute) => ({
        id: randomUUID(),
        automationId,
        time: at(minute),
        trigger: { kind: 'manual' },
        result: minute === 3 ? 'condition_not_met' : 'success',
        finishedAt: at(minute),
        durationMs: 5,
        trace: [],
      })),
    );

    const first = await call('GET', `/automations/${automationId}/runs?limit=2`);
    const page = pageSchema(automationRunSchema).parse(first.body);

    expect(page.items.map((run) => run.time)).toEqual([at(3), at(2)]);
    expect(page.nextCursor).toBeDefined();

    const second = pageSchema(automationRunSchema).parse(
      (
        await call(
          'GET',
          `/automations/${automationId}/runs?limit=2&cursor=${page.nextCursor ?? ''}`,
        )
      ).body,
    );

    expect(second.items.map((run) => run.time)).toEqual([at(1)]);

    const { body } = await call('GET', `/automations/${automationId}`);

    expect(automationViewSchema.parse(body).lastRun).toMatchObject({
      time: at(3),
      result: 'condition_not_met',
    });
  });

  it('refuses to run one that is turned off', async () => {
    await call('PATCH', `/automations/${automationId}`, { isEnabled: false });

    const { status } = await call('POST', `/automations/${automationId}/trigger`);

    expect(status).toBe(409);
  });

  it('deletes it and tells core to let it go', async () => {
    const { status } = await call('DELETE', `/automations/${automationId}`);

    expect(status).toBe(200);
    expect(automationsSynced.at(-1)).toBe(`remove:${automationId}`);
  });
});
