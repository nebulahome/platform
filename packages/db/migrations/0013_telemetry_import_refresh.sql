-- 0013_telemetry_import_refresh.sql
--
-- The job of 0012, made right.
--
-- - It deletes the queued rows it read, by id, and no others: a row whose transaction began
--   before the one last read but committed while the summaries were being brought up to date
--   used to be deleted unsummarised, its readings never reaching the charts.
-- - Each summary is brought up to date only where its own policy never looks (older than the
--   policy's start_offset): newer readings are the policy's, which finds them in the invalidation
--   log. So the job never meets a policy over the same buckets, and never materialises a still
--   open hour or day for the whole house.
-- - A stretch of one reading - the same oldest and newest - is summarised too.
--
-- Rollback: DROP PROCEDURE history.refresh_imported_telemetry(integer, jsonb), then the 0012
--   procedure again; ALTER TABLE history.telemetry_refreshes DROP COLUMN id;

ALTER TABLE history.telemetry_refreshes
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE OR REPLACE PROCEDURE history.refresh_imported_telemetry(job_id integer, config jsonb)
LANGUAGE plpgsql
AS $$
DECLARE
  taken        uuid[];
  oldest       timestamptz;
  newest       timestamptz;
  kept         interval;
  minute_reach interval;
  hour_reach   interval;
  day_reach    interval;
  window_from  timestamptz;
  window_to    timestamptz;
BEGIN
  SELECT array_agg(q.id), min(q.from_time), max(q.to_time)
    INTO taken, oldest, newest
    FROM history.telemetry_refreshes AS q;

  IF taken IS NULL THEN
    RETURN;
  END IF;

  SELECT (j.config ->> 'drop_after')::interval
    INTO kept
    FROM timescaledb_information.jobs AS j
   WHERE j.proc_name = 'policy_retention'
     AND j.hypertable_schema = 'history'
     AND j.hypertable_name = 'telemetry';

  SELECT (j.config ->> 'start_offset')::interval
    INTO minute_reach
    FROM timescaledb_information.jobs AS j
   WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
     AND j.hypertable_schema = 'history'
     AND j.hypertable_name = 'telemetry_1m';

  SELECT (j.config ->> 'start_offset')::interval
    INTO hour_reach
    FROM timescaledb_information.jobs AS j
   WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
     AND j.hypertable_schema = 'history'
     AND j.hypertable_name = 'telemetry_1h';

  SELECT (j.config ->> 'start_offset')::interval
    INTO day_reach
    FROM timescaledb_information.jobs AS j
   WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
     AND j.hypertable_schema = 'history'
     AND j.hypertable_name = 'telemetry_1d';

  -- The one-minute summary is rebuilt from the raw readings, and rebuilding a stretch whose raw
  -- chunks are gone empties every entity's buckets there: stay a day inside what is kept.
  oldest := greatest(oldest, now() - coalesce(kept, INTERVAL '30 days') + INTERVAL '1 day');

  -- refresh_continuous_aggregate runs outside a transaction block.
  COMMIT;

  -- Each window ends at the first bucket its policy reaches; one that is empty is skipped.
  window_from := time_bucket(INTERVAL '1 minute', oldest);
  window_to := least(
    time_bucket(INTERVAL '1 minute', newest),
    time_bucket(INTERVAL '1 minute', now() - coalesce(minute_reach, INTERVAL '3 hours'))
  ) + INTERVAL '1 minute';

  IF window_from < window_to THEN
    CALL refresh_continuous_aggregate('history.telemetry_1m', window_from, window_to);
    COMMIT;
  END IF;

  window_from := time_bucket(INTERVAL '1 hour', oldest);
  window_to := least(
    time_bucket(INTERVAL '1 hour', newest),
    time_bucket(INTERVAL '1 hour', now() - coalesce(hour_reach, INTERVAL '1 day'))
  ) + INTERVAL '1 hour';

  IF window_from < window_to THEN
    CALL refresh_continuous_aggregate('history.telemetry_1h', window_from, window_to);
    COMMIT;
  END IF;

  window_from := time_bucket(INTERVAL '1 day', oldest);
  window_to := least(
    time_bucket(INTERVAL '1 day', newest),
    time_bucket(INTERVAL '1 day', now() - coalesce(day_reach, INTERVAL '7 days'))
  ) + INTERVAL '1 day';

  IF window_from < window_to THEN
    CALL refresh_continuous_aggregate('history.telemetry_1d', window_from, window_to);
    COMMIT;
  END IF;

  -- Only the rows read above: one queued meanwhile waits for the next run. A run that failed -
  -- one that met a policy's refresh after all - deleted nothing, and the next tries again.
  DELETE FROM history.telemetry_refreshes WHERE id = ANY (taken);
END
$$;
