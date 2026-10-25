/**
 * Webhooks: who may call, what a call carries on to `core`, and what Settings › Webhooks lists.
 *
 * A call's address is checked here, before anything else is done for a stranger: a path that is
 * not a webhook id is a 404 that reaches neither `core` nor the log. Whether the caller is on the
 * house's network is read from the address `proxy` saw on the socket - it overwrites
 * `X-Forwarded-For`, so a caller cannot claim to be at home. The headers are passed on with the
 * values of the ones that carry credentials hidden, and the body is never read into anything.
 */
import { BlockList, isIP } from 'node:net';

import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';

import {
  automationTriggerSchema,
  webhookCallSchema,
  webhookViewSchema,
  type WebhookCall,
  type WebhookCallsQuery,
  type WebhookView,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { decodeCursor, toPage, type PageResult } from '../http/pagination.js';

/** The networks a house's own devices are on: private IPv4, loopback, link-local, ULA. */
const LOCAL_NETWORKS = new BlockList();

LOCAL_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
LOCAL_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
LOCAL_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
LOCAL_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4');
LOCAL_NETWORKS.addSubnet('169.254.0.0', 16, 'ipv4');
LOCAL_NETWORKS.addSubnet('::1', 128, 'ipv6');
LOCAL_NETWORKS.addSubnet('fc00::', 7, 'ipv6');
LOCAL_NETWORKS.addSubnet('fe80::', 10, 'ipv6');

/**
 * Whether a caller is on the house's network.
 *
 * shortcut: a tunnel or reverse proxy in front of `proxy` makes every call come from its local
 * address, so "local" webhooks answer the internet through it; read its header then.
 *
 * @param ip - The caller's address, IPv4, IPv6 or IPv4 mapped into IPv6.
 * @returns True for a private, loopback, link-local or unique local address.
 */
export function isLocalAddress(ip: string): boolean {
  const address = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(ip)?.[1] ?? ip;
  const family = isIP(address);

  return family !== 0 && LOCAL_NETWORKS.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Headers whose values are credentials, never written down. */
const HIDDEN_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

/**
 * The headers of a call as the log keeps them.
 *
 * @param headers - As Node read them, names in lower case.
 * @returns One string per header, credentials hidden, each bounded.
 */
export function loggedHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | readonly string[]] => entry[1] !== undefined)
      .slice(0, 50)
      .map(([name, value]) => [
        name.slice(0, 100),
        HIDDEN_HEADERS.has(name)
          ? '[hidden]'
          : (Array.isArray(value) ? value.join(', ') : String(value)).slice(0, 2_000),
      ]),
  );
}

/** How far back each span of the call list reaches. */
const SPAN_MS: Readonly<Record<WebhookCallsQuery['since'], number>> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

/**
 * Every webhook trigger of every automation, with its calls of the last day and its last call.
 *
 * @param db - The database.
 * @param now - Now.
 * @returns The webhooks, in the order of the automations' names.
 */
export async function listWebhooks(db: Database, now: Date): Promise<WebhookView[]> {
  const automations = schema.registry.automations;
  const rows = await db
    .select({
      id: automations.id,
      name: automations.name,
      isEnabled: automations.isEnabled,
      definition: automations.definition,
    })
    .from(automations)
    .orderBy(automations.name);
  const hooks = rows.flatMap((row) => {
    const triggers: unknown = (row.definition as { triggers?: unknown } | null)?.triggers;

    return (Array.isArray(triggers) ? triggers : []).flatMap((value: unknown) => {
      const parsed = automationTriggerSchema.safeParse(value);

      return parsed.success && parsed.data.type === 'webhook'
        ? [{ row, trigger: parsed.data }]
        : [];
    });
  });

  if (hooks.length === 0) {
    return [];
  }

  const calls = schema.history.webhookCalls;
  const hookIds = [...new Set(hooks.map((hook) => hook.trigger.hookId))];
  const counts = await db
    .select({
      hookId: calls.hookId,

      // Hours before now: 0 is the hour up to now, 23 the oldest.
      hoursAgo: sql<number>`floor(extract(epoch from (${now.toISOString()}::timestamptz - ${calls.time})) / 3600)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(calls)
    .where(
      and(
        inArray(calls.hookId, hookIds),
        gte(calls.time, new Date(now.getTime() - SPAN_MS['24h'])),
      ),
    )
    .groupBy(calls.hookId, sql`2`);
  const hourlyOf = new Map<string, number[]>();

  for (const entry of counts) {
    const hourly = hourlyOf.get(entry.hookId) ?? Array.from({ length: 24 }, () => 0);
    const slot = 23 - Math.min(23, Math.max(0, entry.hoursAgo));

    hourly[slot] = (hourly[slot] ?? 0) + entry.count;
    hourlyOf.set(entry.hookId, hourly);
  }
  const lasts = await db
    .selectDistinctOn([calls.hookId], {
      hookId: calls.hookId,
      time: calls.time,
      remoteIp: calls.remoteIp,
      status: calls.status,
    })
    .from(calls)
    .where(inArray(calls.hookId, hookIds))
    .orderBy(calls.hookId, desc(calls.time));
  const lastOf = new Map(lasts.map((entry) => [entry.hookId, entry]));

  return hooks.map(({ row, trigger }) => {
    const last = lastOf.get(trigger.hookId);
    const hourly = hourlyOf.get(trigger.hookId) ?? Array.from({ length: 24 }, () => 0);

    return webhookViewSchema.parse({
      hookId: trigger.hookId,
      automationId: row.id,
      automationName: row.name,
      isActive: row.isEnabled && trigger.isEnabled !== false,
      method: trigger.method,
      reach: trigger.reach,
      calls24h: hourly.reduce((total, count) => total + count, 0),
      hourly,
      lastCall:
        last === undefined
          ? null
          : { time: last.time, remoteIp: last.remoteIp, status: last.status },
    });
  });
}

/**
 * One page of the calls the webhook addresses received, newest first.
 *
 * @param db - The database.
 * @param query - How far back, from where, which methods, which automation, and the page.
 * @param now - Now.
 * @returns The page.
 */
export async function listWebhookCalls(
  db: Database,
  query: WebhookCallsQuery,
  now: Date,
): Promise<PageResult<WebhookCall>> {
  const calls = schema.history.webhookCalls;
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  const where = and(
    gte(calls.time, new Date(now.getTime() - SPAN_MS[query.since])),
    query.where === 'any' ? undefined : eq(calls.isLocal, query.where === 'local'),
    query.methods === undefined || query.methods.length === 0
      ? undefined
      : inArray(calls.method, query.methods),
    query.automationId === undefined ? undefined : eq(calls.automationId, query.automationId),
    cursor === undefined
      ? undefined
      : or(
          lt(calls.time, new Date(cursor.key)),
          and(eq(calls.time, new Date(cursor.key)), lt(calls.id, cursor.id ?? '')),
        ),
  );
  const rows = await db
    .select()
    .from(calls)
    .where(where)
    .orderBy(desc(calls.time), desc(calls.id))
    .limit(query.limit + 1);

  return toPage(
    rows.map((row) => webhookCallSchema.parse(row)),
    query.limit,
    (call) => ({ key: call.time.toISOString(), id: call.id }),
  );
}
