/**
 * Discovery end to end: a device announcing itself over real mDNS, found, proposed, adopted,
 * identified - and no longer proposed.
 *
 * The device is the fixture vendor's relay (`tests/fixtures/vendors/acme/plug`), served by this
 * process: an HTTP server that answers as its API does, announced as `_acme._tcp` by a real mDNS
 * responder on this host. The hub runs with that vendor as a development copy, the HTTP transport,
 * the development database and broker. The
 * adoption is written the way the API writes it - two rows, the second naming the id the device
 * announced - since what is under test is the hub's half: that it proposes the device, binds the
 * one it was adopted as, and stops proposing it once it is added.
 */
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import createMulticastDns, { type MulticastDnsPacket } from 'multicast-dns';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  discoveredReplySchema,
  HUB_DISCOVERED_METHOD,
  HUB_SERVICE,
  registerDeviceRequestSchema,
  type DiscoveredDevice,
} from '@nebulahome/contracts';
import { createDatabase, schema, type Database } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { hubEnvSchema } from '@/config.js';
import { HubService } from '@/service.js';
import { httpTransport } from '@/transports/http.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

/** The vendor the test runs against (`tests/fixtures/vendors/acme`), read as a development copy. */
const FIXTURE_VENDOR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/vendors',
);

/** A data directory with nothing installed in it. */
const EMPTY_DATA_DIR = path.join(tmpdir(), 'nebula-hub-test-data-that-is-not-there');

/** The id the fake relay answers with and announces, unique to this run. */
const DEVICE_ID = `10${ulid().toLowerCase().slice(-8)}`;

/** The instance the device is adopted as. */
const adopted = `int-acme-${ulid().toLowerCase().slice(0, 10)}`;

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let logger: PlatformLogger;
let server: Server;
let port = 0;

/**
 * A logger that keeps its output out of the test report.
 *
 * @returns The logger.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-discovery-integration', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * Answers for a device on this host the way a real mDNS responder does: to every question about
 * its service type, its instance or its host name, and once unasked when it starts.
 *
 * @param instance - The instance's own name: `Acme_10abcdef`.
 * @param service - Its service type: `_acme._tcp`.
 * @param devicePort - Where it serves.
 * @param txt - Its TXT record, as `key=value` strings.
 * @returns A function that stops answering.
 */
function respondAs(
  instance: string,
  service: string,
  devicePort: number,
  txt: readonly string[],
): () => Promise<void> {
  const responder = createMulticastDns();
  const type = `${service}.local`;
  const fqdn = `${instance}.${type}`;
  const target = `${instance}.local`;
  const answer: MulticastDnsPacket = {
    answers: [{ name: type, type: 'PTR', ttl: 120, data: fqdn }],
    additionals: [
      {
        name: fqdn,
        type: 'SRV',
        ttl: 120,
        data: { target, port: devicePort, priority: 0, weight: 0 },
      },
      { name: fqdn, type: 'TXT', ttl: 120, data: txt },
      { name: target, type: 'A', ttl: 120, data: '127.0.0.1' },
    ],
  };

  responder.on('query', (query) => {
    const names = new Set([type, fqdn, target]);

    if (query.questions.some((question) => names.has(question.name))) {
      responder.respond(answer);
    }
  });
  responder.respond(answer);

  return () =>
    new Promise<void>((resolve) => {
      responder.destroy(() => {
        resolve();
      });
    });
}

/**
 * Asks the hub what it proposes, until a condition holds or the time runs out.
 *
 * @param client - Who asks.
 * @param condition - What the list must satisfy.
 * @param timeoutMs - How long to keep asking.
 * @returns The list, as it stood when the condition held or the time ran out.
 */
