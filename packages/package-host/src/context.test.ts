/**
 * A package's context on a bus in memory: what it serves, what it asks of `core`, what it
 * publishes - each under the package's own id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  adapterAckSchema,
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  PACKAGE_RPC_METHOD,
  PACKAGE_SETTINGS_METHOD,
  packageRpcReplySchema,
  parseEntityId,
  stateReportSchema,
  syncPackageRequestSchema,
  type SyncPackageRequest,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import { defineEntityType, field } from '@nebulahome/package-sdk';

import { createPackageContext, type PackageContextHandle } from './context.js';

const logger = createLogger({ service: 'package-host', version: '0.0.0', level: 'fatal' });

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
    platformVersion: '1.2.0',
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

  it('registers a sensor in its class’s unit, and converts the numbers it reports', async () => {
    const { handle: made, platform, transport } = setUp();
    const received: SyncPackageRequest[] = [];

    platform.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
      syncPackageRequestSchema,
      (request) => {
        received.push(request);

        return { devices: [], refused: [], kept: [] };
      },
    );

    /**
     * A numeric sensor.
     *
     * @param objectId - Its object id.
     * @param fields - Its class and unit.
     * @param fields.deviceClass - Its class.
     * @param fields.unitOfMeasurement - The unit its device speaks.
     * @returns The entity.
     */
    const sensor = (
      objectId: string,
      fields: { readonly deviceClass?: string; readonly unitOfMeasurement?: string },
    ) => ({
      domain: 'sensor' as const,
      objectId,
      name: objectId,
      capabilities: { sensor_numeric: {} },
      ...fields,
    });

    await made.context.devices.sync([
      {
        externalId: 'meter',
        name: 'Meter',
        entities: [
          sensor('power', { deviceClass: 'power', unitOfMeasurement: 'kW' }),
          sensor('outside', { deviceClass: 'temperature', unitOfMeasurement: '°F' }),
          sensor('noise', { deviceClass: 'power', unitOfMeasurement: 'furlongs' }),
          sensor('missing', { deviceClass: 'energy' }),
          sensor('plain', { unitOfMeasurement: 'pulses' }),
        ],
      },
    ]);

    const registered = Object.fromEntries(
      (received[0]?.devices[0]?.entities ?? []).map((entity) => [entity.entityId, entity]),
    );

    expect(registered['sensor.nvr_power']).toMatchObject({
      deviceClass: 'power',
      unitOfMeasurement: 'W',
      stateClass: 'measurement',
    });
    expect(registered['sensor.nvr_outside']).toMatchObject({
      deviceClass: 'temperature',
      unitOfMeasurement: '°C',
    });
    expect(registered['sensor.nvr_noise']).toMatchObject({ unitOfMeasurement: 'furlongs' });
    expect(registered['sensor.nvr_noise']).not.toHaveProperty('deviceClass');
    expect(registered['sensor.nvr_missing']).toMatchObject({
      deviceClass: 'energy',
      unitOfMeasurement: 'Wh',
    });
    expect(registered['sensor.nvr_plain']).toMatchObject({ unitOfMeasurement: 'pulses' });

    /**
     * What was published for an entity, last.
     *
     * @param entityId - The entity.
     * @returns Its state.
     */
    const lastState = (entityId: string): unknown => {
      const published = transport.published.findLast(
        (each) => each.subject === busSubjects.stateReport(parseEntityId(entityId)),
      );
      const envelope = JSON.parse(new TextDecoder().decode(published?.data)) as {
        payload: unknown;
      };

      return stateReportSchema.parse(envelope.payload).state;
    };

    made.context.devices.report('sensor.nvr_power', { sensor_numeric: { value: 1.5 } });
    made.context.devices.report('sensor.nvr_outside', { sensor_numeric: { value: 212 } });
    made.context.devices.report('sensor.nvr_plain', { sensor_numeric: { value: 7 } });

    expect(lastState('sensor.nvr_power')).toEqual({ sensor_numeric: { value: 1500 } });
    expect(lastState('sensor.nvr_outside')).toEqual({ sensor_numeric: { value: 100 } });
    expect(lastState('sensor.nvr_plain')).toEqual({ sensor_numeric: { value: 7 } });
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
    }).toThrow(/keeps for itself/u);
    expect(() => {
      made.context.services.provide('_hidden', () => null);
    }).toThrow(/keeps for itself/u);
    expect(made.context.entityId('custom', 'last')).toBe('custom.nvr_last');
    expect(made.context.objectIdOf('custom.nvr_last')).toBe('last');
    expect(made.context.objectIdOf('custom.other_last')).toBeUndefined();
    expect(made.context.platform.version).toBe('1.2.0');
  });

  it('tells a method and a service who called, and checks a service’s input', async () => {
    const { handle: made, platform } = setUp();
    const callers: string[] = [];

    made.context.rpc.method('whoami', { access: 'read' }, (input, { caller }) =>
      input === null ? caller.username : null,
    );
    made.context.services.provide(
      'count',
      { input: z.object({ camera: z.string() }) },
      ({ camera }, { caller }) => {
        callers.push(caller);

        return camera.length;
      },
    );

    await expect(
      platform.request(
        busSubjects.service('nvr', PACKAGE_RPC_METHOD),
        { method: 'whoami', caller: { userId: 'u-1', username: 'ada', role: 'owner' } },
        packageRpcReplySchema,
      ),
    ).resolves.toEqual({ output: 'ada' });
    await expect(
      platform.request(busSubjects.service('nvr', 'count'), { camera: 'door' }, z.number()),
    ).resolves.toBe(4);
    await expect(
      platform.request(busSubjects.service('nvr', 'count'), { camera: 1 }, z.number()),
    ).rejects.toThrow(/does not take that input/u);
    expect(callers).toEqual(['api']);
    expect(() => {
      made.context.services.provide('count', () => 0);
    }).toThrow(/provided already/u);
  });

  it('routes a custom command to its type’s handler, and refuses a second handler', async () => {
    const { handle: made, platform } = setUp();
    const recording = defineEntityType({
      id: 'recording',
      name: 'Recording',
      icon: 'video',
      state: { note: field.text({ label: 'Note' }) },
      commands: { rename: { name: 'Rename', fields: { note: field.text({ label: 'Note' }) } } },
    });
    const renamed: string[] = [];

    platform.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
      syncPackageRequestSchema,
      () => ({ devices: [], refused: [], kept: [] }),
    );
    await made.context.devices.sync([
      {
        externalId: 'clips',
        name: 'Clips',
        entities: [{ objectId: 'last', name: 'Last', type: recording }],
      },
    ]);
    made.context.custom(recording).onCommand('rename', ({ args }) => {
      renamed.push(args.note);
    });
    await platform.request(
      busSubjects.service('nvr', 'command'),
      {
        entityId: parseEntityId('custom.nvr_last'),
        capability: 'custom',
        command: { command: 'rename', args: { note: 'Garden' } },
      },
      adapterAckSchema,
    );

    expect(renamed).toEqual(['Garden']);
    made.context.devices.onCommand(() => undefined);
    expect(() => {
      made.context.devices.onCommand(() => undefined);
    }).toThrow(/has a handler already/u);
  });

  it('hears a live change of its settings', async () => {
    const { handle: made, platform } = setUp();
    const heard: unknown[] = [];

    made.context.onSettingsChange((change) => {
      heard.push(change.changed);
    });
    await platform.request(
      busSubjects.service('nvr', PACKAGE_SETTINGS_METHOD),
      { values: { retentionDays: 30 }, changed: ['retentionDays'] },
      z.unknown(),
    );

    expect(heard).toEqual([['retentionDays']]);
    expect(made.context.settings).toEqual({ retentionDays: 30 });
  });

  it('reads the house and follows its changes', async () => {
    const { handle: made, platform } = setUp();
    const kitchen = parseEntityId('sensor.kitchen_temperature');
    const state = {
      entityId: kitchen,
      state: { sensor_numeric: { value: 21 } },
      attributes: {},
      isAvailable: true,
      lastChanged: '2026-10-02T08:00:00.000Z',
      lastUpdated: '2026-10-02T08:00:00.000Z',
      source: 'pkg-weather',
    };
    const changes: string[] = [];

    platform.serve(busSubjects.stateGet(kitchen), z.unknown(), () => state);
    platform.serve(busSubjects.stateSnapshot(), z.unknown(), () => ({
      entities: [state],
      takenAt: '2026-10-02T08:00:00.000Z',
    }));
    made.context.entities.subscribe({ domain: 'sensor' }, (change) => {
      changes.push(change.entityId);
    });

    expect(await made.context.entities.get(kitchen)).toEqual({
      entityId: kitchen,
      state: { sensor_numeric: { value: 21 } },
      attributes: {},
      isAvailable: true,
      lastChanged: '2026-10-02T08:00:00.000Z',
      lastUpdated: '2026-10-02T08:00:00.000Z',
    });
    expect(await made.context.entities.list({ domain: 'light' })).toEqual([]);

    platform.publish(busSubjects.stateChanged(kitchen), { entityId: kitchen, current: state });
    await vi.waitFor(() => {
      expect(changes).toEqual([kitchen]);
    });
  });
});
