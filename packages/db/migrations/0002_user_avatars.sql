-- 0002_user_avatars.sql
--
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
--
-- Rollback: DROP TABLE auth.user_avatars;
--           Nothing else refers to it, and the interface falls back to initials on its own.

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

CREATE TRIGGER user_avatars_touch_updated_at
  BEFORE UPDATE ON auth.user_avatars
  FOR EACH ROW EXECUTE FUNCTION system.touch_updated_at();

-- `nebula_api` already holds SELECT, INSERT, UPDATE, DELETE on every table in `auth`, but that
-- grant named the tables that existed when it ran. This one did not exist yet.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.user_avatars TO nebula_api;
