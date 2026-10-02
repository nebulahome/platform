/**
 * The live channel's fan-out, against a bus in memory.
 */
import { describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import { busSubjects, type WsServerMessage } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { EventFanout } from './events.js';

/**
 * Waits until a condition holds, polling.
 *
 * @param condition - What to wait for.
 */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('EventFanout', () => {
  it('tells the sockets watching discovery that the proposals changed, and how many there are', async () => {
    const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
    const transport = new FakeTransport();
    const hub = new BusClient({ transport, source: 'hub', logger });
    const fanout = new EventFanout(logger);
    const watching: WsServerMessage[] = [];
    const elsewhere: WsServerMessage[] = [];

    fanout.start(new BusClient({ transport, source: 'api', logger }));
    fanout.add({
      canRead: () => false,
      topics: new Set(['discovery']),
      send: (message) => {
        watching.push(message);
      },
    });
    fanout.add({
      canRead: () => true,
      topics: new Set(['state', 'devices']),
      send: (message) => {
        elsewhere.push(message);
      },
    });

    hub.publish(busSubjects.discoveryEvent('changed'), { count: 2 });
    await until(() => watching.length > 0);
    fanout.stop();

    expect(watching).toEqual([{ type: 'discovery_event', event: 'changed', count: 2 }]);
    expect(elsewhere).toEqual([]);
  });
});
