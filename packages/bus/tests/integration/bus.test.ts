/**
 * The bus against a real broker.
 *
 * The unit tests run on {@link FakeTransport}, which is a model of NATS rather than NATS. These
 * exist for the parts a model cannot honestly stand in for: that the subject taxonomy really
 * routes, that a JetStream stream really captures an ordinary publish, and that a durable
 * consumer really remembers where it got to across a reconnect.
 *
 * Requires the development broker: `docker compose -f infra/docker-compose.dev.yml up -d nats`.
 */
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BUS_PATTERNS,
  busSubjects,
  NotFoundError,
  telemetryReadingSchema,
  type EntityId,
} from '@nebula-home/contracts';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import {
  BusClient,
  connectBus,
  createTelemetryConsumer,
  ensureTelemetryStream,
  TELEMETRY_STREAM,
  ulid,
  type BusConnection,
} from '@/index.js';

/** The development broker from `infra/docker-compose.dev.yml`, and nothing else. */
const NATS_URL = 'nats://localhost:4222';

const kitchenLight = 'light.kitchen_ceiling' as EntityId;

/**
 * A sensor nothing else has ever reported.
 *
 * The stream is durable and shared with whatever ran against this broker before, so a fixed
 * entity id would make these assertions depend on how many times the suite has been run.
 */
const kitchenTemperature = `sensor.t_${ulid().toLowerCase()}` as EntityId;

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'bus-integration', version: '0.0.0', level: 'fatal' },
    new Writable({
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

/**
 * Waits until a predicate holds, or gives up.
 *
 * @param predicate - What has to become true.
 * @param timeoutMs - How long to keep checking.
 * @returns A promise that resolves once the predicate holds.
 * @throws {Error} When it never does.
 */
async function eventually(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error('Condition never became true');
}

describe('the bus against a real broker', () => {
  let bus: BusConnection;
  let client: BusClient;
  const durableName = `core_test_${ulid().toLowerCase()}`;

  beforeAll(async () => {
    bus = await connectBus({
      url: NATS_URL,
      name: 'bus-integration',
      logger: silentLogger(),
      signal: AbortSignal.timeout(20_000),
    });

    client = new BusClient({
      transport: bus.transport,
      source: 'bus-integration',
      logger: silentLogger(),
      requestTimeoutMs: 2000,
    });
  });

  afterAll(async () => {
    try {
      const manager = await bus.connection.jetstreamManager();

      await manager.consumers.delete(TELEMETRY_STREAM, durableName);
    } catch {
      // The consumer may never have been created, if an earlier test failed first.
    }

    await bus.close();
  });

  it('reports itself connected', () => {
    expect(bus.isConnected()).toBe(true);
  });

  it('routes an entity id across two subject tokens', async () => {
    // The `>` rule, verified against the thing that actually implements it rather than against
    // our model of it.
    const received: string[] = [];

    const subscription = client.subscribe(
      BUS_PATTERNS.allStateReports,
      z.object({ level: z.number() }),
      (payload, context) => {
        received.push(context.subject);
      },
    );

    await eventually(() => true, 100);
    client.publish(busSubjects.stateReport(kitchenLight), { level: 42 });

    await eventually(() => received.length === 1);
    expect(received[0]).toBe('nebula.v1.state.report.light.kitchen_ceiling');

    subscription.unsubscribe();
  });

  it('carries a failure back to the requester as the class that was thrown', async () => {
    const subject = busSubjects.service('core-test', 'get');

    const subscription = client.serve(subject, z.object({}), () => {
      throw new NotFoundError('No such entity', { details: { entityId: 'light.nowhere' } });
    });

    await eventually(() => true, 100);

    await expect(client.request(subject, {}, z.object({}))).rejects.toBeInstanceOf(NotFoundError);

    subscription.unsubscribe();
  });

  describe('the telemetry stream', () => {
    beforeAll(async () => {
      await ensureTelemetryStream({ connection: bus.connection, logger: silentLogger() });
    });

    it('is idempotent, so every restart does not have to check first', async () => {
      await expect(
        ensureTelemetryStream({ connection: bus.connection, logger: silentLogger() }),
      ).resolves.toBeUndefined();
    });

    it('captures an ordinary publish', async () => {
      // Adapters publish telemetry with a plain publish and no JetStream client of their own;
      // the stream captures it because it is bound to the subject. If that ever stopped being
      // true, every reading would be silently lost rather than merely unacknowledged.
      const consumer = await createTelemetryConsumer({
        connection: bus.connection,
        durableName,
        logger: silentLogger(),
      });

      const observedAt = new Date('2026-09-04T10:35:19.852Z');

      client.publish(busSubjects.telemetry(kitchenTemperature), {
        entityId: kitchenTemperature,
        value: 21.5,
        observedAt,
      });

      // A fresh durable consumer starts at the beginning of the stream, so the batch also holds
      // whatever earlier runs left behind. Ours is the one to assert on; the rest are
      // acknowledged so the next test sees an empty stream position.
      const batch = await consumer.pull(500, 2000);
      const ours = batch.deliveries.filter(
        (delivery) => delivery.reading.entityId === kitchenTemperature,
      );

      expect(ours).toHaveLength(1);
      expect(ours[0]?.reading.value).toBe(21.5);
      expect(ours[0]?.reading.observedAt).toStrictEqual(observedAt);

      batch.ack();
    });

    it('does not redeliver what was acknowledged', async () => {
      const consumer = await createTelemetryConsumer({
        connection: bus.connection,
        durableName,
        logger: silentLogger(),
      });

      const batch = await consumer.pull(10, 1000);

      expect(batch.deliveries).toHaveLength(0);
    });

    it('accepts a reading that has been through JSON', () => {
      // What the durable consumer reads back is text, so the timestamp arrives as a string. The
      // schema has to accept that or every stored reading is rejected on the way back in.
      const parsed = telemetryReadingSchema.parse({
        entityId: kitchenTemperature,
        value: 21.5,
        observedAt: '2026-09-04T10:35:19.852Z',
      });

      expect(parsed.observedAt).toBeInstanceOf(Date);
    });
  });
});
