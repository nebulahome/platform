import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  registerDeviceRequestSchema,
  type RegisterDeviceRequest,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  bundleManifestSchema,
  createDeclarativeIntegration,
  defineTransport,
  integrationProfileSchema,
  Registry,
  type Discovered,
  type Integration,
  type Transport,
} from '@nebulahome/package-runtime';

import { IdentificationService, type IdentifiableInstance } from './identification.js';

/** Two devices answering on the network: a printer that is not a relay, then the relay. */
const FOUND: Discovered[] = [
  { deviceKey: '192.168.1.41', payload: { model: 'printer-3000', device: { id: 'printer' } } },
  { deviceKey: '192.168.1.40', payload: { device: { id: 'relay-one' }, relay: {} } },
];

/**
 * A declarative integration for a generic REST relay.
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
      transport: 'fake',
      kind: 'declarative',
      profile: './profile.json',
      setup: './setup.json',
    }),
    integrationProfileSchema.parse({
      discovery: {
        scan: { mdns: '_http._tcp' },
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

/** What a fake scan does when asked. */
type Pass = (signal: AbortSignal) => AsyncGenerator<Discovered>;

/**
 * A scan that finds the two devices above and ends.
 *
 * @returns The pass.
 */
function findsBoth(): Pass {
  return async function* pass(): AsyncGenerator<Discovered> {
    yield* await Promise.resolve(FOUND);
  };
}

/**
 * A scan that finds nothing, and ends.
 *
 * @returns The pass.
 */
function findsNothing(): Pass {
  return async function* pass(): AsyncGenerator<Discovered> {
    yield* await Promise.resolve([]);
  };
}

/**
 * A scan that waits for the signal, the way a broker subscription does.
 *
 * @returns The pass.
 */
function waitsForever(): Pass {
  return async function* pass(signal: AbortSignal): AsyncGenerator<Discovered> {
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        resolve();
      });
    });
    yield* [];
  };
}

/** What the fake transport records. */
type Seen = {
  readonly scans: { config: unknown; terms: unknown }[];
  closed: number;
};

/**
 * A transport whose scans are scripted, one per call.
 *
 * @param passes - What each call yields; the last one repeats.
 * @param seen - Where to record what it was given and how often a scan was closed.
 * @param probeFails - What the transport's own test fails with; it passes when not said.
 * @returns The transport.
 */
function fakeTransport(passes: readonly Pass[], seen: Seen, probeFails?: Error): Transport {
  let call = 0;

  return defineTransport({
    id: 'fake',
    configSchema: z.object({}),
    connectionKey: (): string => 'fake:one',
    connect: (): never => {
      throw new Error('not used by identification');
    },

    scan: async function* scan(config, terms, signal): AsyncGenerator<Discovered> {
      seen.scans.push({ config, terms });
      const pass = passes[Math.min(call, passes.length - 1)] ?? findsNothing();
      call += 1;

      try {
        yield* pass(signal);
      } finally {
        seen.closed += 1;
      }
    },

    probe: (): Promise<string> =>
      probeFails === undefined ? Promise.resolve('fake answered') : Promise.reject(probeFails),
  });
}

/** Everything one test needs. */
type Harness = {
  readonly identification: IdentificationService;
  readonly instance: IdentifiableInstance;
  readonly registered: RegisterDeviceRequest[];
  readonly seen: Seen;
  readonly serveCore: () => void;
  readonly stop: () => void;
};

/**
 * Wires identification against a fake transport and a fake `core`.
 *
 * @param passes - What each scan yields.
 * @param options - Which knobs to turn.
 * @param options.expectedExternalId - What the row already says the device is.
 * @param options.coreIsAway - Whether `core` starts out not answering.
 * @param options.lines - Where to keep what was logged at `info` and above, when a test reads it.
 * @param options.probeFails - What the transport's own test fails with.
 * @returns The harness.
 */
function harness(
  passes: readonly Pass[],
  options: {
    expectedExternalId?: string;
    coreIsAway?: boolean;
    lines?: string[];
    probeFails?: Error;
  } = {},
): Harness {
  const transport = new FakeTransport();
  const lines = options.lines;
  const logger =
    lines === undefined
      ? createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' })
      : createLogger(
          { service: 'hub', version: '0.0.0', level: 'debug' },
          new Writable({
            /**
             * Keeps a record.
             *
             * @param chunk - The rendered record.
             * @param encoding - Ignored.
             * @param done - Called to accept the write.
             */
            write(chunk: Buffer, encoding, done): void {
              lines.push(chunk.toString());
              done();
            },
          }),
        );
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 100 });
  const core = new BusClient({ transport, source: 'core', logger, requestTimeoutMs: 100 });

  const registered: RegisterDeviceRequest[] = [];
  let serving: { unsubscribe: () => void } | undefined;

  const serveCore = (): void => {
    serving ??= core.serve(
      busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
      registerDeviceRequestSchema,
      (request) => {
        registered.push(request);

        return {
          deviceId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          entityIds: request.entities.map((entity) => entity.entityId),
        };
      },
    );
  };

  if (options.coreIsAway !== true) {
    serveCore();
  }

  const seen: Seen = { scans: [], closed: 0 };
  const transports = new Registry<Transport>('transport');
  transports.register(fakeTransport(passes, seen, options.probeFails));

  return {
    identification: new IdentificationService({
      client,
      transports,
      logger,
      attemptTimeoutMs: 200,
      retryMs: 1,
      pauseMs: 1,
    }),
    instance: {
      instanceId: 'relay-lab',
      integration: relay(),
      options: {},
      transportId: 'fake',
      transportConfig: {},
      expectedExternalId: options.expectedExternalId ?? null,
    },
    registered,
    seen,
    serveCore,
    stop: (): void => {
      serving?.unsubscribe();
    },
  };
}

