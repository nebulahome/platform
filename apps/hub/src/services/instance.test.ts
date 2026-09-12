import { describe, expect, it } from 'vitest';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  ADAPTER_COMMAND_METHOD,
  adapterAckSchema,
  busSubjects,
  parseEntityId,
  stateReportSchema,
  type EntityId,
  type StateReport,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  bundleManifestSchema,
  createDeclarativeIntegration,
  integrationProfileSchema,
  type Integration,
  type TransportConnection,
  type TransportRequest,
} from '@nebula-home/package-runtime';

import { DeviceBook } from '../domain/devices.js';

import { startInstanceServices } from './instance.js';

const RELAY = parseEntityId('switch.relay_one');
const STRANGER = parseEntityId('switch.somewhere_else');

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
      entities: [
        {
          domain: 'switch',
          capabilities: { on_off: {} },
          state: { on_off: { isOn: 'relay.on' } },
          commands: { 'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } } },
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
 * @returns The harness.
 */
function harness(): Harness {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const caller = new BusClient({ transport, source: 'core', logger, requestTimeoutMs: 500 });

  const sent: TransportRequest[] = [];
  const connection: TransportConnection = {
    key: 'http:192.168.1.40',
    send: (request): Promise<unknown> => {
      sent.push(request);

      return Promise.resolve(null);
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
    entities: new Map<string, EntityId>([['', RELAY]]),
  });

  const subscriptions = startInstanceServices({
    instanceId: 'relay-lab',
    options: {},
    integration: relay(),
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
      (await import('@nebula-home/contracts')).resyncReplySchema,
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
      (await import('@nebula-home/contracts')).resyncReplySchema,
    );

    stop();

    expect(reply.entityCount).toBe(0);
  });
});
