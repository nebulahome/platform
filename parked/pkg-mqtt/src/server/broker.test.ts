/**
 * The broker for real: aedes on a port of its own, clients over TCP, and the package's context
 * stood in for by one that records what it is told.
 *
 * What is asserted is that nobody connects without a password; that a device's client is held to
 * its own topics; that an announcement and a state become a device and its report, and a command
 * the payload its topic expects; and that what was retained - and the platform's password - are
 * still there after a restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import mqtt, { type MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EntityDomain } from '@nebulahome/contracts';
import type { PackageCommand, PackageContext, PackageDevice } from '@nebulahome/package-sdk';

import { startBroker } from './index.js';

/** What the stand-in context was told. */
type Recorded = {
  readonly synced: PackageDevice[][];
  readonly reports: { entityId: string; state: unknown; isAvailable: boolean | undefined }[];
  readonly methods: Map<string, (input: unknown) => unknown>;
  readonly services: Map<string, (request: unknown) => unknown>;
  command?: (command: PackageCommand) => unknown;
};

let dataDir: string;
let port: number;
const clients: MqttClient[] = [];

/**
 * A port nobody listens on.
 *
 * @returns It.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.listen(0, () => {
      const address = server.address();

      server.close(() => {
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  });
}

/**
 * A context that records what the package tells it.
 *
 * @returns It, and what it recorded.
 */
function context(): { ctx: PackageContext; recorded: Recorded } {
  const recorded: Recorded = { synced: [], reports: [], methods: new Map(), services: new Map() };
  const silent = (): undefined => undefined;
  const logger = { info: silent, warn: silent, debug: silent, error: silent, trace: silent };
  const ctx = {
    id: 'mqtt',
    version: '1.0.0',
    settings: { port },
    dataDir,
    cacheDir: dataDir,
    logger,
    signal: new AbortController().signal,
    entityId: (domain: EntityDomain, objectId: string) => `${domain}.mqtt_${objectId}`,
    devices: {
      sync: async (devices: readonly PackageDevice[]) => {
        recorded.synced.push([...devices]);

        return Promise.resolve({ devices: [], entities: [] });
      },
      report: (entityId: string, state: unknown, options?: { isAvailable?: boolean }) => {
        recorded.reports.push({ entityId, state, isAvailable: options?.isAvailable });
      },
      onCommand: (handler: (command: PackageCommand) => unknown) => {
        recorded.command = handler;
      },
    },
    rpc: {
      method: (
        name: string,
        options: { input?: { parse: (value: unknown) => unknown } },
        handler: (input: unknown) => unknown,
      ) => {
        recorded.methods.set(name, (input) =>
          handler(options.input === undefined ? input : options.input.parse(input)),
        );
      },
    },
    services: {
      provide: (name: string, handler: (request: unknown) => unknown) => {
        recorded.services.set(name, handler);
      },
      call: async () => Promise.resolve(null),
    },
  };

  return { ctx: ctx as unknown as PackageContext, recorded };
}

/**
 * Connects a client.
 *
 * @param username - Its username; none for an anonymous one.
 * @param password - Its password.
 * @returns It, connected, or the error it was refused with.
 */
async function connect(username?: string, password?: string): Promise<MqttClient> {
  const client = mqtt.connect(`mqtt://127.0.0.1:${String(port)}`, {
    ...(username === undefined ? {} : { username, password: password ?? '' }),
    reconnectPeriod: 0,
    connectTimeout: 3000,
  });

  clients.push(client);

  return new Promise((resolve, reject) => {
    client.once('connect', () => {
      resolve(client);
    });
    client.once('error', reject);
  });
}

/**
 * The next message a client hears on a topic.
 *
 * @param client - The client.
 * @param topic - The topic.
 * @returns Its payload.
 */
async function next(client: MqttClient, topic: string): Promise<string> {
  return new Promise((resolve) => {
    client.on('message', (heard, payload) => {
      if (heard === topic) {
        resolve(payload.toString());
      }
    });
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'pkg-mqtt-'));
  port = await freePort();
});

afterEach(async () => {
  await Promise.all(
    clients.splice(0).map(
      async (client) =>
        new Promise<void>((resolve) => {
          client.end(true, {}, () => {
            resolve();
          });
        }),
    ),
  );
});

