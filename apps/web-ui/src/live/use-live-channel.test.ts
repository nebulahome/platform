/**
 * Which lists a message from the live channel has read again.
 */
import { describe, expect, it } from 'vitest';

import { wsServerMessageSchema, type WsServerMessage } from '@nebulahome/contracts';

import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { LINK_QUERY_KEYS } from '@/library/links-api';

import { KEPT_FRESH, staleAfter } from './use-live-channel';

/**
 * A device event, as the server sends it.
 *
 * @param event - Which.
 * @param extra - More of its payload.
 * @returns The message.
 */
function deviceEvent(event: string, extra: object = {}): WsServerMessage {
  return wsServerMessageSchema.parse({
    type: 'device_event',
    event,
    payload: {
      deviceId: 'shelly-1pm-mini',
      source: 'shelly-1pm-mini',
      name: 'Bench relay',
      entityIds: [],
      ...extra,
    },
  });
}

const DISCOVERY = wsServerMessageSchema.parse({
  type: 'discovery_event',
  event: 'changed',
  count: 3,
});

const BACKUP = wsServerMessageSchema.parse({
  type: 'backup_event',
  payload: {
    runId: '018f2f9c-7d3e-7000-8000-000000000001',
    kind: 'backup',
    phase: null,
    status: 'success',
  },
});

const MESSAGES: readonly WsServerMessage[] = [
  deviceEvent('added'),
  deviceEvent('updated'),
  deviceEvent('updated', { described: { added: [], removed: [] } }),
  DISCOVERY,
  wsServerMessageSchema.parse({ type: 'integration_event', vendorId: 'shelly' }),
  BACKUP,
  wsServerMessageSchema.parse({
    type: 'container_event',
    payload: { name: 'nebula-mosquitto', event: 'changed' },
  }),
  wsServerMessageSchema.parse({ type: 'package_event', event: 'installed', payload: {} }),
  wsServerMessageSchema.parse({
    type: 'automation_event',
    automationId: '018f2f9c-7d3e-7000-8000-000000000002',
    payload: {
      kind: 'started',
      runId: '018f2f9c-7d3e-7000-8000-000000000003',
      time: '2026-11-04T10:00:00.000Z',
    },
  }),
  wsServerMessageSchema.parse({ type: 'platform_event', payload: { operation: null } }),
];

describe('staleAfter', () => {
  it('reads the vendor Found tab again when what discovery proposes changes', () => {
    expect(staleAfter(DISCOVERY)).toContainEqual(LINK_QUERY_KEYS.found);
  });

  it('reads the entities again for a device described again, not for one only updated', () => {
    expect(staleAfter(deviceEvent('updated'))).toEqual([LIBRARY_QUERY_KEYS.devices]);
    expect(
      staleAfter(deviceEvent('updated', { described: { added: [], removed: [] } })),
    ).toContainEqual(LIBRARY_QUERY_KEYS.entities);
  });

  it('reads the links offered again when a device is added', () => {
    expect(staleAfter(deviceEvent('added'))).toContainEqual(LINK_QUERY_KEYS.suggestions);
  });

  it('reads the archives again when a backup moves on', () => {
    expect(staleAfter(BACKUP)).toContainEqual(BACKUP_QUERY_KEYS.archives);
  });

  it('keeps fresh, after a drop, every list a message can make stale', () => {
    const kept = new Set(KEPT_FRESH.map((key) => JSON.stringify(key)));

    for (const message of MESSAGES) {
      for (const key of staleAfter(message)) {
        expect(kept, JSON.stringify(key)).toContain(JSON.stringify(key));
      }
    }
  });
});
