/**
 * The live channel: what a client may say on the WebSocket, and what it will hear back.
 *
 * Every message is a tagged object rather than a bare payload, because one socket carries state
 * changes, package events and errors at once and a client has to be able to tell them apart
 * without inspecting shapes.
 *
 * Authentication happens in the first message, not in a query parameter: a URL carrying a token
 * ends up in proxy logs and browser history, and RULES.md 16 forbids putting credentials there.
 */
import { z } from 'zod';

import { automationEventSchema } from './automation-bus.js';
import { backupEventSchema } from './backup.js';
import { DISCOVERY_EVENTS } from './discovery.js';
import { entityIdSchema } from './entity-id.js';
import { changeContextSchema } from './entity-state.js';
import { jsonObjectSchema } from './json.js';
import { DEVICE_EVENTS, deviceEventSchema } from './registration.js';
import { containerEventSchema } from './supervisor.js';
import { timestampSchema } from './timestamp.js';
import { platformEventSchema } from './updates.js';

/** How long the server waits for the first message before closing the socket, in milliseconds. */
export const WS_AUTH_TIMEOUT_MS = 10_000;

/** How often the server sends a heartbeat, in milliseconds. */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** The close code used when the first message is not a valid authentication. */
export const WS_CLOSE_UNAUTHENTICATED = 4001;

/** The close code used when the access token behind a live socket expires. */
export const WS_CLOSE_TOKEN_EXPIRED = 4002;

/** What a client may subscribe to. */
export const WS_TOPICS = [
  'state',
  'devices',
  'packages',
  'automations',
  'discovery',
  'containers',
  'backups',
  'system',
] as const;

/** What a client may subscribe to. */
export type WsTopic = (typeof WS_TOPICS)[number];

/** Which entities a `state` subscription covers. */
export const wsStateFilterSchema = z.object({
  /** Only these entities. Absent means every entity the caller may read. */
  entityIds: z.array(entityIdSchema).max(500).optional(),

  /** Only entities in these areas. */
  areas: z.array(z.string().max(64)).max(100).optional(),
});

/** Which entities a `state` subscription covers. */
export type WsStateFilter = z.output<typeof wsStateFilterSchema>;

/** Everything a client may send. */
export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('authenticate'),

    /** The same access token the REST endpoints take. */
    accessToken: z.string().min(1),
  }),
  z.object({
    type: z.literal('subscribe'),
    topic: z.enum(WS_TOPICS),

    /** Only meaningful for the `state` topic. */
    filter: wsStateFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    topic: z.enum(WS_TOPICS),
  }),
  z.object({ type: z.literal('ping') }),
]);

/** Everything a client may send. */
export type WsClientMessage = z.output<typeof wsClientMessageSchema>;

/** Everything the server may send. */
export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),

    /** Who the socket is authenticated as. */
    userId: z.uuid(),

    /** The trace id of the upgrade, so a socket can be found in the logs. */
    traceId: z.string(),

    /**
     * When the access token behind this socket expires.
     *
     * The socket closes with {@link WS_CLOSE_TOKEN_EXPIRED} at that moment. A client that wants
     * to stay connected refreshes and reconnects before then, rather than discovering the
     * disconnection when an event fails to arrive.
     */
    expiresAt: timestampSchema,
  }),
  z.object({
    type: z.literal('subscribed'),
    topic: z.enum(WS_TOPICS),
  }),
  z.object({
    type: z.literal('unsubscribed'),
    topic: z.enum(WS_TOPICS),
  }),
  z.object({
    type: z.literal('state_changed'),
    entityId: entityIdSchema,

    /** The full state after the change, one entry per capability. */
    state: jsonObjectSchema,

    /** Extras reported alongside it. */
    attributes: jsonObjectSchema.default({}),

    /** Whether the entity is reachable. */
    isAvailable: z.boolean(),

    /** True while its package or integration is being updated: the value is the last one known. */
    isUpdating: z.boolean().optional(),

    /** When it changed. */
    changedAt: timestampSchema,

    /** What caused it. */
    context: changeContextSchema.optional(),
  }),
  z.object({
    type: z.literal('device_event'),
    event: z.enum(DEVICE_EVENTS),
    payload: deviceEventSchema,
  }),
  z.object({
    type: z.literal('discovery_event'),
    event: z.enum(DISCOVERY_EVENTS),

    /** How many devices the hub has heard and nobody has added, now. */
    count: z.int().min(0),
  }),
  z.object({
    type: z.literal('container_event'),
    payload: containerEventSchema,
  }),
  z.object({
    type: z.literal('integration_event'),

    /** Which vendor: its page reads it again. */
    vendorId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('backup_event'),
    payload: backupEventSchema,
  }),
  z.object({
    type: z.literal('platform_event'),
    payload: platformEventSchema,
  }),
  z.object({
    type: z.literal('package_event'),
    event: z.enum(['installed', 'removed', 'started', 'stopped', 'configured']),
    payload: jsonObjectSchema,
  }),
  z.object({
    type: z.literal('automation_event'),
    automationId: z.uuid(),
    payload: automationEventSchema,
  }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('error'),

    /** The same codes the REST envelope uses, so one client-side handler covers both. */
    code: z.string(),
    message: z.string(),
  }),
]);

/** Everything the server may send. */
export type WsServerMessage = z.output<typeof wsServerMessageSchema>;
