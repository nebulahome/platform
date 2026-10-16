import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  busSubjects,
  CORE_HISTORY_STATES_METHOD,
  CORE_HISTORY_TELEMETRY_METHOD,
  CORE_SERVICE,
  historyStatesReplySchema,
  historyTelemetryReplySchema,
  parseEntityId,
} from '@nebulahome/contracts';
import { readStateWindow, readTelemetryWindow, type Database } from '@nebulahome/db';

import { createCoreHarness, entityRecord, type CoreHarness } from '../testing/harness.js';

import { startHistoryService } from './history-service.js';

vi.mock('@nebulahome/db', () => ({
  readStateWindow: vi.fn(),
  readTelemetryWindow: vi.fn(),
}));

const lamp = parseEntityId('light.kitchen_ceiling');
const thermometer = parseEntityId('sensor.3d_home_room_kitchen_temperature');
const removed = parseEntityId('light.removed');

const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' };

describe('the history service', () => {
  let harness: CoreHarness;

  beforeEach(() => {
    vi.mocked(readStateWindow).mockReset();
    vi.mocked(readTelemetryWindow).mockReset();

    harness = createCoreHarness();
    harness.directory.set(entityRecord(lamp));
    harness.directory.set(entityRecord(thermometer, { capabilities: { sensor_numeric: {} } }));

    // The reads are mocked: the service only hands the handle on.
    const db: Partial<Database> = {};

    startHistoryService({
      client: harness.client,
      db: db as Database,
      directory: harness.directory,
    });
  });

  it('reads each entity by its row and answers its changes oldest first', async () => {
    vi.mocked(readStateWindow).mockResolvedValue({
      isTruncated: true,
      records: [
        {
          time: new Date('2026-10-01T07:00:00Z'),
          state: { on_off: { isOn: true } },
          previousState: { on_off: { isOn: false } },
          attributes: {},
          isAvailable: true,
          source: 'pkg-weather',
          contextId: null,
          contextType: 'device',
        },
      ],
    });

    const reply = await harness
      .clientFor('3d-home')
      .request(
        busSubjects.service(CORE_SERVICE, CORE_HISTORY_STATES_METHOD),
        { entityIds: [lamp, removed], ...window },
        historyStatesReplySchema,
      );

    expect(vi.mocked(readStateWindow)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readStateWindow).mock.calls[0]?.[1]).toBe(`row-${lamp}`);
    expect(vi.mocked(readStateWindow).mock.calls[0]?.[3]).toBe(10_000);
    expect(reply.series[lamp]?.[0]).toMatchObject({
      entityId: lamp,
      state: { on_off: { isOn: true } },
      context: { type: 'device' },
    });
    expect(reply.series[lamp]?.[0]?.time).toBeInstanceOf(Date);
    expect(reply.series[removed]).toStrictEqual([]);
    expect(reply.truncated).toStrictEqual([lamp]);
  });

  it('reads readings at the resolution asked for', async () => {
    vi.mocked(readTelemetryWindow).mockResolvedValue({
      isTruncated: false,
      records: [
        { time: new Date('2026-10-01T07:00:00Z'), value: 21.5, min: 21, max: 22, count: 4 },
      ],
    });

    const reply = await harness
      .clientFor('3d-home')
      .request(
        busSubjects.service(CORE_SERVICE, CORE_HISTORY_TELEMETRY_METHOD),
        { entityIds: [thermometer], ...window, resolution: '1m', limit: 500 },
        historyTelemetryReplySchema,
      );

    expect(vi.mocked(readTelemetryWindow).mock.calls[0]?.[2]).toBe('1m');
    expect(vi.mocked(readTelemetryWindow).mock.calls[0]?.[4]).toBe(500);
    expect(reply.resolution).toBe('1m');
    expect(reply.series[thermometer]).toStrictEqual([
      { time: new Date('2026-10-01T07:00:00Z'), value: 21.5, min: 21, max: 22, count: 4 },
    ]);
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(
      harness
        .clientFor('3d-home')
        .request(
          busSubjects.service(CORE_SERVICE, CORE_HISTORY_STATES_METHOD),
          { entityIds: [lamp], from: window.to, to: window.from },
          historyStatesReplySchema,
        ),
    ).rejects.toThrow(/does not match its schema/);
    expect(vi.mocked(readStateWindow)).not.toHaveBeenCalled();
  });
});
