-- 0005_bluetooth_proxy_scan_by_hub.sql
--
-- A proxy's scan mode is no longer the owner's choice: every proxy rests in the mode the hub picks
-- and scans actively only while the hub asks. The default for a new proxy goes with it;
-- `registry.bluetooth_proxies.scan_mode` stays and keeps the resting mode installed.
--
-- Rollback: ALTER TABLE registry.bluetooth_settings
--             ADD COLUMN proxy_scan_mode text NOT NULL DEFAULT 'passive',
--             ADD CONSTRAINT bluetooth_settings_proxy_scan_mode_known
--             CHECK (proxy_scan_mode IN ('passive', 'active'));
--           DELETE FROM system.schema_migrations WHERE name = '0005_bluetooth_proxy_scan_by_hub.sql';

ALTER TABLE registry.bluetooth_settings DROP COLUMN proxy_scan_mode;
