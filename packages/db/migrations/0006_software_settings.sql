-- 0006_software_settings.sql
--
-- Settings › System › Software (docs/releases-and-updates.md 4): each component keeps its own
-- update settings. The one window becomes one per kind that updates by itself, and the one
-- Back up first one per kind; both take the value the house had. Developer mode arrives, the
-- switch that offers the Dev channel: on for a house already following Dev somewhere, so nothing
-- it chose is taken away. Shutting down is gone, so `system:power` only restarts.
--
-- Rollback: INSERT INTO system.settings (key, value, schema_ref)
--             SELECT 'updates.window', value, 'settings:updates.window' FROM system.settings
--             WHERE key = 'updates.window.packages';
--           INSERT INTO system.settings (key, value, schema_ref)
--             SELECT 'updates.backup_first', value, 'settings:updates.backup_first' FROM system.settings
--             WHERE key = 'updates.backup_first.packages';
--           DELETE FROM system.settings WHERE key IN ('updates.window.packages',
--             'updates.window.integrations', 'updates.backup_first.core',
--             'updates.backup_first.packages', 'updates.backup_first.integrations',
--             'system.developer_mode');
--           UPDATE auth.permissions SET description = 'Restart Nebula Home and shut it down'
--             WHERE key = 'system:power';
--           DELETE FROM system.schema_migrations WHERE name = '0006_software_settings.sql';

INSERT INTO system.settings (key, value, schema_ref) VALUES
  ('updates.window.packages', '{"mode": "quietest", "time": "03:00"}'::jsonb, 'settings:updates.window.packages'),
  ('updates.window.integrations', '{"mode": "quietest", "time": "03:00"}'::jsonb, 'settings:updates.window.integrations'),
  ('updates.backup_first.core', 'true'::jsonb, 'settings:updates.backup_first.core'),
  ('updates.backup_first.packages', 'true'::jsonb, 'settings:updates.backup_first.packages'),
  ('updates.backup_first.integrations', 'true'::jsonb, 'settings:updates.backup_first.integrations'),
  ('system.developer_mode', 'false'::jsonb, 'settings:system.developer_mode');

UPDATE system.settings AS kind SET value = old.value
FROM system.settings AS old
WHERE old.key = 'updates.window'
  AND kind.key IN ('updates.window.packages', 'updates.window.integrations');

UPDATE system.settings AS kind SET value = old.value
FROM system.settings AS old
WHERE old.key = 'updates.backup_first'
  AND kind.key IN ('updates.backup_first.core', 'updates.backup_first.packages',
    'updates.backup_first.integrations');

UPDATE system.settings SET value = 'true'::jsonb
WHERE key = 'system.developer_mode'
  AND EXISTS (
    SELECT 1 FROM system.settings
    WHERE key LIKE 'updates.channel.%' AND value = '"dev"'::jsonb
  );

DELETE FROM system.settings WHERE key IN ('updates.window', 'updates.backup_first');

UPDATE auth.permissions SET description = 'Restart Nebula Home' WHERE key = 'system:power';
