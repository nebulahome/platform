/**
 * The Nanoleaf bundle, against a controller in this process that answers as the OpenAPI does.
 *
 * What is checked is what the bundle needs the new HTTP transport for: the token is a path
 * segment - `/api/v1/<token>/…` - which the transport puts where the bundle's `pathPrefix` says,
 * and the state is written with a PUT carrying JSON. Discovery reads the model off the mDNS TXT
 * record, because the controller tells nothing to a caller without a token.
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
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  associateModel,
  createDeclarativeIntegration,
  driverManifestSchema,
  identifySighting,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Claim,
  type Integration,
  type MappingContext,
  type MdnsAnnouncement,
} from '@nebula-home/package-runtime';

import { httpTransport } from '../transports/http.js';

import { loadBundles } from './bundles.js';

/** The bundles, where the service reads them from. */
const BUNDLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** The vendor. */
const BUNDLE = path.join(BUNDLES, 'nanoleaf');

/** The token the controller issued when its button was held. */
const TOKEN = 'dDsbdfq7PJeu0SWxBFgdbc7Du3rPdMe4';

/** What the fake controller was asked, in order. */
const asked: { method: string; url: string; body: unknown }[] = [];

/** The controller's state. */
const state = { on: { value: false }, brightness: { value: 50, max: 100, min: 0 } };

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
      const url = request.url ?? '';
      const parsed: unknown = body === '' ? undefined : JSON.parse(body);

      asked.push({ method: request.method ?? '', url, body: parsed });

      if (!url.startsWith(`/api/v1/${TOKEN}/`)) {
        response.writeHead(401).end();

        return;
      }

      const rest = url.slice(`/api/v1/${TOKEN}`.length);

      if (request.method === 'PUT' && rest === '/state') {
        const change = parsed as { on?: { value: boolean }; brightness?: { value: number } };

        if (change.on !== undefined) {
          state.on = change.on;
        }

        if (change.brightness !== undefined) {
          state.brightness = { ...state.brightness, value: change.brightness.value };
        }

        response.writeHead(204).end();

        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          rest === '/state'
            ? state
            : {
                name: 'Shapes 5A3F',
                serialNo: 'S19124C8036',
                manufacturer: 'Nanoleaf',
                firmwareVersion: '9.2.4',
                model: 'NL42',
                state,
              },
        ),
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
 * Reads one JSON file of the vendor.
 *
 * @param file - The file, relative to the vendor.
 * @returns What it holds.
 */
async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(BUNDLE, file), 'utf8')) as unknown;
}

/**
 * Builds the panels' integration the way the hub builds a declarative driver.
 *
 * @returns The integration.
 */
async function panels(): Promise<Integration> {
  return createDeclarativeIntegration(
    resolveManifest(
      vendorManifestSchema.parse(await json('manifest.json')),
      driverManifestSchema.parse(await json('panels/driver.json')),
    ),
    integrationProfileSchema.parse(await json('panels/profile.json')),
  );
}

/**
 * The configuration the hub opens the transport with: the form's answers over the constants.
 *
 * @returns The configuration.
 */
async function configured(): Promise<JsonObject> {
  const setup = integrationSetupSchema.parse(await json('panels/setup.json'));

  return { ...setup.transport.constants, host, token: TOKEN };
}

/**
 * Identifies the fake controller as an instance does.
 *
 * @param integration - The panels' integration.
 * @returns The claim.
 */
async function identified(integration: Integration): Promise<Claim> {
  for await (const found of httpTransport.scan(
    await configured(),
    integration.discovery,
    AbortSignal.timeout(3000),
  )) {
    const claim = integration.claim(found, {});

    if (claim !== null) {
      return claim;
    }
  }

  throw new Error('The controller was not identified');
}

/**
 * A mapping context for the claimed controller.
 *
 * @param claim - The claim.
 * @returns The context, with the light's id.
 */
function context(claim: Claim): MappingContext {
  return {
    options: {},
    claim,
    entities: new Map([['', parseEntityId('light.nanoleaf_shapes')]]),
    lastState: (): CapabilityState | undefined => undefined,
  };
}

describe('discovering a Nanoleaf', () => {
  it('reads the model off the announcement, since the controller says nothing without a token', async () => {
    const { vendors, failures } = await loadBundles({
      directory: BUNDLES,
      runtimeVersion: '1.1.0',
    });
    const plan = vendors.find((vendor) => vendor.manifest.id === 'nanoleaf')?.discovery?.plan;

    expect(failures.filter((failure) => failure.directory.includes('nanoleaf'))).toEqual([]);

    if (plan === undefined) {
      throw new Error('Nanoleaf declares no discovery');
    }

    const announced: MdnsAnnouncement = {
      service: '_nanoleafapi._tcp',
      instance: 'Shapes 5A3F',
      host: 'Shapes-5A3F.local',
      address: '192.168.1.60',
      port: 16021,
      txt: { md: 'NL42', id: '5A:3F:11:22:33:44', srcvers: '9.2.4' },
    };
    const identity = identifySighting(plan, announced);

    expect(plan.discovery.probe).toBeUndefined();
    expect(identity).toMatchObject({ externalId: null, name: 'Shapes 5A3F', modelCode: 'NL42' });
    expect(associateModel(plan, identity.modelCode)).toEqual({
      driverId: 'panels',
      model: 'Shapes Hexagons',
      modelChoices: ['Shapes Hexagons'],
    });
  });
});

describe('the panels', () => {
  it('are identified by their serial, asked with the token in the path', async () => {
    const claim = await identified(await panels());

    expect(claim.externalId).toBe('S19124C8036');
    expect(asked.some((each) => each.url === `/api/v1/${TOKEN}/`)).toBe(true);
  });

  it('read on and brightness from the state', async () => {
    const integration = await panels();
    const claim = await identified(integration);

    expect(
      integration
        .toState(
          {
            connectionKey: 'http',
            deviceKey: host,
            payload: { on: { value: true }, brightness: { value: 72, max: 100, min: 0 } },
          },
          context(claim),
        )
        .map((report) => report.state),
    ).toEqual([{ on_off: { isOn: true }, level: { level: 72 } }]);
  });

  it('are switched and dimmed with a PUT of the state, as the OpenAPI takes it', async () => {
    const integration = await panels();
    const claim = await identified(integration);
    const entityId = parseEntityId('light.nanoleaf_shapes');
    const connection = await httpTransport.connect(await configured(), {
      logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
      deliver: (): void => undefined,
      report: (): void => undefined,
    });

    asked.length = 0;
    await connection.send(
      integration.toCommand(
        { entityId, capability: 'level', command: { command: 'set_level', level: 40 } },
        context(claim),
      ),
      AbortSignal.timeout(2000),
    );
    await connection.send(
      integration.toCommand(
        { entityId, capability: 'on_off', command: { command: 'turn_on' } },
        context(claim),
      ),
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect(asked).toEqual([
      { method: 'PUT', url: `/api/v1/${TOKEN}/state`, body: { brightness: { value: 40 } } },
      { method: 'PUT', url: `/api/v1/${TOKEN}/state`, body: { on: { value: true } } },
    ]);
    expect(state).toMatchObject({ on: { value: true }, brightness: { value: 40 } });
  });
});
