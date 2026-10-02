/**
 * The Ecovacs bundle, against a fake of ECOVACS's servers and a fake MQTT session.
 *
 * What is checked is what the bundle does: a GOAT's and a DEEBOT's reports folded into one state
 * in the platform's units, the commands the app would send for each act and setting - in the
 * dialect the robot speaks, and the other one when it refuses - which robot a product name is,
 * the sign-in steps and the email confirmation ECOVACS asks for, the account's session reused
 * and renewed, the robots found and followed, a vacuum's map drawn, and the profiles reading the
 * state the transport hands on. ECOVACS itself is not reached.
 */
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  parseEntityId,
  type CapabilityState,
  type EntityId,
  type JsonObject,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  createDeclarativeIntegration,
  defineAccount,
  defineStreamSource,
  defineTransport,
  driverManifestSchema,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type AccountHandle,
  type AccountModule,
  type BundleSdk,
  type DiscoverySource,
  type Integration,
  type ManagedMqtt,
  type ManagedMqttOptions,
  type MappingContext,
  type Sighting,
  type Transport,
  type TransportConnection,
  type TransportInbound,
} from '@nebulahome/package-runtime';

import { decodeLzma } from '../codecs/lzma.js';
import { encodePalettedPng } from '../codecs/png.js';

/** The bundle, where it ships. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/ecovacs');

/** A robot's state, as mower.js and vacuum.js keep it. */
type RobotState = Record<string, unknown> & {
  readonly activity: string | null;
  readonly battery: number | null;
  readonly settings: Record<string, unknown>;
  readonly job: Record<string, unknown>;
};

/** A vacuum's map, as vacuum.js keeps it. */
type VacuumMap = {
  readonly mapId: string | null;
  readonly rooms: { id: string; name: string; outline: [number, number][] }[];
  readonly robot: { x: number; y: number; angle: number } | null;
  readonly station: { x: number; y: number } | null;
  readonly pieceCrcs: (string | null)[];
  readonly pieces: Record<string, string>;
  readonly trace: [number, number, boolean][];
  readonly barriers: { id: string; kind: string; points: [number, number][] }[];
  readonly outline: string | null;
};

/** One command. */
type Command = {
  readonly command: string;
  readonly data: unknown;
  readonly fallback?: string;
  readonly fallbackData?: unknown;
};

/** What mower.js exports. */
type MowerModule = {
  readonly emptyState: () => RobotState & { taskId: string | null };
  readonly applyReport: (state: RobotState, command: string, data: unknown) => RobotState;
  readonly mowCommandOf: (act: string, state: RobotState, dialect: 'g1' | 'rtk') => Command;
  readonly settingCommandOf: (setting: string, value: unknown, state: RobotState) => Command;
  readonly withTask: (command: Command, state: RobotState) => Command;
};

/** What vacuum.js exports. */
type VacuumModule = {
  readonly emptyState: () => RobotState & { map: VacuumMap; rooms: unknown[] };
  readonly applyReport: (
    state: RobotState,
    command: string,
    data: unknown,
  ) => RobotState & { map: VacuumMap; rooms: unknown[] };
  readonly cleanCommandOf: (
    act: string,
    state: RobotState,
    dialect: 'v1' | 'v2',
    rooms?: readonly string[],
  ) => Command;
  readonly settingCommandOf: (setting: string, value: unknown) => Command;
};

/** What map.js exports. */
type MapModule = {
  readonly pieceCellsOf: (value: string, lzma: (bytes: Uint8Array) => Buffer) => Uint8Array;
  readonly tracePointsOf: (
    value: string,
    lzma: (bytes: Uint8Array) => Buffer,
  ) => [number, number, boolean][];
  readonly unpackedSubset: (data: unknown, lzma: (bytes: Uint8Array) => Buffer) => unknown;
  readonly barrierSetOf: (
    data: unknown,
    type: 'vw' | 'mw',
    lzma: (bytes: Uint8Array) => Buffer,
  ) => unknown;
  readonly outlineShapesOf: (
    value: string,
    lzma: (bytes: Uint8Array) => Buffer,
  ) => { walls: [number, number][][]; rooms: [number, number][][] };
  readonly piecesToAsk: (map: VacuumMap) => number[];
  readonly createMapDrawer: (
    sdk: Pick<BundleSdk, 'codecs' | 'images'>,
  ) => (map: VacuumMap) => string | null;
};

/** What models.js exports. */
type ModelsModule = {
  readonly goatKindOf: (deviceName: string) => { code: string; dialect: 'g1' | 'rtk' };
  readonly deebotKindOf: (deviceName: string) => { code: string; dialect: 'v1' | 'v2' };
  readonly isGoat: (device: { category: string | null; deviceName: string }) => boolean;
  readonly robotKindOf: (device: {
    category: string | null;
    deviceName: string;
  }) => { role: string; code: string; dialect: string } | null;
};

/** What api.js exports. */
type ApiModule = {
  readonly clientIdOf: (email: string) => string;
  readonly signParams: (
    params: Record<string, string | number>,
    extra: Record<string, string | number>,
    key: string,
    secret: string,
  ) => Record<string, string | number>;
  readonly md5: (text: string) => string;
  readonly dataOfReply: (command: string, reply: unknown) => unknown;
};

/** What account.js exports. */
type AccountJs = {
  readonly forgetAccounts: () => void;
  readonly accountFor: (handle: AccountHandle) => {
    devices: (force?: boolean) => Promise<unknown[]>;
  };
};

/** What sign-in.js exports. */
type SignInJs = {
  readonly default: (sdk: BundleSdk) => AccountModule;
  readonly forgetEmailedCodes: () => void;
};

let mower: MowerModule;
let vacuum: VacuumModule;
let map: MapModule;
let models: ModelsModule;
let api: ApiModule;
let account: AccountJs;
let signIn: SignInJs;
let createTransport: (sdk: BundleSdk) => Transport;
let createDiscovery: (sdk: BundleSdk) => DiscoverySource;

/**
 * Loads one of the bundle's modules by path, as the hub does.
 *
 * @param file - The module, from the bundle.
 * @returns What it exports.
 */
async function load<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(path.join(BUNDLE, file)).href)) as T;
}

beforeAll(async () => {
  mower = await load<MowerModule>('cloud/mower.js');
  vacuum = await load<VacuumModule>('cloud/vacuum.js');
  map = await load<MapModule>('cloud/map.js');
  models = await load<ModelsModule>('cloud/models.js');
  api = await load<ApiModule>('cloud/api.js');
  account = await load<AccountJs>('cloud/account.js');
  signIn = await load<SignInJs>('cloud/sign-in.js');
  createTransport = (await load<{ default: typeof createTransport }>('cloud/transport.js')).default;
  createDiscovery = (await load<{ default: typeof createDiscovery }>('cloud/discovery.js')).default;
});

