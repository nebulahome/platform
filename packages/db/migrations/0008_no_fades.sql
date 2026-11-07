-- 0008_no_fades.sql
--
-- Lights no longer fade: commands carry no transition, so a scene has no default one and a member
-- no override. Both columns go, and the scene's range check with its column; the stored values
-- are dropped with them.
--
-- Rollback: ALTER TABLE registry.scenes
--             ADD COLUMN transition_ms integer NOT NULL DEFAULT 0,
--             ADD CONSTRAINT scenes_transition_range CHECK (transition_ms BETWEEN 0 AND 600000);
--           ALTER TABLE registry.scene_entities
--             ADD COLUMN transition_ms integer,
--             ADD CONSTRAINT scene_entities_transition_range
--             CHECK (transition_ms IS NULL OR transition_ms BETWEEN 0 AND 600000);
--           DELETE FROM system.schema_migrations WHERE name = '0008_no_fades.sql';

ALTER TABLE registry.scenes
  DROP CONSTRAINT scenes_transition_range,
  DROP COLUMN transition_ms;

ALTER TABLE registry.scene_entities
  DROP CONSTRAINT scene_entities_transition_range,
  DROP COLUMN transition_ms;
