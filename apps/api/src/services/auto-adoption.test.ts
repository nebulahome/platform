/**
 * Adding on its own what a vendor adds on its own: which devices, under which ids and names, and
 * what happens when one cannot be added.
 *
 * The hub's list and the adding are stand-ins: what `createDevice` checks is the devices routes'
 * to test, and what is asserted here is what the service decides.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  discoveredDeviceSchema,
  type DeviceView,
  type DiscoveredDevice,
  type DiscoveryAdopt,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';

import { AutoAdoption } from './auto-adoption.js';
import type { DevicesContext } from './devices.js';

/**
 * A Zigbee device just paired, as the hub proposes it.
 *
 * @param id - The candidate's id.
 * @param name - What it called itself.
 * @param adoption - Who adds it.
 * @returns The candidate.
 */
function paired(id: string, name: string | null, adoption = 'automatic'): DiscoveredDevice {
  return discoveredDeviceSchema.parse({
    id,
    vendorId: 'zigbee2mqtt',
    driverId: 'device',
    kind: 'zigbee2mqtt/device',
    source: 'module',
    address: 'zigbee2mqtt',
    externalId: `0x00158d000${id.slice(0, 7)}`,
    name,
    model: 'Zigbee device',
    modelChoices: ['Zigbee device'],
    modelCode: 'device',
    swVersion: null,
    transportConfig: {},
    adoption,
    firstSeenAt: '2026-09-28T10:00:00.000Z',
    lastSeenAt: '2026-09-28T10:00:00.000Z',
  });
}

/**
 * The service over stand-ins, and what it did.
 *
 * @param candidates - What the hub proposes.
 * @param taken - The ids already in use.
 * @param refuse - Why adding a candidate fails, by its id.
 * @returns The service, what it added and what it recorded.
 */
function service(
  candidates: DiscoveredDevice[],
  taken: string[] = [],
  refuse: Record<string, string> = {},
) {
  const added: { candidateId: string; body: DiscoveryAdopt }[] = [];
  const record = vi.fn(async () => Promise.resolve());
  const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
  const warn = vi.spyOn(logger, 'warn');
  const adoption = new AutoAdoption({
    contextFor: (traceId) => ({ logger, traceId }) as unknown as DevicesContext,
    audit: { record },
    list: async () => Promise.resolve(candidates),
    takenIds: async () => Promise.resolve([...taken]),

    /**
     * Adds a device, or fails the way it was told to.
     *
     * @param context - Unused.
     * @param candidateId - Which.
     * @param body - What with.
     * @returns The device added.
     */
    adopt: async (context, candidateId, body) => {
      const reason = refuse[candidateId];

      if (reason !== undefined) {
        throw new Error(reason);
      }

      added.push({ candidateId, body });

      const candidate = candidates.find((each) => each.id === candidateId);

      if (candidate === undefined) {
        throw new Error('fixture');
      }

      // What the service reads of the device added; the rest is the devices routes' to test.
      const view = { id: body.id, kind: candidate.kind, model: candidate.model };

      return Promise.resolve({ device: view as unknown as DeviceView, candidate });
    },
  });

  return { adoption, added, record, warn };
}

describe('AutoAdoption', () => {
  it('adds what a vendor adds on its own, named as it named itself, and leaves the rest', async () => {
    const { adoption, added, record } = service([
      paired('aaaaaaaaaaaaaaaa', 'Aqara MCCGQ11LM'),
      paired('bbbbbbbbbbbbbbbb', 'Hall lamp'),
      paired('cccccccccccccccc', 'A printer', 'owner'),
    ]);

    await adoption.settle();

    expect(added.map((each) => [each.candidateId, each.body.id, each.body.name])).toEqual([
      ['aaaaaaaaaaaaaaaa', 'zigbee2mqtt-aqara-mccgq11lm', 'Aqara MCCGQ11LM'],
      ['bbbbbbbbbbbbbbbb', 'zigbee2mqtt-hall-lamp', 'Hall lamp'],
    ]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'device.create', isSystem: true }),
    );
  });

  it('gives two of the same name two ids, beside the ones already taken', async () => {
    const { adoption, added } = service(
      [paired('aaaaaaaaaaaaaaaa', 'Plug'), paired('bbbbbbbbbbbbbbbb', 'Plug')],
      ['zigbee2mqtt-plug'],
    );

    await adoption.settle();

    expect(added.map((each) => each.body.id)).toEqual(['zigbee2mqtt-plug-2', 'zigbee2mqtt-plug-3']);
  });

  it('names one that said nothing by its model', async () => {
    const { adoption, added } = service([paired('aaaaaaaaaaaaaaaa', null)]);

    await adoption.settle();

    expect(added[0]?.body.name).toBe('Zigbee device');
  });

  it('keeps going past one it cannot add, and says why once, not every time', async () => {
    const { adoption, added, warn } = service(
      [paired('aaaaaaaaaaaaaaaa', 'Broken'), paired('bbbbbbbbbbbbbbbb', 'Fine')],
      [],
      { aaaaaaaaaaaaaaaa: 'Set up Zigbee2MQTT first' },
    );

    await adoption.settle();
    await adoption.settle();

    expect(added.map((each) => each.body.name)).toEqual(['Fine', 'Fine']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
