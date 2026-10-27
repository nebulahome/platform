-- 0003_brokers_ir_serial_bt_thread.sql
--
-- Four more brokers of the platform - Serial, Bluetooth, Infrared and Thread - and the networks
-- Matter gives a device it pairs itself over Bluetooth. What each keeps here is what the owner
-- gave it or what must survive a restart: the serial ports seen and who holds each, the Bluetooth
-- proxies and the addresses ignored, the remotes learned and their buttons, how Thread is set up,
-- and the Wi-Fi a new Matter device joins.
--
-- `hub` is the only writer: the owner's changes reach it over the bus through `api`, as the
-- Modbus broker's do. What is heard - adverts, nodes, border routers - is not kept; it is heard
-- again. Thread's network key and dataset are never stored: they stay in the border router.
--
-- A device's role is held by its integration instance (`registry.integrations.id`), the id the
-- hub addresses it by and the contracts call `deviceId`: a port's holder, a remote's blaster, a
-- proxy.
--
-- Rollback: DROP TABLE registry.matter_networks, registry.thread_settings,
--           registry.infrared_buttons, registry.infrared_remotes, registry.bluetooth_ignored,
--           registry.bluetooth_proxies, registry.bluetooth_settings, registry.serial_ports,
--           registry.serial_settings;
--           DELETE FROM system.schema_migrations WHERE name = '0003_brokers_ir_serial_bt_thread.sql';
--           Nothing else references these tables. The remotes' devices and the devices on serial
--           ports stay registered and stop answering until removed.

-- ------------------------------------------------------------------------------------------
-- registry: serial_settings
--
-- One row: whether built-in `ttyS*` ports are listed, most of which are wired to nothing.

CREATE TABLE registry.serial_settings (
  id           smallint    PRIMARY KEY DEFAULT 1,
  show_builtin boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT serial_settings_single CHECK (id = 1)
);

INSERT INTO registry.serial_settings DEFAULT VALUES;

-- ------------------------------------------------------------------------------------------
-- registry: serial_ports
--
-- Every serial port the server has seen, and those the owner added on the network. A port is
-- known by its stable path - `/dev/serial/by-id/...` when it has one, its `/dev` path otherwise,
-- `tcp://host:port` on the network - so it keeps its id, its holder and its line when it is
-- unplugged and comes back. `usb` is what the adapter said of itself (vendor and product ids,
-- serial number, strings); `network` is `{ host, port, protocol }`.
--
-- A port has at most one holder: a device (its integration instance) or a broker. The console
-- holds a port only while it is open and a managed container's port comes from its spec, so
-- neither is kept. A holder's line - baud rate and framing - is kept beside it.

CREATE TABLE registry.serial_ports (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_path           text        NOT NULL UNIQUE,
  kind                  text        NOT NULL,
  name                  text        NOT NULL,
  usb                   jsonb,
  network               jsonb,
  holder_integration_id text        REFERENCES registry.integrations (id) ON DELETE SET NULL,
  holder_broker         text,
  line                  jsonb,
  is_ignored            boolean     NOT NULL DEFAULT false,
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT serial_ports_stable_path_length CHECK (length(stable_path) BETWEEN 1 AND 512),
  CONSTRAINT serial_ports_kind_known CHECK (kind IN ('usb', 'builtin', 'network')),
  CONSTRAINT serial_ports_name_length CHECK (length(name) BETWEEN 1 AND 256),
  CONSTRAINT serial_ports_usb_only
    CHECK (usb IS NULL OR (kind = 'usb' AND jsonb_typeof(usb) = 'object')),
  CONSTRAINT serial_ports_network_kind
    CHECK ((kind = 'network') = (network IS NOT NULL AND jsonb_typeof(network) = 'object')),
  CONSTRAINT serial_ports_one_holder
    CHECK (holder_integration_id IS NULL OR holder_broker IS NULL),
  CONSTRAINT serial_ports_holder_broker_known CHECK (holder_broker IN ('thread')),
  CONSTRAINT serial_ports_line_object CHECK (line IS NULL OR jsonb_typeof(line) = 'object')
);

CREATE INDEX serial_ports_holder_integration_id_idx
  ON registry.serial_ports (holder_integration_id);

