-- 0002_modbus_broker.sql
--
-- The house's Modbus broker: the hub is the Modbus TCP client of every gateway on the network,
-- and keeps here what the owner gave it - the templates a device is read through, the devices
-- (a template at an address), the servers found on the network the owner ignores, and whether
-- and where the network is searched.
--
-- `hub` is the only writer: the owner's changes reach it over the bus through `api`, as the
-- MQTT broker's do. The servers a search found are not kept; they are found again.
--
-- Rollback: DROP TABLE registry.modbus_devices, registry.modbus_templates,
--           registry.modbus_ignored, registry.modbus_settings;
--           DELETE FROM system.schema_migrations WHERE name = '0002_modbus_broker.sql';
--           Nothing else references these tables. The Modbus devices of the house stay
--           registered and stop answering until removed.

-- ------------------------------------------------------------------------------------------
-- registry: modbus_settings
--
-- One row: whether the network is searched for Modbus servers, where, and how often, and how
-- the last search went. `search_ranges` holds what the owner wrote - a network `10.0.0.0/24`,
-- a span `10.0.0.20-10.0.0.40` or one address - checked by `hub`; empty means the networks the
-- hub is on, up to a /22 each. A single-row table keyed by a constant, rather than a uuid:
-- there is never a second set of these settings to tell apart.

CREATE TABLE registry.modbus_settings (
  id                      smallint    PRIMARY KEY DEFAULT 1,
  is_search_enabled       boolean     NOT NULL DEFAULT false,
  search_ranges           text[]      NOT NULL DEFAULT '{}',
  search_interval_minutes integer     NOT NULL DEFAULT 120,
  last_search_at          timestamptz,
  last_search_ms          integer,
  last_search_addresses   integer,
  last_search_answered    integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT modbus_settings_single CHECK (id = 1),
  CONSTRAINT modbus_settings_interval_range CHECK (search_interval_minutes BETWEEN 15 AND 1440),
  CONSTRAINT modbus_settings_ranges_count CHECK (cardinality(search_ranges) <= 16)
);

INSERT INTO registry.modbus_settings DEFAULT VALUES;

-- ------------------------------------------------------------------------------------------
-- registry: modbus_templates
--
-- The owner's templates: a device's entities, each capability mapped to the register it is
-- read from and the command it is written with. The document is the template file as the
-- editor writes it, checked by `hub` against the contract before it is stored. Templates an
-- integration ships are its drivers' files and have no row.

CREATE TABLE registry.modbus_templates (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document   jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT modbus_templates_document_object CHECK (jsonb_typeof(document) = 'object')
);

-- ------------------------------------------------------------------------------------------
-- registry: modbus_devices
--
-- The Modbus devices of the house: a template at an address. `unit_id` tells the devices
-- behind one gateway apart. A device is read through one of the owner's templates
-- (`template_id`) or an integration's driver (`template_kind`, `vendor/driver`), never both; a
-- driver's integration removed leaves the row, which comes back with it. `poll_seconds`
-- overrides the template's when set.

CREATE TABLE registry.modbus_devices (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  host          text        NOT NULL,
  port          integer     NOT NULL DEFAULT 502,
  unit_id       integer     NOT NULL DEFAULT 1,
  framing       text        NOT NULL DEFAULT 'tcp',
  template_id   uuid        REFERENCES registry.modbus_templates (id) ON DELETE RESTRICT,
  template_kind text,
  poll_seconds  integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT modbus_devices_name_length CHECK (length(name) BETWEEN 1 AND 128),
  CONSTRAINT modbus_devices_host_length CHECK (length(host) BETWEEN 1 AND 253),
  CONSTRAINT modbus_devices_port_range CHECK (port BETWEEN 1 AND 65535),
  CONSTRAINT modbus_devices_unit_range CHECK (unit_id BETWEEN 1 AND 247),
  CONSTRAINT modbus_devices_framing_known CHECK (framing IN ('tcp', 'rtu')),
  CONSTRAINT modbus_devices_one_template CHECK ((template_id IS NULL) <> (template_kind IS NULL)),
  CONSTRAINT modbus_devices_kind_format
    CHECK (template_kind ~ '^[a-z][a-z0-9-]{1,63}/[a-z0-9][a-z0-9-]{1,63}$'),
  CONSTRAINT modbus_devices_poll_range CHECK (poll_seconds BETWEEN 1 AND 3600),
  CONSTRAINT modbus_devices_address_unique UNIQUE (host, port, unit_id)
);

CREATE INDEX modbus_devices_template_id_idx ON registry.modbus_devices (template_id);

-- ------------------------------------------------------------------------------------------
-- registry: modbus_ignored
--
-- The servers found on the network the owner ignores: never offered again until the owner
-- stops ignoring them.

CREATE TABLE registry.modbus_ignored (
  host       text        NOT NULL,
  port       integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (host, port),
  CONSTRAINT modbus_ignored_host_length CHECK (length(host) BETWEEN 1 AND 253),
  CONSTRAINT modbus_ignored_port_range CHECK (port BETWEEN 1 AND 65535)
);

-- ------------------------------------------------------------------------------------------
-- Triggers and grants

CREATE TRIGGER modbus_settings_touch_updated_at
  BEFORE UPDATE ON registry.modbus_settings
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER modbus_templates_touch_updated_at
  BEFORE UPDATE ON registry.modbus_templates
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER modbus_devices_touch_updated_at
  BEFORE UPDATE ON registry.modbus_devices
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

-- `hub` runs the broker, so it is the one that writes all four. `core` and `api` already have
-- the registry's default privileges.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON registry.modbus_settings, registry.modbus_templates, registry.modbus_devices,
     registry.modbus_ignored
  TO nebula_hub;
