-- 0014_entity_time_capabilities.sql
--
-- The `time` domain joins the contract, with three capabilities: `time_of_day` (a wake-up time,
-- the start of a charging window), `date` (the day a holiday ends) and `datetime` (when a boost
-- stops). The check on `registry.entity_capabilities.capability` is the contract's list, so it is
-- replaced by the longer one; no row changes.
--
-- Rollback: DELETE FROM registry.entity_capabilities
--             WHERE capability IN ('time_of_day', 'date', 'datetime');
--           ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;
--           ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
--             CHECK (capability IN (
--               'on_off', 'level', 'color_hs', 'color_temp', 'effect', 'cover', 'lock',
--               'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
--               'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
--               'vacuum', 'fan', 'location', 'image', 'custom'));
--           DELETE FROM system.schema_migrations WHERE name = '0014_entity_time_capabilities.sql';

ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;

ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
  CHECK (capability IN (
    'on_off', 'level', 'color_hs', 'color_temp', 'effect', 'cover', 'lock',
    'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
    'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
    'time_of_day', 'date', 'datetime',
    'vacuum', 'fan', 'location', 'image', 'custom'
  ));
