-- 0010_aliases_grants.sql
--
-- `core` and `api` could not read the aliases 0009 made. The registry's default privileges are
-- for tables `nebula_migrator` creates, and the migrations run as `nebula`, so the two new
-- tables came with no grant and `core` stopped at start ("permission denied for table aliases").
-- They get what 0001 gave both services on every registry table.
--
-- Rollback: REVOKE ALL ON registry.aliases, registry.alias_reads FROM nebula_core, nebula_api;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON registry.aliases, registry.alias_reads
  TO nebula_core, nebula_api;
