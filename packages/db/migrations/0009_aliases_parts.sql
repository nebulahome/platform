-- 0009_aliases_parts.sql
--
-- Aliases are rebuilt around parts. An alias is one entity that behaves as a domain (a sensor, a
-- light, a thermostat…) and is made of parts - one per field of its capabilities - each taking
-- its value from a source of its own: stored, an entity, several entities, a formula or code.
-- It lives on a device: the shared virtual device "Aliases", a virtual device of the owner's, or a
-- real device, among that device's own entities.
--
-- The old aliases (a formula over named variables, or a stored helper) are deleted with their
-- entities, as the owner decided: they are made again with the new page. Their history goes with
-- the entities' rows the way any removed entity's does.
--
-- What changes:
--   * devices.source gains 'virtual': a device with no hardware behind it, which only holds
--     aliases. The shared one is written here, `external_id = 'aliases'`, and cannot be removed.
--   * a derived entity (an alias) may sit on a device; it still has no package or integration.
--   * a device that goes takes no alias with it: its aliases move to the shared device first,
--     whichever path removes it (a trigger, so no path can forget).
--   * registry.aliases holds the whole setup: the type, the parts, the code and its cases and
--     memory, the display, the last error with where it happened.
--   * registry.alias_reads lists the entities an alias reads, by entity id - worked out from its
--     parts and its code on every save - for its inputs, the cycle check, "used by" and the
--     refusal to remove what an alias reads. By id rather than by row: an entity removed and made
--     again (a device re-described) is the same input.
--
-- Rollback: there is none that brings the old aliases back. To undo the structure:
--   DROP TRIGGER devices_keep_aliases ON registry.devices;
--   DROP FUNCTION registry.devices_keep_aliases();
--   DROP TABLE registry.alias_reads; DROP TABLE registry.aliases;
--   DELETE FROM registry.entities WHERE source = 'derived';
--   DELETE FROM registry.devices WHERE source = 'virtual';
--   then restore 0001's aliases, alias_sources, v_alias_dependents and the two checks below, and
--   DELETE FROM system.schema_migrations WHERE name = '0009_aliases_parts.sql';

-- The old aliases, and their entities (which cascade to states, capabilities, tags and scene
-- members).
DROP VIEW registry.v_alias_dependents;
DROP TABLE registry.alias_sources;
DROP TABLE registry.aliases;
DELETE FROM registry.entities WHERE source = 'derived';

-- Virtual devices.
ALTER TABLE registry.devices
  DROP CONSTRAINT devices_source,
  ADD CONSTRAINT devices_source CHECK (source IN ('adapter', 'system', 'container', 'virtual')),
  DROP CONSTRAINT devices_owner_exclusive,
  ADD CONSTRAINT devices_owner_exclusive CHECK (
    (source = 'adapter' AND (package_id IS NOT NULL) <> (integration_id IS NOT NULL))
    OR (source IN ('system', 'container', 'virtual') AND package_id IS NULL AND integration_id IS NULL)
  );

-- The shared virtual device every new alias goes on unless told otherwise: one, found by its
-- external id.
CREATE UNIQUE INDEX devices_shared_aliases_idx ON registry.devices (external_id)
  WHERE source = 'virtual' AND external_id = 'aliases';

INSERT INTO registry.devices (source, external_id, name, icon, manufacturer, model)
VALUES ('virtual', 'aliases', 'Aliases', 'sigma', 'Nebula', 'Virtual device');

-- An alias may sit on a device; it still belongs to no package and no integration.
ALTER TABLE registry.entities
  DROP CONSTRAINT entities_source_consistency,
  ADD CONSTRAINT entities_source_consistency CHECK (
    (source = 'adapter' AND device_id IS NOT NULL
       AND (package_id IS NOT NULL) <> (integration_id IS NOT NULL))
    OR (source = 'derived' AND package_id IS NULL AND integration_id IS NULL)
    OR (source = 'system')
    OR (source = 'container' AND device_id IS NOT NULL AND package_id IS NULL
          AND integration_id IS NULL)
  );

