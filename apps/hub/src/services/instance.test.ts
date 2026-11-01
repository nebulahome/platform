import { describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  ADAPTER_COMMAND_METHOD,
  adapterAckSchema,
  busSubjects,
  parseEntityId,
  stateReportSchema,
  type EntityId,
  type StateReport,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  bundleManifestSchema,
  createDeclarativeIntegration,
  integrationProfileSchema,
  type Integration,
  type TransportConnection,
  type TransportRequest,
} from '@nebulahome/package-runtime';

import { DeviceBook } from '../domain/devices.js';

import { startInstanceServices } from './instance.js';

const RELAY = parseEntityId('switch.relay_one');
const STRANGER = parseEntityId('switch.somewhere_else');
const FIRMWARE = parseEntityId('update.relay_one_firmware');

/**
 * A real declarative integration for a generic REST relay.
 *
 * @returns The integration.
 */
function relay(): Integration {
  return createDeclarativeIntegration(
    bundleManifestSchema.parse({
      id: 'generic/rest-relay',
      version: '1.0.0',
      sdk: '^1.0.0',
      name: 'Generic REST relay',
      vendor: { id: 'generic', name: 'Generic' },
      transport: 'http',
      kind: 'declarative',
      profile: './profile.json',
      setup: './setup.json',
    }),
    integrationProfileSchema.parse({
      discovery: {
        claim: [{ path: 'relay', exists: true }],
        identity: { externalId: 'device.id' },
      },
      device: { swVersion: 'firmware.ver' },
      entities: [
        {
          domain: 'switch',
          capabilities: { on_off: {} },
          state: { on_off: { isOn: 'relay.on' } },
          commands: { 'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } } },
        },
        {
          domain: 'update',
          objectId: 'firmware',
          capabilities: { update: {} },
          state: {
            update: {
              installedVersion: 'firmware.ver',
              latestVersion: 'firmware.offered',
              isInstalling: 'firmware.installing',
            },
          },
          commands: { 'update.install': { op: 'get', args: { path: '/ota' } } },
        },
      ],
    }),
  );
}

/** Everything one test needs, wired over an in-memory broker. */
type Harness = {
  readonly caller: BusClient;
  readonly book: DeviceBook;
  readonly sent: TransportRequest[];
  readonly stop: () => void;
};

/**
 * Wires one instance onto a fake broker, with a device already adopted.
 *
 * @param integration - The integration it runs.
 * @param answer - What the transport answers a request.
 * @returns The harness.
 */
function harness(
  integration: Integration = relay(),
  answer: (request: TransportRequest) => unknown = () => null,
): Harness {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const caller = new BusClient({ transport, source: 'core', logger, requestTimeoutMs: 500 });

  const sent: TransportRequest[] = [];
  const connection: TransportConnection = {
    key: 'http:192.168.1.40',
    send: (request): Promise<unknown> => {
      sent.push(request);

      return Promise.resolve(answer(request));
    },
    apply: (): Promise<void> => Promise.resolve(),
    close: (): Promise<void> => Promise.resolve(),
  };

  const book = new DeviceBook();
  book.bind({
    claim: {
      deviceKey: '192.168.1.40',
      externalId: 'relay-one',
      descriptor: { device: { id: 'relay-one' }, relay: {} },
    },
    entities: new Map<string, EntityId>([
      ['', RELAY],
      ['firmware', FIRMWARE],
    ]),
  });

  const subscriptions = startInstanceServices({
    instanceId: 'relay-lab',
    options: {},
    integration,
    book,
    client,
    connection,
    commandTimeoutMs: 500,
  });

  return {
    caller,
    book,
    sent,
    stop: (): void => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    },
  };
}