afterAll(() => {
  // SQLite may still hold the file on Windows for a moment; the folder is a temporary one.
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // left for the system to clear
  }
});

describe('the broker', () => {
  let stop: () => Promise<void>;
  let recorded: Recorded;
  let hubPassword: string;

  it('lets nobody in without a password, and the hub in with its own', async () => {
    const made = context();

    recorded = made.recorded;
    stop = await startBroker(made.ctx);

    const credentials = (await recorded.services.get('credentials')?.({ principal: 'hub' })) as {
      username: string;
      password: string;
      port: number;
    };

    hubPassword = credentials.password;

    await expect(connect()).rejects.toThrow();
    await expect(connect(credentials.username, 'wrong')).rejects.toThrow();
    await expect(connect(credentials.username, credentials.password)).resolves.toBeDefined();
    expect(credentials.port).toBe(port);
  });

  it("holds a device's client to its own topics, and drops it when it strays", async () => {
    const added = (await recorded.methods.get('addClient')?.({ username: 'plug' })) as {
      password: string;
    };
    const hub = await connect('nebula-hub', hubPassword);
    const plug = await connect('plug', added.password);

    await hub.subscribeAsync('#');

    const heard = vi.fn();
    const closed = new Promise<void>((resolve) => {
      plug.once('close', () => {
        resolve();
      });
    });

    hub.on('message', heard);
    await plug.publishAsync('plug/hello', 'hi');
    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalledWith('plug/hello', expect.anything(), expect.anything());
    });

    // MQTT 3.1.1 has no way to refuse a publish but to close the connection (MQTT-3.3.5-2).
    plug.publish('zigbee2mqtt/bridge/request/permit_join', 'true');
    await closed;

    expect(heard.mock.calls.map((call) => call[0] as string)).not.toContain(
      'zigbee2mqtt/bridge/request/permit_join',
    );
  });

  it('turns an announcement into a device, a state into its report, and a command into its payload', async () => {
    const added = (await recorded.methods.get('addClient')?.({ username: 'lamp' })) as {
      password: string;
    };
    const lamp = await connect('lamp', added.password);
    const hub = await connect('nebula-hub', hubPassword);

    await lamp.publishAsync(
      'homeassistant/switch/lamp/config',
      JSON.stringify({
        name: null,
        uniq_id: 'lamp-relay',
        stat_t: 'lamp/state',
        cmd_t: 'lamp/set',
        dev: { ids: ['lamp'], name: 'Desk lamp' },
      }),
      { retain: true },
    );
    await lamp.publishAsync('lamp/state', 'ON', { retain: true });

    await vi.waitFor(
      () => {
        expect(recorded.synced.at(-1)?.map((device) => device.name)).toContain('Desk lamp');
      },
      { timeout: 3000 },
    );
    await vi.waitFor(() => {
      expect(recorded.reports).toContainEqual({
        entityId: 'switch.mqtt_lamp_relay',
        state: { on_off: { isOn: true } },
        isAvailable: true,
      });
    });

    await hub.subscribeAsync('lamp/set');

    const sent = next(hub, 'lamp/set');

    await recorded.command?.({
      entityId: 'switch.mqtt_lamp_relay' as never,
      capability: 'on_off',
      command: { command: 'turn_off' },
    });

    expect(await sent).toBe('OFF');
  });

  it('keeps what was retained, and the platform its password, across a restart', async () => {
    await stop();

    const made = context();

    stop = await startBroker(made.ctx);

    await vi.waitFor(
      () => {
        expect(made.recorded.synced.at(-1)?.map((device) => device.name)).toContain('Desk lamp');
      },
      { timeout: 3000 },
    );

    const again = (await made.recorded.services.get('credentials')?.({ principal: 'hub' })) as {
      password: string;
    };

    expect(again.password).toBe(hubPassword);

    const topics = (await made.recorded.methods.get('topics')?.(null)) as {
      items: { topic: string; isRetained: boolean }[];
    };

    expect(topics.items).toContainEqual(
      expect.objectContaining({ topic: 'lamp/state', isRetained: true }),
    );

    await stop();
  });
});