-- A device that goes leaves its aliases on the shared device rather than taking them with it,
-- and the shared device itself cannot go.
-- Security definer: whichever service removes the device (`hub` removes Modbus devices), the move
-- is the platform's, not that service's grant on entities.
CREATE FUNCTION registry.devices_keep_aliases() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, registry AS $$
DECLARE
  shared uuid;
BEGIN
  IF OLD.source = 'virtual' AND OLD.external_id = 'aliases' THEN
    RAISE EXCEPTION 'The shared Aliases device cannot be removed'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO shared FROM registry.devices
    WHERE source = 'virtual' AND external_id = 'aliases';

  UPDATE registry.entities
    SET device_id = shared, updated_at = now()
    WHERE device_id = OLD.id AND source = 'derived';

  RETURN OLD;
END;
$$;

CREATE TRIGGER devices_keep_aliases
  BEFORE DELETE ON registry.devices
  FOR EACH ROW EXECUTE FUNCTION registry.devices_keep_aliases();

CREATE TABLE registry.aliases (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid        NOT NULL UNIQUE REFERENCES registry.entities (id) ON DELETE CASCADE,
  -- What it behaves as: one of the types of contracts' alias-types.ts.
  behaves_as        text        NOT NULL,
  -- For a custom alias: the package entity type, { packageId, type }.
  custom_type       jsonb,
  -- Every part by key: { from, ...its source, ...its settings } (contracts' alias-parts.ts).
  parts             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- One file of code for the whole alias; empty when no part comes from code.
  code              text        NOT NULL DEFAULT '',
  -- What the code keeps between runs, and the cases it is tried against.
  memory            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  cases             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- How it is shown: { deviceClass, unit, precision }.
  display           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  debounce_ms       integer     NOT NULL DEFAULT 0,
  fallback_policy   text        NOT NULL DEFAULT 'unavailable',
  is_enabled        boolean     NOT NULL DEFAULT true,
  -- Why it failed last: { message, part, function, line, column, since, count, inputs }.
  last_error        jsonb,
  last_evaluated_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT aliases_behaves_as CHECK (behaves_as ~ '^[a-z][a-z_]{0,31}$'),
  CONSTRAINT aliases_parts_object CHECK (jsonb_typeof(parts) = 'object'),
  CONSTRAINT aliases_memory_object CHECK (jsonb_typeof(memory) = 'object'),
  CONSTRAINT aliases_cases_array CHECK (jsonb_typeof(cases) = 'array'),
  CONSTRAINT aliases_display_object CHECK (jsonb_typeof(display) = 'object'),
  CONSTRAINT aliases_code_length CHECK (length(code) <= 100000),
  CONSTRAINT aliases_memory_size CHECK (length(memory::text) <= 16384),
  CONSTRAINT aliases_debounce_range CHECK (debounce_ms BETWEEN 0 AND 3600000),
  CONSTRAINT aliases_fallback_policy
    CHECK (fallback_policy IN ('unavailable', 'ignore_missing', 'last_known'))
);

CREATE INDEX aliases_created_by_idx ON registry.aliases (created_by);

CREATE TABLE registry.alias_reads (
  alias_id  uuid NOT NULL REFERENCES registry.aliases (id) ON DELETE CASCADE,
  entity_id text NOT NULL,

  PRIMARY KEY (alias_id, entity_id),
  CONSTRAINT alias_reads_entity_id_format
    CHECK (entity_id ~ '^[a-z][a-z0-9_]{0,31}\.[a-z0-9][a-z0-9_]{0,63}$')
);

CREATE INDEX alias_reads_entity_id_idx ON registry.alias_reads (entity_id);

CREATE TRIGGER aliases_touch_updated_at
  BEFORE UPDATE ON registry.aliases
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

-- `core` and `api` have the registry's default privileges on the two new tables.
