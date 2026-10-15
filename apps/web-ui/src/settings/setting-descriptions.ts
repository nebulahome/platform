/**
 * What each server setting controls, in the language the interface speaks.
 *
 * The catalogue in `@nebulahome/contracts` describes each setting in English for the API; the
 * settings page says the same here, by key. A key this build does not know reads as the
 * description the server sent.
 */
import { defineMessage, text, type Message } from '@/i18n/messages';

/** Every setting's description, by key. */
const DESCRIPTIONS: Readonly<Record<string, Message>> = {
  'history.telemetry.raw_retention_days': defineMessage(
    'settings.descriptions.historyTelemetryRawRetentionDays',
    'How long raw readings are kept at full resolution',
  ),
  'history.telemetry.tier_1m_retention_days': defineMessage(
    'settings.descriptions.historyTelemetryTier1mRetentionDays',
    'How long one-minute buckets are kept',
  ),
  'history.telemetry.tier_1h_retention_days': defineMessage(
    'settings.descriptions.historyTelemetryTier1hRetentionDays',
    'How long one-hour buckets are kept',
  ),
  'history.telemetry.tier_1d_retention_days': defineMessage(
    'settings.descriptions.historyTelemetryTier1dRetentionDays',
    'How long daily buckets are kept. Null means forever',
  ),
  'history.state_history.retention_days': defineMessage(
    'settings.descriptions.historyStateHistoryRetentionDays',
    'How long entity state changes are kept',
  ),
  'history.automation_runs.retention_days': defineMessage(
    'settings.descriptions.historyAutomationRunsRetentionDays',
    'How long automation execution traces are kept',
  ),
  'history.logs.retention_days': defineMessage(
    'settings.descriptions.historyLogsRetentionDays',
    'How long application logs are kept',
  ),
  'history.logs.min_level': defineMessage(
    'settings.descriptions.historyLogsMinLevel',
    'Records below this pino level are dropped at ingest, not stored',
  ),
  'system.audit_log.retention_days': defineMessage(
    'settings.descriptions.systemAuditLogRetentionDays',
    'How long audit records are kept. Null means forever',
  ),
  'ui.default_theme': defineMessage(
    'settings.descriptions.uiDefaultTheme',
    'Theme applied to a user who has not chosen one',
  ),
  'units.temperature': defineMessage(
    'settings.descriptions.unitsTemperature',
    'Unit temperatures are displayed in',
  ),
  'house.timezone': defineMessage(
    'settings.descriptions.houseTimezone',
    'The time zone the house keeps: time triggers, time windows and days are read in it',
  ),
  'house.locale': defineMessage(
    'settings.descriptions.houseLocale',
    'The language the house speaks: the sign-in screen, and everyone who has not chosen their own',
  ),
  'security.session_lifetime_hours': defineMessage(
    'settings.descriptions.securitySessionLifetimeHours',
    'How long a session stays valid before requiring a new sign-in',
  ),
  'backup.enabled': defineMessage(
    'settings.descriptions.backupEnabled',
    'Whether backups are taken on their schedule',
  ),
  'backup.sections': defineMessage(
    'settings.descriptions.backupSections',
    'Which of the optional parts a backup takes; the configuration is always taken',
  ),
  'backup.schedule': defineMessage(
    'settings.descriptions.backupSchedule',
    'The time of day a backup runs at: a fixed one, or the quietest learned',
  ),
  'backup.frequency': defineMessage(
    'settings.descriptions.backupFrequency',
    'The days a backup runs on',
  ),
};

/**
 * What a setting controls.
 *
 * @param key - The setting.
 * @param sent - The description the server sent, for a key this build does not know.
 * @returns The sentence.
 */
export function settingDescription(key: string, sent: string | undefined): string {
  const known = DESCRIPTIONS[key];

  return known === undefined ? (sent ?? '') : text(known);
}
