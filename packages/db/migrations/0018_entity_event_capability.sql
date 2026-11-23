-- 0018_entity_event_capability.sql
--
-- The `event` domain joins the contract, with its capability `event`: something that happens and
-- is over (a button pressed twice, the doorbell), its state the last type and when it came. The
-- check on `registry.entity_capabilities.capability` is the contract's list, so it is replaced by
-- the longer one; no row changes.
--
-- Rollback: DELETE FROM registry.entity_capabilities WHERE capability = 'event';
--           ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;
--           ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
--             CHECK (capability IN (
--               'on_off', 'level', 'color_hs', 'color_temp', 'effect', 'cover', 'lock',
--               'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
--               'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
--               'time_of_day', 'date', 'datetime', 'calendar',
--               'vacuum', 'fan', 'location', 'image', 'custom'));
--           DELETE FROM system.schema_migrations WHERE name = '0018_entity_event_capability.sql';

ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;

ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
  CHECK (capability IN (
    'on_off', 'level', 'color_hs', 'color_temp', 'effect', 'cover', 'lock',
    'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
    'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
    'time_of_day', 'date', 'datetime', 'calendar', 'event',
    'vacuum', 'fan', 'location', 'image', 'custom'
  ));
