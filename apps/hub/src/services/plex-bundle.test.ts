/**
 * The Plex bundle, against a Media Server in this process that answers as the real one does.
 *
 * What is checked is what the bundle needs the new HTTP transport for: the server's identity is
 * public, and everything else answers only a request carrying `X-Plex-Token`. The token is the
 * owner's, typed once into the form; the bundle only says which header it goes in.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  integrationSetupSchema,
  parseEntityId,
  type CapabilityState,
  type JsonObject,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  createDeclarativeIntegration,
  driverManifestSchema,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Integration,
  type TransportInbound,
} from '@nebulahome/package-runtime';

import { httpTransport } from '../transports/http.js';

/** The vendor, where the service reads it from. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/plex');

/** The one driver. */
const DRIVER = path.join(BUNDLE, 'server');

/** The owner's token, as Plex issues them. */
const TOKEN = 'xPlexT0ken-123';

/** The server's own id. */
const MACHINE = '6f1d2a9c0b8e4f7a9d3c2b1a0e9f8d7c6b5a4f3e';

let server: Server;
let host = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? '';

    if (url.startsWith('/identity')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          MediaContainer: { size: 0, claimed: true, machineIdentifier: MACHINE, version: '1.41.2' },
        }),
      );

      return;
    }

    if (request.headers['x-plex-token'] !== TOKEN) {
      response.writeHead(401).end();

      return;
    }

    if (url.startsWith('/status/sessions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ MediaContainer: { size: 2, Metadata: [{}, {}] } }));

      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  host = typeof address === 'object' && address !== null ? `127.0.0.1:${String(address.port)}` : '';
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

/**
 * Reads one JSON file of the bundle.
 *
 * @param file - The file, relative to the vendor.
 * @returns What it holds.
 */
async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(BUNDLE, file), 'utf8')) as unknown;
}

/**
 * Builds the server's integration the way the hub builds a declarative driver.
 *
 * @returns The integration.
 */
async function plex(): Promise<Integration> {
  return createDeclarativeIntegration(
    resolveManifest(
      vendorManifestSchema.parse(await json('manifest.json')),
      driverManifestSchema.parse(await json('server/driver.json')),
    ),
    integrationProfileSchema.parse(await json('server/profile.json')),
  );
}

/**
 * The configuration the hub would open the transport with: the form's answers, and the bundle's
 * constants beneath them.
 *
 * @returns The configuration.
 */
async function configured(): Promise<JsonObject> {
  const setup = integrationSetupSchema.parse(
    JSON.parse(await readFile(path.join(DRIVER, 'setup.json'), 'utf8')),
  );

  return { ...setup.transport.constants, host, token: TOKEN };
}

describe('the Plex Media Server', () => {
  it('asks for the address and the token, and puts the token in the header Plex reads', async () => {
    const setup = integrationSetupSchema.parse(
      JSON.parse(await readFile(path.join(DRIVER, 'setup.json'), 'utf8')),
    );

    expect(setup.transport.constants).toEqual({ tokenHeader: 'X-Plex-Token' });
    expect(setup.transport.fields.map((field) => [field.key, field.type])).toEqual([
      ['host', 'text'],
      ['token', 'secret'],
    ]);
  });

  it('is identified by its machine id, which it gives without the token', async () => {
    const integration = await plex();

    for await (const found of httpTransport.scan(
      { host },
      integration.discovery,
      AbortSignal.timeout(3000),
    )) {
      const claim = integration.claim(found, {});

      expect(claim?.externalId).toBe(MACHINE);
      expect(claim === null ? undefined : integration.describe(claim, {})).toMatchObject({
        manufacturer: 'Plex',
        swVersion: '1.41.2',
      });
    }
  });

  it('counts what is playing, reading the sessions with the owner token', async () => {
    const integration = await plex();
    const claim = {
      deviceKey: host,
      externalId: MACHINE,
      descriptor: { MediaContainer: { machineIdentifier: MACHINE } },
    };
    const delivered: TransportInbound[] = [];
    const connection = await httpTransport.connect(await configured(), {
      logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
      deliver: (message): void => {
        delivered.push(message);
      },
      report: (): void => undefined,
    });

    await connection.apply(
      integration.subscriptions([claim], {}).map((each) => ({
        ...each,
        args: { ...each.args, everyMs: 250 },
      })),
    );

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    const entityId = parseEntityId('sensor.plex_activity');
    const [message] = delivered;

    if (message === undefined) {
      throw new Error('The sessions were never read');
    }

    expect(
      integration
        .toState(message, {
          options: {},
          claim,
          entities: new Map([['activity', entityId]]),
          lastState: (): CapabilityState | undefined => undefined,
        })
        .map((report) => report.state),
    ).toEqual([{ sensor_numeric: { value: 2 } }]);
  });
});
