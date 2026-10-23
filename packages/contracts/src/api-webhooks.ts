/**
 * Webhooks as Settings › Webhooks reads them: the automations that start from one, and every
 * call their addresses received.
 *
 * A webhook is not a row of its own. It is a webhook trigger inside an automation's document,
 * and its address is `/api/hooks/<hookId>`. `core` decides what a call does and records it in
 * `history.webhook_calls`, kept 30 days; the API lists both.
 */
import { z } from 'zod';

import { pageQuerySchema } from './api-http.js';
import { WEBHOOK_METHODS, WEBHOOK_REACHES } from './automation-triggers.js';
import { timestampSchema } from './timestamp.js';

/**
 * What became of a call, decided in this order: no webhook has the id (`not_found`), a call from
 * outside to one kept on the house's network (`local_only`), a method it does not take
 * (`wrong_method`), over the limit a minute (`rate_limited`), then what the automation's mode made
 * of the run (`started`, `queued`, `ignored`).
 */
export const WEBHOOK_CALL_OUTCOMES = [
  'started',
  'queued',
  'ignored',
  'not_found',
  'local_only',
  'wrong_method',
  'rate_limited',
] as const;

/** What became of a call. */
export type WebhookCallOutcome = (typeof WEBHOOK_CALL_OUTCOMES)[number];

/** One call a webhook address received. Its body is never kept. */
export const webhookCallSchema = z.object({
  id: z.uuid(),
  time: timestampSchema,
  hookId: z.string().max(64),

  /** The automation whose webhook it was; null for an address none has. */
  automationId: z.uuid().nullable(),
  method: z.string().max(16),
  path: z.string().max(2_000),
  remoteIp: z.string().max(64),

  /** Whether it came from the house's own network. */
  isLocal: z.boolean(),
  userAgent: z.string().nullable(),

  /** The request's headers, with the values of `authorization` and `cookie` hidden. */
  headers: z.record(z.string(), z.string()),
  status: z.int(),
  durationMs: z.int().min(0),
  outcome: z.enum(WEBHOOK_CALL_OUTCOMES),

  /** The run it started or queued. */
  runId: z.uuid().nullable(),
});

/** One call a webhook address received. */
export type WebhookCall = z.output<typeof webhookCallSchema>;

/** One webhook: an automation's webhook trigger, with how much it has been called. */
export const webhookViewSchema = z.object({
  hookId: z.string().max(64),
  automationId: z.uuid(),
  automationName: z.string(),

  /** False while the automation is paused, when its address answers 404. */
  isActive: z.boolean(),
  method: z.enum([...WEBHOOK_METHODS, 'any']),
  reach: z.enum(WEBHOOK_REACHES),

  /** Calls in the last 24 hours. */
  calls24h: z.int().min(0),
  lastCall: webhookCallSchema.pick({ time: true, remoteIp: true, status: true }).nullable(),
});

/** One webhook. */
export type WebhookView = z.output<typeof webhookViewSchema>;

/** How far back the call list reaches. */
export const WEBHOOK_CALL_SPANS = ['1h', '24h', '7d', '30d'] as const;

/** Where a call came from, as the call list filters it. */
export const WEBHOOK_CALL_ORIGINS = ['any', 'local', 'internet'] as const;

/** A page of calls, narrowed. */
export const webhookCallsQuerySchema = pageQuerySchema.extend({
  since: z.enum(WEBHOOK_CALL_SPANS).default('24h'),
  where: z.enum(WEBHOOK_CALL_ORIGINS).default('any'),

  /** Methods, comma-separated: `GET,POST`. Absent means any. */
  methods: z
    .string()
    .max(64)
    .transform((value) => value.split(',').filter((method) => method !== ''))
    .pipe(z.array(z.enum(WEBHOOK_METHODS)))
    .optional(),
  automationId: z.uuid().optional(),
});

/** A page of calls, narrowed. */
export type WebhookCallsQuery = z.output<typeof webhookCallsQuerySchema>;
