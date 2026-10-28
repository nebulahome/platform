/**
 * A new remote's room: the hub never writes a device row, so the room the owner picked is put on
 * the remote's device here, through the ordinary device update, once the house has it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INFRARED_REMOTE } from '../testing/brokers-fake.js';

import type { DevicesContext } from './devices.js';
import { saveInfraredRemote } from './infrared.js';

const updateDevice = vi.hoisted(() => vi.fn());

vi.mock('./devices.js', () => ({ deleteDevice: vi.fn(), updateDevice }));

/** The room the owner picked. */
const AREA_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/**
 * A context whose hub answers a remote save with the given device.
 *
 * @param deviceId - The remote's device, or null when it was not added in time.
 * @returns The context.
 */
function answering(deviceId: string | null): DevicesContext {
  return {
    traceId: 'trace',
    timeoutMs: 5000,
    bus: { request: () => Promise.resolve({ ...INFRARED_REMOTE, deviceId }) },
  } as unknown as DevicesContext;
}

describe('saveInfraredRemote', () => {
  beforeEach(() => {
    updateDevice.mockReset();
  });

  it('puts a new remote’s device in the room asked for', async () => {
    const saved = await saveInfraredRemote(answering('infrared-tv'), {
      name: 'TV',
      kind: 'tv',
      blasterId: null,
      columns: 3,
      areaId: AREA_ID,
    });

    expect(updateDevice).toHaveBeenCalledWith(expect.anything(), 'infrared-tv', {
      areaId: AREA_ID,
    });
    expect(saved.areaId).toBe(AREA_ID);
  });

  it('leaves the room alone for a remote changed, or one whose device is not there yet', async () => {
    await saveInfraredRemote(answering('infrared-tv'), {
      id: INFRARED_REMOTE.id,
      name: 'TV',
      kind: 'tv',
      blasterId: null,
      columns: 3,
      areaId: AREA_ID,
    });
    await saveInfraredRemote(answering(null), {
      name: 'TV',
      kind: 'tv',
      blasterId: null,
      columns: 3,
      areaId: AREA_ID,
    });

    expect(updateDevice).not.toHaveBeenCalled();
  });
});
