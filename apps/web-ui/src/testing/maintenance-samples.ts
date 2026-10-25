/**
 * What the Maintenance page reads, as the board draws it: Nebula Home, two packages and two
 * integrations with an update, the last round, and the settings.
 */
import { QueryClient } from '@tanstack/react-query';

import type { SettingsResponse, SystemUpdatesView } from '@nebulahome/contracts';

import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { SETTINGS_QUERY_KEYS } from '@/settings/api';
import { UPDATES_QUERY_KEY } from '@/settings/updates-api';
import { SAMPLE_STATUS } from '@/testing/backup-samples';

/** The list of updates. */
export const SAMPLE_UPDATES: SystemUpdatesView = {
  core: {
    installedVersion: '2026.10.1',
    stable: {
      version: '2026.11.0',
      notes: '## What is new\n\n- Settings › Maintenance\n- The quietest time as an entity',
      url: 'https://github.com/nebulahome/platform/releases/tag/v2026.11.0',
      publishedAt: new Date('2026-11-02T10:00:00Z'),
    },
    beta: null,
    checkedAt: new Date(Date.now() - 12 * 60_000),
    error: null,
    refusal: null,
    lastUpdate: null,
    channel: 'stable',
  },
  rows: [
    {
      item: { kind: 'core', version: '2026.11.0' },
      name: 'Nebula Home',
      installedVersion: '2026.10.1',
      latestVersion: '2026.11.0',
      notes: '## What is new\n\n- Settings › Maintenance',
      notesUrl: 'https://github.com/nebulahome/platform/releases/tag/v2026.11.0',
    },
    {
      item: { kind: 'package', id: 'mqtt' },
      name: 'MQTT',
      installedVersion: '0.5.0',
      latestVersion: '0.5.1',
      notes: null,
      notesUrl: 'https://github.com/nebulahome/pkg-mqtt/releases',
    },
    {
      item: { kind: 'package', id: 'nvr' },
      name: 'NVR',
      installedVersion: '1.2.0',
      latestVersion: '1.3.0',
      notes: null,
      notesUrl: null,
    },
    {
      item: { kind: 'integration', id: 'shelly' },
      name: 'Shelly',
      installedVersion: '1.4.2',
      latestVersion: '1.5.0',
      notes: null,
      notesUrl: 'https://github.com/nebulahome/integration-shelly/releases',
    },
    {
      item: { kind: 'integration', id: 'zigbee2mqtt' },
      name: 'Zigbee2MQTT',
      installedVersion: '2.1.0',
      latestVersion: '2.2.0',
      notes: null,
      notesUrl: null,
    },
  ],
  problems: [],
  round: null,
};

/**
 * A cache holding what the Maintenance page reads.
 *
 * @returns The cache.
 */
export function maintenanceSampleCache(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
  });
  const settings: SettingsResponse = {
    items: [
      ['updates.auto.packages', true],
      ['updates.auto.integrations', true],
      ['updates.window', { mode: 'quietest', time: '03:00' }],
      ['updates.backup_first', true],
      ['updates.channel.core', 'stable'],
    ].map(([key, value]) => ({
      key: key as string,
      value: value as never,
      defaultValue: null,
      description: '',
      updatedAt: new Date(),
      updatedBy: null,
    })),
  };

  client.setQueryData(UPDATES_QUERY_KEY, SAMPLE_UPDATES);
  client.setQueryData(SETTINGS_QUERY_KEYS.server, settings);
  client.setQueryData(BACKUP_QUERY_KEYS.status, SAMPLE_STATUS);

  return client;
}
