-- 0001_initial_schema.sql
--
-- The initial NebulaHome schema: four schemas, 41 tables, four views and the TimescaleDB
-- hypertables, plus the roles, grants and seed data an installation needs to boot.
--
-- Object order follows DATABASE.md 13 rather than the reading order of that document, because
-- foreign keys cross schema boundaries in both directions.
--
-- Everything runs in one transaction, so a failure leaves no half-created database behind.
-- Continuous aggregates were verified to work inside a transaction block on TimescaleDB 2.29;
-- older releases restricted this, so the runner keeps a marker for opting a file out.
--
-- Rollback: DROP SCHEMA auth, registry, history, system CASCADE, then DROP the roles.
--           There is nothing to preserve - this migration is what creates the database.

-- --------------------------------------------------------------------------------------

-- Extensions and schemas

-- --------------------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive usernames and emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy entity search

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS registry;
CREATE SCHEMA IF NOT EXISTS history;
CREATE SCHEMA IF NOT EXISTS system;

-- --------------------------------------------------------------------------------------

-- The one permitted trigger function

-- --------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION system.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------------------

-- auth: roles and the permission catalogue

-- --------------------------------------------------------------------------------------

CREATE TABLE auth.roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  is_builtin  boolean     NOT NULL DEFAULT false,
  sort_order  smallint    NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT roles_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$')
);

CREATE TABLE auth.permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL UNIQUE,        -- 'entity:control'
  resource    text        NOT NULL,               -- 'entity'
  action      text        NOT NULL,               -- 'control'
  description text        NOT NULL DEFAULT '',
  is_scopable boolean     NOT NULL DEFAULT false, -- may be narrowed to an area or entity
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT permissions_key_format CHECK (key ~ '^[a-z_]+:[a-z_]+$'),
  CONSTRAINT permissions_key_matches_parts CHECK (key = resource || ':' || action)
);

-- --------------------------------------------------------------------------------------

-- auth: users

-- --------------------------------------------------------------------------------------

CREATE TABLE auth.users (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username              citext      NOT NULL,
  email                 citext,
  display_name          text        NOT NULL,
  password_hash         text        NOT NULL,          -- argon2id, encoded string
  role_id               uuid        NOT NULL REFERENCES auth.roles (id) ON DELETE RESTRICT,
  locale                text        NOT NULL DEFAULT 'en',
  timezone              text        NOT NULL DEFAULT 'UTC',
  is_active             boolean     NOT NULL DEFAULT true,
  must_change_password  boolean     NOT NULL DEFAULT false,
  failed_login_count    integer     NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- The cast to text is required: `~` on a citext column is case-insensitive, so without it
  -- the pattern would accept 'Mattia' and the column would not actually be lower case.
  CONSTRAINT users_username_format CHECK (username::text ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  CONSTRAINT users_failed_login_count_non_negative CHECK (failed_login_count >= 0)
);

CREATE UNIQUE INDEX users_username_active_key
  ON auth.users (username) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_active_key
  ON auth.users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX users_role_id_idx ON auth.users (role_id);

-- --------------------------------------------------------------------------------------

-- auth: grants, sessions, tokens and two-factor

-- --------------------------------------------------------------------------------------

CREATE TABLE auth.role_permissions (
  role_id       uuid        NOT NULL REFERENCES auth.roles (id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES auth.permissions (id) ON DELETE CASCADE,
  scope         text        NOT NULL DEFAULT '*',
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (role_id, permission_id, scope),
  CONSTRAINT role_permissions_scope_format
    CHECK (scope = '*' OR scope ~ '^(area|entity|tag)\.[a-z0-9_.]+$')
);

CREATE INDEX role_permissions_permission_id_idx ON auth.role_permissions (permission_id);

CREATE TABLE auth.user_permissions (
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES auth.permissions (id) ON DELETE CASCADE,
  scope         text        NOT NULL DEFAULT '*',
  effect        text        NOT NULL DEFAULT 'allow',
  granted_by    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, permission_id, scope),
  CONSTRAINT user_permissions_effect CHECK (effect IN ('allow', 'deny')),
  CONSTRAINT user_permissions_scope_format
    CHECK (scope = '*' OR scope ~ '^(area|entity|tag)\.[a-z0-9_.]+$')
);

CREATE INDEX user_permissions_permission_id_idx ON auth.user_permissions (permission_id);
CREATE INDEX user_permissions_expires_at_idx
  ON auth.user_permissions (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE auth.sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoked_reason text,

  CONSTRAINT sessions_revoked_reason
    CHECK (revoked_reason IS NULL
           OR revoked_reason IN ('logout', 'expired', 'token_reuse', 'admin', 'password_change',
                                 'restore'))
);

CREATE INDEX sessions_user_id_idx ON auth.sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON auth.sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth.refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES auth.sessions (id) ON DELETE CASCADE,
  token_hash  bytea       NOT NULL UNIQUE,       -- sha256 of the opaque token
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  replaced_by uuid        REFERENCES auth.refresh_tokens (id) ON DELETE SET NULL,
  revoked_at  timestamptz
);

CREATE INDEX refresh_tokens_session_id_idx ON auth.refresh_tokens (session_id);
CREATE INDEX refresh_tokens_expires_at_idx ON auth.refresh_tokens (expires_at);

CREATE TABLE auth.access_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  token_hash   bytea       NOT NULL UNIQUE,
  token_prefix text        NOT NULL,             -- 'nbh_a1b2c3', shown in the UI for recognition
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, name)
);

CREATE INDEX access_tokens_user_id_idx ON auth.access_tokens (user_id);

CREATE TABLE auth.access_token_permissions (
  access_token_id uuid NOT NULL REFERENCES auth.access_tokens (id) ON DELETE CASCADE,
  permission_id   uuid NOT NULL REFERENCES auth.permissions (id) ON DELETE CASCADE,
  scope           text NOT NULL DEFAULT '*',

  PRIMARY KEY (access_token_id, permission_id, scope)
);

CREATE INDEX access_token_permissions_permission_id_idx
  ON auth.access_token_permissions (permission_id);