beforeEach(() => {
  account.forgetAccounts();
  signIn.forgetEmailedCodes();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The account the tests sign in with. */
const SETTINGS = { email: 'owner@example.com', password: 'hunter2', country: 'IT' };

/**
 * The account as the hub hands it once connected: the portal's credentials still good.
 *
 * @param session - What to change of the session kept.
 * @returns The handle, its `update` and `needsSignIn` spies.
 */
function handleWith(session: JsonObject = {}): AccountHandle & {
  update: ReturnType<typeof vi.fn>;
  needsSignIn: ReturnType<typeof vi.fn>;
} {
  return {
    id: 'uid-1',
    label: SETTINGS.email,
    status: 'connected',
    credentials: SETTINGS,
    session: {
      uid: 'uid-1',
      accessToken: 'access-1',
      userId: 'user-1',
      token: 'token-1',
      expiresAtMs: Date.now() + 86_400_000,
      signedInAt: '2026-09-01T00:00:00.000Z',
      ...session,
    },
    update: vi.fn(async () => Promise.resolve()),
    needsSignIn: vi.fn(async () => Promise.resolve()),
  };
}

/** The mower on it, as the device list names it. */
const GOAT = {
  did: 'did-goat',
  class: '5xu9h3',
  resource: 'ONb7',
  nick: 'Front lawn',
  company: 'eco-ng',
  deviceName: 'GOAT G1-800',
};

/** A robot vacuum on the same account. */
const DEEBOT = {
  did: 'did-deebot',
  class: 'p95mgv',
  resource: 'XyZ1',
  nick: 'Hall',
  company: 'eco-ng',
  deviceName: 'DEEBOT X1 OMNI',
  product_category: 'DEEBOT',
};

/** An air purifier on it, which the bundle does not drive. */
const AIRBOT = {
  did: 'did-airbot',
  class: 'a1b2c3',
  resource: 'Q1',
  nick: 'Bedroom air',
  company: 'eco-ng',
  deviceName: 'AIRBOT Z1',
  product_category: 'AIRBOT',
};

/** What a whole read of the mower answers, group by group. */
const GROUPED: Record<string, unknown> = {
  getBattery: { data: { value: 87, isLow: 0 } },
  getChargeState: { data: { isCharging: 1, mode: 'slot' } },
  getCleanInfo_V2: { data: { trigger: 'none', state: 'idle' } },
  getStats: { data: { mowid: '4711', time: 1800, area: 2538175, mowedArea: 1269088 } },
  getError: { data: { code: [0] } },
  getRainDelay: { data: { enable: 1, delay: 180 } },
  getCutEfficiency: { data: { level: 2 } },
  getCutDirection: { data: { angle: 90 } },
};

/** What a whole read of the vacuum answers, group by group. */
const VACUUM_GROUPED: Record<string, unknown> = {
  getChargeState: { data: { isCharging: 0 } },
  getCleanInfo_V2: { data: { state: 'clean', cleanState: { motionState: 'working' } } },
  getBattery: { data: { value: 64 } },
  getStats: { data: { area: 12, time: 600 } },
  getError: { data: { code: [0] } },
  getSpeed: { data: { speed: 1 } },
  getWaterInfo: { data: { amount: 2 } },
  getVolume: { data: { volume: 7 } },
  getBreakPoint: { data: { enable: 1 } },
  getCarpertPressure: { data: { enable: 0 } },
  getCleanCount: { data: { count: 1 } },
};

/**
 * A piece of floor plan as `getMinorMap` sends it: floor in a square, walls round it, carpet in
 * the middle, packed as ECOVACS packs it (made with Python's liblzma).
 */
const PIECE =
  'XQAAgAAQJwAAAABv/f//o7dpke2r+0LGRej57ervqUcgdkbBZuR3WNk4VTqWUxxW5Rdzmk6uQ/o8a7w1rWco/HA6VB9lsktIMfye1/f//QRXcg==';

/** A path: three joined points in centimetres, then one that does not join. */
const TRACE = 'XQAAgAAUAAAAAABpCv/eP8iD73D+CFUv//9iLAAA';

/** A room's outline, packed: `500,-500;4500,-500;4500,-4500;500,-4500`. */
const OUTLINE = 'XQAAgAAnAAAAABqMLFgvO2El3GqjDpYp1xQb///4+kAA';

/** The CRC of a piece with nothing in it. */
const EMPTY_CRC = '1295764014';

/**
 * The outline a robot without pieces sends whole, as {@link OUTLINE_JSON} packed: a closed square
 * of walls, a wall on its own beside it, the square's room, and an entry of a type not drawn.
 */
const MAP_INFO =
  'XQAAgAB1AAAAAC3ghGIjMOLiCnLwySXAfen0dEqp2rDo9eC5rk+gJ/zBHR9ar0n/7iJadY3mtIdB+5CyudqduFNtjXasTn//u28gAA==';

/** What {@link MAP_INFO} holds. */
const OUTLINE_JSON =
  '[["1","10;0,0;4000,0;4000,-4000;0,-4000","11;6000,0,3-1-0;8000,0"],["2","1;0,0;4000,0;4000,-4000;0,-4000"],["5","x"]]';

/**
 * A virtual wall and a no-mop zone as `getMapSet_V2` packs them:
 * `[["3",-1000,500,-1000,-1500],["4",0,0,1000,0,1000,-1000,0,-1000]]`.
 */
const BARRIERS_V2 = 'XQAAgABBAAAAAC3ghGYjMKXu28EhAMBD+OJhfo2tN00ke+pdpvpOLJK1DBRpraJqjm6V/oYggA==';

/** An RSA key pair standing in for ECOVACS's, so what is encrypted with it can be read back. */
const KEYS = generateKeyPairSync('rsa', { modulusLength: 1024 });

/** What the fake servers were asked, and how they answer. */
type Servers = {
  readonly fetch: typeof fetch;
  readonly asked: { url: URL; body: unknown }[];
  loginCode: string;
  verifyCode: string;
  checkLoginCode: string;
  refused: Set<string>;
};

/**
 * What a vacuum answers one command with.
 *
 * @param command - The command.
 * @param data - What it carried.
 * @returns Its data.
 */
function vacuumAnswer(command: string, data: unknown): unknown {
  const asked = (data ?? {}) as Record<string, unknown>;

  switch (command) {
    case 'getNetInfo': {
      return { ssid: 'Home', rssi: -55, ip: '192.168.1.20' };
    }

    case 'getLifeSpan': {
      return [
        { type: 'brush', left: 150, total: 300 },
        { type: 'sideBrush', left: 50, total: 200 },
        { type: 'heap', left: 90, total: 120 },
      ];
    }

    case 'getTotalStats': {
      return { area: 1200, time: 360_000, count: 88 };
    }

    case 'getCachedMapInfo': {
      return { info: [{ mid: '7', using: 1 }] };
    }

    case 'getMapSet': {
      if (asked['type'] === 'vw') {
        return { type: 'vw', mid: '7', subsets: [{ mssid: '3' }] };
      }

      if (asked['type'] === 'mw') {
        return {
          type: 'mw',
          mid: '7',
          subsets: [{ mssid: '4', value: '0,0,1000,0,1000,-1000,0,-1000' }],
        };
      }

      return {
        type: 'ar',
        mid: '7',
        subsets: [
          { mssid: '1', name: 'Kitchen <&>' },
          { mssid: '2', subtype: '3' },
        ],
      };
    }

    case 'getMapSubSet': {
      if (asked['type'] === 'vw') {
        return { type: 'vw', mssid: asked['mssid'], value: '[-1000,500,-1000,-1500]' };
      }

      return asked['mssid'] === '1'
        ? { mssid: '1', compress: 1, value: OUTLINE }
        : { mssid: '2', value: '-3000,-500;-1000,-500;-1000,-2500;-3000,-2500' };
    }

    case 'getMapInfo_V2': {
      return { mid: '7', outlineVer: '1', info: MAP_INFO };
    }

    case 'getMajorMap': {
      return {
        mid: '7',
        value: [...Array.from({ length: 64 }).keys()]
          .map((index) => (index === 36 ? '4242' : EMPTY_CRC))
          .join(','),
      };
    }

    case 'getMinorMap': {
      return { mid: '7', type: 'ol', pieceIndex: asked['pieceIndex'], pieceValue: PIECE };
    }

    case 'getPos': {
      return { deebotPos: { x: 1000, y: -1000, a: 90 }, chargePos: [{ x: 250, y: -250, a: 0 }] };
    }

    case 'getMapTrace': {
      return asked['traceStart'] === 0
        ? { tid: '1', traceStart: 0, pointCount: 4, totalCount: 4, traceValue: TRACE }
        : { tid: '1', traceStart: asked['traceStart'], totalCount: 4, traceValue: '' };
    }

    default: {
      return {};
    }
  }
}

/**
 * ECOVACS's servers, as far as the bundle goes.
 *
 * @returns The fake, and what it was asked.
 */
function servers(): Servers {
  const state: Servers = {
    asked: [],
    loginCode: '0000',
    verifyCode: '0000',
    checkLoginCode: '0000',
    refused: new Set(),
    fetch: (input, init) => Promise.resolve(answer(input, init)),
  };

  /**
   * Answers one request.
   *
   * @param input - Where.
   * @param init - What.
   * @returns The response.
   */
  function answer(input: string | URL | Request, init: RequestInit | undefined): Response {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const text = typeof init?.body === 'string' ? init.body : '';
    const body: unknown = text === '' ? null : JSON.parse(text);

    state.asked.push({ url, body });

    const endpoint = url.pathname;
    /**
     * Answers as the account service does.
     *
     * @param code - Its code.
     * @param data - Its data.
     * @returns The response.
     */
    const reply = (code: string, data: unknown): Response => Response.json({ code, data });

    if (endpoint.endsWith('/user/login')) {
      return reply(state.loginCode, { uid: 'uid-1', accessToken: 'access-1' });
    }

    if (endpoint.endsWith('/user/checkLogin')) {
      return reply(state.checkLoginCode, { uid: 'uid-1', accessToken: 'access-3' });
    }

    if (endpoint.endsWith('/common/getConfig')) {
      const der = KEYS.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      return reply('0000', [
        { key: 'PUBLIC.KEY.CONFIG', value: JSON.stringify({ publicKey: der }) },
      ]);
    }

    if (endpoint.endsWith('/user/sendEmailVerifyCode')) {
      return reply('0000', null);
    }

    if (endpoint.endsWith('/user/verifyDevice')) {
      return reply(state.verifyCode, { uid: 'uid-1', accessToken: 'access-2' });
    }

    if (endpoint.endsWith('/auth/getAuthCode')) {
      return reply('0000', { authCode: 'auth-1' });
    }

    if (endpoint === '/api/users/user.do') {
      const todo = (body as { todo?: string }).todo;

      return todo === 'loginByItToken'
        ? Response.json({ result: 'ok', userId: 'user-1', token: 'token-1', last: 604800000 })
        : Response.json({ result: 'ok', devices: [GOAT, DEEBOT, AIRBOT] });
    }

    if (endpoint === '/api/appsvr/app.do') {
      return Response.json({ devices: [{ did: 'did-goat', product_category: 'GOATBOT' }] });
    }

    if (endpoint.endsWith('/sst/issue')) {
      return Response.json({ data: { data: { token: 'sst-1' } } });
    }

    if (endpoint.endsWith('/endpoint/control')) {
      const command = url.searchParams.get('apn') ?? '';
      const isVacuum = url.searchParams.get('eid') === DEEBOT.did;
      const carried = (body as { body: { data: unknown } }).body.data;

      if (state.refused.has(command)) {
        return Response.json({
          ret: 'ok',
          resp: JSON.stringify({ body: { code: 20003, msg: 'rcp not support' } }),
        });
      }

      const grouped = isVacuum ? VACUUM_GROUPED : GROUPED;
      const data =
        command === 'getInfo'
          ? Object.fromEntries(
              (carried as string[])
                .filter((each) => each in grouped)
                .map((each) => [each, grouped[each]]),
            )
          : isVacuum
            ? vacuumAnswer(command, carried)
            : command === 'getLifeSpan'
              ? [{ type: 'blade', left: 3000, total: 12000 }]
              : {};

      return Response.json({ ret: 'ok', resp: JSON.stringify({ body: { code: 0, data } }) });
    }

    return new Response('not found', { status: 404 });
  }

  return state;
}

/** A fake MQTT session the test drives. */
type FakeMqtt = {
  readonly options: ManagedMqttOptions;
  readonly topics: string[];
  closes: number;
};

/**
 * An SDK whose MQTT sessions the test holds, with the hub's own codecs.
 *
 * @param sessions - Where each opened session goes.
 * @returns The SDK.
 */
function sdkWith(sessions: FakeMqtt[]): BundleSdk {
  return {
    version: '1.5.0',
    z,
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    defineTransport,
    defineAccount,
    codecs: { lzma: decodeLzma },
    images: { png: encodePalettedPng },
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
      throw new Error('unused');
    },
    platform: { mqtt: null },
  };
}

/**
 * The commands the fake servers were sent, in order, with what each carried.
 *
 * @param fake - The servers.
 * @param did - Only those for this robot, when said.
 * @returns Each command's name and data.
 */
function controls(fake: Servers, did?: string): { command: string; data: unknown }[] {
  return fake.asked
    .filter(
      (each) =>
        each.url.pathname.endsWith('/endpoint/control') &&
        (did === undefined || each.url.searchParams.get('eid') === did),
    )
    .map((each) => ({
      command: each.url.searchParams.get('apn') ?? '',
      data: (each.body as { body: { data: unknown } }).body.data,
    }));
}

/**
 * The paths the fake servers were asked, for what a sign-in called.
 *
 * @param fake - The servers.
 * @returns Each path.
 */
function paths(fake: Servers): string[] {
  return fake.asked.map((each) => each.url.pathname);
}

describe("a GOAT's state", () => {
  it('folds a grouped read into one state, in square metres and percent', () => {
    const state = mower.applyReport(mower.emptyState(), 'getInfo', GROUPED);

    expect(state).toMatchObject({
      activity: 'docked',
      battery: 87,
      isCharging: true,
      taskId: '4711',
      hasError: false,
      error: 'No fault',
      job: { area: 126.91, jobArea: 253.82, progress: 50, duration: 1800 },
      settings: {
        rainSensor: true,
        rainDelay: 180,
        mowingEfficiency: 'delicate',
        cutDirection: 90,
      },
    });
  });

  it('takes a pause during a charge for what it is, and a weak signal for going home', () => {
    const charging = mower.applyReport(mower.emptyState(), 'getChargeState', { isCharging: 1 });
    const paused = mower.applyReport(charging, 'getCleanInfo_V2', {
      state: 'clean',
      cleanState: { motionState: 'pause' },
    });
    const mowing = mower.applyReport(mower.emptyState(), 'onCleanInfo_V2', { state: 'clean' });

    expect(paused.activity).toBe('paused');
    expect(mower.applyReport(mowing, 'onError', { code: [422] })).toMatchObject({
      activity: 'returning',
      hasError: false,
    });
    expect(mower.applyReport(mowing, 'onError', { code: [104] })).toMatchObject({
      activity: 'error',
      hasError: true,
      error: 'Fault 104',
    });
  });

  it('reads a setting the app changed from its push, and the blade from its lifespan', () => {
    const pushed = mower.applyReport(mower.emptyState(), 'onAnimProtect', {
      enable: 1,
      start: '20:0',
      end: '8:0',
    });
    const worn = mower.applyReport(pushed, 'getLifeSpan', [
      { type: 'blade', left: 3000, total: 12000 },
    ]);

    expect(worn.settings).toMatchObject({
      animalProtection: true,
      animalStart: '20:00',
      animalEnd: '08:00',
    });
    expect(worn['lifespans']).toEqual({ blade: 25, lensBrush: null });
  });
});

describe("a GOAT's commands", () => {
  it('starts a G1 with clean_V2 and an O series with clean, and resumes a paused job', () => {
    const docked = mower.applyReport(mower.emptyState(), 'getChargeState', { isCharging: 1 });
    const paused = { ...docked, activity: 'paused' };

    expect(mower.mowCommandOf('start', docked, 'g1')).toMatchObject({
      command: 'clean_V2',
      data: { act: 'start', content: { type: 'auto' } },
      fallback: 'clean',
    });
    expect(mower.mowCommandOf('start', paused, 'g1').data).toEqual({ act: 'resume' });
    expect(mower.mowCommandOf('stop', paused, 'rtk')).toMatchObject({
      command: 'clean',
      data: { act: 'stop', content: { type: 'auto' } },
      fallbackData: { act: 'stop', content: { type: '' } },
    });
    expect(mower.mowCommandOf('dock', docked, 'g1')).toEqual({
      command: 'charge',
      data: { act: 'go' },
    });
  });

  it('keeps the other half of a paired setting, and sends the job along', () => {
    const state = mower.applyReport(mower.emptyState(), 'getInfo', GROUPED);
    const off = mower.withTask(mower.settingCommandOf('rainSensor', false, state), state);

    expect(off).toEqual({
      command: 'setRainDelay',
      data: { enable: 0, delay: 180, bdTaskID: '4711' },
    });
    expect(mower.settingCommandOf('mowingEfficiency', 'quick', state)).toEqual({
      command: 'setCutEfficiency',
      data: { level: 1 },
    });
    expect(() => mower.settingCommandOf('mowingEfficiency', 'reckless', state)).toThrow(
      /cannot be set/u,
    );
  });

  it('refuses a cutting direction while the mower is out on the lawn', () => {
    const mowing = mower.applyReport(mower.emptyState(), 'onCleanInfo_V2', { state: 'clean' });

    expect(() => mower.settingCommandOf('cutDirection', 45, mowing)).toThrow(/end the job/u);
  });

  it('carries on a job a fault stopped, where a start would begin the lawn again', () => {
    const mowing = mower.applyReport(mower.emptyState(), 'onCleanInfo_V2', { state: 'clean' });
    const stuck = mower.applyReport(mowing, 'onError', { code: [104] });
    const idle = mower.applyReport(stuck, 'onCleanInfo_V2', { state: 'idle' });

    expect(stuck).toMatchObject({ activity: 'error', isResumable: true });
    expect(idle['isResumable']).toBe(false);
    expect(mower.mowCommandOf('resume', stuck, 'g1')).toMatchObject({
      command: 'clean_V2',
      data: { act: 'resume' },
      fallback: 'clean',
      fallbackData: { act: 'resume', content: { type: 'auto' } },
    });
    expect(mower.mowCommandOf('start', stuck, 'g1').data).toEqual({
      act: 'start',
      content: { type: 'auto' },
    });
  });
});

describe("a DEEBOT's state", () => {
  it('folds a grouped read into one state, in the words its settings use', () => {
    const state = vacuum.applyReport(vacuum.emptyState(), 'getInfo', VACUUM_GROUPED);

    expect(state).toMatchObject({
      activity: 'cleaning',
      battery: 64,
      isCharging: false,
      hasError: false,
      job: { area: 12, duration: 600 },
      settings: {
        suction: 'max',
        water: 'medium',
        volume: 7,
        continuousCleaning: true,
        carpetBoost: false,
        cleanCount: 1,
      },
    });
  });

  it('reads its consumables in percent, a fault in words, and docked from a charge', () => {
    const worn = vacuum.applyReport(
      vacuum.emptyState(),
      'getLifeSpan',
      vacuumAnswer('getLifeSpan', {}),
    );
    const stuck = vacuum.applyReport(worn, 'onError', { code: [102] });
    const docked = vacuum.applyReport(worn, 'onChargeState', { isCharging: 1 });

    expect(worn['lifespans']).toEqual({ brush: 50, sideBrush: 25, filter: 75 });
    expect(stuck).toMatchObject({ activity: 'error', error: 'The main brush is stuck' });
    expect(docked.activity).toBe('docked');
  });

  it('keeps a job open through a fault, until it says it is idle', () => {
    const cleaning = vacuum.applyReport(vacuum.emptyState(), 'getInfo', VACUUM_GROUPED);
    const stuck = vacuum.applyReport(cleaning, 'onError', { code: [102] });
    const done = vacuum.applyReport(stuck, 'onCleanInfo_V2', { state: 'idle' });

    expect(vacuum.emptyState()['isResumable']).toBe(false);
    expect(stuck).toMatchObject({ activity: 'error', isResumable: true });
    expect(done['isResumable']).toBe(false);
  });

  it('names its rooms after the app, or after the kind of room they are', () => {
    const state = vacuum.applyReport(
      vacuum.emptyState(),
      'getMapSet',
      vacuumAnswer('getMapSet', {}),
    );

    expect(state.rooms).toEqual([
      { id: '1', name: 'Kitchen <&>' },
      { id: '2', name: 'Bedroom' },
    ]);
  });
});

describe("a DEEBOT's commands", () => {
  it('cleans some rooms as a spot area, in either dialect', () => {
    const idle = vacuum.applyReport(vacuum.emptyState(), 'getCleanInfo_V2', { state: 'idle' });

    expect(vacuum.cleanCommandOf('rooms', idle, 'v2', ['1', '4'])).toEqual({
      command: 'clean_V2',
      data: { act: 'start', content: { type: 'spotArea', value: '1,4' } },
      fallback: 'clean',
      fallbackData: { act: 'start', type: 'spotArea', content: '1,4' },
    });
    expect(vacuum.cleanCommandOf('start', { ...idle, activity: 'paused' }, 'v1').data).toEqual({
      act: 'r',
      type: 'auto',
    });
    expect(vacuum.cleanCommandOf('dock', idle, 'v2')).toEqual({
      command: 'charge',
      data: { act: 'go' },
    });
  });

  it('carries on a job a fault stopped, in either dialect', () => {
    const stuck = vacuum.applyReport(
      vacuum.applyReport(vacuum.emptyState(), 'getInfo', VACUUM_GROUPED),
      'onError',
      { code: [102] },
    );

    expect(vacuum.cleanCommandOf('resume', stuck, 'v2')).toEqual({
      command: 'clean_V2',
      data: { act: 'resume', content: { type: 'auto' } },
      fallback: 'clean',
      fallbackData: { act: 'r', type: 'auto' },
    });
  });

  it('turns a setting into the command the app sends, and refuses one it does not take', () => {
    expect(vacuum.settingCommandOf('suction', 'quiet')).toEqual({
      command: 'setSpeed',
      data: { speed: 1000 },
    });
    expect(vacuum.settingCommandOf('carpetBoost', true)).toEqual({
      command: 'setCarpertPressure',
      data: { enable: 1 },
    });
    expect(() => vacuum.settingCommandOf('volume', 11)).toThrow(/cannot be set/u);
  });
});

describe("a DEEBOT's map", () => {
  it('unpacks a piece of the floor plan, the path and a packed outline', () => {
    const cells = map.pieceCellsOf(PIECE, decodeLzma);

    expect(cells).toHaveLength(10_000);
    // Column 10, row 50: the wall; column 50, row 50: the carpet; column 5: nothing.
    expect([cells[10 * 100 + 50], cells[50 * 100 + 50], cells[5 * 100 + 5]]).toEqual([2, 3, 0]);
    expect(map.tracePointsOf(TRACE, decodeLzma)).toEqual([
      [0, 0, true],
      [500, 0, true],
      [500, -500, true],
      [-500, 0, false],
    ]);
    expect(map.unpackedSubset({ mssid: '1', compress: 1, value: OUTLINE }, decodeLzma)).toEqual({
      mssid: '1',
      compress: 0,
      value: '500,-500;4500,-500;4500,-4500;500,-4500',
    });
  });

  it('reads the virtual walls and the no-mop zones set in the app', () => {
    let state = vacuum.applyReport(vacuum.emptyState(), 'getMapSet', {
      type: 'vw',
      subsets: [{ mssid: '3' }],
    });

    expect(state.map.barriers).toEqual([{ id: '3', kind: 'virtual', points: [] }]);

    state = vacuum.applyReport(state, 'getMapSubSet', {
      type: 'vw',
      mssid: '3',
      value: '[-1000,500,-1000,-1500]',
    });
    state = vacuum.applyReport(state, 'getMapSet', {
      type: 'mw',
      subsets: [{ mssid: '4', value: '0,0;1000,0;1000,-1000;0,-1000' }],
    });

    expect(state.map.barriers).toEqual([
      {
        id: '3',
        kind: 'virtual',
        points: [
          [-1000, 500],
          [-1000, -1500],
        ],
      },
      {
        id: '4',
        kind: 'no_mop',
        points: [
          [0, 0],
          [1000, 0],
          [1000, -1000],
          [0, -1000],
        ],
      },
    ]);
    // The rooms are left as they were.
    expect(state.rooms).toEqual([]);
    expect(map.barrierSetOf({ type: 'vw', subsets: BARRIERS_V2 }, 'vw', decodeLzma)).toEqual({
      type: 'vw',
      subsets: [
        { mssid: '3', value: '-1000,500,-1000,-1500' },
        { mssid: '4', value: '0,0,1000,0,1000,-1000,0,-1000' },
      ],
    });
  });

  it('reads the outline of the walls a robot without pieces sends, LZMA or Zstandard', () => {
    const shapes = {
      walls: [
        [
          [0, 0],
          [4000, 0],
          [4000, -4000],
          [0, -4000],
          [0, 0],
        ],
        [
          [6000, 0],
          [8000, 0],
        ],
      ],
      rooms: [
        [
          [0, 0],
          [4000, 0],
          [4000, -4000],
          [0, -4000],
        ],
      ],
    };

    expect(map.outlineShapesOf(MAP_INFO, decodeLzma)).toEqual(shapes);
    expect(
      map.outlineShapesOf(zstdCompressSync(Buffer.from(OUTLINE_JSON)).toString('base64'), () => {
        throw new Error('not LZMA');
      }),
    ).toEqual(shapes);
    expect(map.outlineShapesOf('bm90IHBhY2tlZA==', decodeLzma)).toEqual({ walls: [], rooms: [] });

    const kept = vacuum.applyReport(vacuum.emptyState(), 'onMapInfo_V2', {
      mid: '7',
      outlineVer: '1',
      info: MAP_INFO,
    });

    expect(kept.map.outline).toBe(MAP_INFO);
    // A map the robot keeps and does not clean by is not drawn.
    expect(
      vacuum.applyReport(vacuum.emptyState(), 'onMapInfo_V2', { outlineVer: '0', info: MAP_INFO })
        .map.outline,
    ).toBeNull();
  });

  it('draws the walls of the outline, the virtual walls and the no-mop zones', () => {
    let state = vacuum.applyReport(vacuum.emptyState(), 'onMapInfo_V2', {
      mid: '7',
      info: MAP_INFO,
    });

    state = vacuum.applyReport(state, 'getMapSubSet', {
      type: 'vw',
      mssid: '3',
      value: '[-1000,500,-1000,-1500]',
    });
    state = vacuum.applyReport(state, 'getMapSet', {
      type: 'mw',
      subsets: [{ mssid: '4', value: '0,0,1000,0,1000,-1000,0,-1000' }],
    });

    const svg =
      map.createMapDrawer({ codecs: { lzma: decodeLzma }, images: { png: encodePalettedPng } })(
        state.map,
      ) ?? '';

    // No pieces: the outline's room is the floor, its walls drawn over it.
    expect(svg).not.toContain('<image');
    expect(svg).toContain('<polygon points="400,400 480,400 480,480 400,480" fill="#cddcf0"/>');
    expect(svg).toContain('d="M400 400L480 400L480 480L400 480L400 400M520 400L560 400"');
    expect(svg).toContain('<polyline points="380,390 380,430" fill="none" stroke="#e5484d"');
    expect(svg).toContain('<polygon points="400,400 420,400 420,420 400,420" fill="#f2a33a"');
  });

  it('asks only for the pieces that hold something and were not received', () => {
    const state = vacuum.applyReport(
      vacuum.emptyState(),
      'getMajorMap',
      vacuumAnswer('getMajorMap', {}),
    );

    expect(map.piecesToAsk(state.map)).toEqual([36]);
    expect(
      map.piecesToAsk(
        vacuum.applyReport(state, 'getMinorMap', { pieceIndex: 36, pieceValue: PIECE }).map,
      ),
    ).toEqual([]);
  });

  it('draws the floor plan, the rooms with their names, the path, the robot and its station', () => {
    let state = vacuum.emptyState();

    for (const [command, data] of [
      ['getMapSet', vacuumAnswer('getMapSet', {})],
      ['getMapSubSet', { mssid: '1', value: '500,-500;4500,-500;4500,-4500;500,-4500' }],
      ['getMapSubSet', vacuumAnswer('getMapSubSet', { mssid: '2' })],
      ['getMajorMap', vacuumAnswer('getMajorMap', {})],
      ['getMinorMap', { pieceIndex: 36, pieceValue: PIECE }],
      ['getPos', vacuumAnswer('getPos', {})],
    ] as const) {
      state = vacuum.applyReport(state, command, data);
    }

    const draw = map.createMapDrawer({
      codecs: { lzma: decodeLzma },
      images: { png: encodePalettedPng },
    });
    const svg = draw({ ...state.map, trace: map.tracePointsOf(TRACE, decodeLzma) }) ?? '';

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="330 /u);
    expect(svg).toContain('href="data:image/png;base64,iVBORw0KGgo');
    expect(svg.match(/<polygon /gu)).toHaveLength(2);
    expect(svg).toContain('>Kitchen &lt;&amp;&gt;</text>');
    expect(svg).toContain('>Bedroom</text>');
    expect(svg).toContain('d="M400 400L410 400L410 410M390 400"');
    expect(svg).toContain('<circle cx="420" cy="420"');
    expect(svg).toContain('<rect x="402" y="402"');
    expect(draw(vacuum.emptyState().map)).toBeNull();
  });
});

describe('which robot a product name is', () => {
  it('tells the GOAT lines apart, the longer names first', () => {
    expect(models.goatKindOf('GOAT G1-800')).toEqual({ code: 'g1-800', dialect: 'g1' });
    expect(models.goatKindOf('GOAT G1')).toEqual({ code: 'g1', dialect: 'g1' });
    expect(models.goatKindOf('GOAT O1200 LiDAR Pro')).toEqual({
      code: 'o1200-lidar-pro',
      dialect: 'rtk',
    });
    expect(models.goatKindOf('GOAT O800 RTK')).toEqual({ code: 'o800-rtk', dialect: 'rtk' });
    expect(models.goatKindOf('GOAT A3000 LiDAR Pro').code).toBe('a3000-lidar-pro');
    expect(models.goatKindOf('GOAT O2950 NEW')).toEqual({ code: 'goat', dialect: 'rtk' });
  });

  it('tells the DEEBOTs apart, the older ones in the first dialect', () => {
    expect(models.deebotKindOf('DEEBOT X1 OMNI')).toEqual({ code: 'x1-omni', dialect: 'v2' });
    expect(models.deebotKindOf('DEEBOT OZMO 950')).toEqual({ code: 'ozmo-950', dialect: 'v1' });
    expect(models.deebotKindOf('DEEBOT Y1 PRO')).toEqual({ code: 'deebot', dialect: 'v2' });
  });

  it('takes a robot by its category, and leaves what is neither alone', () => {
    expect(models.isGoat({ category: 'GOATBOT', deviceName: 'Mower' })).toBe(true);
    expect(models.isGoat({ category: 'DEEBOT', deviceName: 'GOAT-looking vacuum' })).toBe(false);
    expect(models.isGoat({ category: null, deviceName: 'GOAT G1-800' })).toBe(true);
    expect(models.robotKindOf({ category: 'DEEBOT', deviceName: 'DEEBOT T10' })).toEqual({
      role: 'vacuum',
      code: 't10',
      dialect: 'v2',
    });
    expect(models.robotKindOf({ category: 'AIRBOT', deviceName: 'AIRBOT Z1' })).toBeNull();
  });
});

describe("ECOVACS's API", () => {
  it('signs the way the app does: the key, the parameters sorted, the secret', () => {
    const signed = api.signParams({ b: 2, a: 'x' }, { c: 3 }, 'key', 'secret');

    expect(signed).toEqual({
      b: 2,
      a: 'x',
      authSign: api.md5('keya=xb=2c=3secret'),
      authAppkey: 'key',
    });
  });

  it('signs in as the same client at every start', () => {
    expect(api.clientIdOf('Owner@Example.com ')).toBe(api.clientIdOf('owner@example.com'));
    expect(api.clientIdOf('owner@example.com')).toMatch(/^[A-Z0-9]{8}$/u);
  });

  it('reads the data out of a command answer, and says when the robot does not know it', () => {
    expect(
      api.dataOfReply('getBattery', {
        ret: 'ok',
        resp: JSON.stringify({ body: { code: 0, data: { value: 50 } } }),
      }),
    ).toEqual({ value: 50 });
    expect(() =>
      api.dataOfReply('clean_V2', { ret: 'ok', resp: JSON.stringify({ body: { code: 20003 } }) }),
    ).toThrow(expect.objectContaining({ kind: 'unsupported' }));
  });
});

describe('signing in', () => {
  /** What each step is handed beside its arguments. */
  const step = { signal: new AbortController().signal };

  it('connects with the password alone, keeping the session and the credentials', async () => {
    vi.stubGlobal('fetch', servers().fetch);

    await expect(signIn.default(sdkWith([])).signIn(SETTINGS, step)).resolves.toMatchObject({
      kind: 'connected',
      identity: { id: 'uid-1', label: 'owner@example.com' },
      session: { uid: 'uid-1', accessToken: 'access-1', userId: 'user-1', token: 'token-1' },
    });
  });

  it('asks for the emailed code, emailing it once however often it is tried', async () => {
    const fake = servers();

    fake.loginCode = '1013';
    vi.stubGlobal('fetch', fake.fetch);

    const module = signIn.default(sdkWith([]));
    const first = await module.signIn(SETTINGS, step);
    const again = await module.signIn(SETTINGS, step);

    expect(first).toMatchObject({
      kind: 'ask',
      message: expect.stringMatching(/emailed a code to ow…@example\.com/u) as unknown,
      fields: [expect.objectContaining({ key: 'code', isRequired: true }) as unknown],
    });
    expect(again).toMatchObject({
      kind: 'ask',
      message: expect.stringMatching(/minutes ago/u) as unknown,
    });

    const emails = fake.asked.filter((each) => each.url.pathname.endsWith('sendEmailVerifyCode'));

    expect(emails).toHaveLength(1);
    // The email goes encrypted with ECOVACS's key.
    expect(
      privateDecrypt(
        { key: KEYS.privateKey, padding: constants.RSA_PKCS1_PADDING },
        Buffer.from(emails[0]?.url.searchParams.get('encryptEmail') ?? '', 'base64'),
      ).toString(),
    ).toBe('owner@example.com');
  });

  it('confirms the client with the code, and connects', async () => {
    const fake = servers();

    fake.loginCode = '1013';
    vi.stubGlobal('fetch', fake.fetch);

    const module = signIn.default(sdkWith([]));
    const asked = await module.signIn(SETTINGS, step);

    if (asked.kind !== 'ask') {
      throw new Error('not asked');
    }

    await expect(module.answer(asked.pending, { code: ' 123456 ' }, step)).resolves.toMatchObject({
      kind: 'connected',
      session: { accessToken: 'access-2' },
    });
    expect(
      fake.asked
        .find((each) => each.url.pathname.endsWith('verifyDevice'))
        ?.url.searchParams.get('verifyCode'),
    ).toBe('123456');
  });

  it('asks again for a code ECOVACS does not take, and says why a password is refused', async () => {
    const fake = servers();

    fake.loginCode = '1013';
    fake.verifyCode = '1012';
    vi.stubGlobal('fetch', fake.fetch);

    const module = signIn.default(sdkWith([]));
    const asked = await module.signIn(SETTINGS, step);

    if (asked.kind !== 'ask') {
      throw new Error('not asked');
    }

    await expect(module.answer(asked.pending, { code: '000000' }, step)).resolves.toMatchObject({
      kind: 'ask',
      message: expect.stringMatching(/did not take that code/u) as unknown,
    });

    fake.loginCode = '1005';

    await expect(module.signIn(SETTINGS, step)).resolves.toMatchObject({
      kind: 'failed',
      field: 'password',
    });
  });
});

describe('the account, once connected', () => {
  it('goes straight to the robots while the credentials kept hold', async () => {
    const fake = servers();

    vi.stubGlobal('fetch', fake.fetch);

    await account.accountFor(handleWith()).devices();

    expect(paths(fake)).toEqual(['/api/users/user.do', '/api/appsvr/app.do']);
  });

  it('renews run-out credentials from the session, and keeps what it got', async () => {
    const fake = servers();
    const handle = handleWith({ expiresAtMs: 0 });

    vi.stubGlobal('fetch', fake.fetch);

    await account.accountFor(handle).devices();

    expect(paths(fake).some((each) => each.endsWith('/user/checkLogin'))).toBe(true);
    expect(paths(fake).some((each) => each.endsWith('/user/login'))).toBe(false);
    expect(handle.update).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-3', token: 'token-1' }),
    );
  });

  it('says the owner has to sign in again when ECOVACS wants the code once more', async () => {
    const fake = servers();
    const handle = handleWith({ expiresAtMs: 0 });

    fake.checkLoginCode = '3000';
    fake.loginCode = '1013';
    vi.stubGlobal('fetch', fake.fetch);

    await expect(account.accountFor(handle).devices()).rejects.toThrow(/confirm the sign-in/u);
    expect(handle.needsSignIn).toHaveBeenCalledWith(expect.stringMatching(/ow…@example\.com/u));
    // Nothing is emailed without the owner asking.
    expect(paths(fake).some((each) => each.endsWith('sendEmailVerifyCode'))).toBe(false);
  });
});

