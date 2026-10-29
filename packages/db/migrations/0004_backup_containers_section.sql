-- 0004_backup_containers_section.sql
--
-- The containers become a part of a backup the owner may leave out, beside the history and the
-- packages: their folders and named volumes were always taken with the configuration. A run
-- records the parts it took, so the check on `system.backup_runs.sections` learns the new one.
--
-- Rollback: DELETE FROM system.backup_runs WHERE 'containers' = ANY (sections);
--           ALTER TABLE system.backup_runs DROP CONSTRAINT backup_runs_sections,
--             ADD CONSTRAINT backup_runs_sections
--             CHECK (sections <@ ARRAY['configuration', 'history', 'packages']::text[]);
--           DELETE FROM system.schema_migrations WHERE name = '0004_backup_containers_section.sql';

ALTER TABLE system.backup_runs
  DROP CONSTRAINT backup_runs_sections,
  ADD CONSTRAINT backup_runs_sections
    CHECK (sections <@ ARRAY['configuration', 'history', 'packages', 'containers']::text[]);