CREATE TABLE auth.totp_secrets (
  user_id      uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  secret       bytea       NOT NULL,             -- encrypted with the instance key, never plaintext
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.totp_recovery_codes (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  code_hash bytea       NOT NULL,
  used_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX totp_recovery_codes_user_id_idx ON auth.totp_recovery_codes (user_id);

-- A picture for each person, so a list of accounts is scannable by face rather than by reading
-- four names that all begin with M.
--
-- A table of its own rather than columns on `auth.users`, following `auth.totp_secrets`: the
-- users row is read on every authenticated request and on every sign-in, and a `bytea` sitting
-- in it would be dragged along by any query that ever forgets to name its columns. Here it is
-- read only by the code that means to.
--
-- Stored in the database rather than on disk. A self-hosted installation has one backup story -
-- `pg_dump` - and an avatar directory beside it is a thing that silently is not in the backup,
-- then silently is not restored, and shows up months later as a wall of grey circles. The size
-- cap is what makes that affordable, and it is a CHECK rather than an application rule because
-- the cost of getting it wrong is a database nobody can dump.

CREATE TABLE auth.user_avatars (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  image      bytea       NOT NULL,
  mime       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Exactly the three formats every browser this interface supports can both encode from a
  -- canvas and decode. An SVG is deliberately not among them: it is a document, it can carry
  -- script, and it would be served back to every other user of the installation.
  CONSTRAINT user_avatars_mime CHECK (mime IN ('image/webp', 'image/png', 'image/jpeg')),

  -- 64 KiB. A 128-pixel square is a few kilobytes as WebP, so this is several times what the
  -- interface produces and still small enough that a household's worth of them is nothing next
  -- to the history tables.
  CONSTRAINT user_avatars_size CHECK (octet_length(image) BETWEEN 1 AND 65536)
);

-- --------------------------------------------------------------------------------------

-- system: packages, settings and migration bookkeeping

-- --------------------------------------------------------------------------------------

-- Where a package came from (`source`): a release of the package index, or a file of the
-- platform's local folder. Which package is the house's MQTT broker is not kept here: it is the
-- one that provides `mqtt-broker`, and packet-manager installs one when none does.
CREATE TABLE system.packages (
  id               text        PRIMARY KEY,
  version          text        NOT NULL,
  runtime          text        NOT NULL,
  state            text        NOT NULL DEFAULT 'installed',
  source           text        NOT NULL DEFAULT 'index',
  manifest         jsonb       NOT NULL,   -- packageManifestSchema
  config           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  previous_version text,
  artifact_sha256  text,                  -- of the archive it was unpacked from
  last_started_at  timestamptz,
  last_error       text,
  installed_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  installed_by     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT packages_id_format CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  CONSTRAINT packages_runtime CHECK (runtime IN ('node', 'container', 'none')),
  CONSTRAINT packages_state CHECK (state IN (
    'installed', 'starting', 'running', 'stopped', 'failed', 'disabled', 'waiting-dependency'
  )),
  CONSTRAINT packages_source CHECK (source IN ('index', 'local')),
  CONSTRAINT packages_artifact_sha256 CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX packages_state_idx ON system.packages (state);

-- The house as the Community Hub knows it: one registration per Hub address, made the first time
-- the house reports an install (a proof of work, then a token the Hub shows once), and the token
-- every report since is sent with. Sealed under NEBULA_SECRETS_KEY like any other secret. A row
-- of a Hub no longer set is kept: pointing the house back at it reports as the same house.
CREATE TABLE system.community_hub_installations (
  hub_url          text        PRIMARY KEY,
  installation_id  uuid        NOT NULL,
  token            jsonb       NOT NULL,   -- { "$sealed": "v1:…" }
  registered_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT community_hub_installations_url CHECK (hub_url ~ '^https?://')
);

CREATE TABLE system.settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  schema_ref text        NOT NULL,               -- the Zod schema that validates `value`
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT settings_key_format CHECK (key ~ '^[a-z][a-z0-9_.]{1,63}$')
);

-- Guarded because the runner creates this table before applying anything: it cannot record that
-- the initial migration ran into a table that migration is in the middle of creating.
CREATE TABLE IF NOT EXISTS system.schema_migrations (
  id         bigserial   PRIMARY KEY,
  hash       text        NOT NULL,
  created_at bigint      NOT NULL
);

-- --------------------------------------------------------------------------------------

-- registry: areas

-- --------------------------------------------------------------------------------------

-- A tree three deep: the house at the top, floors in it, rooms on each floor. The kind says which
-- level a row is; that a floor's parent is the house and a room's a floor is checked by `api`,
-- not here, as is anything deeper than one level of the tree. There is one house - an
-- installation is one home - and the partial unique index below is what holds that under a
-- race. The house is the only kind that stands somewhere, so only the house carries a position -
-- two numbers or none, never one. Removing a floor removes its rooms: a room off its floor is
-- not a place anybody meant.
CREATE TABLE registry.areas (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  kind       text        NOT NULL,
  parent_id  uuid        REFERENCES registry.areas (id) ON DELETE CASCADE,
  icon       text,
  sort_order smallint    NOT NULL DEFAULT 100,
  level      smallint,                          -- which storey a floor is: 0 ground, -1 cellar
  latitude   double precision,
  longitude  double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT areas_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT areas_kind CHECK (kind IN ('house', 'floor', 'room')),
  CONSTRAINT areas_level_on_floor CHECK ((kind = 'floor') = (level IS NOT NULL)),
  CONSTRAINT areas_level_range CHECK (level IS NULL OR level BETWEEN -20 AND 200),
  CONSTRAINT areas_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT areas_position_whole CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT areas_position_on_house CHECK (kind = 'house' OR latitude IS NULL),
  CONSTRAINT areas_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT areas_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX areas_parent_id_idx ON registry.areas (parent_id);
CREATE UNIQUE INDEX areas_one_house_idx ON registry.areas ((kind)) WHERE kind = 'house';
-- Two floors that are both "1" is a house nobody can draw.
CREATE UNIQUE INDEX areas_floor_level_idx ON registry.areas (level) WHERE kind = 'floor';

-- --------------------------------------------------------------------------------------

-- registry: integrations

-- --------------------------------------------------------------------------------------
--
-- One configured integration instance: a driver bundle bound to a transport, with the settings
-- the owner supplied. Created before devices because a device points at the instance that owns
-- it.
--
-- The row id is what `entities.source` carries and what `core` uses as the subject token when
-- it routes a command, so it shares one namespace with `system.packages.id` and has the same
-- format. A collision would make two owners answer `svc.<id>.command`, which is an ambiguity
-- rather than an error. A CHECK cannot see another table and RULES.md 13 permits no trigger
-- beyond the `updated_at` touch, so the collision is refused by whoever writes the row: `api`
-- when the owner adds an instance, and `hub` when it loads one.
--
-- `kind` and `transport` deliberately carry no CHECK. They are resolved against the registries
-- `hub` builds from the bundles it loaded, and an unknown value leaves the instance in `failed`
-- with `last_error` set, which the interface can show. A CHECK here would instead mean a
-- migration for every transport ever added, and a failure at write time for a bundle that is
-- merely not installed yet.
--
-- One instance is one device. `api` writes this row and the `registry.devices` row that names
-- the device in one transaction; `hub` runs the instance, identifies the device - the serial on
-- the broker, the id the relay answers with - and asks `core` to complete the registry row.
-- `identifying` is the state in between: the transport is open, and nothing has answered yet.
--
-- Configuration is written by `api`, runtime status by `hub`. That split is why the grants
-- further down are column-level rather than a blanket UPDATE.

CREATE TABLE registry.integrations (
  id               text        PRIMARY KEY,
  kind             text        NOT NULL,   -- the driver, vendor-qualified: 'shelly/dimmer-pm'
  kind_version     text        NOT NULL,
  model            text,                   -- the model the owner picked: 'X1C'; null when never picked
  transport        text        NOT NULL,   -- 'http', 'mqtt', ...
  transport_config jsonb       NOT NULL DEFAULT '{}'::jsonb,
  options          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_enabled       boolean     NOT NULL DEFAULT true,
  state            text        NOT NULL DEFAULT 'stopped',
  last_error       text,
  last_started_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT integrations_id_format CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  CONSTRAINT integrations_state CHECK (state IN (
    'stopped', 'starting', 'identifying', 'running', 'failed', 'disabled'
  ))
);

CREATE INDEX integrations_state_idx ON registry.integrations (state);

-- --------------------------------------------------------------------------------------

-- registry: integration_vendors

-- --------------------------------------------------------------------------------------
--
-- What every device of one vendor shares: the settings a vendor bundle's own `setup.json`
-- asks for - a cloud API key, an account - as the owner supplied them. One row per vendor,
-- and only for the vendors whose settings the owner has saved; the bundles themselves live on
-- `hub`'s disk and are listed from there, so a vendor without a row is still a vendor.
--
-- The id is the vendor bundle's directory name, held to the same shape as an instance id
-- because both are read as identifiers by things that never see the row. No runtime state: a
-- vendor does not run, its instances do, and `hub` reads this row to layer under each of them
-- when it starts one.
--
-- Written by `api` and by nothing else, which is why the grant below gives `hub` SELECT only.

CREATE TABLE registry.integration_vendors (
  id               text        PRIMARY KEY,
  version          text        NOT NULL,   -- the bundle version the settings were saved against
  transport_config jsonb       NOT NULL DEFAULT '{}'::jsonb,
  options          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT integration_vendors_id_format CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$')
);

-- --------------------------------------------------------------------------------------

-- registry: integration_accounts
--
-- The accounts a vendor's devices are reached through - an ECOVACS HOME account, a cloud's -
-- one row per account signed in to, a vendor holding as many as the house has. `id` is the
-- account's own at its cloud, as the bundle's sign-in module said it, which is what a device's
-- configuration names (`transport_config.account`).
--
-- `credentials` is what the owner typed to sign in, its secrets sealed - kept so a session that
-- expires is renewed without the owner - and `session` what the cloud gave back, sealed whole:
-- tokens, a user id. Neither leaves `hub`, which runs the sign-in and is the only writer; `api`
-- reads the rest for the vendor's page. `status` is where the account stands: `needs-sign-in`
-- once the cloud wants the owner again - an emailed code - with why in `last_error`.
--
-- No foreign key to `integration_vendors`: a vendor with an account and no settings has no row
-- there. An account of a vendor no longer loaded is kept, like that vendor's settings, and comes
-- back with it.

CREATE TABLE registry.integration_accounts (
  vendor_id    text        NOT NULL,
  id           text        NOT NULL,
  label        text        NOT NULL,
  status       text        NOT NULL DEFAULT 'connected',
  credentials  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  session      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_error   text,
  connected_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (vendor_id, id),
  CONSTRAINT integration_accounts_vendor_format CHECK (vendor_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  CONSTRAINT integration_accounts_id_format CHECK (id ~ '^[A-Za-z0-9._@:+-]{1,128}$'),
  CONSTRAINT integration_accounts_label_length CHECK (length(label) BETWEEN 1 AND 256),
  CONSTRAINT integration_accounts_status_known
    CHECK (status IN ('connected', 'needs-sign-in', 'failed'))
);

-- --------------------------------------------------------------------------------------

-- registry: icons

-- --------------------------------------------------------------------------------------
--
-- The icons an owner added to the catalogue, or drew afresh over a built-in one. The built-in
-- set ships with the platform and has no rows; a `custom` row is a new id, an `override` row
-- carries the id of a built-in icon and replaces its drawing everywhere that id is used.
--
-- The drawing is kept as the node the interface renders - the flat list of SVG elements the
-- upload was reduced to by `api` - never as the file, so what is stored is exactly what every
-- browser will draw. The frame is the square of the drawing's own coordinates to show, which
-- is how an upload with an odd viewBox is centred to the padding the other icons use.
--
-- Written by `api` and by nothing else. The id shape is the built-in set's own, digit first
-- allowed, because a built-in id has to fit it to be overridden.

CREATE TABLE registry.icons (
  id         text        PRIMARY KEY,
  kind       text        NOT NULL,
  name       text        NOT NULL,
  keywords   text[]      NOT NULL DEFAULT '{}'::text[],
  node       jsonb       NOT NULL,   -- iconNodeSchema
  frame      jsonb       NOT NULL,   -- iconFrameSchema
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT icons_id_format CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  CONSTRAINT icons_kind CHECK (kind IN ('custom', 'override'))
);

-- --------------------------------------------------------------------------------------

-- registry: devices

-- --------------------------------------------------------------------------------------

CREATE TABLE registry.devices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The kind of device, with the words `entities.source` uses. An adapter device has exactly
  -- one owner, enforced by devices_owner_exclusive below: a package installs devices through
  -- `packet-manager`; an integration instance is one, written by `api` beside it and gone with
  -- it. Whichever it is becomes the entity's `source`, so a device with neither has no route for
  -- a command and one with both has two. The system device is the machine the platform runs
  -- on: `core` writes it and its entities at startup, it has no owner, and there is one of it.
  -- A container device is one of the host's containers: `core` writes it when the supervisor
  -- says the container exists and removes it when it is gone; its `external_id` is the
  -- container's name, and the supervisor answers for its entities.
  source         text        NOT NULL DEFAULT 'adapter',
  package_id     text        REFERENCES system.packages (id) ON DELETE RESTRICT,
  integration_id text        UNIQUE REFERENCES registry.integrations (id) ON DELETE CASCADE,
  -- The owner's own identifier for the device: the serial, the id the relay answers with.
  -- Null until `hub` has heard from it; a package always knows it.
  external_id    text,
  name           text        NOT NULL,
  icon           text,                          -- a catalogue icon id, when one is set
  manufacturer   text,
  model          text,
  sw_version     text,
  hw_version     text,
  area_id        uuid        REFERENCES registry.areas (id) ON DELETE SET NULL,
  via_device_id  uuid        REFERENCES registry.devices (id) ON DELETE SET NULL,
  config         jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- deviceConfigSchema
  is_enabled     boolean     NOT NULL DEFAULT true,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (package_id, external_id),
  CONSTRAINT devices_source CHECK (source IN ('adapter', 'system', 'container')),
  CONSTRAINT devices_not_own_parent CHECK (via_device_id IS DISTINCT FROM id),
  CONSTRAINT devices_owner_exclusive CHECK (
    (source = 'adapter' AND (package_id IS NOT NULL) <> (integration_id IS NOT NULL))
    OR (source IN ('system', 'container') AND package_id IS NULL AND integration_id IS NULL)
  )
);

CREATE UNIQUE INDEX devices_one_system_idx ON registry.devices ((source)) WHERE source = 'system';
-- A container's device is found by the container's name, and a name is one container at a time.
CREATE UNIQUE INDEX devices_container_name_idx ON registry.devices (external_id)
  WHERE source = 'container';
CREATE INDEX devices_area_id_idx ON registry.devices (area_id);
CREATE INDEX devices_via_device_id_idx ON registry.devices (via_device_id);
CREATE INDEX devices_package_id_idx ON registry.devices (package_id);

-- --------------------------------------------------------------------------------------

-- registry: entities

-- --------------------------------------------------------------------------------------

CREATE TABLE registry.entities (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           text        NOT NULL UNIQUE,
  domain              text        GENERATED ALWAYS AS (split_part(entity_id, '.', 1)) STORED,
  object_id           text        GENERATED ALWAYS AS (split_part(entity_id, '.', 2)) STORED,
  device_id           uuid        REFERENCES registry.devices (id) ON DELETE CASCADE,
  package_id          text        REFERENCES system.packages (id) ON DELETE RESTRICT,
  integration_id      text        REFERENCES registry.integrations (id) ON DELETE RESTRICT,
  source              text        NOT NULL,
  name                text        NOT NULL,
  icon                text,
  area_id             uuid        REFERENCES registry.areas (id) ON DELETE SET NULL,
  unit_of_measurement text,
  device_class        text,
  state_class         text,
  display_precision   smallint,
  search_aliases      text[]      NOT NULL DEFAULT '{}',
  is_enabled          boolean     NOT NULL DEFAULT true,
  is_hidden           boolean     NOT NULL DEFAULT false,
  config              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entities_entity_id_format
    CHECK (entity_id ~ '^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT entities_source CHECK (source IN ('adapter', 'derived', 'system', 'container')),
  CONSTRAINT entities_state_class
    CHECK (state_class IS NULL
           OR state_class IN ('measurement', 'total', 'total_increasing')),
  CONSTRAINT entities_display_precision_range
    CHECK (display_precision IS NULL OR display_precision BETWEEN 0 AND 6),
  -- An adapter entity belongs to a device and to exactly one owner, a package or an
  -- integration; a derived entity belongs to none of the three. `source` records the kind of
  -- entity rather than which owner it has: an entity a `hub` integration adopted is still an
  -- adapter entity, and `core` treats it identically.
  CONSTRAINT entities_source_consistency CHECK (
    (source = 'adapter' AND device_id IS NOT NULL
       AND (package_id IS NOT NULL) <> (integration_id IS NOT NULL))
    OR (source = 'derived' AND device_id IS NULL AND package_id IS NULL AND integration_id IS NULL)
    OR (source = 'system')
    OR (source = 'container' AND device_id IS NOT NULL AND package_id IS NULL
          AND integration_id IS NULL)
  )
);

CREATE INDEX entities_device_id_idx ON registry.entities (device_id);
CREATE INDEX entities_area_id_idx ON registry.entities (area_id);
CREATE INDEX entities_package_id_idx ON registry.entities (package_id);
CREATE INDEX entities_integration_id_idx ON registry.entities (integration_id);
CREATE INDEX entities_domain_idx ON registry.entities (domain);
CREATE INDEX entities_search_aliases_idx ON registry.entities USING gin (search_aliases);
CREATE INDEX entities_name_trgm_idx ON registry.entities USING gin (name gin_trgm_ops);

-- --------------------------------------------------------------------------------------

-- registry: everything that hangs off an entity

-- --------------------------------------------------------------------------------------

CREATE TABLE registry.entity_capabilities (
  entity_id  uuid        NOT NULL REFERENCES registry.entities (id) ON DELETE CASCADE,
  capability text        NOT NULL,
  params     jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- capabilityParamsSchema
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (entity_id, capability),
  CONSTRAINT entity_capabilities_known CHECK (capability IN (
    'on_off', 'level', 'color_hs', 'color_temp', 'cover', 'lock',
    'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
    'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
    'vacuum', 'image', 'custom'
  ))
);

CREATE INDEX entity_capabilities_capability_idx ON registry.entity_capabilities (capability);

CREATE TABLE registry.entity_states (
  entity_id    uuid        PRIMARY KEY REFERENCES registry.entities (id) ON DELETE CASCADE,
  state        jsonb       NOT NULL,             -- capabilityStateSchema
  attributes   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_available boolean     NOT NULL DEFAULT true,
  last_changed timestamptz NOT NULL,
  last_updated timestamptz NOT NULL,
  source       text        NOT NULL,             -- package id, 'derived', or 'system'
  context_id   uuid,                             -- what caused the change
  context_type text,

  CONSTRAINT entity_states_context_type
    CHECK (context_type IS NULL
           OR context_type IN ('automation', 'scene', 'user', 'device', 'alias', 'startup'))
);

CREATE INDEX entity_states_is_available_idx
  ON registry.entity_states (is_available) WHERE is_available = false;

CREATE TABLE registry.tags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text        NOT NULL UNIQUE,   -- a slug of the name at creation; never changes
  name       text        NOT NULL,
  color      text        NOT NULL,          -- a palette key, not a hex: the interface maps it to a theme token
  icon       text,                           -- a catalogue icon id, when one is set
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT tags_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT tags_color CHECK (color IN (
    'red', 'orange', 'amber', 'yellow', 'lime', 'green',
    'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'
  ))
);

CREATE TABLE registry.entity_tags (
  entity_id uuid NOT NULL REFERENCES registry.entities (id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES registry.tags (id) ON DELETE CASCADE,

  PRIMARY KEY (entity_id, tag_id)
);

CREATE INDEX entity_tags_tag_id_idx ON registry.entity_tags (tag_id);

CREATE TABLE registry.device_tags (
  device_id uuid NOT NULL REFERENCES registry.devices (id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES registry.tags (id) ON DELETE CASCADE,

  PRIMARY KEY (device_id, tag_id)
);

CREATE INDEX device_tags_tag_id_idx ON registry.device_tags (tag_id);

CREATE TABLE registry.aliases (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid        NOT NULL UNIQUE REFERENCES registry.entities (id) ON DELETE CASCADE,
  capability      text        NOT NULL,
  expression      text        NOT NULL,
  debounce_ms     integer     NOT NULL DEFAULT 0,
  fallback_policy text        NOT NULL DEFAULT 'unavailable',
  is_enabled      boolean     NOT NULL DEFAULT true,
  last_error      text,
  last_evaluated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT aliases_debounce_range CHECK (debounce_ms BETWEEN 0 AND 3600000),
  -- Calculated aliases require a non-blank expression; stored helpers forbid one (empty string).
  -- Whitespace-only is neither: it is not a formula and it is not the stored marker.
  CONSTRAINT aliases_expression_kind CHECK (
    length(expression) <= 2000
    AND (expression = '' OR length(btrim(expression)) > 0)
  ),
  CONSTRAINT aliases_fallback_policy
    CHECK (fallback_policy IN ('unavailable', 'ignore_missing', 'last_known'))
);

CREATE INDEX aliases_created_by_idx ON registry.aliases (created_by);

CREATE TABLE registry.alias_sources (
  alias_id      uuid NOT NULL REFERENCES registry.aliases (id) ON DELETE CASCADE,
  variable_name text NOT NULL,
  entity_id     uuid NOT NULL REFERENCES registry.entities (id) ON DELETE RESTRICT,

  PRIMARY KEY (alias_id, variable_name),
  CONSTRAINT alias_sources_variable_format CHECK (variable_name ~ '^[a-z][a-z0-9_]{0,31}$')
);

CREATE INDEX alias_sources_entity_id_idx ON registry.alias_sources (entity_id);

CREATE TABLE registry.scenes (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                         text        NOT NULL UNIQUE,
  name                        text        NOT NULL,
  icon                        text,
  area_id                     uuid        REFERENCES registry.areas (id) ON DELETE SET NULL,
  transition_ms               integer     NOT NULL DEFAULT 0,
  rollback_on_partial_failure boolean     NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT scenes_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT scenes_transition_range CHECK (transition_ms BETWEEN 0 AND 600000)
);

CREATE INDEX scenes_area_id_idx ON registry.scenes (area_id);

CREATE TABLE registry.scene_entities (
  scene_id      uuid    NOT NULL REFERENCES registry.scenes (id) ON DELETE CASCADE,
  entity_id     uuid    NOT NULL REFERENCES registry.entities (id) ON DELETE CASCADE,
  target_state  jsonb   NOT NULL,                -- capabilityStateSchema
  transition_ms integer,                         -- overrides the scene default

  PRIMARY KEY (scene_id, entity_id),
  CONSTRAINT scene_entities_transition_range
    CHECK (transition_ms IS NULL OR transition_ms BETWEEN 0 AND 600000)
);

CREATE INDEX scene_entities_entity_id_idx ON registry.scene_entities (entity_id);

CREATE TABLE registry.automations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text        NOT NULL UNIQUE,
  name               text        NOT NULL,
  description        text        NOT NULL DEFAULT '',
  definition         jsonb       NOT NULL,       -- automationDefinitionSchema
  definition_version integer     NOT NULL DEFAULT 1,
  mode               text        NOT NULL DEFAULT 'single',
  max_runtime_ms     integer     NOT NULL DEFAULT 300000,
  is_enabled         boolean     NOT NULL DEFAULT true,
  last_triggered_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT automations_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT automations_mode CHECK (mode IN ('single', 'restart', 'queued', 'parallel')),
  CONSTRAINT automations_max_runtime_range CHECK (max_runtime_ms BETWEEN 1000 AND 86400000)
);

CREATE INDEX automations_is_enabled_idx ON registry.automations (is_enabled) WHERE is_enabled;
CREATE INDEX automations_created_by_idx ON registry.automations (created_by);
CREATE INDEX automations_definition_idx ON registry.automations USING gin (definition);

-- The house's pages of cards, made by whoever holds dashboard:manage and shown to the people each
-- is assigned to. The layout is one document, read and written whole by the editor; cards name
-- entities by their address, not by row, so a removed entity leaves a card saying so.
CREATE TABLE registry.dashboards (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  icon           text,
  layout         jsonb       NOT NULL DEFAULT '{"cards": []}',  -- dashboardLayoutSchema
  layout_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT dashboards_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 60)
);

CREATE INDEX dashboards_created_at_idx ON registry.dashboards (created_at);

-- Who sees which dashboard. Removing either end removes the assignment.
CREATE TABLE registry.dashboard_users (
  dashboard_id uuid NOT NULL REFERENCES registry.dashboards (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  PRIMARY KEY (dashboard_id, user_id)
);

CREATE INDEX dashboard_users_user_id_idx ON registry.dashboard_users (user_id);

-- --------------------------------------------------------------------------------------

-- system: package routes

-- --------------------------------------------------------------------------------------

CREATE TABLE system.package_routes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          text        NOT NULL REFERENCES system.packages (id) ON DELETE CASCADE,
  path_prefix         text        NOT NULL UNIQUE,
  upstream            text        NOT NULL,
  strip_prefix        boolean     NOT NULL DEFAULT true,
  requires_permission text,
  is_websocket        boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT package_routes_path_prefix_format CHECK (path_prefix ~ '^/[a-z0-9/_-]*$'),
  CONSTRAINT package_routes_path_prefix_not_reserved
    CHECK (path_prefix !~ '^/(api|health|ready)(/|$)')
);

CREATE INDEX package_routes_package_id_idx ON system.package_routes (package_id);

-- --------------------------------------------------------------------------------------

-- system: backups (DATABASE.md 7, 15)

-- --------------------------------------------------------------------------------------

-- Where backups are written. The one `system` row is the data directory's `backups/`, seeded
-- below and never deleted; the others are the owner's: a folder, an SMB share, an FTP server,
-- an NFS export. `config` is the kind's own settings, its password sealed with the instance's
-- secrets key as every stored credential is (DATABASE.md 11).
CREATE TABLE system.backup_locations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  kind             text        NOT NULL,
  config           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_enabled       boolean     NOT NULL DEFAULT true,
  retention_mode   text        NOT NULL DEFAULT 'count',
  retention_value  integer     NOT NULL DEFAULT 7,
  last_result      text,
  last_error       text,
  last_success_at  timestamptz,
  created_by       uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT backup_locations_kind CHECK (kind IN ('system', 'local', 'smb', 'ftp', 'nfs')),
  CONSTRAINT backup_locations_retention_mode CHECK (retention_mode IN ('count', 'days')),
  CONSTRAINT backup_locations_retention_value CHECK (retention_value BETWEEN 1 AND 3650),
  CONSTRAINT backup_locations_last_result
    CHECK (last_result IS NULL OR last_result IN ('success', 'failure')),
  CONSTRAINT backup_locations_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT backup_locations_config_object CHECK (jsonb_typeof(config) = 'object')
);

-- Exactly one system location.
CREATE UNIQUE INDEX backup_locations_single_system_idx
  ON system.backup_locations (kind) WHERE kind = 'system';
CREATE INDEX backup_locations_created_by_idx ON system.backup_locations (created_by);

-- Every backup and every restore, as it runs and as it ended. `section_bytes` is what each part
-- measured, which the next estimate scales; `destinations` is how each location took the archive.
CREATE TABLE system.backup_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text        NOT NULL,
  trigger        text        NOT NULL,
  status         text        NOT NULL DEFAULT 'running',
  sections       text[]      NOT NULL,
  archive_name   text,
  archive_bytes  bigint,
  section_bytes  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  key_id         text,
  destinations   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source         jsonb,
  error          text,
  requested_by   uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  scheduled_for  timestamptz,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT backup_runs_kind CHECK (kind IN ('backup', 'restore')),
  CONSTRAINT backup_runs_trigger
    CHECK (trigger IN ('schedule', 'catch_up', 'manual', 'pre_restore')),
  CONSTRAINT backup_runs_status
    CHECK (status IN ('running', 'success', 'partial', 'failure', 'interrupted', 'cancelled')),
  CONSTRAINT backup_runs_sections
    CHECK (sections <@ ARRAY['configuration', 'history', 'packages']::text[])
);

CREATE INDEX backup_runs_started_at_idx ON system.backup_runs (started_at DESC, id);
CREATE INDEX backup_runs_requested_by_idx ON system.backup_runs (requested_by);

-- --------------------------------------------------------------------------------------

-- history: hypertables

-- --------------------------------------------------------------------------------------

CREATE TABLE history.state_history (
  time           timestamptz NOT NULL,
  entity_id      uuid        NOT NULL,
  state          jsonb       NOT NULL,
  previous_state jsonb,
  attributes     jsonb,
  is_available   boolean     NOT NULL DEFAULT true,
  source         text        NOT NULL,
  context_id     uuid,
  context_type   text,

  CONSTRAINT state_history_context_type
    CHECK (context_type IS NULL
           OR context_type IN ('automation', 'scene', 'user', 'device', 'alias', 'startup'))
);

SELECT create_hypertable('history.state_history', by_range('time', INTERVAL '1 day'));

CREATE INDEX state_history_entity_id_time_idx
  ON history.state_history (entity_id, time DESC);
CREATE INDEX state_history_context_id_idx
  ON history.state_history (context_id, time DESC) WHERE context_id IS NOT NULL;

CREATE TABLE history.telemetry (
  time      timestamptz      NOT NULL,
  entity_id uuid             NOT NULL,
  value     double precision NOT NULL
);

SELECT create_hypertable('history.telemetry', by_range('time', INTERVAL '1 day'));

CREATE INDEX telemetry_entity_id_time_idx ON history.telemetry (entity_id, time DESC);

CREATE TABLE history.automation_runs (
  time          timestamptz NOT NULL,            -- when the run started
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  automation_id uuid        NOT NULL,
  trigger       jsonb       NOT NULL,            -- which trigger fired, and with what
  result        text        NOT NULL,
  finished_at   timestamptz,
  duration_ms   integer,
  trace         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error         text,

  CONSTRAINT automation_runs_result
    CHECK (result IN ('success', 'condition_not_met', 'failed', 'timeout', 'cancelled'))
);

SELECT create_hypertable('history.automation_runs', by_range('time', INTERVAL '7 days'));

CREATE INDEX automation_runs_automation_id_time_idx
  ON history.automation_runs (automation_id, time DESC);
CREATE INDEX automation_runs_result_time_idx
  ON history.automation_runs (result, time DESC) WHERE result <> 'success';

CREATE TABLE history.logs (
  time       timestamptz NOT NULL,
  level      smallint    NOT NULL,               -- pino levels: 10..60
  service    text        NOT NULL,
  package_id text,
  message    text        NOT NULL,
  trace_id   text,
  context    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT logs_level_range CHECK (level BETWEEN 10 AND 60)
);

SELECT create_hypertable('history.logs', by_range('time', INTERVAL '1 day'));

-- No explicit index on (time DESC): create_hypertable already builds one, named logs_time_idx.
CREATE INDEX logs_service_time_idx ON history.logs (service, time DESC);
CREATE INDEX logs_level_time_idx ON history.logs (level, time DESC) WHERE level >= 40;
CREATE INDEX logs_trace_id_idx ON history.logs (trace_id, time DESC) WHERE trace_id IS NOT NULL;
CREATE INDEX logs_message_trgm_idx ON history.logs USING gin (message gin_trgm_ops);

-- --------------------------------------------------------------------------------------

-- system: audit log

-- --------------------------------------------------------------------------------------

CREATE TABLE system.audit_log (
  time          timestamptz NOT NULL DEFAULT now(),
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  actor_type    text        NOT NULL,
  actor_user_id uuid,                            -- intentionally not a foreign key
  actor_label   text        NOT NULL,            -- username snapshot, survives user deletion
  action        text        NOT NULL,            -- 'user.create', 'package.install'
  resource_type text,
  resource_id   text,
  result        text        NOT NULL,
  ip_address    inet,
  user_agent    text,
  trace_id      text,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT audit_log_actor_type CHECK (actor_type IN ('user', 'token', 'system')),
  CONSTRAINT audit_log_result CHECK (result IN ('success', 'failure', 'denied'))
);

SELECT create_hypertable('system.audit_log', by_range('time', INTERVAL '30 days'));

CREATE INDEX audit_log_actor_user_id_time_idx
  ON system.audit_log (actor_user_id, time DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_log_action_time_idx ON system.audit_log (action, time DESC);
CREATE INDEX audit_log_resource_idx
  ON system.audit_log (resource_type, resource_id, time DESC) WHERE resource_type IS NOT NULL;

-- --------------------------------------------------------------------------------------

-- views

-- --------------------------------------------------------------------------------------

CREATE VIEW registry.v_entities_expanded AS
SELECT
  e.id,
  e.entity_id,
  e.domain,
  e.name,
  e.icon,
  e.source,
  e.unit_of_measurement,
  e.device_class,
  e.state_class,
  e.display_precision,
  e.search_aliases,
  e.is_enabled,
  e.is_hidden,
  d.id                                   AS device_id,
  d.name                                 AS device_name,
  d.manufacturer,
  d.model,
  d.package_id,
  COALESCE(e.area_id, d.area_id)         AS effective_area_id,
  a.key                                  AS area_key,
  a.name                                 AS area_name,
  s.state,
  s.attributes,
  s.is_available,
  s.last_changed,
  s.last_updated,
  COALESCE(caps.capabilities, '{}'::text[]) AS capabilities,
  COALESCE(tags.tag_keys, '{}'::text[]) AS tag_keys
FROM registry.entities e
LEFT JOIN registry.devices d       ON d.id = e.device_id
LEFT JOIN registry.areas a         ON a.id = COALESCE(e.area_id, d.area_id)
LEFT JOIN registry.entity_states s ON s.entity_id = e.id
LEFT JOIN LATERAL (
  SELECT array_agg(ec.capability ORDER BY ec.capability) AS capabilities
  FROM registry.entity_capabilities ec
  WHERE ec.entity_id = e.id
) caps ON true
LEFT JOIN LATERAL (
  SELECT array_agg(t.key ORDER BY t.key) AS tag_keys
  FROM registry.entity_tags et
  JOIN registry.tags t ON t.id = et.tag_id
  WHERE et.entity_id = e.id
) tags ON true;

CREATE VIEW registry.v_alias_dependents AS
WITH RECURSIVE dependents AS (
  -- Direct dependents: aliases that read the entity.
  SELECT
    src.entity_id       AS root_entity_id,
    al.entity_id        AS dependent_entity_id,
    1                   AS depth
  FROM registry.alias_sources src
  JOIN registry.aliases al ON al.id = src.alias_id

  UNION ALL

  -- Indirect: aliases that read another alias's output entity.
  SELECT
    d.root_entity_id,
    al.entity_id,
    d.depth + 1
  FROM dependents d
  JOIN registry.alias_sources src ON src.entity_id = d.dependent_entity_id
  JOIN registry.aliases al        ON al.id = src.alias_id
  WHERE d.depth < 32
)
SELECT
  root_entity_id,
  dependent_entity_id,
  min(depth) AS depth
FROM dependents
GROUP BY root_entity_id, dependent_entity_id;

CREATE VIEW auth.v_permission_grants AS
SELECT
  u.id           AS user_id,
  p.key          AS permission_key,
  rp.scope       AS scope,
  'allow'::text  AS effect,
  'role'::text   AS origin,
  NULL::timestamptz AS expires_at
FROM auth.users u
JOIN auth.role_permissions rp ON rp.role_id = u.role_id
JOIN auth.permissions p       ON p.id = rp.permission_id
WHERE u.deleted_at IS NULL

UNION ALL

SELECT
  up.user_id,
  p.key,
  up.scope,
  up.effect,
  'user'::text,
  up.expires_at
FROM auth.user_permissions up
JOIN auth.permissions p ON p.id = up.permission_id
JOIN auth.users u       ON u.id = up.user_id
WHERE u.deleted_at IS NULL;

CREATE VIEW system.v_schema_version AS
SELECT
  count(*)::integer                   AS version,
  max(created_at)                     AS applied_at,
  (SELECT hash FROM system.schema_migrations ORDER BY id DESC LIMIT 1) AS latest_hash
FROM system.schema_migrations;

-- --------------------------------------------------------------------------------------

-- updated_at triggers, one per mutable table (DATABASE.md 1)

-- --------------------------------------------------------------------------------------

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER roles_touch_updated_at
  BEFORE UPDATE ON auth.roles
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER totp_secrets_touch_updated_at
  BEFORE UPDATE ON auth.totp_secrets
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER areas_touch_updated_at
  BEFORE UPDATE ON registry.areas
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER devices_touch_updated_at
  BEFORE UPDATE ON registry.devices
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER entities_touch_updated_at
  BEFORE UPDATE ON registry.entities
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER tags_touch_updated_at
  BEFORE UPDATE ON registry.tags
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER aliases_touch_updated_at
  BEFORE UPDATE ON registry.aliases
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER scenes_touch_updated_at
  BEFORE UPDATE ON registry.scenes
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER automations_touch_updated_at
  BEFORE UPDATE ON registry.automations
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER dashboards_touch_updated_at
  BEFORE UPDATE ON registry.dashboards
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER packages_touch_updated_at
  BEFORE UPDATE ON system.packages
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER package_routes_touch_updated_at
  BEFORE UPDATE ON system.package_routes
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER settings_touch_updated_at
  BEFORE UPDATE ON system.settings
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER user_avatars_touch_updated_at
  BEFORE UPDATE ON auth.user_avatars
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER integrations_touch_updated_at
  BEFORE UPDATE ON registry.integrations
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER backup_locations_touch_updated_at
  BEFORE UPDATE ON system.backup_locations
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER backup_runs_touch_updated_at
  BEFORE UPDATE ON system.backup_runs
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER integration_vendors_touch_updated_at
  BEFORE UPDATE ON registry.integration_vendors
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER integration_accounts_touch_updated_at
  BEFORE UPDATE ON registry.integration_accounts
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER icons_touch_updated_at
  BEFORE UPDATE ON registry.icons
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

-- ------------------------------------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------------------------------------
--
-- Created without a password on purpose. A password committed to a repository is a password
-- everyone has; the operator assigns one out of band, with ALTER ROLE ... WITH PASSWORD.
-- Until then these roles cannot connect, which is the safe failure.
--
-- CREATE ROLE is cluster-wide rather than per-database, so each is guarded: running this
-- migration against a second database on the same cluster must not fail on an existing role.

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'nebula_migrator', 'nebula_core', 'nebula_api', 'nebula_logger', 'nebula_packet_manager',
    'nebula_hub', 'nebula_backup'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', role_name);
    END IF;
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------------------

-- Grants (DATABASE.md 12)

-- --------------------------------------------------------------------------------------

-- Migrator owns the schemas; nothing else may create objects.
ALTER SCHEMA auth     OWNER TO nebula_migrator;
ALTER SCHEMA registry OWNER TO nebula_migrator;
ALTER SCHEMA history  OWNER TO nebula_migrator;
ALTER SCHEMA system   OWNER TO nebula_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- core: owns entity state and history, reads packages and settings, never sees credentials.
GRANT USAGE ON SCHEMA registry, history, system TO nebula_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA registry TO nebula_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA history  TO nebula_core;
GRANT SELECT ON system.packages, system.settings, system.v_schema_version TO nebula_core;
-- No grant on any auth table: core never reads password hashes or tokens.

-- api: the only role that touches auth.
GRANT USAGE ON SCHEMA auth, registry, history, system TO nebula_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth     TO nebula_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA registry TO nebula_api;
GRANT SELECT ON ALL TABLES IN SCHEMA history TO nebula_api;
GRANT SELECT, UPDATE ON system.settings TO nebula_api;
GRANT SELECT ON system.packages, system.package_routes, system.v_schema_version TO nebula_api;
-- Audit log is append-only: insert and read, never update or delete.
GRANT INSERT, SELECT ON system.audit_log TO nebula_api;
-- The backup locations are the owner's to add and change; the runs are the backup service's.
GRANT SELECT, INSERT, UPDATE, DELETE ON system.backup_locations TO nebula_api;
GRANT SELECT ON system.backup_runs TO nebula_api;

-- logger: logs and nothing else.
GRANT USAGE ON SCHEMA history, system TO nebula_logger;
GRANT INSERT, SELECT ON history.logs TO nebula_logger;
GRANT SELECT ON system.settings, system.v_schema_version TO nebula_logger;
-- Explicitly no access to auth.users, registry, or any other history table.

-- packet-manager: packages and routes, and the house's registration at the Community Hub.
GRANT USAGE ON SCHEMA system, registry TO nebula_packet_manager;
GRANT SELECT, INSERT, UPDATE, DELETE ON system.packages, system.package_routes,
  system.community_hub_installations
  TO nebula_packet_manager;
GRANT INSERT, SELECT ON system.audit_log TO nebula_packet_manager;
GRANT SELECT ON registry.devices, registry.entities TO nebula_packet_manager;
GRANT SELECT ON system.settings, system.v_schema_version TO nebula_packet_manager;

-- hub: the integration instances it runs, and their runtime status.
-- The device row is read, never written: it carries the claim an instance binds its device
-- from when it starts again. `hub` asks `core` to complete what it identifies instead of
-- writing the registry itself, which is what keeps `core` the single writer of both.
-- The UPDATE is column-level on purpose: the rest of the row is configuration the owner set
-- through `api`, and a blanket UPDATE would let a restart quietly overwrite it.
GRANT USAGE ON SCHEMA registry, system TO nebula_hub;
GRANT SELECT ON registry.integrations TO nebula_hub;
GRANT UPDATE (state, last_error, last_started_at) ON registry.integrations TO nebula_hub;
GRANT SELECT ON registry.devices TO nebula_hub;
-- The vendor's shared settings, read to layer under each instance it starts; never written.
GRANT SELECT ON registry.integration_vendors TO nebula_hub;
-- The accounts: `hub` runs the sign-in, so it is the one that writes them.
GRANT SELECT, INSERT, UPDATE, DELETE ON registry.integration_accounts TO nebula_hub;
GRANT SELECT ON system.settings, system.v_schema_version TO nebula_hub;

-- backup: its runs, the locations it writes to and their outcome, the settings, and the
-- processor's load it learns the quietest time from. The archive itself is dumped and restored
-- through a separate superuser connection (DATABASE.md 15), not as this role.
GRANT USAGE ON SCHEMA registry, history, system TO nebula_backup;
GRANT SELECT, INSERT, UPDATE ON system.backup_runs TO nebula_backup;
GRANT SELECT ON system.backup_locations, system.settings, system.v_schema_version
  TO nebula_backup;
GRANT UPDATE (last_result, last_error, last_success_at) ON system.backup_locations
  TO nebula_backup;
GRANT SELECT (id, entity_id) ON registry.entities TO nebula_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE nebula_migrator IN SCHEMA registry
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nebula_core, nebula_api;
ALTER DEFAULT PRIVILEGES FOR ROLE nebula_migrator IN SCHEMA history
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nebula_core;
ALTER DEFAULT PRIVILEGES FOR ROLE nebula_migrator IN SCHEMA history
  GRANT SELECT ON TABLES TO nebula_api;

-- ------------------------------------------------------------------------------------------
-- Seed data (DATABASE.md 14)
-- ------------------------------------------------------------------------------------------
--
-- No user is seeded. On first boot with an empty auth.users, `api` serves a one-time setup
-- flow that creates the initial owner. Shipping a default administrator password is how
-- appliances end up on the public internet with admin/admin.

INSERT INTO auth.roles (key, name, description, is_builtin, sort_order) VALUES
  ('owner',   'Owner',   'Full control, including users and system settings', true, 10),
  ('admin',   'Admin',   'Everything except changing what roles grant',       true, 20),
  ('member',  'Member',  'Control entities and apply scenes, read history',   true, 30),
  ('guest',   'Guest',   'Control an explicit allow-list of entities',        true, 40),
  ('service', 'Service', 'Machine identity for access tokens',                true, 50);

-- Permissions: generated from PERMISSIONS in @nebula-home/contracts.
INSERT INTO auth.permissions (key, resource, action, description, is_scopable) VALUES
  ('entity:read', 'entity', 'read', 'See entities and their current state', true),
  ('entity:control', 'entity', 'control', 'Send commands to entities', true),
  ('entity:write', 'entity', 'write', 'Rename entities and change their configuration', true),
  ('entity:delete', 'entity', 'delete', 'Remove entities from the registry', false),
  ('device:read', 'device', 'read', 'See devices and how they are connected', true),
  ('device:write', 'device', 'write', 'Pair devices, rename them and assign them to areas', false),
  ('device:delete', 'device', 'delete', 'Unpair and remove devices', false),
  ('area:read', 'area', 'read', 'See the area hierarchy', false),
  ('area:write', 'area', 'write', 'Create, rename and rearrange areas', false),
  ('tag:read', 'tag', 'read', 'See tags', false),
  ('tag:write', 'tag', 'write', 'Create, rename, recolour and delete tags', false),
  ('automation:read', 'automation', 'read', 'See automations and their run history', false),
  ('automation:write', 'automation', 'write', 'Create, edit, enable and delete automations', false),
  ('automation:trigger', 'automation', 'trigger', 'Run an automation manually', true),
  ('scene:read', 'scene', 'read', 'See scenes', false),
  ('scene:apply', 'scene', 'apply', 'Apply a scene', true),
  ('scene:write', 'scene', 'write', 'Create, edit and delete scenes', false),
  ('alias:read', 'alias', 'read', 'See derived entities and their definitions', false),
  ('alias:write', 'alias', 'write', 'Create, edit and delete derived entities', false),
  ('dashboard:manage', 'dashboard', 'manage', 'Create, edit, assign and delete dashboards', false),
  ('history:read', 'history', 'read', 'Read state history and telemetry', true),
  ('package:read', 'package', 'read', 'See installed packages and the package store', false),
  ('package:install', 'package', 'install', 'Install, update and remove packages', false),
  ('package:configure', 'package', 'configure', 'Change a package configuration and start or stop it', false),
  ('integration:read', 'integration', 'read', 'See configured integrations and the bundles available', false),
  ('integration:configure', 'integration', 'configure', 'Add integrations, change their configuration and start or stop them', false),
  ('integration:install', 'integration', 'install', 'Install, update and remove integrations', false),
  ('user:read', 'user', 'read', 'See the list of users', false),
  ('user:manage', 'user', 'manage', 'Create, edit, disable and delete users', false),
  ('role:manage', 'role', 'manage', 'Create roles and change what they grant', false),
  ('logs:read', 'logs', 'read', 'Read logs and use the live tail', false),
  ('settings:read', 'settings', 'read', 'See system settings', false),
  ('settings:write', 'settings', 'write', 'Change system settings, including history retention', false),
  ('audit:read', 'audit', 'read', 'Read the audit log', false),
  ('system:read', 'system', 'read', 'See the system monitor: processor, memory, disk and network', false),
  ('container:read', 'container', 'read', 'See the containers the machine runs, their settings and their logs', false),
  ('container:control', 'container', 'control', 'Start, stop, restart and update the containers the machine runs', false),
  ('container:install', 'container', 'install', 'Install and remove containers and compose projects', false),
  ('backup:restore', 'backup', 'restore', 'Restore the installation from a backup and download the backup key', false);

-- Settings: generated from SETTINGS in @nebula-home/contracts.
INSERT INTO system.settings (key, value, schema_ref) VALUES
  ('history.telemetry.raw_retention_days', '30'::jsonb, 'settings:history.telemetry.raw_retention_days'),
  ('history.telemetry.tier_1m_retention_days', '365'::jsonb, 'settings:history.telemetry.tier_1m_retention_days'),
  ('history.telemetry.tier_1h_retention_days', '1825'::jsonb, 'settings:history.telemetry.tier_1h_retention_days'),
  ('history.telemetry.tier_1d_retention_days', 'null'::jsonb, 'settings:history.telemetry.tier_1d_retention_days'),
  ('history.state_history.retention_days', '365'::jsonb, 'settings:history.state_history.retention_days'),
  ('history.automation_runs.retention_days', '30'::jsonb, 'settings:history.automation_runs.retention_days'),
  ('history.logs.retention_days', '14'::jsonb, 'settings:history.logs.retention_days'),
  ('history.logs.min_level', '20'::jsonb, 'settings:history.logs.min_level'),
  ('system.audit_log.retention_days', 'null'::jsonb, 'settings:system.audit_log.retention_days'),
  ('ui.default_theme', '"system"'::jsonb, 'settings:ui.default_theme'),
  ('units.temperature', '"celsius"'::jsonb, 'settings:units.temperature'),
  ('security.session_lifetime_hours', '720'::jsonb, 'settings:security.session_lifetime_hours'),
  ('backup.enabled', 'false'::jsonb, 'settings:backup.enabled'),
  ('backup.sections', '{"history": true, "packages": true}'::jsonb, 'settings:backup.sections'),
  ('backup.schedule', '{"mode": "quietest", "time": "03:00", "timezone": "UTC"}'::jsonb, 'settings:backup.schedule'),
  ('backup.frequency', '{"mode": "daily"}'::jsonb, 'settings:backup.frequency');

-- The system backup location: the data directory's `backups/`, always there (DATABASE.md 14).
INSERT INTO system.backup_locations (name, kind, retention_mode, retention_value)
VALUES ('This machine', 'system', 'count', 3);

-- Role grants: generated from DEFAULT_ROLE_PERMISSIONS in @nebula-home/contracts.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM auth.roles r, auth.permissions p
WHERE r.key = 'admin' AND p.key IN ('entity:read', 'entity:control', 'entity:write', 'entity:delete', 'device:read', 'device:write', 'device:delete', 'area:read', 'area:write', 'tag:read', 'tag:write', 'automation:read', 'automation:write', 'automation:trigger', 'scene:read', 'scene:apply', 'scene:write', 'alias:read', 'alias:write', 'dashboard:manage', 'history:read', 'package:read', 'package:install', 'package:configure', 'integration:read', 'integration:configure', 'integration:install', 'user:read', 'user:manage', 'logs:read', 'settings:read', 'settings:write', 'audit:read', 'system:read', 'container:read', 'container:control', 'container:install');
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM auth.roles r, auth.permissions p
WHERE r.key = 'member' AND p.key IN ('entity:read', 'entity:control', 'device:read', 'area:read', 'tag:read', 'automation:read', 'automation:trigger', 'scene:read', 'scene:apply', 'alias:read', 'history:read', 'package:read', 'integration:read');
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM auth.roles r, auth.permissions p
WHERE r.key = 'guest' AND p.key IN ('entity:read', 'entity:control', 'area:read', 'scene:read', 'scene:apply');
-- service: granted nothing by default.

-- --------------------------------------------------------------------------------------

-- Continuous aggregates: the telemetry rollup ladder (DATABASE.md 9)

-- --------------------------------------------------------------------------------------

-- Each level is rolled up from the one below it, never from the raw table. That is what makes
-- the retention ladder safe: dropping raw chunks after 30 days breaks nothing downstream,
-- because nothing downstream reads them.
--
-- materialized_only is set explicitly on every level. The default has differed between
-- TimescaleDB versions, and a silent change of behaviour on upgrade is not acceptable here.

-- One-minute buckets, rolled up from the raw table

CREATE MATERIALIZED VIEW history.telemetry_1m
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '1 minute', time) AS bucket,
  entity_id,
  avg(value)   AS avg_value,
  min(value)   AS min_value,
  max(value)   AS max_value,
  first(value, time) AS first_value,
  last(value, time)  AS last_value,
  count(*)     AS sample_count
FROM history.telemetry
GROUP BY bucket, entity_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('history.telemetry_1m',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

-- One-hour buckets, rolled up from the one-minute aggregate

CREATE MATERIALIZED VIEW history.telemetry_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '1 hour', bucket) AS bucket,
  entity_id,
  avg(avg_value)                  AS avg_value,
  min(min_value)                  AS min_value,
  max(max_value)                  AS max_value,
  first(first_value, bucket)      AS first_value,
  last(last_value, bucket)        AS last_value,
  sum(sample_count)               AS sample_count
FROM history.telemetry_1m
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy('history.telemetry_1h',
  start_offset => INTERVAL '1 day',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- Daily buckets, rolled up from the hourly aggregate

CREATE MATERIALIZED VIEW history.telemetry_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
  time_bucket(INTERVAL '1 day', bucket) AS bucket,
  entity_id,
  avg(avg_value)             AS avg_value,
  min(min_value)             AS min_value,
  max(max_value)             AS max_value,
  first(first_value, bucket) AS first_value,
  last(last_value, bucket)   AS last_value,
  sum(sample_count)          AS sample_count
FROM history.telemetry_1h
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy('history.telemetry_1d',
  start_offset => INTERVAL '7 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');

-- --------------------------------------------------------------------------------------

-- Compression and retention (DATABASE.md 10)

-- --------------------------------------------------------------------------------------

-- Segmenting by the column every history query filters on lets compressed chunks be pruned by
-- segment without being decompressed first.

ALTER TABLE history.telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'entity_id',
  timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('history.telemetry', INTERVAL '7 days');

ALTER TABLE history.state_history SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'entity_id',
  timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('history.state_history', INTERVAL '7 days');

ALTER TABLE history.logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'service',
  timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('history.logs', INTERVAL '2 days');

-- The shipped retention defaults. `core` reapplies these whenever the corresponding key in
-- system.settings changes, so this is a starting point rather than the authority.

SELECT add_retention_policy('history.telemetry',       INTERVAL '30 days');
SELECT add_retention_policy('history.telemetry_1m',    INTERVAL '365 days');
SELECT add_retention_policy('history.telemetry_1h',    INTERVAL '1825 days');
-- telemetry_1d: no policy, kept indefinitely
SELECT add_retention_policy('history.state_history',   INTERVAL '365 days');
SELECT add_retention_policy('history.logs',            INTERVAL '14 days');
SELECT add_retention_policy('history.automation_runs', INTERVAL '30 days');
-- system.audit_log: no policy, kept indefinitely

-- The continuous aggregates are created after the grants above, which cover only the tables
-- that existed then: they are granted here, to what reads the ladder.
GRANT SELECT ON history.telemetry_1m, history.telemetry_1h, history.telemetry_1d
  TO nebula_core, nebula_api;
GRANT SELECT ON history.telemetry_1m TO nebula_backup;

-- The owner is granted every permission that exists, including ones added by later
-- migrations. Listing its grants explicitly would mean a new permission silently missing from
-- the one role that must never lack it.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM auth.roles r, auth.permissions p WHERE r.key = 'owner';
