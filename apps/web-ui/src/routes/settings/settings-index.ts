/**
 * The settings worth finding by name (boards N-Settings-Search, N-Command-Palette-*): a row with a
 * `searchId` on its page, where it lives and what it says. Data only - the settings search and the
 * command palette both read it.
 */
import type { UiIconId } from '@nebulahome/ui';

import { defineMessage, type Message } from '@/i18n/messages';

/** One setting worth finding: a row with a `searchId` on its page. */
export type SettingEntry = {
  /** The row's `searchId`. */
  readonly id: string;

  /** The page it is on. */
  readonly path: string;

  /** The section of the page. */
  readonly section: Message;

  /** What the row is called. */
  readonly title: Message;

  /** Its line, or the catalogue's description of the setting it holds. */
  readonly note: Message | 'catalogue';

  /** Its glyph in the results. */
  readonly icon: UiIconId;
};

/** Sections that more than one entry sits in. */
const SECTIONS = {
  security: defineMessage('settings.account.security', 'Security'),
  language: defineMessage('settings.language.title', 'Language'),
  appearance: defineMessage('settings.interface.appearance', 'Appearance'),
  startup: defineMessage('settings.interface.startup', 'Startup'),
  history: defineMessage('settings.data.historyAndLogs', 'History and logs'),
  installation: defineMessage('settings.data.installation', 'This installation'),
  schedule: defineMessage('backup.schedule', 'Schedule'),
  key: defineMessage('backup.key.section', 'Encryption key'),
  endpoint: defineMessage('settings.webhooks.endpoint', 'Endpoint'),
  core: defineMessage('settingsMaintenance.core', 'Core'),
  packages: defineMessage('settingsMaintenance.packages', 'Packages'),
  integrations: defineMessage('settingsMaintenance.integrations', 'Integrations'),
  advanced: defineMessage('settingsMaintenance.advanced', 'Advanced'),
};

