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
