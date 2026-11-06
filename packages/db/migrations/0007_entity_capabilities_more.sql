-- 0007_entity_capabilities_more.sql
--
-- Three capabilities join the contract's list: `effect` (a lamp's effects), `fan` (speed, presets,
-- oscillation, direction) and `location` (where a tracked thing or an event is). The check on
-- `registry.entity_capabilities.capability` is the contract's list, so it is replaced by the
-- longer one; no row changes.
--
-- Rollback: DELETE FROM registry.entity_capabilities WHERE capability IN ('effect', 'fan', 'location');
--           ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;
--           ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
--             CHECK (capability IN (
--               'on_off', 'level', 'color_hs', 'color_temp', 'cover', 'lock',
--               'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
--               'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
--               'vacuum', 'image', 'custom'));
--           DELETE FROM system.schema_migrations WHERE name = '0007_entity_capabilities_more.sql';

ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;

ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
  CHECK (capability IN (
    'on_off', 'level', 'color_hs', 'color_temp', 'effect', 'cover', 'lock',
    'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
    'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
    'vacuum', 'fan', 'location', 'image', 'custom'
  ));
