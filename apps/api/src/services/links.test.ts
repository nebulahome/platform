import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { IntegrationsContext } from './integrations.js';
import { rankedWay, syncLinksOnCore, twinReasons } from './links.js';

describe('syncLinksOnCore', () => {
  it('names every row, in requests of at most 1024', async () => {
    const sent: number[] = [];
    const context = {
      traceId: 'trace',
      timeoutMs: 1000,
      bus: {
        request: async (subject: string, payload: { entityRowIds: string[] }) => {
          sent.push(payload.entityRowIds.length);

          return Promise.resolve({});
        },
      },
    } as unknown as IntegrationsContext;

    await syncLinksOnCore(
      context,
      Array.from({ length: 1500 }, () => randomUUID()),
    );

    expect(sent).toEqual([1024, 476]);
  });
});

const plug = { mac: '08:f9:e0:12:4c:7a', serialNumber: 'SN-1', model: 'Plug S Gen3' };

describe('twinReasons', () => {
  it('says what two devices have alike when what the integration asks agrees', () => {
    expect(twinReasons(plug, { ...plug }, ['mac'])).toEqual([
      { kind: 'mac', value: '08:f9:e0:12:4c:7a' },
      { kind: 'serial', value: 'SN-1' },
      { kind: 'model', value: 'Plug S Gen3' },
    ]);
  });

  it('finds no twin when what the integration asks is missing or differs', () => {
    expect(twinReasons(plug, { ...plug, mac: null }, ['mac'])).toBeNull();
    expect(twinReasons(plug, { ...plug, serialNumber: 'SN-2' }, ['mac', 'serial'])).toBeNull();
  });
});

describe('rankedWay', () => {
  const cloud = { transport: 'switchbot/cloud' };
  const ble = { transport: 'bluetooth' };
  const matter = { transport: 'matter' };
  const prefer = ['matter', 'bluetooth', 'switchbot/cloud'];

  it('prefers the way the vendor ranks higher', () => {
    expect(rankedWay(cloud, ble, prefer)).toBe(ble);
    expect(rankedWay(ble, matter, prefer)).toBe(matter);
  });

  it('keeps the way preferred now when the joining one ranks lower or not at all', () => {
    expect(rankedWay(matter, cloud, prefer)).toBe(matter);
    expect(rankedWay(cloud, ble, [])).toBe(cloud);
  });
});