/** Every setting the search finds. */
export const SETTINGS_INDEX: readonly SettingEntry[] = [
  {
    id: 'password',
    path: '/settings/account',
    section: SECTIONS.security,
    title: defineMessage('settings.password.title', 'Password'),
    note: defineMessage(
      'settings.password.note',
      'At least twelve characters, and no other rules.',
    ),
    icon: 'key',
  },
  {
    id: 'two-factor',
    path: '/settings/account',
    section: SECTIONS.security,
    title: defineMessage('settings.twoFactor.title', 'Authenticator app'),
    note: defineMessage('settings.search.notes.twoFactor', 'A code after the password.'),
    icon: 'shield-check',
  },
  {
    id: 'language',
    path: '/settings/account',
    section: SECTIONS.language,
    title: defineMessage('settings.language.title', 'Language'),
    note: defineMessage(
      'settings.language.note',
      'What the interface speaks to you. Names and anything typed stay as they were written.',
    ),
    icon: 'globe',
  },
  {
    id: 'theme',
    path: '/settings/interface',
    section: SECTIONS.appearance,
    title: defineMessage('settings.interface.theme', 'Theme'),
    note: defineMessage(
      'settings.interface.themeNote',
      'Follows the operating system unless you pick one.',
    ),
    icon: 'moon',
  },
  {
    id: 'motion',
    path: '/settings/interface',
    section: SECTIONS.appearance,
    title: defineMessage('settings.interface.motion', 'Motion'),
    note: defineMessage('settings.search.notes.motion', 'Reduced stops background motion.'),
    icon: 'sparkles',
  },
  {
    id: 'sidebar',
    path: '/settings/interface',
    section: SECTIONS.appearance,
    title: defineMessage('settings.interface.sidebar', 'Sidebar'),
    note: defineMessage('settings.search.notes.sidebar', 'How it opens on this device.'),
    icon: 'columns-2',
  },
  {
    id: 'open-on',
    path: '/settings/interface',
    section: SECTIONS.startup,
    title: defineMessage('settings.interface.openOn', 'Open on'),
    note: defineMessage(
      'settings.interface.openOnNote',
      'Which page you land on when you sign in.',
    ),
    icon: 'app-window',
  },
  {
    id: 'history.state_history.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.stateChanges', 'Entity state changes'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'history.automation_runs.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.automationTraces', 'Automation traces'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'history.logs.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.logs', 'Logs'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'system.audit_log.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.audit', 'Audit trail'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'history.logs.min_level',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.logLevel', 'Log level'),
    note: 'catalogue',
    icon: 'list-filter',
  },
  {
    id: 'units.temperature',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.temperature', 'Temperature'),
    note: 'catalogue',
    icon: 'thermometer',
  },
  {
    id: 'ui.default_theme',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.defaultTheme', 'Default theme'),
    note: 'catalogue',
    icon: 'moon',
  },
  {
    id: 'house.timezone',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('firstRun.home.timeZone', 'Time zone'),
    note: 'catalogue',
    icon: 'clock',
  },
  {
    id: 'house.locale',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.houseLanguage', 'House language'),
    note: 'catalogue',
    icon: 'globe',
  },
  {
    id: 'security.session_lifetime_hours',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.sessionLifetime', 'Session lifetime'),
    note: 'catalogue',
    icon: 'timer',
  },
  {
    id: 'backup.automatic',
    path: '/settings/system/backup',
    section: SECTIONS.schedule,
    title: defineMessage('backup.automatic', 'Automatic backups'),
    note: defineMessage('settings.search.notes.automaticBackups', 'Runs on the schedule below.'),
    icon: 'toggle-left',
  },
  {
    id: 'backup.frequency',
    path: '/settings/system/backup',
    section: SECTIONS.schedule,
    title: defineMessage('backup.frequency', 'How often'),
    note: defineMessage('settings.search.notes.frequency', 'Daily, weekly, or the days chosen.'),
    icon: 'calendar',
  },
  {
    id: 'backup.when',
    path: '/settings/system/backup',
    section: SECTIONS.schedule,
    title: defineMessage('backup.when', 'When'),
    note: defineMessage('settings.search.notes.when', 'At a time, or when the house is quietest.'),
    icon: 'clock',
  },
  {
    id: 'updates.channel.core',
    path: '/settings/system/software',
    section: SECTIONS.core,
    title: defineMessage('settingsMaintenance.releaseChannel', 'Release channel'),
    note: 'catalogue',
    icon: 'git-branch',
  },
  {
    id: 'updates.backup_first.core',
    path: '/settings/system/software',
    section: SECTIONS.core,
    title: defineMessage('settingsMaintenance.backupFirst', 'Back up first'),
    note: 'catalogue',
    icon: 'hard-drive',
  },
  {
    id: 'updates.auto.packages',
    path: '/settings/system/software',
    section: SECTIONS.packages,
    title: defineMessage('settingsMaintenance.automatic', 'Automatic updates'),
    note: 'catalogue',
    icon: 'package',
  },
  {
    id: 'updates.window.packages',
    path: '/settings/system/software',
    section: SECTIONS.packages,
    title: defineMessage('settingsMaintenance.when', 'When'),
    note: 'catalogue',
    icon: 'clock',
  },
  {
    id: 'updates.channel.packages',
    path: '/settings/system/software',
    section: SECTIONS.packages,
    title: defineMessage('settingsMaintenance.hubVersions', 'Versions in the Hub'),
    note: 'catalogue',
    icon: 'git-branch',
  },
  {
    id: 'updates.backup_first.packages',
    path: '/settings/system/software',
    section: SECTIONS.packages,
    title: defineMessage('settingsMaintenance.backupFirst', 'Back up first'),
    note: 'catalogue',
    icon: 'hard-drive',
  },
  {
    id: 'updates.auto.integrations',
    path: '/settings/system/software',
    section: SECTIONS.integrations,
    title: defineMessage('settingsMaintenance.automatic', 'Automatic updates'),
    note: 'catalogue',
    icon: 'plug',
  },
  {
    id: 'updates.window.integrations',
    path: '/settings/system/software',
    section: SECTIONS.integrations,
    title: defineMessage('settingsMaintenance.when', 'When'),
    note: 'catalogue',
    icon: 'clock',
  },
  {
    id: 'updates.channel.integrations',
    path: '/settings/system/software',
    section: SECTIONS.integrations,
    title: defineMessage('settingsMaintenance.hubVersions', 'Versions in the Hub'),
    note: 'catalogue',
    icon: 'git-branch',
  },
  {
    id: 'updates.backup_first.integrations',
    path: '/settings/system/software',
    section: SECTIONS.integrations,
    title: defineMessage('settingsMaintenance.backupFirst', 'Back up first'),
    note: 'catalogue',
    icon: 'hard-drive',
  },
  {
    id: 'system.restart',
    path: '/settings/system/software',
    section: SECTIONS.advanced,
    title: defineMessage('settingsMaintenance.restart', 'Restart'),
    note: defineMessage(
      'settingsMaintenance.restartNote',
      'Restarts Nebula Home. Devices and automations pause until it is back.',
    ),
    icon: 'rotate-ccw',
  },
  {
    id: 'system.developer_mode',
    path: '/settings/system/software',
    section: SECTIONS.advanced,
    title: defineMessage('settingsMaintenance.developerMode', 'Developer mode'),
    note: 'catalogue',
    icon: 'code-xml',
  },
  {
    id: 'backup.key',
    path: '/settings/system/backup',
    section: SECTIONS.key,
    title: defineMessage('backup.key.title', 'Backup key'),
    note: defineMessage('settings.search.notes.backupKey', 'Needed on another machine.'),
    icon: 'key',
  },
  {
    id: 'webhooks.base',
    path: '/settings/network/webhooks',
    section: SECTIONS.endpoint,
    title: defineMessage('settings.webhooks.baseAddress', 'Base address'),
    note: defineMessage('settings.webhooks.baseAddressNote', 'Every webhook is a path under it.'),
    icon: 'webhook',
  },
  {
    id: 'webhooks.allow_internet',
    path: '/settings/network/webhooks',
    section: SECTIONS.endpoint,
    title: defineMessage('settings.webhooks.fromTheInternet', 'From the internet'),
    note: defineMessage(
      'settings.webhooks.fromTheInternetNote',
      'Through remote access. Off: webhooks marked Internet answer 404 from outside.',
    ),
    icon: 'globe',
  },
  {
    id: 'webhooks.rate_per_minute',
    path: '/settings/network/webhooks',
    section: SECTIONS.endpoint,
    title: defineMessage('settings.webhooks.limit', 'Limit'),
    note: defineMessage('settings.webhooks.limitNote', 'Calls above it get 429 and start nothing.'),
    icon: 'gauge',
  },
];
