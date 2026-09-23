/**
 * The Sonoff DIY bundle, against a device in this process that answers as the DIY API does.
 *
 * What is checked is the whole of what the bundle claims to do: that an `_ewelink._tcp`
 * announcement is taken as a DIY plug from its TXT record alone, that the probe identification
 * then makes is a POST with the body the firmware wants and finds the same device id the
 * announcement gave, and that the switch reads and is switched the way the DIY API documents.
 * The one thing a test cannot settle is a firmware that answers otherwise; the bundle's README
 * says what to look for.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState } from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  associateModel,
  createDeclarativeIntegration,
  driverManifestSchema,
  identifySighting,
  integrationProfileSchema,
  matchesAnnouncement,
  resolveManifest,
  vendorManifestSchema,
  type Discovered,
  type Integration,
  type MappingContext,
  type MdnsAnnouncement,
} from '@nebula-home/package-runtime';

import { httpTransport } from '../transports/http.js';

import { loadBundles } from './bundles.js';

/** The bundles, where the service reads them from. */
const BUNDLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** The DIY plug driver. */
const DRIVER = path.join(BUNDLES, 'sonoff', 'diy-plug');

/** The id a DIY device answers with, and announces in its TXT record. */
const DEVICE_ID = '1000a1b2c3';

/** What the fake device was asked, in order. */
const asked: { method: string; url: string; body: unknown }[] = [];

/** Whether the fake device's relay is on. */
let isOn = false;

let server: Server;
let host = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed: unknown = body === '' ? undefined : JSON.parse(body);

      asked.push({ method: request.method ?? '', url: request.url ?? '', body: parsed });

      if (request.method !== 'POST') {
        // A GET at a DIY path is what the firmware does not answer.
        response.writeHead(405).end();

        return;
      }

      if (request.url === '/zeroconf/switch') {
        const data = (parsed as { data?: { switch?: string } } | undefined)?.data;

        isOn = data?.switch === 'on';
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          seq: asked.length,
          error: 0,
          data: {
            switch: isOn ? 'on' : 'off',
            startup: 'off',
            pulse: 'off',
            fwVersion: '3.7.0',
            deviceid: DEVICE_ID,
            signalStrength: -54,
          },
        }),
      );
    });
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
 * Builds the plug's integration the way the hub builds a declarative driver.
 *
 * @returns The integration.
 */
async function plug(): Promise<Integration> {
  return createDeclarativeIntegration(
    resolveManifest(
      vendorManifestSchema.parse(
        JSON.parse(await readFile(path.join(BUNDLES, 'sonoff', 'manifest.json'), 'utf8')),
      ),
      driverManifestSchema.parse(
        JSON.parse(await readFile(path.join(DRIVER, 'driver.json'), 'utf8')),
      ),
    ),
    integrationProfileSchema.parse(
      JSON.parse(await readFile(path.join(DRIVER, 'profile.json'), 'utf8')),
    ),
  );
}

/**
 * Identifies the fake device the way an instance does: the probe, through the transport.
 *
 * @param integration - The plug's integration.
 * @returns What the device answered.
 */
async function probed(integration: Integration): Promise<Discovered> {
  for await (const found of httpTransport.scan(
    { host },
    integration.discovery,
    AbortSignal.timeout(3000),
  )) {
    return found;
  }

  throw new Error('The fake device did not answer the probe');
}

/** The announcement a DIY plug makes, as the platform's mDNS source reports it. */
const ANNOUNCED: MdnsAnnouncement = {
  service: '_ewelink._tcp',
  instance: `eWeLink_${DEVICE_ID}`,
  host: `eWeLink_${DEVICE_ID}.local`,
  address: '192.168.1.50',
  port: 8081,
  txt: { txtvers: '1', id: DEVICE_ID, type: 'diy_plug', apivers: '1', seq: '4', data1: '{}' },
};

