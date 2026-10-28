/**
 * The house's Infrared broker as the boards draw it, for the gallery: three blasters - a
 * Broadlink that also does RF 433, a zigbee2mqtt one and an offline Tuya one - four remotes, one
 * of them left without a blaster, and the living room TV's keypad of twelve buttons.
 */
import type { QueryClient } from '@tanstack/react-query';

import type {
  InfraredBlaster,
  InfraredButton,
  InfraredCode,
  InfraredLearnJob,
  InfraredRemote,
  InfraredRemoteDetail,
  InfraredStatus,
} from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { INFRARED_QUERY_KEYS } from '@/library/infrared-api';
import {
  brokerSampleCache,
  SAMPLE_ROOMS,
  sampleDevice,
  sampleIcon,
} from '@/testing/broker-samples';

/** The TV's remote, which the keypad's sample opens. */
export const INFRARED_SAMPLE_TV_ID = '1e000000-0000-4000-8000-000000000001';

/**
 * A time on the sample day.
 *
 * @param time - `14:31:07`.
 * @returns The moment, in UTC.
 */
const at = (time: string): Date => new Date(`2026-10-27T${time}Z`);

/**
 * An NEC code's timings: the leader, 32 bits of address and command, the stop mark.
 *
 * @param address - The address byte.
 * @param command - The command byte.
 * @returns The code.
 */
export function necSample(address: number, command: number): InfraredCode {
  const bytes = [address, 0xff - address, command, 0xff - command];
  const bits = bytes.flatMap((byte) =>
    Array.from({ length: 8 }, (unused, bit) => (byte >> bit) & 1),
  );

  return {
    signal: 'ir',
    carrierHz: 38_000,
    pulses: [9000, 4500, ...bits.flatMap((bit) => [560, bit === 1 ? 1690 : 560]), 560],
    protocol: { name: 'nec', address, command },
  };
}

/** The blasters the integrations provide. */
export const INFRARED_SAMPLE_BLASTERS: InfraredBlaster[] = [
  {
    deviceId: 'broadlink-rm4',
    name: 'Living room RM4',
    vendorId: 'broadlink',
    vendorName: 'Broadlink',
    areaId: SAMPLE_ROOMS.living,
    isOnline: true,
    signals: ['ir', 'rf'],
    receives: true,
    lastSentAt: at('14:29:00'),
    remotes: 2,
  },
  {
    deviceId: 'z2m-kitchen-ir',
    name: 'Kitchen IR',
    vendorId: 'zigbee2mqtt',
    vendorName: 'zigbee2mqtt',
    areaId: SAMPLE_ROOMS.kitchen,
    isOnline: true,
    signals: ['ir'],
    receives: true,
    lastSentAt: at('21:14:00'),
    remotes: 0,
  },
  {
    deviceId: 'tuya-bedroom-ir',
    name: 'Bedroom IR',
    vendorId: 'tuya',
    vendorName: 'Tuya',
    areaId: SAMPLE_ROOMS.bedroom,
    isOnline: false,
    signals: ['ir'],
    receives: true,
    lastSentAt: at('08:31:00'),
    remotes: 1,
  },
];

/**
 * One sample remote.
 *
 * @param fields - What tells it apart.
 * @returns The remote.
 */
function remote(fields: Partial<InfraredRemote> & Pick<InfraredRemote, 'id' | 'name'>) {
  return {
    kind: 'tv',
    blasterId: 'broadlink-rm4',
    blasterName: 'Living room RM4',
    isBlasterOnline: true,
    canRf: true,
    columns: 3,
    deviceId: null,
    areaId: SAMPLE_ROOMS.living,
    buttonCount: 0,
    lastPressedAt: null,
    ...fields,
  } satisfies InfraredRemote;
}

/** The remotes. */
export const INFRARED_SAMPLE_REMOTES: InfraredRemote[] = [
  remote({
    id: INFRARED_SAMPLE_TV_ID,
    name: 'Living room TV',
    deviceId: 'infrared-tv',
    buttonCount: 12,
    lastPressedAt: at('14:29:00'),
  }),
  remote({
    id: '1e000000-0000-4000-8000-000000000002',
    name: 'Soundbar',
    kind: 'audio',
    deviceId: 'infrared-soundbar',
    buttonCount: 8,
    lastPressedAt: at('14:28:00'),
  }),
  remote({
    id: '1e000000-0000-4000-8000-000000000003',
    name: 'Bedroom fan',
    kind: 'fan',
    blasterId: 'tuya-bedroom-ir',
    blasterName: 'Bedroom IR',
    isBlasterOnline: false,
    canRf: false,
    areaId: SAMPLE_ROOMS.bedroom,
    deviceId: 'infrared-fan',
    buttonCount: 5,
    lastPressedAt: new Date('2026-10-26T23:10:00Z'),
  }),
  remote({
    id: '1e000000-0000-4000-8000-000000000004',
    name: 'Office air conditioner',
    kind: 'air-conditioner',
    blasterId: null,
    blasterName: null,
    isBlasterOnline: false,
    canRf: false,
    areaId: SAMPLE_ROOMS.office,
    deviceId: 'infrared-ac',
    buttonCount: 12,
    lastPressedAt: new Date('2026-10-24T18:00:00Z'),
  }),
];