describe('the robots, followed', () => {
  /**
   * A connection that follows some robots on the account.
   *
   * @param fake - The servers.
   * @param dids - The robots.
   * @returns The connection, what it delivered and its MQTT session.
   */
  async function following(
    fake: Servers,
    dids: readonly string[],
  ): Promise<{
    connection: TransportConnection;
    delivered: TransportInbound[];
    session: FakeMqtt;
  }> {
    const sessions: FakeMqtt[] = [];
    const delivered: TransportInbound[] = [];

    vi.stubGlobal('fetch', fake.fetch);

    const connection = await createTransport(sdkWith(sessions)).connect(
      { account: 'uid-1' },
      {
        logger: sdkWith([]).logger,
        account: handleWith(),
        deliver: (message) => {
          delivered.push(message);
        },
        report: vi.fn(),
      },
    );

    await connection.apply(dids.map((did) => ({ op: 'follow', args: { deviceKey: did } })));

    const [session] = sessions;

    if (session === undefined) {
      throw new Error('no session');
    }

    return { connection, delivered, session };
  }

  /**
   * The last state handed on for a device.
   *
   * @param delivered - What was handed on.
   * @param deviceKey - Which device.
   * @returns The payload.
   */
  function lastOf(delivered: TransportInbound[], deviceKey: string): Record<string, unknown> {
    return delivered.filter((each) => each.deviceKey === deviceKey).at(-1)?.payload as Record<
      string,
      unknown
    >;
  }

  it('says which account is not connected, rather than signing in', async () => {
    const context = { logger: sdkWith([]).logger, deliver: vi.fn(), report: vi.fn() };
    const transport = createTransport(sdkWith([]));

    await expect(transport.connect({ account: 'uid-1' }, context)).rejects.toThrow(
      /\(uid-1\) is not connected/u,
    );
    await expect(
      transport.connect(
        { account: 'uid-1' },
        { ...context, account: { ...handleWith(), status: 'needs-sign-in' } },
      ),
    ).rejects.toThrow(/needs signing in again/u);
  });

  it('opens the session with the credentials kept, reads a mower whole, and hears it push', async () => {
    const fake = servers();
    const { connection, delivered, session } = await following(fake, ['did-goat']);

    expect(paths(fake).some((each) => each.endsWith('/user/login'))).toBe(false);
    expect(session.options).toMatchObject({
      url: 'mqtts://mq-eu.ecouser.net:443',
      clientId: `user-1@ecouser/${api.clientIdOf(SETTINGS.email)}`,
      username: 'user-1',
      password: 'token-1',
      tls: { rejectUnauthorized: false },
    });
    expect(session.topics).toEqual(['iot/atr/+/did-goat/5xu9h3/ONb7/j']);
    expect(lastOf(delivered, 'did-goat')).toMatchObject({
      role: 'mower',
      name: 'Front lawn',
      model: 'g1-800',
      activity: 'docked',
      battery: 87,
      lifespans: { blade: 25 },
    });

    session.options.onMessage(
      'iot/atr/onBattery/did-goat/5xu9h3/ONb7/j',
      Buffer.from(JSON.stringify({ header: {}, body: { data: { value: 64 } } })),
    );

    expect(lastOf(delivered, 'did-goat')['battery']).toBe(64);

    await connection.close();
  });

  it('sends mowing in the other dialect when the mower does not know the first', async () => {
    const fake = servers();
    const { connection, delivered } = await following(fake, ['did-goat']);

    fake.refused.add('clean_V2');
    await connection.send(
      { deviceKey: 'did-goat', op: 'mow', args: { act: 'start' } },
      new AbortController().signal,
    );

    expect(controls(fake).slice(-2)).toEqual([
      { command: 'clean_V2', data: { act: 'start', content: { type: 'auto' }, bdTaskID: '4711' } },
      { command: 'clean', data: { act: 'start', content: { type: 'auto' } } },
    ]);
    expect(lastOf(delivered, 'did-goat')['activity']).toBe('mowing');

    await connection.close();
  });

  it('turns a setting into the command the app sends, and shows it at once', async () => {
    const fake = servers();
    const { connection, delivered } = await following(fake, ['did-goat']);

    await connection.send(
      { deviceKey: 'did-goat', op: 'set', args: { setting: 'rainDelay', value: 240 } },
      new AbortController().signal,
    );

    expect(controls(fake).at(-1)).toEqual({
      command: 'setRainDelay',
      data: { enable: 1, delay: 240, bdTaskID: '4711' },
    });
    expect(lastOf(delivered, 'did-goat')['settings']).toMatchObject({ rainDelay: 240 });

    await connection.close();
  });

  it('reads a vacuum whole, then its map, and hands the map on drawn', async () => {
    const fake = servers();
    const { connection, delivered } = await following(fake, ['did-deebot']);

    expect(lastOf(delivered, 'did-deebot')).toMatchObject({
      role: 'vacuum',
      model: 'x1-omni',
      product: 'DEEBOT X1 OMNI',
      activity: 'cleaning',
      settings: { suction: 'max', water: 'medium' },
      lifespans: { brush: 50, sideBrush: 25, filter: 75 },
      totals: { area: 1200, count: 88 },
      wifi: { ssid: 'Home' },
    });

    await vi.waitFor(() => {
      expect(lastOf(delivered, 'did-deebot')['mapSvg']).toContain('<circle cx="420"');
    });

    const payload = lastOf(delivered, 'did-deebot');

    expect(payload['rooms']).toEqual([
      { id: '1', name: 'Kitchen <&>' },
      { id: '2', name: 'Bedroom' },
    ]);
    // What the map is drawn from stays with the transport.
    expect(payload).not.toHaveProperty('map');
    expect(controls(fake, 'did-deebot').map((each) => each.command)).toEqual(
      expect.arrayContaining(['getMapSubSet', 'getMinorMap', 'getPos', 'getMapTrace']),
    );
    expect(
      controls(fake, 'did-deebot').find((each) => each.command === 'getMinorMap')?.data,
    ).toEqual({ mid: '7', type: 'ol', pieceIndex: 36 });

    await connection.close();
  });

  it('reads the virtual walls, and the outline from a robot that sends no pieces', async () => {
    const fake = servers();

    fake.refused.add('getMajorMap');

    const { connection, delivered } = await following(fake, ['did-deebot']);

    await vi.waitFor(() => {
      expect(lastOf(delivered, 'did-deebot')['mapSvg']).toContain('stroke="#2f4a73"');
    });

    const sent = controls(fake, 'did-deebot');

    expect(sent).toEqual(
      expect.arrayContaining([
        { command: 'getMapSet', data: { mid: '7', type: 'vw' } },
        { command: 'getMapSet', data: { mid: '7', type: 'mw' } },
        { command: 'getMapSubSet', data: { mid: '7', mssid: '3', type: 'vw' } },
        { command: 'getMapInfo_V2', data: { mid: '7', type: '0' } },
      ]),
    );
    expect(sent.some((each) => each.command === 'getMinorMap')).toBe(false);
    expect(lastOf(delivered, 'did-deebot')['mapSvg']).toContain('stroke="#e5484d"');

    await connection.close();
  });

  it('carries on a job a fault stopped, keeping the path it had', async () => {
    const fake = servers();
    const { connection, delivered, session } = await following(fake, ['did-deebot']);

    await vi.waitFor(() => {
      expect(lastOf(delivered, 'did-deebot')['mapSvg']).toBeDefined();
    });
    session.options.onMessage(
      'iot/atr/onError/did-deebot/p95mgv/XyZ1/j',
      Buffer.from(JSON.stringify({ body: { data: { code: [102] } } })),
    );

    expect(lastOf(delivered, 'did-deebot')).toMatchObject({
      activity: 'error',
      isResumable: true,
    });

    await connection.send(
      { deviceKey: 'did-deebot', op: 'clean', args: { act: 'resume' } },
      new AbortController().signal,
    );

    expect(controls(fake, 'did-deebot').at(-1)).toEqual({
      command: 'clean_V2',
      data: { act: 'resume', content: { type: 'auto' } },
    });
    expect(lastOf(delivered, 'did-deebot')).toMatchObject({
      activity: 'cleaning',
      isResumable: true,
    });

    await connection.send(
      { deviceKey: 'did-deebot', op: 'clean', args: { act: 'stop' } },
      new AbortController().signal,
    );

    expect(lastOf(delivered, 'did-deebot')).toMatchObject({ activity: 'idle', isResumable: false });

    await connection.close();
  });

  it('cleans the rooms asked for, and moves the robot on the map as it pushes', async () => {
    const fake = servers();
    const { connection, delivered, session } = await following(fake, ['did-deebot']);

    await vi.waitFor(() => {
      expect(lastOf(delivered, 'did-deebot')['mapSvg']).toBeDefined();
    });
    await connection.send(
      { deviceKey: 'did-deebot', op: 'clean', args: { act: 'rooms', rooms: ['1', '2'] } },
      new AbortController().signal,
    );

    expect(controls(fake, 'did-deebot').at(-1)).toEqual({
      command: 'clean_V2',
      data: { act: 'start', content: { type: 'spotArea', value: '1,2' } },
    });

    session.options.onMessage(
      'iot/atr/onPos/did-deebot/p95mgv/XyZ1/j',
      Buffer.from(JSON.stringify({ body: { data: { deebotPos: { x: 2000, y: -1000, a: 0 } } } })),
    );

    expect(lastOf(delivered, 'did-deebot')['mapSvg']).toContain('<circle cx="440" cy="420"');

    await connection.close();
  });

  it('finds the robots on the account a scan is handed', async () => {
    vi.stubGlobal('fetch', servers().fetch);

    const found = [];

    for await (const each of createTransport(sdkWith([])).scan(
      { account: 'uid-1' },
      { role: 'vacuum' },
      new AbortController().signal,
      { account: handleWith() },
    )) {
      found.push(each);
    }

    expect(found).toEqual([
      {
        deviceKey: 'did-deebot',
        payload: {
          role: 'vacuum',
          did: 'did-deebot',
          name: 'Hall',
          model: 'x1-omni',
          product: 'DEEBOT X1 OMNI',
        },
      },
    ]);
  });
});

