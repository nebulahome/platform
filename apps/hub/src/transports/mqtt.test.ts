/**
 * The words a failed probe uses, which are the words an owner reads under the Test button, and
 * how a session paces its tries while its broker is away.
 *
 * The sessions themselves are tried against a broker in `tests/integration/mqtt.test.ts`; this is
 * the client's error becoming a sentence, and the client's events met with a stand-in for it.
 */
import { EventEmitter } from 'node:events';

import { connectAsync, ErrorWithReasonCode, type MqttClient } from 'mqtt';
import { describe, expect, it, vi } from 'vitest';

import type { BundleLogger } from '@nebulahome/package-runtime';

import { failureOf, mqttTransport } from './mqtt.js';

vi.mock('mqtt', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connectAsync: vi.fn(),
}));

const URL = 'mqtts://192.168.1.60:8883';

describe('failureOf', () => {
  it('says the broker refused when it answered the connect packet with a refusal', () => {
    const error = new ErrorWithReasonCode('Connection refused: Not authorized', 5);

    expect(failureOf(URL, error)).toBe(`${URL} refused the session: Not authorized`);
  });

  it('says the broker did not answer for a socket error, by its message', () => {
    expect(failureOf(URL, new Error('self-signed certificate'))).toBe(
      `${URL} did not answer: self-signed certificate`,
    );
  });

  it('falls back to the code when the error carries no message', () => {
    const error = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });

    expect(failureOf(URL, error)).toBe(`${URL} did not answer: ECONNREFUSED`);
  });
});

describe('mqttTransport.connectionKey', () => {
  it('keeps two instances apart that differ only by password', () => {
    // Shared, the second would run on the first one's session and never sign in as itself.
    const key = (password: string): string =>
      mqttTransport.connectionKey({ url: URL, username: 'hub', password });

    expect(key('first')).not.toBe(key('second'));
    expect(key('first')).not.toContain('first');
  });
});

describe('an MQTT session whose broker is away', () => {
  it('tries less and less often, says so once, and starts over once connected', async () => {
    const client = Object.assign(new EventEmitter(), {
      options: { reconnectPeriod: 5000 },
      connected: true,
    });
    const logger = { warn: vi.fn(), debug: vi.fn() };
    const report = vi.fn();

    vi.mocked(connectAsync).mockResolvedValue(client as unknown as MqttClient);
    await mqttTransport.connect(
      { url: URL },
      { logger: logger as unknown as BundleLogger, deliver: vi.fn(), report },
    );

    const periods: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      client.emit(
        'error',
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      );
      client.emit('close');
      periods.push(client.options.reconnectPeriod);
    }

    expect(periods).toStrictEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledTimes(5);
    expect(report.mock.calls.filter(([status]) => status === 'down')).toHaveLength(6);

    client.emit('connect');
    expect(client.options.reconnectPeriod).toBe(5000);
    expect(report).toHaveBeenLastCalledWith('up');

    client.emit('error', new Error('Keepalive timeout'));
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