describe('discovering a Sonoff in DIY mode', () => {
  it('takes a DIY plug from its announcement alone, and offers its family to pick from', async () => {
    const { vendors, failures } = await loadBundles({
      directory: BUNDLES,
      runtimeVersion: '1.1.0',
    });
    const sonoff = vendors.find((vendor) => vendor.manifest.id === 'sonoff');
    const plan = sonoff?.discovery?.plan;

    expect(failures.filter((failure) => failure.directory.includes('sonoff'))).toEqual([]);

    if (plan === undefined) {
      throw new Error('Sonoff declares no discovery');
    }

    const identity = identifySighting(plan, ANNOUNCED);

    expect(sonoff?.discovery?.sources).toEqual([{ kind: 'mdns', service: '_ewelink._tcp' }]);
    expect(matchesAnnouncement(plan, ANNOUNCED)).toBe(true);
    expect(matchesAnnouncement(plan, { ...ANNOUNCED, txt: { id: DEVICE_ID } })).toBe(false);
    expect(identity.externalId).toBe(DEVICE_ID);
    expect(associateModel(plan, identity.modelCode)).toEqual({
      driverId: 'diy-plug',
      model: null,
      modelChoices: ['BASICR3', 'RFR3', 'MINI', 'MINIR2'],
    });
  });

  it('identifies the device it was adopted as, with a POST, by the same id it announced', async () => {
    // The hub insists on the id discovery found; if identification read another, an adopted
    // plug would never be bound.
    const integration = await plug();

    asked.length = 0;

    const found = await probed(integration);
    const claim = integration.claim(found, {});

    expect(asked[0]).toEqual({
      method: 'POST',
      url: '/zeroconf/info',
      body: { deviceid: '', data: {} },
    });
    expect(claim?.externalId).toBe(DEVICE_ID);
    expect(claim === null ? undefined : integration.describe(claim, {})).toMatchObject({
      manufacturer: 'Sonoff',
      swVersion: '3.7.0',
    });
  });
});

describe('the DIY plug', () => {
  it('reads the relay from what the device answers', async () => {
    const integration = await plug();
    const found = await probed(integration);
    const claim = integration.claim(found, {});

    if (claim === null) {
      throw new Error('Not claimed');
    }

    const entityId = parseEntityId('switch.sonoff_plug');
    const context: MappingContext = {
      options: {},
      claim,
      entities: new Map([['', entityId]]),
      lastState: (): CapabilityState | undefined => undefined,
    };
    const reports = integration.toState(
      {
        connectionKey: 'http',
        deviceKey: host,
        payload: { error: 0, data: { switch: 'on', deviceid: DEVICE_ID } },
      },
      context,
    );

    expect(reports.map((report) => report.state)).toEqual([{ on_off: { isOn: true } }]);
  });

  it('switches with the POST the DIY API documents, and polls with one too', async () => {
    const integration = await plug();
    const found = await probed(integration);
    const claim = integration.claim(found, {});

    if (claim === null) {
      throw new Error('Not claimed');
    }

    const entityId = parseEntityId('switch.sonoff_plug');
    const request = integration.toCommand(
      { entityId, capability: 'on_off', command: { command: 'turn_on' } },
      {
        options: {},
        claim,
        entities: new Map([['', entityId]]),
        lastState: (): CapabilityState | undefined => undefined,
      },
    );
    const connection = await httpTransport.connect(
      { host },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (): void => undefined,
        report: (): void => undefined,
      },
    );

    asked.length = 0;
    await connection.send(request, AbortSignal.timeout(2000));
    await connection.close();

    expect(asked[0]).toEqual({
      method: 'POST',
      url: '/zeroconf/switch',
      body: { deviceid: '', data: { switch: 'on' } },
    });
    expect(isOn).toBe(true);
    expect(integration.subscriptions([claim], {})).toEqual([
      {
        op: 'poll',
        args: {
          deviceKey: host,
          path: '/zeroconf/info',
          method: 'post',
          body: { deviceid: '', data: {} },
          everyMs: 5000,
        },
      },
    ]);
  });
});
