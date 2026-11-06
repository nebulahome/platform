import { describe, expect, it, vi } from 'vitest';

import type { BusClient } from '@nebulahome/bus';
import { parseEntityId, type Identity } from '@nebulahome/contracts';

import { sendCommand } from './commands.js';

describe('sendCommand', () => {
  it('tells core how long it waits, so a command held for an update is not sent after it', async () => {
    const request = vi.fn(async () =>
      Promise.resolve({ entityId: 'light.desk', capability: 'on_off', acceptedAt: new Date() }),
    );

    await sendCommand({
      client: { request } as unknown as BusClient,
      entityId: parseEntityId('light.desk'),
      capability: 'on_off',
      command: { command: 'turn_on' },
      identity: { userId: '00000000-0000-4000-8000-000000000001' } as unknown as Identity,
      traceId: '00000000-0000-4000-8000-000000000002',
      timeoutMs: 125_000,
    });

    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ waitMs: 125_000 }),
      expect.anything(),
      { traceId: '00000000-0000-4000-8000-000000000002', timeoutMs: 125_000 },
    );
  });
});
