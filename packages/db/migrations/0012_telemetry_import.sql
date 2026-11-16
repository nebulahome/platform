-- 0012_telemetry_import.sql
--
-- A device's past readings, imported when it is added (integration SDK 1.10.0, `history`).
-- `core` writes them into history.telemetry and queues the stretch they cover here; the job below
-- brings the 1m/1h/1d summaries up to date over it, since their own policies only look at the
-- last hours. The job, not `core`, refreshes them: refresh_continuous_aggregate needs the
-- summaries' owner - the role these migrations run as, which add_job makes the job's owner -
-- and `core` runs as nebula_core.
--
-- Rollback: SELECT delete_job(job_id) FROM timescaledb_information.jobs
--   WHERE proc_schema = 'history' AND proc_name = 'refresh_imported_telemetry';
--   DROP PROCEDURE history.refresh_imported_telemetry(integer, jsonb);
--   DROP TABLE history.telemetry_refreshes;

CREATE TABLE history.telemetry_refreshes (
  from_time    timestamptz NOT NULL,           -- the oldest reading imported
  to_time      timestamptz NOT NULL,           -- the newest
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE PROCEDURE history.refresh_imported_telemetry(job_id integer, config jsonb)
LANGUAGE plpgsql
AS $$
DECLARE
  oldest   timestamptz;
  newest   timestamptz;
  taken_at timestamptz;
  kept     interval;
BEGIN
  SELECT min(from_time), max(to_time), max(requested_at)
    INTO oldest, newest, taken_at
    FROM history.telemetry_refreshes;

  IF oldest IS NULL THEN
    RETURN;
  END IF;

  -- The one-minute summary is rebuilt from the raw readings, and rebuilding a stretch whose raw
  -- chunks are gone empties every entity's buckets there: stay a day inside what is kept.
  SELECT (j.config ->> 'drop_after')::interval
    INTO kept
    FROM timescaledb_information.jobs AS j
   WHERE j.proc_name = 'policy_retention'
     AND j.hypertable_schema = 'history'
     AND j.hypertable_name = 'telemetry';

  oldest := greatest(oldest, now() - coalesce(kept, INTERVAL '30 days') + INTERVAL '1 day');

  -- refresh_continuous_aggregate runs outside a transaction block.
  COMMIT;

  IF oldest < newest THEN
    CALL refresh_continuous_aggregate('history.telemetry_1m',
      time_bucket(INTERVAL '1 minute', oldest), time_bucket(INTERVAL '1 minute', newest) + INTERVAL '1 minute');
    COMMIT;
    CALL refresh_continuous_aggregate('history.telemetry_1h',
      time_bucket(INTERVAL '1 hour', oldest), time_bucket(INTERVAL '1 hour', newest) + INTERVAL '1 hour');
    COMMIT;
    CALL refresh_continuous_aggregate('history.telemetry_1d',
      time_bucket(INTERVAL '1 day', oldest), time_bucket(INTERVAL '1 day', newest) + INTERVAL '1 day');
    COMMIT;
  END IF;

  -- Only what was summarised: a stretch queued meanwhile waits for the next run.
  DELETE FROM history.telemetry_refreshes WHERE requested_at <= taken_at;
END
$$;

SELECT add_job('history.refresh_imported_telemetry', INTERVAL '1 minute');

-- Migrations run as `nebula`: the default privileges of 0001 do not reach this table.
GRANT SELECT, INSERT ON history.telemetry_refreshes TO nebula_core;