describe('the listener', () => {
  it('reports each GOAT and DEEBOT on every account, and says why the rest are not', async () => {
    vi.stubGlobal('fetch', servers().fetch);

    const listener = createDiscovery(sdkWith([]));
    const abort = new AbortController();
    const heard: Sighting[] = [];
    const passedOver = vi.fn();

    for await (const sighting of listener.listen(abort.signal, {
      settings: async () => Promise.resolve({}),
      accounts: async () => Promise.resolve([handleWith()]),
      passedOver,
    })) {
      heard.push(sighting);

      if (heard.length === 2) {
        abort.abort();
      }
    }

    expect(heard.map((each) => [each.config, each.payload['role'], each.payload['model']])).toEqual(
      [
        [{ account: 'uid-1', did: 'did-goat' }, 'mower', 'g1-800'],
        [{ account: 'uid-1', did: 'did-deebot' }, 'vacuum', 'x1-omni'],
      ],
    );
    expect(passedOver).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'did-airbot', name: 'Bedroom air', model: 'AIRBOT Z1' }),
    ]);
  });
});

/**
 * The integration the hub builds from one of the drivers.
 *
 * @param driver - `mower` or `vacuum`.
 * @param deviceKey - The robot it is for.
 * @returns The integration, and the ids the hub would give its entities.
 */
