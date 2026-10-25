/**
 * The quietest time of day, as an entity of the system device (docs/releases-and-updates.md 4).
 *
 * `core` learns it from the processor's load once a day and reports it as `sensor_text`, the
 * time `HH:MM` in the house's zone, with how it was learned as attributes. Whatever runs at the
 * quietest time - backups, updates, an automation through a time trigger read from an entity -
 * reads this one entity instead of learning it again.
 */
import { quietTimeSchema, type QuietTime } from './backup.js';
import type { JsonObject } from './json.js';

/** The entity's id. */
export const QUIET_TIME_ENTITY_ID = 'sensor.system_quiet_time';

/** How long the quiet stretch it looks for is, in minutes: room for a backup or an update. */
export const QUIET_TIME_WINDOW_MINUTES = 60;

/** The time used until enough load is known. */
export const QUIET_TIME_FALLBACK = '03:00';

/** What it registers as; checked against the registration schema where it is registered. */
export const QUIET_TIME_ENTITY = {
  entityId: QUIET_TIME_ENTITY_ID,
  name: 'Quietest time',
  icon: 'moon',
  capabilities: { sensor_text: {} },
} as const;

/**
 * The attributes a report of it carries: the learning, without the time, which is the state.
 *
 * @param quiet - What was learned.
 * @returns The attributes.
 */
export function quietTimeAttributes(quiet: QuietTime): JsonObject {
  return {
    state: quiet.state,
    meanLoadPercent: quiet.meanLoadPercent,
    daysOfData: quiet.daysOfData,
    daysNeeded: quiet.daysNeeded,
    profile: quiet.profile,
    reason: quiet.reason,
    timezone: quiet.timezone ?? null,
  };
}

/**
 * Reads the entity's state and attributes back into what was learned.
 *
 * @param state - The entity's state, `{ sensor_text: { value } }`.
 * @param attributes - Its attributes.
 * @returns What was learned, or null when the state is not one.
 */
export function quietTimeFromState(state: unknown, attributes: unknown): QuietTime | null {
  const value = (state as { sensor_text?: { value?: unknown } } | null)?.sensor_text?.value;
  const extra = typeof attributes === 'object' && attributes !== null ? attributes : {};
  const parsed = quietTimeSchema.safeParse({ ...extra, time: value });

  return parsed.success ? parsed.data : null;
}
