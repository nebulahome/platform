/**
 * A Backup page with something on it, for the gallery and the tests: a cache already holding the
 * state, the locations, the runs and the settings, so the page renders without an API.
 */
import { QueryClient } from '@tanstack/react-query';

import {
  PERMISSIONS,
  type BackupLocationView,
  type BackupRunView,
  type BackupStatusView,
  type SessionUser,
  type SettingsResponse,
} from '@nebulahome/contracts';

import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { SETTINGS_QUERY_KEYS } from '@/settings/api';

/** A quiet night: low load from 02:00 to 05:00, busy evenings. */
const PROFILE = Array.from({ length: 96 }, (nothing, slot) => {
  const hour = slot / 4;

  return (
    Math.round(
      (hour >= 2 && hour < 5 ? 4 : hour >= 18 && hour < 23 ? 38 : 18 + 6 * Math.sin(slot / 9)) * 10,
    ) / 10
  );
});

/** The owner, who may do everything on the page. */
export const SAMPLE_OWNER: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'owner',
  displayName: 'Owner',
  role: 'owner',
  permissions: PERMISSIONS.map((permission) => ({
    key: permission.key,
    scope: '*',
    effect: 'allow',
  })),
  avatarUrl: null,
  locale: 'en',
  houseLocale: 'en',
  timezone: 'Europe/Rome',
  mustChangePassword: false,
} as unknown as SessionUser;

/** What the backup service says. */
export const SAMPLE_STATUS: BackupStatusView = {
  isEnabled: true,
  schedule: {
    mode: 'quietest',
    time: '03:15',
    timezone: 'Europe/Rome',
    nextRunAt: new Date('2026-09-28T01:15:00Z'),
  },
  quietTime: {
    state: 'ready',
    time: '03:15',
    meanLoadPercent: 4.1,
    daysOfData: 21,
    daysNeeded: 3,
    profile: PROFILE,
    reason: null,
  },
  estimates: {
    configuration: 48_200_000,
    history: 1_310_000_000,
    packages: 0,
    basis: 'last-backup',
    measuredAt: new Date(),
  },
  lastBackup: {
    runId: '00000000-0000-4000-8000-00000000aa01',
    status: 'success',
    archiveBytes: 1_290_000_000,
    finishedAt: new Date(Date.now() - 20 * 3600_000),
    sections: ['configuration', 'history', 'packages'],
  },
  active: null,
  key: {
    keyId: '490abf8d7cc4e08fc12333d9937bc41a',
    source: 'file',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    downloadedAt: null,
  },
  capabilities: { canMount: true, mountProblem: null },
  problems: [],
  maintenance: {
    state: 'normal',
    runId: null,
    phase: null,
    percent: null,
    outcome: null,
    message: null,
    tokensInvalidBefore: null,
  },
  canRestore: true,
};

/** The locations: the system one, a NAS share that works, an FTP server that does not. */
export const SAMPLE_LOCATIONS: BackupLocationView[] = [
  {
    id: '00000000-0000-4000-8000-0000000000b1',
    name: 'This machine',
    target: { kind: 'system' },
    isEnabled: true,
    retention: { mode: 'count', value: 3 },
    lastResult: 'success',
    lastError: null,
    lastSuccessAt: new Date(Date.now() - 20 * 3600_000),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  },
  {
    id: '00000000-0000-4000-8000-0000000000b2',
    name: 'Synology',
    target: {
      kind: 'smb',
      host: 'nas.local',
      share: 'backups',
      path: 'nebulahome',
      username: 'nebula',
      hasPassword: true,
      domain: '',
      version: 'auto',
    },
    isEnabled: true,
    retention: { mode: 'days', value: 30 },
    lastResult: 'success',
    lastError: null,
    lastSuccessAt: new Date(Date.now() - 20 * 3600_000),
    createdAt: new Date('2026-09-02T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
  },
  {
    id: '00000000-0000-4000-8000-0000000000b3',
    name: 'Offsite FTP',
    target: {
      kind: 'ftp',
      host: 'ftp.example.org',
      port: null,
      security: 'explicit',
      allowSelfSigned: false,
      path: 'house',
      username: 'robin',
      hasPassword: true,
    },
    isEnabled: true,
    retention: { mode: 'count', value: 7 },
    lastResult: 'failure',
    lastError: '530 Login authentication failed',
    lastSuccessAt: null,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    updatedAt: new Date('2026-09-03T00:00:00Z'),
  },
];

/** The latest runs. */
export const SAMPLE_RUNS: BackupRunView[] = [
  {
    id: '00000000-0000-4000-8000-00000000aa01',
    kind: 'backup',
    trigger: 'schedule',
    status: 'partial',
    sections: ['configuration', 'history'],
    archiveName: 'nebulahome-20260926T011500Z-aa010000.nhbk',
    archiveBytes: 1_290_000_000,
    destinations: [
      {
        locationId: '00000000-0000-4000-8000-0000000000b2',
        name: 'Synology',
        kind: 'smb',
        status: 'success',
        error: null,
        bytes: 1_290_000_000,
        durationMs: 61_000,
        pruned: 1,
      },
      {
        locationId: '00000000-0000-4000-8000-0000000000b3',
        name: 'Offsite FTP',
        kind: 'ftp',
        status: 'failure',
        error: '530 Login authentication failed',
        bytes: null,
        durationMs: 900,
        pruned: 0,
      },
    ],
    error: null,
    startedAt: new Date(Date.now() - 20 * 3600_000 - 180_000),
    finishedAt: new Date(Date.now() - 20 * 3600_000),
    requestedBy: null,
  },
];

/**
 * A cache holding what the Backup page reads.
 *
 * @returns The cache.
 */
export function backupSampleCache(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
  });
  const settings: SettingsResponse = {
    items: [
      ['backup.enabled', true],
      ['backup.sections', { history: true, packages: false }],
      ['backup.schedule', { mode: 'quietest', time: '03:00', timezone: 'Europe/Rome' }],
      ['backup.frequency', { mode: 'custom', days: ['monday', 'wednesday', 'friday'] }],
    ].map(([key, value]) => ({
      key: key as string,
      value: value as never,
      defaultValue: null,
      description: '',
      updatedAt: new Date(),
      updatedBy: null,
    })),
  };

  client.setQueryData(BACKUP_QUERY_KEYS.status, SAMPLE_STATUS);
  client.setQueryData(BACKUP_QUERY_KEYS.locations, SAMPLE_LOCATIONS);
  client.setQueryData(BACKUP_QUERY_KEYS.runs, SAMPLE_RUNS);
  client.setQueryData(SETTINGS_QUERY_KEYS.server, settings);

  return client;
}
