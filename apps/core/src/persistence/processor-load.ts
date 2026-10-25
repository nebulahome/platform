/**
 * The processor's load the quietest time is learned from (`domain/quietest.ts`).
 *
 * Read from the per-minute aggregate of `sensor.system_cpu_usage`, in quarter hours of the
 * house's day, leaving out the windows the backups ran in: otherwise each backup would make its
 * own slot look busy and push the next one away.
 */
import { sql } from 'drizzle-orm';

import { SYSTEM_ENTITIES } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import type { LoadCell } from '../domain/quietest.js';

/** The processor's entity. */
const CPU_ENTITY_ID = SYSTEM_ENTITIES[0].entityId;

/**
 * Reads the processor's load.
 *
 * @param db - The service's connection.
 * @param options - Over how long, and in which time zone.
 * @param options.days - How many days back.
 * @param options.timezone - The house's time zone.
 * @returns The cells, one per day and quarter hour that has any load.
 */
export async function readProcessorLoad(
  db: Database,
  options: { readonly days: number; readonly timezone: string },
): Promise<LoadCell[]> {
  const rows = await db.execute<{ day: string; slot: number; load: number }>(sql`
    SELECT to_char(t.bucket AT TIME ZONE ${options.timezone}, 'YYYY-MM-DD') AS day,
           (extract(hour FROM t.bucket AT TIME ZONE ${options.timezone})::int * 4
             + extract(minute FROM t.bucket AT TIME ZONE ${options.timezone})::int / 15) AS slot,
           avg(t.avg_value)::float8 AS load
    FROM history.telemetry_1m t
    WHERE t.entity_id = (SELECT id FROM registry.entities WHERE entity_id = ${CPU_ENTITY_ID})
      AND t.bucket >= now() - make_interval(days => ${options.days})
      AND NOT EXISTS (
        SELECT 1 FROM system.backup_runs r
        WHERE t.bucket BETWEEN r.started_at - interval '10 minutes'
                           AND coalesce(r.finished_at, now()) + interval '10 minutes')
    GROUP BY 1, 2`);

  // The driver hands numbers back as it read them, which for a float is text.
  return rows.map((row) => ({
    day: row.day,
    slot: Number(String(row.slot)),
    load: Number(String(row.load)),
  }));
}

/**
 * Whether the processor's load is being recorded at all.
 *
 * @param db - The service's connection.
 * @returns True when the entity exists.
 */
export async function hasProcessorLoad(db: Database): Promise<boolean> {
  const rows = await db.execute<{ found: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM registry.entities WHERE entity_id = ${CPU_ENTITY_ID}) AS found`,
  );

  return rows[0]?.found === true;
}
