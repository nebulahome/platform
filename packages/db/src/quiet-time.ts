/**
 * Reading the quietest time of day `core` learned, which the services that run long jobs on
 * their own - backups, automatic updates - start them in.
 */
import { sql } from 'drizzle-orm';

import { QUIET_TIME_ENTITY_ID, quietTimeFromState, type QuietTime } from '@nebulahome/contracts';

import type { Database } from './client.js';

/**
 * Reads the quietest time core learned, `sensor.system_quiet_time`.
 *
 * @param db - The service's connection.
 * @returns What was learned, or null while the entity has no state.
 */
export async function readQuietTime(db: Database): Promise<QuietTime | null> {
  const rows = await db.execute<{ state: unknown; attributes: unknown }>(sql`
    SELECT s.state, s.attributes
    FROM registry.entity_states s
    JOIN registry.entities e ON e.id = s.entity_id
    WHERE e.entity_id = ${QUIET_TIME_ENTITY_ID}`);
  const row = rows[0];

  return row === undefined ? null : quietTimeFromState(row.state, row.attributes);
}