-- ------------------------------------------------------------------------------------------
-- registry: bluetooth_settings
--
-- One row: whether the server's own adapter is used and which (`hci0`; null for the first BlueZ
-- has), how it and new proxies scan, how long an address not heard is remembered, and whether
-- Nearby lists private addresses.

CREATE TABLE registry.bluetooth_settings (
  id                smallint    PRIMARY KEY DEFAULT 1,
  local_enabled     boolean     NOT NULL DEFAULT true,
  adapter_id        text,
  local_scan_mode   text        NOT NULL DEFAULT 'active',
  proxy_scan_mode   text        NOT NULL DEFAULT 'passive',
  forget_after_days integer     NOT NULL DEFAULT 7,
  show_private      boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bluetooth_settings_single CHECK (id = 1),
  CONSTRAINT bluetooth_settings_adapter_format CHECK (adapter_id ~ '^hci[0-9]{1,3}$'),
  CONSTRAINT bluetooth_settings_local_scan_mode_known
    CHECK (local_scan_mode IN ('passive', 'active')),
  CONSTRAINT bluetooth_settings_proxy_scan_mode_known
    CHECK (proxy_scan_mode IN ('passive', 'active')),
  CONSTRAINT bluetooth_settings_forget_range CHECK (forget_after_days BETWEEN 1 AND 365)
);

INSERT INTO registry.bluetooth_settings DEFAULT VALUES;

-- ------------------------------------------------------------------------------------------
-- registry: bluetooth_proxies
--
-- The devices made Bluetooth proxies: how each scans, and the script version installed, so an
-- outdated one is offered an update. The row goes with its device.

CREATE TABLE registry.bluetooth_proxies (
  integration_id text        PRIMARY KEY REFERENCES registry.integrations (id) ON DELETE CASCADE,
  scan_mode      text        NOT NULL DEFAULT 'passive',
  script_version text,
  installed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bluetooth_proxies_scan_mode_known CHECK (scan_mode IN ('passive', 'active')),
  CONSTRAINT bluetooth_proxies_script_version_length
    CHECK (length(script_version) BETWEEN 1 AND 64)
);

-- ------------------------------------------------------------------------------------------
-- registry: bluetooth_ignored
--
-- The addresses the owner ignores: never offered in Found again. The name it advertised then is
-- kept for the Ignored fold.

