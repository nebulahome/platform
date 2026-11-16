/**
 * Numeric readings, as they travel on the durable telemetry stream.
 *
 * Separate from a state report on purpose. A state report is the current truth about an entity
 * and is worth exactly as much as the next one that replaces it, so it is fire-and-forget. A
 * reading is a point in a series, and a series with a hole in it is wrong forever - which is why
 * telemetry goes to JetStream and state does not (ARCHITECTURE.md 7.4).
 *
 * The payload is deliberately three fields. Unit, device class and precision live once on
 * `registry.entities`; repeating them on every reading would cost the highest-volume path in the
 * system for information that never changes.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { integrationIdSchema } from './integrations.js';
import { timestampSchema } from './timestamp.js';

/** One numeric reading from one entity. */
export const telemetryReadingSchema = z.object({
  entityId: entityIdSchema,

  /** The measurement, in the unit declared on the entity. */
  value: z.number(),

  /** When the device took the reading, not when the platform received it. */
  observedAt: timestampSchema,
});

/** One numeric reading from one entity. */
export type TelemetryReading = z.output<typeof telemetryReadingSchema>;

/**
 * Writes a device's past numeric readings into an entity's history, without its state: what
 * `hub` asks once a device was first added and its driver could tell its past
 * (`Integration.history`). `core` writes the readings into the telemetry table and queues the
 * stretch for the job that brings the 1m/1h/1d summaries up to date.
 */
export const CORE_HISTORY_IMPORT_METHOD = 'history_import';

/**
 * How far back a past reading may be: the raw readings are kept 30 days, and a summary is only
 * brought up to date where the raw readings of every entity are still there.
 */
export const HISTORY_IMPORT_MAX_DAYS = 28;

/** The most readings one request may carry. */
export const HISTORY_IMPORT_MAX_READINGS = 5000;

/** Past readings of one entity, from the instance that owns it. */
export const historyImportRequestSchema = z.strictObject({
  /** The instance that owns the entity, which is the device's own id. */
  integrationId: integrationIdSchema,
  entityId: entityIdSchema,
  readings: z
    .array(z.object({ observedAt: timestampSchema, value: z.number() }))
    .min(1)
    .max(HISTORY_IMPORT_MAX_READINGS),
});

/** Past readings of one entity, from the instance that owns it. */
export type HistoryImportRequest = z.output<typeof historyImportRequestSchema>;

/**
 * How many readings were written, and how many left out: not finite, at or after the entity was
 * registered, or older than {@link HISTORY_IMPORT_MAX_DAYS}.
 */
export const historyImportReplySchema = z.object({
  written: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** How many readings were written and left out. */
export type HistoryImportReply = z.output<typeof historyImportReplySchema>;