/** The TV's buttons: name, icon, cell and command. */
const TV_KEYS: readonly (readonly [string, UiIconId, number, number])[] = [
  ['Power', 'power', 0, 0x08],
  ['Input', 'arrow-right', 2, 0x0b],
  ['Up', 'arrow-up', 4, 0x40],
  ['Back', 'rotate-ccw', 6, 0x28],
  ['OK', 'circle-dot', 7, 0x44],
  ['Home', 'house', 8, 0x7c],
  ['Down', 'arrow-down', 10, 0x41],
  ['Volume +', 'volume-2', 12, 0x02],
  ['Mute', 'volume-x', 13, 0x09],
  ['Channel +', 'plus', 14, 0x00],
  ['Volume -', 'minus', 15, 0x03],
  ['Channel -', 'minus', 17, 0x01],
];

/** The TV's remote with its keypad. */
export const INFRARED_SAMPLE_TV: InfraredRemoteDetail = {
  ...remote({
    id: INFRARED_SAMPLE_TV_ID,
    name: 'Living room TV',
    deviceId: 'infrared-tv',
    buttonCount: 12,
    lastPressedAt: at('14:29:00'),
  }),
  buttons: TV_KEYS.map(([name, icon, cell, command], index): InfraredButton => ({
    id: `1b000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    remoteId: INFRARED_SAMPLE_TV_ID,
    name,
    icon,
    cell,
    code: necSample(0x04, command),
    lastPressedAt: index === 0 ? at('14:29:00') : null,
  })),
};

/** Where the sample broker stands: three blasters, two online, one learning nothing. */
export const INFRARED_SAMPLE_STATUS: InfraredStatus = {
  state: 'running',
  error: null,
  blasters: { total: 3, online: 2 },
  remotes: 4,
  lastSent: {
    remoteId: INFRARED_SAMPLE_TV_ID,
    remoteName: 'Living room TV',
    buttonId: '1b000000-0000-4000-8000-000000000000',
    buttonName: 'Power',
    blasterName: 'Living room RM4',
    at: at('14:29:00'),
  },
  learning: [],
  devices: { total: 4, online: 2 },
};

/** The same broker in a house with no blaster yet: what a real house sees today. */
export const INFRARED_SAMPLE_EMPTY: InfraredStatus = {
  ...INFRARED_SAMPLE_STATUS,
  state: 'unavailable',
  blasters: { total: 0, online: 0 },
  remotes: 0,
  lastSent: null,
  devices: { total: 0, online: 0 },
};

/**
 * A learn job, at a phase.
 *
 * @param phase - Where it stands.
 * @returns The job.
 */
export function infraredLearnSample(phase: InfraredLearnJob['phase']): InfraredLearnJob {
  return {
    id: 'learn-1',
    blasterId: 'broadlink-rm4',
    blasterName: 'Living room RM4',
    signal: phase === 'sweeping' ? 'rf' : 'ir',
    phase,
    startedAt: at('14:30:00'),
    finishedAt: phase === 'captured' || phase === 'failed' ? at('14:30:06') : null,
    endsAt: phase === 'listening' ? new Date(Date.now() + 24_000) : null,
    frequencyHz: null,
    code: phase === 'captured' ? necSample(0x04, 0x02) : null,
    error: phase === 'failed' ? 'Nothing reached the blaster in 30 s.' : null,
  };
}

/**
 * A cache already holding the broker, for its pages drawn with no server.
 *
 * @param isEmpty - A house with no blaster yet.
 * @returns The cache.
 */
export function infraredSampleCache(isEmpty = false): QueryClient {
  const client = brokerSampleCache([
    sampleDevice('infrared-tv', 'Living room TV', 'living', {
      vendorId: 'infrared',
      transport: 'infrared',
      kind: 'infrared/remote',
    }),
  ]);
  const icons = [...new Set(TV_KEYS.map(([, icon]) => icon))].sort();

  client.setQueryData(
    INFRARED_QUERY_KEYS.status,
    isEmpty ? INFRARED_SAMPLE_EMPTY : INFRARED_SAMPLE_STATUS,
  );
  client.setQueryData(INFRARED_QUERY_KEYS.blasters, isEmpty ? [] : INFRARED_SAMPLE_BLASTERS);
  client.setQueryData(INFRARED_QUERY_KEYS.remotes, isEmpty ? [] : INFRARED_SAMPLE_REMOTES);
  client.setQueryData([...INFRARED_QUERY_KEYS.remote, INFRARED_SAMPLE_TV_ID], INFRARED_SAMPLE_TV);
  client.setQueryData(
    [...LIBRARY_QUERY_KEYS.icons, 'ids', icons.join(',')],
    new Map(icons.map((id) => [id, sampleIcon(id)])),
  );

  return client;
}