CREATE TABLE registry.bluetooth_ignored (
  address    text        PRIMARY KEY,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bluetooth_ignored_address_format
    CHECK (address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  CONSTRAINT bluetooth_ignored_name_length CHECK (length(name) <= 248)
);

-- ------------------------------------------------------------------------------------------
-- registry: infrared_remotes
--
-- The remotes the house learned. Each is a device of the platform's `infrared` vendor, its
-- device key `infrared-<id>`, added by `hub` the way a Modbus device is. Its blaster is the
-- instance its codes are sent through: removed, the remote keeps its buttons and waits for
-- another. `column_count` is how many columns its keypad has.

CREATE TABLE registry.infrared_remotes (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text        NOT NULL,
  kind                   text        NOT NULL DEFAULT 'other',
  blaster_integration_id text        REFERENCES registry.integrations (id) ON DELETE SET NULL,
  column_count           integer     NOT NULL DEFAULT 3,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT infrared_remotes_name_length CHECK (length(name) BETWEEN 1 AND 128),
  CONSTRAINT infrared_remotes_kind_known
    CHECK (kind IN ('tv', 'air-conditioner', 'fan', 'audio', 'light', 'other')),
  CONSTRAINT infrared_remotes_column_range CHECK (column_count BETWEEN 1 AND 6)
);

CREATE INDEX infrared_remotes_blaster_integration_id_idx
  ON registry.infrared_remotes (blaster_integration_id);

-- ------------------------------------------------------------------------------------------
-- registry: infrared_buttons
--
-- The buttons of a remote, each a `button` entity of its device. `cell` is its place on the
-- keypad, counted along the rows from 0, one button a cell. `code` is the code in the platform's
-- shape - `{ signal, carrierHz, frequencyHz?, pulses, protocol? }`, checked by `hub` against the
-- contract - never a blaster's own format, so a remote moves to another blaster without learning
-- again.

CREATE TABLE registry.infrared_buttons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id       uuid        NOT NULL REFERENCES registry.infrared_remotes (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  icon            text,
  cell            integer     NOT NULL,
  code            jsonb       NOT NULL,
  last_pressed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT infrared_buttons_name_length CHECK (length(name) BETWEEN 1 AND 64),
  CONSTRAINT infrared_buttons_cell_range CHECK (cell BETWEEN 0 AND 1023),
  CONSTRAINT infrared_buttons_code_object CHECK (jsonb_typeof(code) = 'object'),
  CONSTRAINT infrared_buttons_cell_unique UNIQUE (remote_id, cell)
);

-- ------------------------------------------------------------------------------------------
-- registry: thread_settings
--
-- One row: whose border router the house's Thread network goes through - none, the platform's
-- own on a radio of this server (`radio_port_id`), or an external one by the URL of its REST API
-- - and whether the network is handed to Matter for devices it pairs over Bluetooth.

CREATE TABLE registry.thread_settings (
  id             smallint    PRIMARY KEY DEFAULT 1,
  mode           text        NOT NULL DEFAULT 'none',
  external_url   text,
  radio_port_id  uuid        REFERENCES registry.serial_ports (id) ON DELETE SET NULL,
  use_for_matter boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT thread_settings_single CHECK (id = 1),
  CONSTRAINT thread_settings_mode_known CHECK (mode IN ('none', 'local', 'external')),
  CONSTRAINT thread_settings_external_needs_url
    CHECK (mode <> 'external' OR external_url IS NOT NULL),
  CONSTRAINT thread_settings_external_url_format
    CHECK (external_url ~ '^https?://' AND length(external_url) <= 512)
);

INSERT INTO registry.thread_settings DEFAULT VALUES;

-- ------------------------------------------------------------------------------------------
-- registry: matter_networks
--
-- One row: the Wi-Fi a device Matter pairs itself joins, its password sealed under
-- NEBULA_SECRETS_KEY as `{ "$sealed": "v1:..." }` like any other secret at rest. Thread is not
-- kept here: it is read from the Thread broker.

CREATE TABLE registry.matter_networks (
  id                   smallint    PRIMARY KEY DEFAULT 1,
  wifi_ssid            text,
  wifi_password_sealed jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT matter_networks_single CHECK (id = 1),
  CONSTRAINT matter_networks_ssid_length CHECK (length(wifi_ssid) BETWEEN 1 AND 32),
  CONSTRAINT matter_networks_password_needs_ssid
    CHECK (wifi_password_sealed IS NULL OR wifi_ssid IS NOT NULL),
  CONSTRAINT matter_networks_password_sealed
    CHECK (wifi_password_sealed IS NULL
           OR jsonb_typeof(wifi_password_sealed -> '$sealed') = 'string')
);

INSERT INTO registry.matter_networks DEFAULT VALUES;

-- ------------------------------------------------------------------------------------------
-- Triggers and grants

CREATE TRIGGER serial_settings_touch_updated_at
  BEFORE UPDATE ON registry.serial_settings
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER serial_ports_touch_updated_at
  BEFORE UPDATE ON registry.serial_ports
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER bluetooth_settings_touch_updated_at
  BEFORE UPDATE ON registry.bluetooth_settings
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER bluetooth_proxies_touch_updated_at
  BEFORE UPDATE ON registry.bluetooth_proxies
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER infrared_remotes_touch_updated_at
  BEFORE UPDATE ON registry.infrared_remotes
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER infrared_buttons_touch_updated_at
  BEFORE UPDATE ON registry.infrared_buttons
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER thread_settings_touch_updated_at
  BEFORE UPDATE ON registry.thread_settings
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER matter_networks_touch_updated_at
  BEFORE UPDATE ON registry.matter_networks
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

-- `hub` runs the brokers, so it is the one that writes all nine. `core` and `api` already have
-- the registry's default privileges.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON registry.serial_settings, registry.serial_ports, registry.bluetooth_settings,
     registry.bluetooth_proxies, registry.bluetooth_ignored, registry.infrared_remotes,
     registry.infrared_buttons, registry.thread_settings, registry.matter_networks
  TO nebula_hub;
