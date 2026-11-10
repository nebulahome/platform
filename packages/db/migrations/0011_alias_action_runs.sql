-- 0011_alias_action_runs.sql
--
-- What an alias's actions did: one row per run, the way history.automation_runs keeps an
-- automation's. A part's actions answer a command it was sent or a change of its value; the
-- History of the alias lists these rows, the page shows how each action last went. Written by
-- `core`, which runs them; read by `api`. Its own table rather than automation_runs, whose rows
-- belong to an automation and count as the house's activity.
--
-- Rollback: DROP TABLE history.alias_action_runs;

CREATE TABLE history.alias_action_runs (
  time        timestamptz NOT NULL,            -- when the run started
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  alias_id    uuid        NOT NULL,
  part        text        NOT NULL,            -- the part the action belongs to
  action_id   text        NOT NULL,            -- the action's id within the part
  "when"      jsonb       NOT NULL,            -- the command with its values, or the change
  origin      jsonb       NOT NULL,            -- who or what sent it: the change context
  result      text        NOT NULL,
  finished_at timestamptz,
  duration_ms integer,
  trace       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error       text,

  CONSTRAINT alias_action_runs_result
    CHECK (result IN ('success', 'condition_not_met', 'failed', 'timeout', 'cancelled'))
);

SELECT create_hypertable('history.alias_action_runs', by_range('time', INTERVAL '7 days'));

CREATE INDEX alias_action_runs_alias_id_time_idx
  ON history.alias_action_runs (alias_id, time DESC);

SELECT add_retention_policy('history.alias_action_runs', INTERVAL '30 days');

-- Migrations run as `nebula`: the default privileges of 0001 do not reach this table.
GRANT SELECT, INSERT, DELETE ON history.alias_action_runs TO nebula_core;
GRANT SELECT ON history.alias_action_runs TO nebula_api;