async function driverOf(
  driver: string,
  deviceKey: string,
): Promise<{
  integration: Integration;
  context: MappingContext;
  ids: Map<string, EntityId>;
}> {
  const manifest = resolveManifest(
    vendorManifestSchema.parse(
      JSON.parse(await readFile(path.join(BUNDLE, 'manifest.json'), 'utf8')),
    ),
    driverManifestSchema.parse(
      JSON.parse(await readFile(path.join(BUNDLE, driver, 'driver.json'), 'utf8')),
    ),
  );
  const profile = integrationProfileSchema.parse(
    JSON.parse(await readFile(path.join(BUNDLE, driver, 'profile.json'), 'utf8')),
  );
  const ids = new Map(
    profile.entities.map((entity): [string, EntityId] => [
      entity.objectId ?? entity.domain,
      parseEntityId(`${entity.domain}.robot_${entity.objectId ?? entity.domain}`),
    ]),
  );
  const integration = createDeclarativeIntegration(manifest, profile);

  return {
    integration,
    ids,
    context: {
      options: {},
      claim: { deviceKey, externalId: deviceKey, descriptor: {} },
      entities: ids,
      lastState: (): CapabilityState | undefined => undefined,
    },
  };
}

/**
 * An entity's id, for a test that knows it is there.
 *
 * @param ids - The ids.
 * @param objectId - The entity.
 * @returns Its id.
 */
