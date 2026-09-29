/**
 * A package's context on a bus in memory: what it serves, what it asks of `core`, what it
 * publishes - each under the package's own id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  adapterAckSchema,
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  PACKAGE_RPC_METHOD,
  packageRpcReplySchema,
  parseEntityId,
  stateReportSchema,
  syncPackageRequestSchema,
  type SyncPackageRequest,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';

import { createPackageContext, type PackageContextHandle } from './context.js';

const logger = createLogger({ service: 'package-sdk', version: '0.0.0', level: 'fatal' });

let handle: PackageContextHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

/**
 * A context for the package `nvr`, and a client of the platform's on the same bus.
 *
 * @returns Both, and the transport.
 */
function setUp(): { handle: PackageContextHandle; platform: BusClient; transport: FakeTransport } {
  const transport = new FakeTransport();
  const made = createPackageContext({
    client: new BusClient({ transport, source: 'nvr', logger, requestTimeoutMs: 500 }),
    id: 'nvr',
    version: '1.4.0',
    settings: { retentionDays: 7 },
    dataDir: '/data/packages/nvr/data',
    cacheDir: '/data/cache/packages/nvr',
    logger,
    signal: new AbortController().signal,
  });

  handle = made;

  return {
    handle: made,
    platform: new BusClient({ transport, source: 'api', logger, requestTimeoutMs: 500 }),
    transport,
  };
}

describe("a package's context", () => {
  it('answers its pages’ calls with the methods it registered, their input checked', async () => {
    const { handle: made, platform } = setUp();

    made.context.rpc.method(
      'clips',
      { access: 'read', input: z.object({ camera: z.string() }) },
      ({ camera }) => [`${camera}-1.mp4`],
    );

    const subject = busSubjects.service('nvr', PACKAGE_RPC_METHOD);

    await expect(
      platform.request(
        subject,
        { method: 'clips', input: { camera: 'door' } },
        packageRpcReplySchema,
      ),
    ).resolves.toEqual({ output: ['door-1.mp4'] });
    await expect(
      platform.request(subject, { method: 'clips', input: { camera: 3 } }, packageRpcReplySchema),
    ).rejects.toThrow(/does not take that input/u);
    await expect(
      platform.request(subject, { method: 'erase' }, packageRpcReplySchema),
    ).rejects.toThrow(/has no method erase/u);
    expect(made.rpcMethods()).toEqual([{ name: 'clips', access: 'read' }]);
  });

  it('hands core the devices with their entities named after the package', async () => {
    const { handle: made, platform } = setUp();
    const received: SyncPackageRequest[] = [];

    platform.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
      syncPackageRequestSchema,
      (request) => {
        received.push(request);

        return { devices: [], refused: [], kept: [] };
      },
    );

    await made.context.devices.sync([
      {
        externalId: 'door',
        name: 'Door camera',
        entities: [
          {
            domain: 'binary_sensor',
            objectId: 'door_person',
            name: 'Person',
            capabilities: { sensor_binary: {} },
          },
        ],
      },
    ]);

    expect(received[0]?.packageId).toBe('nvr');
    expect(received[0]?.devices[0]?.entities[0]?.entityId).toBe('binary_sensor.nvr_door_person');
  });

  it('hands the commands core routes to its handler, and reports as the package', async () => {
    const { handle: made, platform, transport } = setUp();
    const commands: unknown[] = [];
    const entityId = parseEntityId('switch.nvr_recording');

    made.context.devices.onCommand((command) => {
      commands.push(command);
    });

    await platform.request(
      busSubjects.service('nvr', 'command'),
      { entityId, capability: 'on_off', command: { command: 'turn_on' } },
      adapterAckSchema,
    );
    made.context.devices.report(entityId, { on_off: { isOn: true } });

    expect(commands).toEqual([{ entityId, capability: 'on_off', command: { command: 'turn_on' } }]);

    const published = transport.published.find(
      (each) => each.subject === busSubjects.stateReport(entityId),
    );
    const envelope = JSON.parse(new TextDecoder().decode(published?.data)) as {
      source: string;
      payload: unknown;
    };

    expect(envelope.source).toBe('nvr');
    expect(stateReportSchema.parse(envelope.payload).state).toEqual({ on_off: { isOn: true } });
  });

  it('refuses a service that would take one of its own subjects', () => {
    const { handle: made } = setUp();

    expect(() => {
      made.context.services.provide('rpc', () => null);
    }).toThrow(/package's own subject/u);
    expect(made.context.entityId('custom', 'last')).toBe('custom.nvr_last');
  });
});
