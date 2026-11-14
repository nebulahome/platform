import { Writable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DeviceUnavailableError, NotFoundError } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { BusClient } from './client.js';
import { createEnvelope, encodeEnvelope } from './codec.js';
import { FakeTransport } from './fake-transport.js';

/**
 * A logger whose output goes nowhere, so a test asserting on behaviour is not also a test of
 * what got printed.
 *
 * @returns A logger writing into a discarding stream.
 */
function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'test', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param callback - Signals completion.
       */
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

const reportSchema = z.object({ entityId: z.string(), level: z.number() });

/**
 * Builds a client over a fresh in-memory broker.
 *
 * @param source - The publisher identity to stamp on envelopes.
 * @returns The transport and a client bound to it.
 */
function createHarness(source = 'core'): { transport: FakeTransport; client: BusClient } {
  const transport = new FakeTransport();

  return {
    transport,
    client: new BusClient({ transport, source, logger: silentLogger(), requestTimeoutMs: 200 }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('publish and subscribe', () => {
  it('delivers a validated payload', async () => {
    const { client } = createHarness();
    const received: unknown[] = [];

    client.subscribe('nebula.v1.state.report.>', reportSchema, (payload) => {
      received.push(payload);
    });

    client.publish('nebula.v1.state.report.light.kitchen', {
      entityId: 'light.kitchen',
      level: 40,
    });

    await vi.waitFor(() => {
      expect(received).toStrictEqual([{ entityId: 'light.kitchen', level: 40 }]);
    });
  });

  it('tells the handler which subject the message actually arrived on', async () => {
    // The subscription is a pattern; the handler needs the resolved subject to know which
    // entity reported.
    const { client } = createHarness();
    const subjects: string[] = [];

    client.subscribe('nebula.v1.state.report.>', reportSchema, (payload, context) => {
      subjects.push(context.subject);
    });

    client.publish('nebula.v1.state.report.light.kitchen', { entityId: 'light.kitchen', level: 1 });

    await vi.waitFor(() => {
      expect(subjects).toStrictEqual(['nebula.v1.state.report.light.kitchen']);
    });
  });

  it('drops an invalid message without ending the subscription', async () => {
    // One misbehaving adapter must not silently stop every state report in the house.
    const { client } = createHarness();
    const received: unknown[] = [];

    client.subscribe('nebula.v1.state.report.>', reportSchema, (payload) => {
      received.push(payload);
    });

    client.publish('nebula.v1.state.report.light.kitchen', { entityId: 'light.kitchen' });
    client.publish('nebula.v1.state.report.light.hall', { entityId: 'light.hall', level: 7 });

    await vi.waitFor(() => {
      expect(received).toStrictEqual([{ entityId: 'light.hall', level: 7 }]);
    });
  });

  it('survives a handler that throws', async () => {
    const { client } = createHarness();
    const seen: number[] = [];

    client.subscribe('nebula.v1.state.report.>', reportSchema, (payload) => {
      seen.push(payload.level);

      if (payload.level === 1) {
        throw new Error('handler exploded');
      }
    });

    client.publish('nebula.v1.state.report.light.a', { entityId: 'light.a', level: 1 });
    client.publish('nebula.v1.state.report.light.b', { entityId: 'light.b', level: 2 });

    await vi.waitFor(() => {
      expect(seen).toStrictEqual([1, 2]);
    });
  });

  it('handles messages one at a time, in arrival order', async () => {
    // Concurrency here would let two reports for the same entity be applied in an order nobody
    // chose, which is the race the single-writer design exists to remove.
    const { client } = createHarness();
    const order: string[] = [];

    client.subscribe('nebula.v1.state.report.>', reportSchema, async (payload) => {
      order.push(`start:${String(payload.level)}`);
      await new Promise((resolve) => setTimeout(resolve, payload.level === 1 ? 20 : 0));
      order.push(`end:${String(payload.level)}`);
    });

    client.publish('nebula.v1.state.report.light.a', { entityId: 'light.a', level: 1 });
    client.publish('nebula.v1.state.report.light.b', { entityId: 'light.b', level: 2 });

    await vi.waitFor(() => {
      expect(order).toStrictEqual(['start:1', 'end:1', 'start:2', 'end:2']);
    });
  });

  it('lets a slow message be overtaken when the handler asks for concurrency', async () => {
    // A command waiting on a device that does not answer must not hold up the next one.
    const { client } = createHarness();
    const order: string[] = [];

    client.subscribe(
      'nebula.v1.state.report.>',
      reportSchema,
      async (payload) => {
        order.push(`start:${String(payload.level)}`);
        await new Promise((resolve) => setTimeout(resolve, payload.level === 1 ? 30 : 0));
        order.push(`end:${String(payload.level)}`);
      },
      { concurrency: 4 },
    );

    client.publish('nebula.v1.state.report.light.a', { entityId: 'light.a', level: 1 });
    client.publish('nebula.v1.state.report.light.b', { entityId: 'light.b', level: 2 });

    await vi.waitFor(() => {
      expect(order).toStrictEqual(['start:1', 'start:2', 'end:2', 'end:1']);
    });
  });

  it('stops delivering once unsubscribed', async () => {
    const { client } = createHarness();
    const received: unknown[] = [];

    const subscription = client.subscribe('nebula.v1.state.report.>', reportSchema, (payload) => {
      received.push(payload);
    });

    subscription.unsubscribe();
    client.publish('nebula.v1.state.report.light.a', { entityId: 'light.a', level: 1 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toStrictEqual([]);
  });
});

describe('request and serve', () => {
  it('round-trips a value', async () => {
    const { client } = createHarness();

    client.serve('nebula.v1.svc.core.ping', z.object({ n: z.number() }), (payload) => ({
      pong: payload.n * 2,
    }));

    await expect(
      client.request('nebula.v1.svc.core.ping', { n: 21 }, z.object({ pong: z.number() })),
    ).resolves.toStrictEqual({ pong: 42 });
  });

  it('gives the caller back the class the responder threw', async () => {
    const { client } = createHarness();

    client.serve('nebula.v1.svc.core.get', z.object({}), () => {
      throw new NotFoundError('No such entity', { details: { entityId: 'light.nowhere' } });
    });

    await expect(client.request('nebula.v1.svc.core.get', {}, z.object({}))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('reports an unanswered request as unavailability', async () => {
    const { client } = createHarness();

    await expect(
      client.request('nebula.v1.cmd.light.kitchen.on_off', {}, z.object({})),
    ).rejects.toBeInstanceOf(DeviceUnavailableError);
  });

  it('times out rather than waiting forever', async () => {
    const { client } = createHarness();

    client.serve('nebula.v1.svc.core.slow', z.object({}), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      return {};
    });

    await expect(
      client.request('nebula.v1.svc.core.slow', {}, z.object({}), { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(DeviceUnavailableError);
  });

  it('propagates the trace id into the handler and back out on the reply', async () => {
    // One failure has to be reassemblable from two services' log streams, which only works if
    // the identifier survives the round trip.
    const { client, transport } = createHarness();
    let seenByHandler = '';

    client.serve('nebula.v1.svc.core.echo', z.object({}), (payload, context) => {
      seenByHandler = context.header.traceId;

      return {};
    });

    await client.request('nebula.v1.svc.core.echo', {}, z.object({}), { traceId: 'trace-42' });

    expect(seenByHandler).toBe('trace-42');

    const decoder = new TextDecoder();
    const replies = transport.published.filter((message) =>
      decoder.decode(message.data).includes('"status":"ok"'),
    );

    expect(replies).toHaveLength(0);
  });

  it('drops a queued request whose caller already gave up, and handles a live one', async () => {
    // A command the user saw fail and retried must not also run late from the queue.
    const { client, transport } = createHarness();
    const handled: number[] = [];

    client.serve('nebula.v1.svc.core.count', z.object({ n: z.number() }), (payload) => {
      handled.push(payload.n);

      return {};
    });

    /**
     * Encodes a request envelope as an older or newer requester would send it.
     *
     * @param n - The payload marker.
     * @param expiresAt - The expiry to carry, or undefined for an envelope without one.
     * @returns The encoded envelope.
     */
    const encode = (n: number, expiresAt: string | undefined): Uint8Array =>
      encodeEnvelope({
        ...createEnvelope({ n }, { source: 'api' }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

    const subject = 'nebula.v1.svc.core.count';
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    await expect(transport.request(subject, encode(1, past), 50)).rejects.toThrow(/No reply/);
    await transport.request(subject, encode(2, future), 200);
    await transport.request(subject, encode(3, undefined), 200);

    expect(handled).toStrictEqual([2, 3]);
  });

  it.each([
    { expires: true, handled: [1] },
    { expires: false, handled: [1, 2] },
  ])(
    'with expires $expires, handles $handled once a request times out behind a slow one',
    async ({ expires, handled: expected }) => {
      // An expiring request (a device command) must not run late; a best-effort one still must.
      vi.useFakeTimers({ toFake: ['Date'] });

      const { client, transport } = createHarness();
      const handled: number[] = [];

      client.serve('nebula.v1.svc.core.slow', z.object({ n: z.number() }), async (payload) => {
        handled.push(payload.n);
        await new Promise((resolve) => setTimeout(resolve, 20));
        // The clock jumps past the second caller's timeout while this one is still being handled.
        vi.setSystemTime(Date.now() + 10_000);

        return {};
      });

      const first = client.request('nebula.v1.svc.core.slow', { n: 1 }, z.object({}));
      const second = client.request('nebula.v1.svc.core.slow', { n: 2 }, z.object({}), {
        timeoutMs: 100,
        expires,
      });

      await expect(first).resolves.toStrictEqual({});
      await second.catch(() => undefined);
      await vi.waitFor(() => {
        expect(handled).toStrictEqual(expected);
      });

      const sent = new TextDecoder().decode(transport.published[1]?.data);

      expect(sent.includes('"expiresAt"')).toBe(expires);
    },
  );

  it('rejects a request whose payload does not match, without leaving the caller hanging', async () => {
    // The caller learns what was wrong immediately instead of discovering it as a timeout five
    // seconds later.
    const { client } = createHarness();

    client.serve('nebula.v1.svc.core.strict', z.object({ n: z.number() }), () => ({ ok: true }));

    await expect(
      client.request('nebula.v1.svc.core.strict', { n: 'not a number' }, z.object({})),
    ).rejects.toThrow(/does not match its schema/);
  });
});

describe('queue groups', () => {
  it('gives one message to one member rather than to all of them', async () => {
    // What makes a second instance of a service share the load instead of duplicating the work.
    const { client } = createHarness();
    const first: unknown[] = [];
    const second: unknown[] = [];

    client.subscribe(
      'nebula.v1.state.report.>',
      reportSchema,
      (payload) => {
        first.push(payload);
      },
      { queue: 'core' },
    );

    client.subscribe(
      'nebula.v1.state.report.>',
      reportSchema,
      (payload) => {
        second.push(payload);
      },
      { queue: 'core' },
    );

    client.publish('nebula.v1.state.report.light.a', { entityId: 'light.a', level: 1 });

    await vi.waitFor(() => {
      expect(first.length + second.length).toBe(1);
    });
  });
});