describe('IdentificationService', () => {
  it('binds the device its integration claims, and not the one it does not', async () => {
    const { identification, instance, stop } = harness([findsBoth()]);

    const found = await identification.attempt(instance, new AbortController().signal);

    expect(found?.externalId).toBe('relay-one');
    expect(found?.binding.claim.deviceKey).toBe('192.168.1.40');
    stop();
  });

  it('passes the integration search terms to the transport', async () => {
    const { identification, instance, seen, stop } = harness([findsBoth()]);

    await identification.attempt(instance, new AbortController().signal);

    expect(seen.scans[0]?.terms).toEqual({ mdns: '_http._tcp' });
    stop();
  });

  it('asks core to complete the row rather than writing it, and sends no name', async () => {
    // The row already carries the name the owner chose. What the hardware says about itself
    // completes it - the serial, the claim to find it again - and nothing more.
    const { identification, instance, registered, stop } = harness([findsBoth()]);

    await identification.attempt(instance, new AbortController().signal);

    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      integrationId: 'relay-lab',
      externalId: 'relay-one',
      config: { claim: { deviceKey: '192.168.1.40', externalId: 'relay-one' } },
    });
    expect('name' in (registered[0] ?? {})).toBe(false);
    stop();
  });

  it('composes the entity ids from the device id, not from the serial', async () => {
    // `switch.relay_lab`, which a person can read and which survives a replaced relay - not
    // `switch.relay_one`, which is the hardware's name for itself.
    const { identification, instance, registered, stop } = harness([findsBoth()]);

    const found = await identification.attempt(instance, new AbortController().signal);

    expect(registered[0]?.entities.map((entity) => entity.entityId)).toEqual(['switch.relay_lab']);
    expect([...(found?.binding.entities.values() ?? [])]).toEqual(['switch.relay_lab']);
    expect(found?.entityIds).toEqual(['switch.relay_lab']);
    stop();
  });

  it('says what answered when the driver claims none of it', async () => {
    // An instance that stays `identifying` gives an owner nothing to act on. The log names
    // the address and what the device said of itself, which is where the profile's claim is
    // compared against.
    const lines: string[] = [];
    const { identification, instance, stop } = harness([findsBoth()], { lines });

    await identification.attempt(instance, new AbortController().signal);

    const line = lines.find((each) => each.includes('did not claim'));

    expect(line).toContain('192.168.1.41');
    expect(line).toContain('printer-3000');
    stop();
  });

  it('closes the scan once a device is claimed', async () => {
    // A broker subscription never ends on its own. Leaving the scan open after the claim would
    // hold a second session to the printer for the rest of the pass.
    const { identification, instance, seen, stop } = harness([findsBoth()]);

    await identification.attempt(instance, new AbortController().signal);

    expect(seen.closed).toBe(1);
    stop();
  });

  it('ignores a claim whose serial is not the one on the row', async () => {
    // The row says which device this is. Another device answering on the same address is not
    // it, and binding it would attach its entities to the wrong name.
    const { identification, instance, registered, stop } = harness([findsBoth()], {
      expectedExternalId: 'relay-two',
    });

    const found = await identification.attempt(instance, new AbortController().signal);

    expect(found).toBeUndefined();
    expect(registered).toHaveLength(0);
    stop();
  });

  it('tries again after a pass that claimed nothing, until the device answers', async () => {
    const { identification, instance, seen, stop } = harness([findsNothing(), findsBoth()]);

    const found = await identification.identify(instance, new AbortController().signal);

    expect(found?.externalId).toBe('relay-one');
    expect(seen.scans).toHaveLength(2);
    stop();
  });

  it("says why a quiet pass heard nothing, in the transport's own test's words, once", async () => {
    const { identification, instance, stop } = harness(
      [findsNothing(), findsNothing(), findsBoth()],
      {
        probeFails: new Error('192.168.1.40 did not answer: EHOSTUNREACH'),
      },
    );
    const reasons: string[] = [];

    const found = await identification.identify(
      instance,
      new AbortController().signal,
      (reason) => {
        reasons.push(reason);
      },
    );

    expect(found?.externalId).toBe('relay-one');
    expect(reasons).toEqual(['192.168.1.40 did not answer: EHOSTUNREACH']);
    stop();
  });

  it('says that a device answered as another than the one on the row', async () => {
    const { identification, instance, stop } = harness([findsBoth()], {
      expectedExternalId: 'relay-three',
    });
    const abort = new AbortController();
    const reasons: string[] = [];

    await identification.identify(instance, abort.signal, (reason) => {
      reasons.push(reason);
      abort.abort();
    });

    expect(reasons[0]).toMatch(/not as relay-three it was added as/u);
    stop();
  });

  it('tries again after core did not answer', async () => {
    const { identification, instance, registered, serveCore, stop } = harness([findsBoth()], {
      coreIsAway: true,
    });

    setTimeout(serveCore, 150);
    const found = await identification.identify(instance, new AbortController().signal);

    expect(found?.externalId).toBe('relay-one');
    expect(registered).toHaveLength(1);
    stop();
  });

  it('stops when told to, registering nothing afterwards', async () => {
    const { identification, instance, registered, stop } = harness([waitsForever()]);
    const abort = new AbortController();

    setTimeout(() => {
      abort.abort();
    }, 20);
    const found = await identification.identify(instance, abort.signal);

    expect(found).toBeUndefined();
    expect(registered).toHaveLength(0);
    stop();
  });
});
