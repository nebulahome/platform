-- 0017_calendar.sql
--
-- The house's calendar (docs/calendar.md 4). A calendar is a filter of the page and a source of
-- events: House, Holidays and Waste in every house, one per person, and any the owner makes.
-- Everyone sees every calendar; who edits one is its Editors list, the owner and admins always.
-- Its events are its own (`source` 'user') or read from an ICS address or a loaded `.ics` file
-- (`source` 'ics', one row per occurrence, keyed by the file's UID and recurrence id). Its models
-- are the kinds of event it offers (Organic, Glass). A share link is an ICS feed of some of them,
-- read on the house's network by its token. A time or date entity may be shown in a calendar
-- (`registry.entities.calendar_id`), and every calendar is an entity of the new capability
-- `calendar`, made by `core`.
--
-- Written by `api` (calendars, models, events, editors, files, share links) and `core` (ICS
-- events and state). Seeds the two permissions, the six `calendar.*` settings and the default
-- rows, named in the house's language.
--
-- Rollback: ALTER TABLE registry.entities DROP COLUMN calendar_id;
--           DROP TABLE registry.calendar_feed_calendars, registry.calendar_feeds,
--             registry.calendar_editors, registry.calendar_ics_files, registry.calendar_events,
--             registry.calendar_models, registry.calendars;
--           DELETE FROM system.settings WHERE key LIKE 'calendar.%';
--           DELETE FROM auth.permissions WHERE key IN ('calendar:read', 'calendar:manage');
--           DELETE FROM registry.entity_capabilities WHERE capability = 'calendar';
--           ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;
--           and add it back as 0014 has it;
--           DELETE FROM system.schema_migrations WHERE name = '0017_calendar.sql';

CREATE TABLE registry.calendars (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text        NOT NULL,
  name          text        NOT NULL,
  color         text        NOT NULL,              -- a palette key, as a tag's
  icon          text,                              -- a catalogue icon id
  -- The person a personal calendar belongs to; it goes with the account.
  owner_user_id uuid        UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  is_day_off    boolean     NOT NULL DEFAULT false, -- its events are not working days
  ics_url       text,
  ics_state     jsonb       NOT NULL DEFAULT '{}'::jsonb, -- calendarIcsStateSchema, by core
  position      integer     NOT NULL DEFAULT 0,
  created_by    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendars_kind
    CHECK (kind IN ('house', 'holidays', 'waste', 'personal', 'custom')),
  CONSTRAINT calendars_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT calendars_color CHECK (color IN (
    'red', 'orange', 'amber', 'yellow', 'lime', 'green',
    'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'
  )),
  CONSTRAINT calendars_owner CHECK ((kind = 'personal') = (owner_user_id IS NOT NULL)),
  CONSTRAINT calendars_holidays_day_off CHECK (kind <> 'holidays' OR is_day_off),
  CONSTRAINT calendars_position CHECK (position >= 0)
);

-- One Holidays calendar; one personal calendar a person is the UNIQUE on owner_user_id.
CREATE UNIQUE INDEX calendars_one_holidays_idx ON registry.calendars ((kind))
  WHERE kind = 'holidays';
CREATE INDEX calendars_created_by_idx ON registry.calendars (created_by);

CREATE TABLE registry.calendar_models (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid        NOT NULL REFERENCES registry.calendars (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  icon        text        NOT NULL,
  color       text        NOT NULL,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_models_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT calendar_models_color CHECK (color IN (
    'red', 'orange', 'amber', 'yellow', 'lime', 'green',
    'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'
  )),
  CONSTRAINT calendar_models_position CHECK (position >= 0)
);

CREATE INDEX calendar_models_calendar_id_idx ON registry.calendar_models (calendar_id);

-- All day: days, the last included. Timed: instants; a repeating one keeps its wall clock in
-- `time_zone`. "Only this one" deleted is a day in `skipped_on`; changed, a row of its own naming
-- the series and the day it replaces. An ICS event is one row per occurrence.
CREATE TABLE registry.calendar_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id   uuid        NOT NULL REFERENCES registry.calendars (id) ON DELETE CASCADE,
  model_id      uuid        REFERENCES registry.calendar_models (id) ON DELETE SET NULL,
  title         text        NOT NULL,
  icon          text,
  notes         text,
  is_all_day    boolean     NOT NULL,
  starts_on     date,
  ends_on       date,
  starts_at     timestamptz,
  ends_at       timestamptz,
  time_zone     text        NOT NULL,
  repeat        jsonb,                             -- calendarRepeatSchema
  skipped_on    date[]      NOT NULL DEFAULT '{}',
  series_id     uuid        REFERENCES registry.calendar_events (id) ON DELETE CASCADE,
  occurrence_on date,
  source        text        NOT NULL DEFAULT 'user',
  source_uid    text,                              -- the ICS UID and recurrence id
  created_by    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_events_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT calendar_events_source CHECK (source IN ('user', 'ics')),
  CONSTRAINT calendar_events_source_uid CHECK ((source = 'ics') = (source_uid IS NOT NULL)),
  CONSTRAINT calendar_events_times CHECK (
    (is_all_day AND starts_on IS NOT NULL AND ends_on IS NOT NULL
       AND starts_at IS NULL AND ends_at IS NULL AND ends_on >= starts_on)
    OR (NOT is_all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL
       AND starts_on IS NULL AND ends_on IS NULL AND ends_at >= starts_at)
  ),
  CONSTRAINT calendar_events_replaces CHECK ((series_id IS NULL) = (occurrence_on IS NULL)),
  CONSTRAINT calendar_events_not_own_series CHECK (series_id IS DISTINCT FROM id),
  -- Also the index of calendar_id, its first column.
  CONSTRAINT calendar_events_source_uid_key UNIQUE (calendar_id, source_uid)
);

CREATE INDEX calendar_events_model_id_idx ON registry.calendar_events (model_id);
CREATE INDEX calendar_events_series_id_idx ON registry.calendar_events (series_id);
CREATE INDEX calendar_events_created_by_idx ON registry.calendar_events (created_by);

-- A `.ics` file loaded from the computer, a calendar's source as an address is (D11): kept so its
-- repeating events are expanded again as time moves on. No calendar while it is only tested;
-- those older than a day are swept by core's hourly ICS job. A calendar has one source: the API
-- refuses a file while `ics_url` is set, and the reverse.
CREATE TABLE registry.calendar_ics_files (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid        UNIQUE REFERENCES registry.calendars (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  size        integer     NOT NULL,
  body        text        NOT NULL,
  uploaded_by uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_ics_files_size CHECK (size BETWEEN 0 AND 5242880)
);

CREATE INDEX calendar_ics_files_uploaded_by_idx ON registry.calendar_ics_files (uploaded_by);
CREATE INDEX calendar_ics_files_unattached_idx ON registry.calendar_ics_files (created_at)
  WHERE calendar_id IS NULL;

-- Who may edit a calendar's events besides the owner and admins. Never for Holidays.
CREATE TABLE registry.calendar_editors (
  calendar_id uuid        NOT NULL REFERENCES registry.calendars (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (calendar_id, user_id)
);

CREATE INDEX calendar_editors_user_id_idx ON registry.calendar_editors (user_id);

-- A share link: an ICS feed of some calendars at `/api/calendar/<token>.ics`, local network only.
CREATE TABLE registry.calendar_feeds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  token           text        NOT NULL UNIQUE,
  created_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  last_read_at    timestamptz,
  last_read_agent text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_feeds_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT calendar_feeds_token_format CHECK (token ~ '^[0-9a-f]{32}$')
);

CREATE INDEX calendar_feeds_created_by_idx ON registry.calendar_feeds (created_by);

CREATE TABLE registry.calendar_feed_calendars (
  feed_id     uuid        NOT NULL REFERENCES registry.calendar_feeds (id) ON DELETE CASCADE,
  calendar_id uuid        NOT NULL REFERENCES registry.calendars (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (feed_id, calendar_id)
);

CREATE INDEX calendar_feed_calendars_calendar_id_idx
  ON registry.calendar_feed_calendars (calendar_id);

-- Show in calendar: the calendar a time, date or date-and-time entity's value is shown in.
ALTER TABLE registry.entities
  ADD COLUMN calendar_id uuid REFERENCES registry.calendars (id) ON DELETE SET NULL;

CREATE INDEX entities_calendar_id_idx ON registry.entities (calendar_id);

CREATE TRIGGER calendars_touch_updated_at
  BEFORE UPDATE ON registry.calendars
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER calendar_models_touch_updated_at
  BEFORE UPDATE ON registry.calendar_models
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER calendar_events_touch_updated_at
  BEFORE UPDATE ON registry.calendar_events
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER calendar_ics_files_touch_updated_at
  BEFORE UPDATE ON registry.calendar_ics_files
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

CREATE TRIGGER calendar_feeds_touch_updated_at
  BEFORE UPDATE ON registry.calendar_feeds
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

-- Migrations run as `nebula`: the default privileges of 0001 do not reach these tables.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON registry.calendars, registry.calendar_models, registry.calendar_events,
     registry.calendar_ics_files, registry.calendar_editors, registry.calendar_feeds,
     registry.calendar_feed_calendars
  TO nebula_core, nebula_api;

-- The capability of a calendar's entity: on while one of its events is, the current and next.
ALTER TABLE registry.entity_capabilities DROP CONSTRAINT entity_capabilities_known;

ALTER TABLE registry.entity_capabilities ADD CONSTRAINT entity_capabilities_known
  CHECK (capability IN (
    'on_off', 'level', 'color_hs', 'color_temp', 'effect', 'cover', 'lock',
    'thermostat', 'sensor_numeric', 'sensor_binary', 'sensor_text',
    'media_player', 'camera', 'button', 'update', 'lawn_mower', 'select', 'number',
    'time_of_day', 'date', 'datetime', 'calendar',
    'vacuum', 'fan', 'location', 'image', 'custom'
  ));

-- Permissions: from PERMISSIONS in @nebulahome/contracts. The owner's grant of 0001 covered only
-- the permissions there were then, so the owner is granted these too. Everyone sees every
-- calendar: a custom role made before today gets `calendar:read` as the built-in ones do.
INSERT INTO auth.permissions (key, resource, action, description, is_scopable) VALUES
  ('calendar:read', 'calendar', 'read', 'See the calendars and their events', false),
  ('calendar:manage', 'calendar', 'manage', 'Create, change and delete calendars, their editors, the holidays and share links', false);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM auth.roles r, auth.permissions p
WHERE (r.key IN ('owner', 'admin') AND p.key IN ('calendar:read', 'calendar:manage'))
   OR (r.key IN ('member', 'guest') AND p.key = 'calendar:read')
   OR (NOT r.is_builtin AND p.key = 'calendar:read');

-- Settings: from SETTINGS in @nebulahome/contracts. The place stays empty until the owner
-- confirms it; the weekend is Saturday and Sunday, 0 being Monday.
INSERT INTO system.settings (key, value, schema_ref) VALUES
  ('calendar.country', 'null'::jsonb, 'settings:calendar.country'),
  ('calendar.region', 'null'::jsonb, 'settings:calendar.region'),
  ('calendar.town', 'null'::jsonb, 'settings:calendar.town'),
  ('calendar.patron', 'null'::jsonb, 'settings:calendar.patron'),
  ('calendar.weekend_days', '[5, 6]'::jsonb, 'settings:calendar.weekend_days'),
  ('calendar.hidden_holidays', '[]'::jsonb, 'settings:calendar.hidden_holidays');

-- The calendars every house starts with, named in the house's language.
WITH house AS (
  SELECT coalesce((SELECT value #>> '{}' FROM system.settings WHERE key = 'house.locale'), 'en')
    LIKE 'it%' AS speaks_italian
)
INSERT INTO registry.calendars (kind, name, color, icon, is_day_off, position)
SELECT defaults.kind,
       CASE WHEN house.speaks_italian THEN defaults.italian ELSE defaults.english END,
       defaults.color, defaults.icon, defaults.is_day_off, defaults.position
FROM house, (VALUES
  ('house', 'House', 'Casa', 'indigo', 'house', false, 0),
  ('holidays', 'Holidays', 'Festività', 'red', 'flag', true, 1),
  ('waste', 'Waste', 'Rifiuti', 'green', 'recycle', false, 2)
) AS defaults (kind, english, italian, color, icon, is_day_off, position);

WITH house AS (
  SELECT coalesce((SELECT value #>> '{}' FROM system.settings WHERE key = 'house.locale'), 'en')
    LIKE 'it%' AS speaks_italian
)
INSERT INTO registry.calendar_models (calendar_id, name, icon, color, position)
SELECT waste.id,
       CASE WHEN house.speaks_italian THEN models.italian ELSE models.english END,
       models.icon, models.color, models.position
FROM house, registry.calendars AS waste, (VALUES
  ('Organic', 'Umido', 'apple', 'orange', 0),
  ('Plastic and metal', 'Plastica e metalli', 'milk', 'yellow', 1),
  ('Paper and card', 'Carta e cartone', 'newspaper', 'blue', 2),
  ('Glass', 'Vetro', 'wine', 'green', 3),
  ('General waste', 'Secco indifferenziato', 'trash-2', 'violet', 4),
  ('Garden waste', 'Verde', 'leaf', 'lime', 5),
  ('Bulky items', 'Ingombranti', 'sofa', 'cyan', 6)
) AS models (english, italian, icon, color, position)
WHERE waste.kind = 'waste';

-- One personal calendar per person (not a service identity), named after them, the colours
-- taken in turn; then House and Waste editable by every member and above.
INSERT INTO registry.calendars (kind, name, color, icon, owner_user_id, position)
SELECT 'personal',
       coalesce(nullif(btrim(left(btrim(people.display_name), 40)), ''), people.username::text),
       (ARRAY['amber', 'teal', 'pink', 'violet', 'cyan', 'orange', 'lime', 'blue'])
         [(people.turn - 1) % 8 + 1],
       'user', people.id, 2 + people.turn
FROM (
  SELECT u.id, u.display_name, u.username,
         row_number() OVER (ORDER BY u.created_at, u.id)::integer AS turn
  FROM auth.users u
  JOIN auth.roles r ON r.id = u.role_id
  WHERE u.deleted_at IS NULL AND r.key <> 'service'
) AS people;

INSERT INTO registry.calendar_editors (calendar_id, user_id)
SELECT c.id, u.id
FROM registry.calendars c
CROSS JOIN auth.users u
JOIN auth.roles r ON r.id = u.role_id
WHERE c.kind IN ('house', 'waste')
  AND u.deleted_at IS NULL
  AND r.key IN ('owner', 'admin', 'member');
