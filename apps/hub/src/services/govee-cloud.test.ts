/**
 * The Govee cloud listener, against a fake of Govee's servers and a fake MQTT session.
 *
 * What is checked is the part the bundle does: signing in the way the app does, asking for the
 * certificate, opening the session with it, and handing each light's state to whoever holds that
 * light - once per account, however many lights of it are held. The servers themselves are not
 * reached from a test.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createLogger } from '@nebula-home/logging';
import {
  defineStreamSource,
  defineTransport,
  type BundleSdk,
  type ManagedMqtt,
  type ManagedMqttOptions,
} from '@nebula-home/package-runtime';

/** The module, where the bundle ships it. */
const MODULE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bundles/govee/lan/cloud.js',
);

/** What the module exports. */
type CloudModule = {
  readonly uuidV5: (name: string) => string;
  readonly signIn: (
    email: string,
    password: string,
    request: typeof fetch,
  ) => Promise<{ accountId: string; topic: string; endpoint: string; passphrase: string }>;
  readonly stateMessageOf: (
    payload: Buffer,
  ) => { device: string; state: Record<string, unknown> } | undefined;
  readonly listenToCloud: (
    sdk: BundleSdk,
    account: { email: string; password: string },
    device: string,
    listener: (state: Record<string, unknown>) => void,
  ) => { release: () => Promise<void> };
};

let cloud: CloudModule;

beforeAll(async () => {
  cloud = (await import(pathToFileURL(MODULE).href)) as CloudModule;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Govee's servers, as far as signing in goes.
 *
 * @param requests - Where to record what was asked.
 * @returns A `fetch` answering the two requests.
 */
function servers(requests: { url: string; init: RequestInit | undefined }[]): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();

    requests.push({ url, init });

    if (url.endsWith('/account/v1/login')) {
      return Promise.resolve(
        Response.json({
          client: {
            accountId: 42,
            token: 'token-1',
            topic: 'GA/account-topic',
            tokenExpireCycle: 3600,
          },
          message: 'Login successful',
          status: 200,
        }),
      );
    }

    return Promise.resolve(
      Response.json({
        data: {
          endpoint: 'iot.example.amazonaws.com',
          p12: Buffer.from('certificate').toString('base64'),
          p12_pass: 'secret',
        },
        message: 'Success',
        status: 200,
      }),
    );
  };
}

/** A fake MQTT session the test drives. */
type FakeMqtt = {
  readonly options: ManagedMqttOptions;
  readonly topics: string[];
  closes: number;
};

/**
 * An SDK whose MQTT sessions the test holds.
 *
 * @param sessions - Where each opened session goes.
 * @returns The SDK.
 */
function sdkWith(sessions: FakeMqtt[]): BundleSdk {
  return {
    version: '1.2.0',
    z,
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    defineTransport,
    openWebSocket: () => {
      throw new Error('unused');
    },
    openUdpSocket: () => {
      throw new Error('unused');
    },
    openMqtt: (options): ManagedMqtt => {
      const fake: FakeMqtt = { options, topics: [], closes: 0 };

      sessions.push(fake);

      return {
        isConnected: true,
        subscribe: (topic) => {
          fake.topics.push(topic);
        },
        unsubscribe: () => undefined,
        publish: () => Promise.resolve(),
        close: () => {
          fake.closes += 1;

          return Promise.resolve();
        },
      };
    },
    defineStreamSource,
    openRtsp: () => {
      throw new Error('not opened in this test');
    },
    platform: { mqtt: null },
  };
}

describe('the Govee cloud listener', () => {
  it("derives the app's client id from the email as a version-5 UUID", () => {
    // The RFC 4122 example: www.example.com in the DNS namespace.
    expect(cloud.uuidV5('www.example.com')).toBe('2ed6657de927568b95e12665a8aea6a2');
  });

  it('signs in as the app does, then asks for the certificate with the token', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const granted = await cloud.signIn('owner@example.com', 'hunter2', servers(requests));

    expect(granted).toMatchObject({
      accountId: '42',
      topic: 'GA/account-topic',
      endpoint: 'iot.example.amazonaws.com',
      passphrase: 'secret',
    });

    const [login, key] = requests;

    const body = login?.init?.body;

    expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual({
      email: 'owner@example.com',
      password: 'hunter2',
      client: cloud.uuidV5('owner@example.com'),
    });
    expect(login?.init?.headers).toHaveProperty('appVersion');
    expect(login?.init?.headers).toMatchObject({ clientType: '1' });
    expect(key?.init?.headers).toMatchObject({ authorization: 'Bearer token-1' });
  });

  it('says why when Govee refuses the sign-in', async () => {
    const refusing: typeof fetch = () =>
      Promise.resolve(
        Response.json({ message: 'Incorrect password', status: 454 }, { status: 200 }),
      );

    await expect(cloud.signIn('owner@example.com', 'wrong', refusing)).rejects.toThrow(
      'Govee refused the sign-in: Incorrect password',
    );
  });

  it("reads which light a message is about and what it shows, and nothing else's", () => {
    expect(
      cloud.stateMessageOf(
        Buffer.from(
          JSON.stringify({
            sku: 'H6072',
            device: 'AA:BB',
            state: { onOff: 1, brightness: 40, colorTemInKelvin: 0 },
          }),
        ),
      ),
    ).toEqual({ device: 'AA:BB', state: { onOff: 1, brightness: 40, colorTemInKelvin: 0 } });
    expect(cloud.stateMessageOf(Buffer.from('not json'))).toBeUndefined();
    expect(cloud.stateMessageOf(Buffer.from('{"device":"AA:BB"}'))).toBeUndefined();
  });

  it('opens one session per account, and hands each light its own states', async () => {
    vi.stubGlobal('fetch', servers([]));

    const sessions: FakeMqtt[] = [];
    const sdk = sdkWith(sessions);
    const account = { email: 'owner@example.com', password: 'hunter2' };
    const strip: Record<string, unknown>[] = [];
    const lamp: Record<string, unknown>[] = [];
    const first = cloud.listenToCloud(sdk, account, 'AA:BB', (state) => strip.push(state));
    const second = cloud.listenToCloud(sdk, account, 'CC:DD', (state) => lamp.push(state));

    for (let attempt = 0; attempt < 100 && sessions.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const [session] = sessions;

    expect(sessions).toHaveLength(1);
    expect(session?.options.url).toBe('mqtts://iot.example.amazonaws.com:8883');
    expect(session?.options.clientId).toMatch(/^AP\/42\/[0-9a-f]{32}$/u);
    expect(session?.options.tls?.passphrase).toBe('secret');
    expect(session?.topics).toEqual(['GA/account-topic']);

    session?.options.onMessage(
      'GA/account-topic',
      Buffer.from(JSON.stringify({ device: 'AA:BB', state: { onOff: 0 } })),
    );

    expect(strip).toEqual([{ onOff: 0 }]);
    expect(lamp).toEqual([]);

    await first.release();

    expect(session?.closes).toBe(0);

    await second.release();

    expect(session?.closes).toBe(1);
  });
});
