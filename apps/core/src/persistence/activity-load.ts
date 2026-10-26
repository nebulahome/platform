/**
 * The house's activity the quietest time is learned from (`domain/quietest.ts`,
 * docs/releases-and-updates.md 4): what people did, per quarter hour of the house's day.
 *
 * One point for each of:
 * - a change a person asked for: a command from the page or the API (`user`), a scene applied
 *   (`scene`);
 * - a change nobody asked the platform for - a light switched by hand, a door opened, motion - on
 *   the domains people touch, or a presence, motion, door or window sensor turning on;
 * - an automation run that did something, except runs of a quiet-time trigger and the runs those
 *   started directly: the quietest time's own automations must not make it look busy. A run
 *   started further down that chain is counted - the engine keeps chains in memory only.
 *
 * Never counted: readings (`sensor`), images, the platform's own entities and containers, and the
 * changes an automation made (its run already counts once). Every quarter hour from the first day
 * with activity to yesterday is returned, the quiet ones as zero, so a quiet day is a day.
 */
import { sql } from 'drizzle-orm';

import type { Database } from '@nebulahome/db';

import type { ActivityCell } from '../domain/quietest.js';

/** The domains a person switches by hand. */
const TOUCHED_DOMAINS = [
  'light',
  'switch',
  'cover',
  'lock',
  'climate',
  'media_player',
  'vacuum',
  'lawn_mower',
];

/** The binary sensors that turn on when somebody is about. */
const PRESENCE_CLASSES = [
  'motion',
  'occupancy',
  'presence',
  'door',
  'opening',
  'window',
  'garage_door',
];

/**
 * Reads the activity.
 *
 * @param db - The service's connection.
 * @param options - Over how long, and in which time zone.
 * @param options.days - How many days back.
 * @param options.timezone - The house's time zone.
 * @returns Every quarter hour of every day since activity began, up to yesterday.
 */
export async function readActivity(
  db: Database,
  options: { readonly days: number; readonly timezone: string },
): Promise<ActivityCell[]> {
  const { days, timezone } = options;
  const rows = await db.execute<{ day: string; slot: number; activity: number }>(sql`
    WITH events AS (
      SELECT h.time AS at
      FROM history.state_history h
      JOIN registry.entities e ON e.id = h.entity_id
      WHERE h.time >= now() - make_interval(days => ${days})
        AND e.source NOT IN ('system', 'container')
        AND e.domain NOT IN ('sensor', 'image')
        AND (
          h.context_type IN ('user', 'scene')
          OR (
            h.context_type IS NULL
            AND h.is_available
            AND h.previous_state IS NOT NULL
            AND h.state <> h.previous_state
            AND (
              coalesce(e.shown_domain, e.domain) IN (${sql.join(
                TOUCHED_DOMAINS.map((domain) => sql`${domain}`),
                sql`, `,
              )})
              OR (
                e.domain = 'binary_sensor'
                -- What the owner shows it as: motion shown as presence counts as presence.
                AND (CASE WHEN e.shown_domain IS NULL THEN e.device_class
                          ELSE e.shown_device_class END) IN (${sql.join(
                            PRESENCE_CLASSES.map((kind) => sql`${kind}`),
                            sql`, `,
                          )})
                AND h.state -> 'sensor_binary' ->> 'isOn' = 'true'
              )
            )
          )
        )
      UNION ALL
      SELECT r.time
      FROM history.automation_runs r
      WHERE r.time >= now() - make_interval(days => ${days})
        AND r.result <> 'condition_not_met'
        AND coalesce(r.trigger ->> 'kind', '') <> 'quiet'
        AND NOT (
          r.trigger ->> 'kind' = 'automation'
          AND EXISTS (
            SELECT 1 FROM history.automation_runs q
            WHERE q.id::text = r.trigger ->> 'runId' AND q.trigger ->> 'kind' = 'quiet'
          )
        )
    ),
    counted AS (
      SELECT to_char(at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
             (extract(hour FROM at AT TIME ZONE ${timezone})::int * 4
               + extract(minute FROM at AT TIME ZONE ${timezone})::int / 15) AS slot,
             count(*)::int AS activity
      FROM events
      GROUP BY 1, 2
    ),
    grid AS (
      SELECT to_char(d, 'YYYY-MM-DD') AS day, s AS slot
      FROM generate_series(
             (SELECT min(day) FROM counted)::date,
             (now() AT TIME ZONE ${timezone})::date - 1,
             interval '1 day'
           ) AS d,
           generate_series(0, 95) AS s
    )
    SELECT g.day, g.slot, coalesce(c.activity, 0) AS activity
    FROM grid g
    LEFT JOIN counted c ON c.day = g.day AND c.slot = g.slot`);

  // The driver hands numbers back as it read them.
  return rows.map((row) => ({
    day: row.day,
    slot: Number(String(row.slot)),
    activity: Number(String(row.activity)),
  }));
}
