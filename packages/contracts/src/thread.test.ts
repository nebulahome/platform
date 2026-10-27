import { describe, expect, it } from 'vitest';

import {
  threadDatasetSchema,
  threadSettingsRequestSchema,
  threadSetupRequestSchema,
} from './thread.js';

describe('threadDatasetSchema', () => {
  it('keeps a pasted dataset as lower-case hex', () => {
    expect(threadDatasetSchema.parse(' 0E080000000000010000000300000F ')).toBe(
      '0e080000000000010000000300000f',
    );
  });

  it('refuses what is no TLV hex', () => {
    expect(threadDatasetSchema.safeParse('').success).toBe(false);
    expect(threadDatasetSchema.safeParse('0e0').success).toBe(false);
    expect(threadDatasetSchema.safeParse('0e08zz').success).toBe(false);
  });
});

describe('threadSetupRequestSchema', () => {
  it('creates a network on a radio, channel left to the border router', () => {
    const request = threadSetupRequestSchema.parse({
      border: { mode: 'local', portId: '0192f6a4-5b6c-7d8e-9f01-23456789abcd' },
      network: { action: 'create', name: 'NebulaHome-1A2B' },
    });

    expect(request.network).toEqual({ action: 'create', name: 'NebulaHome-1A2B', channel: null });
    expect(request.useForMatter).toBe(true);
  });

  it('keeps the network an external border router has', () => {
    expect(
      threadSetupRequestSchema.parse({
        border: { mode: 'external', url: 'http://192.168.1.20:8081' },
        network: { action: 'keep' },
      }).border,
    ).toEqual({ mode: 'external', url: 'http://192.168.1.20:8081' });
  });

  it('refuses a border router reached by anything but HTTP', () => {
    expect(
      threadSetupRequestSchema.safeParse({
        border: { mode: 'external', url: 'file:///etc/passwd' },
        network: { action: 'keep' },
      }).success,
    ).toBe(false);
  });

  it('refuses a name longer than Thread allows, and a channel off 2.4 GHz', () => {
    const border = { mode: 'local', portId: '0192f6a4-5b6c-7d8e-9f01-23456789abcd' };

    expect(
      threadSetupRequestSchema.safeParse({
        border,
        network: { action: 'create', name: 'A network name too long' },
      }).success,
    ).toBe(false);
    expect(threadSettingsRequestSchema.safeParse({ channel: 27 }).success).toBe(false);
  });
});
