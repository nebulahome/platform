-- 0015_device_parents.sql
--
-- A device can name the device it is part of: the EPS output and the dry contact of an inverter
-- name the inverter. The child keeps the parent's `external_id` (the serial, for SolaX), written
-- by `core` from what the integration declares, and the parent is found by reading: same vendor,
-- same `external_id`. No foreign key, so the order the two arrive in does not matter and a parent
-- removed and added again gathers its children by itself.
--
-- The candidates the owner dismissed from the Found list are kept here too, so a dismissal
-- outlives the candidate going quiet and the hub restarting. `key` is the candidate's identity:
-- its `external_id`, or `@` and its address when it has none. Written by `hub` alone.
--
-- Rollback: DROP TABLE registry.discovery_dismissed;
--           ALTER TABLE registry.devices DROP COLUMN parent_external_id;
--           DELETE FROM system.schema_migrations WHERE name = '0015_device_parents.sql';

ALTER TABLE registry.devices
  ADD COLUMN parent_external_id text;

CREATE TABLE registry.discovery_dismissed (
  vendor_id    text        NOT NULL,
  key          text        NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (vendor_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON registry.discovery_dismissed
  TO nebula_hub;
