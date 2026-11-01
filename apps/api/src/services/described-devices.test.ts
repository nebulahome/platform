import { describe, expect, it, vi } from 'vitest';

import { parseEntityId } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { DESCRIBED_ACTION, onDescribed } from './described-devices.js';
import type { DevicesContext } from './devices.js';

/**
 * The follower over stand-ins: no database, so linking fails and is only logged.
 *
 * @returns What it needs, and what it recorded.
 */
function rig() {
  const record = vi.fn(async () => Promise.resolve());
  const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });

  return {
    record,
    options: {
      contextFor: (traceId: string) => ({ logger, traceId }) as unknown as DevicesContext,
      audit: { record },
    },
  };
}

const event = {
  deviceId: 'switchbot-ghiaccio',
  source: 'switchbot-ghiaccio',
  name: 'Ghiaccio',
  entityIds: [parseEntityId('switch.switchbot_ghiaccio_switch')],
};

describe('a device described again', () => {
  it('is recorded for its Activity with what was removed and added', async () => {
    const { record, options } = rig();
    const described = {
      added: [{ entityId: parseEntityId('switch.switchbot_ghiaccio_switch'), name: 'Switch' }],
      removed: [{ entityId: parseEntityId('button.switchbot_ghiaccio_press'), name: 'Press' }],
    };

    await onDescribed(options, { ...event, described });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: DESCRIBED_ACTION,
        resourceType: 'device',
        resourceId: 'switchbot-ghiaccio',
        isSystem: true,
        details: described,
      }),
    );
  });

  it('records nothing when its entities stayed the same, or it is another update', async () => {
    const { record, options } = rig();

    await onDescribed(options, { ...event, described: { added: [], removed: [] } });
    await onDescribed(options, event);

    expect(record).not.toHaveBeenCalled();
  });
});