function idOf(ids: Map<string, EntityId>, objectId: string): EntityId {
  return ids.get(objectId) ?? parseEntityId('x.x');
}

describe("the mower's profile", () => {
  it('reads the mower, its settings and its job out of the state handed on', async () => {
    const { integration, context, ids } = await driverOf('mower', 'did-goat');
    const state = mower.applyReport(mower.emptyState(), 'getInfo', GROUPED);
    const reports = new Map(
      integration
        .toState({ connectionKey: 'ecovacs', deviceKey: 'did-goat', payload: state }, context)
        .map((report) => [report.entityId, report.state]),
    );

    expect(reports.get(idOf(ids, 'mower'))).toEqual({
      lawn_mower: { activity: 'docked', isResumable: false },
    });
    expect(reports.get(idOf(ids, 'mowing_efficiency'))).toEqual({ select: { option: 'delicate' } });
    expect(reports.get(idOf(ids, 'rain_delay'))).toEqual({ number: { value: 180 } });
    expect(reports.get(idOf(ids, 'rain_sensor'))).toEqual({ on_off: { isOn: true } });
    expect(reports.get(idOf(ids, 'mowed_area'))).toEqual({ sensor_numeric: { value: 126.91 } });
    // Not known yet: not reported, rather than reported as nothing.
    expect(reports.has(idOf(ids, 'wifi_network'))).toBe(false);
  });

  it('asks the transport for a setting by its name', async () => {
    const { integration, context, ids } = await driverOf('mower', 'did-goat');

    expect(
      integration.toCommand(
        {
          entityId: idOf(ids, 'obstacle_avoidance'),
          capability: 'select',
          command: { command: 'select_option', option: 'general' },
        },
        context,
      ),
    ).toEqual({
      deviceKey: 'did-goat',
      op: 'set',
      args: { setting: 'obstacleAvoidance', value: 'general' },
    });
    expect(
      integration.toCommand(
        { entityId: idOf(ids, 'mower'), capability: 'lawn_mower', command: { command: 'dock' } },
        context,
      ),
    ).toEqual({ deviceKey: 'did-goat', op: 'mow', args: { act: 'dock' } });
    expect(
      integration.toCommand(
        { entityId: idOf(ids, 'mower'), capability: 'lawn_mower', command: { command: 'resume' } },
        context,
      ),
    ).toEqual({ deviceKey: 'did-goat', op: 'mow', args: { act: 'resume' } });
  });
});