describe('startInstanceServices', () => {
  it('turns a command from core into the request the integration describes', async () => {
    const { caller, sent, stop } = harness();

    await caller.request(
      busSubjects.service('relay-lab', ADAPTER_COMMAND_METHOD),
      { entityId: RELAY, capability: 'on_off', command: { command: 'turn_on' } },
      adapterAckSchema,
    );

    stop();

    expect(sent).toEqual([{ deviceKey: '192.168.1.40', op: 'get', args: { path: '/relay/on' } }]);
  });

  it('carries a command on with each answer until the integration says it is done', async () => {
    const steps: unknown[] = [];
    const integration: Integration = {
      ...relay(),
      continueCommand: (target, step) => {
        steps.push(step.answer);

        if (step.answer === 'refused') {
          throw new Error('The relay refused it');
        }

        return step.index === 0
          ? {
              deviceKey: '192.168.1.40',
              op: 'get',
              args: { path: `/relay/on/${String(step.answer)}` },
            }
          : null;
      },
    };
    let session = 'session-7';
    const { caller, sent, stop } = harness(integration, (request) =>
      request.args['path'] === '/relay/on' ? session : 'done',
    );
    const turnOn = async (): Promise<unknown> =>
      caller.request(
        busSubjects.service('relay-lab', ADAPTER_COMMAND_METHOD),
        { entityId: RELAY, capability: 'on_off', command: { command: 'turn_on' } },
        adapterAckSchema,
      );

    await turnOn();
    expect(sent.map((request) => request.args['path'])).toEqual([
      '/relay/on',
      '/relay/on/session-7',
    ]);
    expect(steps).toEqual(['session-7', 'done']);

    session = 'refused';
    await expect(turnOn()).rejects.toThrow(/refused/u);
    stop();
  });

  it('refuses to install firmware while the device is installing it already', async () => {
    const { caller, book, sent, stop } = harness();
    const install = async (): Promise<unknown> =>
      caller.request(
        busSubjects.service('relay-lab', ADAPTER_COMMAND_METHOD),
        { entityId: FIRMWARE, capability: 'update', command: { command: 'install' } },
        adapterAckSchema,
      );
    const report = (installing: boolean): void => {
      book.ingest(
        relay(),
        {},
        {
          connectionKey: 'http:192.168.1.40',
          deviceKey: '192.168.1.40',
          payload: { firmware: { ver: '1.0', offered: '1.1', installing } },
        },
      );
    };

    report(false);
    await install();
    report(true);
    await expect(install()).rejects.toThrow(/already installing/u);

    stop();

    expect(sent).toEqual([{ deviceKey: '192.168.1.40', op: 'get', args: { path: '/ota' } }]);
  });

  it('says the firmware a device reports once, and again only when it changes', () => {
    const { book, stop } = harness();
    const heard = (ver: string): unknown =>
      book.infoOf(
        relay(),
        {},
        {
          connectionKey: 'http:192.168.1.40',
          deviceKey: '192.168.1.40',
          payload: { relay: { on: true }, firmware: { ver } },
        },
      );

    expect(heard('1.0')).toEqual({ firmware: { swVersion: '1.0' } });
    expect(heard('1.0')).toBeUndefined();
    expect(heard('1.1')).toEqual({ firmware: { swVersion: '1.1' } });
    stop();
  });

  it('says how a device is set up whenever it says, and whether that is not its claim', () => {
    const { book, stop } = harness();
    const switching: Integration = {
      ...relay(),
      deviceInfo: (message) => {
        const { mode } = message.payload as { mode?: string };

        return mode === undefined
          ? undefined
          : { descriptor: { device: { id: 'relay-one' }, relay: {}, mode } };
      },
    };
    const said = (payload: object): unknown =>
      book.infoOf(
        switching,
        {},
        { connectionKey: 'http:192.168.1.40', deviceKey: '192.168.1.40', payload },
      );

    expect(said({ relay: { on: true } })).toBeUndefined();
    expect(said({ mode: 'cover' })).toEqual({
      setUp: {
        claim: {
          deviceKey: '192.168.1.40',
          externalId: 'relay-one',
          descriptor: { device: { id: 'relay-one' }, relay: {}, mode: 'cover' },
        },
        isNew: true,
      },
    });
    // Said twice, still said: the hub, not the book, decides when it is taken.
    expect(said({ mode: 'cover' })).toMatchObject({ setUp: { isNew: true } });
    stop();
  });

  it('refuses a command for an entity this instance does not own', async () => {
    // `core` routes on `source`, so this only happens when the registry and what `hub` has
    // adopted disagree. Answering with an error is what turns that into something visible
    // instead of a command that is acknowledged and goes nowhere.
    const { caller, stop } = harness();

    await expect(
      caller.request(
        busSubjects.service('relay-lab', ADAPTER_COMMAND_METHOD),
        { entityId: STRANGER, capability: 'on_off', command: { command: 'turn_on' } },
        adapterAckSchema,
      ),
    ).rejects.toThrow();

    stop();
  });

  it('republishes what every entity last said when core asks for a resynchronisation', async () => {
    const { caller, book, stop } = harness();
    const seen: StateReport[] = [];

    const watching = caller.subscribe(
      busSubjects.stateReport(RELAY),
      stateReportSchema,
      (report): void => {
        seen.push(report);
      },
    );

    book.ingest(
      relay(),
      {},
      {
        connectionKey: 'http:192.168.1.40',
        deviceKey: '192.168.1.40',
        payload: { relay: { on: true } },
      },
    );

    const reply = await caller.request(
      busSubjects.stateResync('relay-lab'),
      { reason: 'startup' },
      (await import('@nebulahome/contracts')).resyncReplySchema,
    );

    watching.unsubscribe();
    stop();

    expect([reply.entityCount, seen[0]?.state]).toEqual([1, { on_off: { isOn: true } }]);
  });

  it('reports nothing to resynchronise before any device has spoken', async () => {
    const { caller, stop } = harness();

    const reply = await caller.request(
      busSubjects.stateResync('relay-lab'),
      { reason: 'startup' },
      (await import('@nebulahome/contracts')).resyncReplySchema,
    );

    stop();

    expect(reply.entityCount).toBe(0);
  });
});
