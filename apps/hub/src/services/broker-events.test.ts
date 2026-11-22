import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrokerEvent } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { BROKER_EVENT_WINDOW_MS, BrokerEvents, told } from './broker-events.js';

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'test', version: '0.0.0', level: 'fatal' },
    new Writable({
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

describe('BrokerEvents', () => {
  let published: BrokerEvent[];
  let events: BrokerEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    published = [];
    events = new BrokerEvents((event) => {
      published.push(event);
    }, silentLogger());
  });

  afterEach(() => {
    events.stop();
    vi.useRealTimers();
  });

  it('tells a change once its burst is over, once for the whole burst', () => {
    events.changed({ broker: 'mqtt', part: 'clients' });
    events.changed({ broker: 'mqtt', part: 'clients' });
    events.changed({ broker: 'mqtt', part: 'clients' });

    vi.advanceTimersByTime(BROKER_EVENT_WINDOW_MS - 1);
    expect(published).toStrictEqual([]);

    vi.advanceTimersByTime(1);
    expect(published).toStrictEqual([{ broker: 'mqtt', part: 'clients' }]);
  });

  it('tells each broker and part on its own', () => {
    events.changed({ broker: 'mqtt', part: 'clients' });
    events.changed({ broker: 'mqtt', part: 'status' });
    events.changed({ broker: 'serial', part: 'status' });
    vi.advanceTimersByTime(BROKER_EVENT_WINDOW_MS);

    expect(published).toStrictEqual([
      { broker: 'mqtt', part: 'clients' },
      { broker: 'mqtt', part: 'status' },
      { broker: 'serial', part: 'status' },
    ]);
  });

  it('tells a change after the last burst again, at most once a window', () => {
    for (let tick = 0; tick < 10; tick += 1) {
      events.changed({ broker: 'matter', part: 'nodes' });
      vi.advanceTimersByTime(BROKER_EVENT_WINDOW_MS / 5);
    }

    expect(published).toHaveLength(2);

    vi.advanceTimersByTime(BROKER_EVENT_WINDOW_MS);
    expect(published).toHaveLength(2);
  });

  it('tells nothing once stopped, nor what was still gathering', () => {
    events.changed({ broker: 'modbus', part: 'found' });
    events.stop();
    events.changed({ broker: 'modbus', part: 'devices' });
    vi.advanceTimersByTime(BROKER_EVENT_WINDOW_MS);

    expect(published).toStrictEqual([]);
  });

  it('keeps going when the bus refuses one', () => {
    const failing = new BrokerEvents(() => {
      throw new Error('CONNECTION_CLOSED');
    }, silentLogger());

    failing.changed({ broker: 'thread', part: 'status' });

    expect(() => vi.advanceTimersByTime(BROKER_EVENT_WINDOW_MS)).not.toThrow();
  });
});

describe('told', () => {
  it('says what a method changed and hands its reply back', () => {
    const changed = vi.fn();

    expect(
      told(
        { isRemoved: true },
        changed,
        { broker: 'mqtt', part: 'mappings' },
        { broker: 'mqtt', part: 'devices' },
      ),
    ).toStrictEqual({ isRemoved: true });
    expect(changed.mock.calls).toStrictEqual([
      [{ broker: 'mqtt', part: 'mappings' }],
      [{ broker: 'mqtt', part: 'devices' }],
    ]);
  });
});
