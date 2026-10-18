import { describe, expect, it } from 'vitest';

import {
  busSubjects,
  HUB_CATALOGUE_METHOD,
  HUB_MATTER_NODES_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
} from '@nebulahome/contracts';

import { MATTER_LAMP } from '../testing/hub-harness.js';

import { rehomeMatterDevices } from './brokers.js';
import type { DevicesContext } from './devices.js';

/**
 * A device of the lamp's node, held by the platform.
 *
 * @param deviceId - The device it was added as.
 * @param claimedBy - The vendors whose rules take it.
 * @returns The device, as the hub lists it.
 */
function held(deviceId: string, claimedBy: string[]) {
  const [device] = MATTER_LAMP.devices;

  return { ...device, deviceId, kind: 'matter/generic', claimedBy };
}

describe('rehomeMatterDevices', () => {
  it('hands a device the platform holds to the one integration that now takes it', async () => {
    const asked: string[] = [];
    const written: unknown[] = [];
    const replies: Record<string, unknown> = {
      [busSubjects.service(HUB_SERVICE, HUB_MATTER_NODES_METHOD)]: {
        items: [
          // One vendor takes the first; two take the second, which stays the platform's.
          { ...MATTER_LAMP, devices: [held('matter-lamp', ['cloudy'])] },
          { ...MATTER_LAMP, nodeId: '8', devices: [held('matter-plug', ['cloudy', 'other'])] },
        ],
      },
      [busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD)]: {
        vendors: [
          {
            id: 'cloudy',
            version: '1.2.0',
            drivers: [
              { id: 'cloudy/robot', name: 'Robot', transport: 'cloudy/cloud', models: [] },
              { id: 'cloudy/matter', name: 'Matter device', transport: 'matter', models: [] },
            ],
          },
        ],
      },
      [busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD)]: { wasRunning: true },
    };
    const context = {
      traceId: 'trace',
      bus: {
        request: async (subject: string, payload: unknown) => {
          asked.push(`${subject} ${JSON.stringify(payload)}`);

          return Promise.resolve(replies[subject]);
        },
      },
      db: {
        update: () => ({
          set: (values: unknown) => {
            written.push(values);

            return { where: () => ({ returning: async () => Promise.resolve([{ id: 'x' }]) }) };
          },
        }),
      },
    } as unknown as DevicesContext;

    expect(await rehomeMatterDevices(context)).toEqual([
      { deviceId: 'matter-lamp', kind: 'cloudy/matter' },
    ]);
    expect(written).toEqual([
      expect.objectContaining({
        kind: 'cloudy/matter',
        kindVersion: '1.2.0',
        model: 'Matter device',
      }),
    ]);
    expect(asked).toContain(
      `${busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD)} {"integrationId":"matter-lamp"}`,
    );
  });
});