async function proposedUntil(
  client: BusClient,
  condition: (items: readonly DiscoveredDevice[]) => boolean,
  timeoutMs: number,
): Promise<DiscoveredDevice[]> {
  const deadline = Date.now() + timeoutMs;
  let items: DiscoveredDevice[];

  do {
    ({ items } = await client.request(
      busSubjects.service(HUB_SERVICE, HUB_DISCOVERED_METHOD),
      {},
      discoveredReplySchema,
    ));

    if (condition(items)) {
      return items;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  return items;
}

/**
 * Waits until the adopted instance's row says the state, or gives up.
 *
 * @param state - The state to wait for.
 * @param timeoutMs - How long to wait at most.
 * @returns The row's state as it stands.
 */
async function stateUntil(state: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let current: string;

  do {
    const [row] = await database.db
      .select({ state: schema.registry.integrations.state })
      .from(schema.registry.integrations)
      .where(eq(schema.registry.integrations.id, adopted));

    current = row?.state ?? 'missing';

    if (current === state) {
      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  return current;
}

beforeAll(async () => {
  logger = silent();
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'hub-discovery-integration',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (request.method !== 'POST') {
        response.writeHead(405).end();

        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          seq: 1,
          error: 0,
          data: { switch: 'off', fwVersion: '3.7.0', deviceid: DEVICE_ID },
        }),
      );
    });
  });

  // Every interface: the announcement carries this host's own addresses, not loopback's.
  await new Promise<void>((resolve) => {
    server.listen(0, '0.0.0.0', resolve);
  });

  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, adopted));
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await bus.close();
  await database.close();
});

describe('discovering and adopting a device', () => {
  it('proposes a relay it heard announce itself, binds it once adopted, and stops proposing it', async () => {
    const own = await connectBus({
      url: NATS_URL,
      name: 'hub-under-test',
      logger,
      signal: AbortSignal.timeout(20_000),
    });
    const service = new HubService({
      config: hubEnvSchema.parse({
        DATABASE_URL,
        NATS_URL,
        HUB_DEV_BUNDLE_DIR: FIXTURE_VENDOR_DIR,
        NEBULA_DATA_DIR: EMPTY_DATA_DIR,
        NEBULA_SECRETS_KEY: 'ab'.repeat(32),
      }),
      db: database.db,
      bus: own,
      logger,
      transports: [httpTransport],
    });
    const asker = new BusClient({ transport: bus.transport, source: 'api', logger });
    const core = new BusClient({ transport: bus.transport, source: 'core', logger });
    const registered: string[] = [];
    const serving = core.serve(
      busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
      registerDeviceRequestSchema,
      (request) => {
        if (request.integrationId === adopted) {
          registered.push(request.externalId);
        }

        return {
          deviceId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          entityIds: request.entities.map((entity) => entity.entityId),
        };
      },
    );
    let stopResponding = (): Promise<void> => Promise.resolve();

    await service.start();

    try {
      stopResponding = respondAs(`Acme_${DEVICE_ID}`, '_acme._tcp', port, [
        'txtvers=1',
        `id=${DEVICE_ID}`,
        'type=acme_plug',
        'apivers=1',
      ]);

      const proposed = await proposedUntil(
        asker,
        (items) => items.some((item) => item.externalId === DEVICE_ID),
        20_000,
      );
      const candidate = proposed.find((item) => item.externalId === DEVICE_ID);

      expect(candidate).toMatchObject({
        vendorId: 'acme',
        kind: 'acme/plug',
        source: 'mdns',
        model: null,
        modelChoices: ['Plug S', 'Plug M'],
      });
      const host = candidate?.transportConfig['host'];

      expect(typeof host === 'string' ? host : '').toMatch(new RegExp(`:${String(port)}$`));

      // Adopted, the way the API writes it: the connection, and the identity naming the id the
      // device announced.
      await database.db.insert(schema.registry.integrations).values({
        id: adopted,
        kind: 'acme/plug',
        kindVersion: '1.0.0',
        model: 'Plug M',
        transport: 'http',
        transportConfig: candidate?.transportConfig ?? {},
        options: {},
        isEnabled: true,
      });
      await database.db.insert(schema.registry.devices).values({
        integrationId: adopted,
        externalId: DEVICE_ID,
        name: 'Hall plug',
        manufacturer: 'Acme',
        config: {},
      });

      await service.reloadInstance(adopted);

      expect(await stateUntil('running', 20_000)).toBe('running');
      expect(registered).toEqual([DEVICE_ID]);

      const after = await proposedUntil(
        asker,
        (items) => !items.some((item) => item.externalId === DEVICE_ID),
        5000,
      );

      expect(after.some((item) => item.externalId === DEVICE_ID)).toBe(false);
    } finally {
      serving.unsubscribe();
      await stopResponding();
      await service.stop();
      await own.close();
    }
  }, 60_000);
});