describe("the vacuum's profile", () => {
  it('reads the vacuum and its rooms, and hands the map over as a picture', async () => {
    const { integration, context, ids } = await driverOf('vacuum', 'did-deebot');
    const state = vacuum.applyReport(
      vacuum.applyReport(vacuum.emptyState(), 'getInfo', VACUUM_GROUPED),
      'getMapSet',
      vacuumAnswer('getMapSet', {}),
    );
    const payload = Object.fromEntries(Object.entries(state).filter(([name]) => name !== 'map'));
    const reports = integration.toState(
      {
        connectionKey: 'ecovacs',
        deviceKey: 'did-deebot',
        payload: { ...payload, mapSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      },
      context,
    );
    const byId = new Map(reports.map((report) => [report.entityId, report]));

    expect(byId.get(idOf(ids, 'vacuum'))?.state).toEqual({
      vacuum: {
        activity: 'cleaning',
        rooms: [
          { id: '1', name: 'Kitchen <&>' },
          { id: '2', name: 'Bedroom' },
        ],
        isResumable: true,
      },
    });
    expect(byId.get(idOf(ids, 'suction'))?.state).toEqual({ select: { option: 'max' } });
    expect(byId.get(idOf(ids, 'map'))).toMatchObject({
      state: { image: { contentType: 'image/svg+xml' } },
      blob: { contentType: 'image/svg+xml', minIntervalMs: 5000 },
    });
  });

  it('asks the transport to clean the rooms picked', async () => {
    const { integration, context, ids } = await driverOf('vacuum', 'did-deebot');

    expect(
      integration.toCommand(
        {
          entityId: idOf(ids, 'vacuum'),
          capability: 'vacuum',
          command: { command: 'clean_rooms', rooms: ['1', '2'] },
        },
        context,
      ),
    ).toEqual({ deviceKey: 'did-deebot', op: 'clean', args: { act: 'rooms', rooms: ['1', '2'] } });
  });
});
