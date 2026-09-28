/**
 * The Bambu Lab camera and discovery modules, against fakes of what a printer sends.
 *
 * The still camera of a P1 or an A1 is played by a TLS server that checks the greeting and sends
 * pictures the way the printer frames them; the RTSP camera of the others is played by a fake of
 * the RTSP client, since that client has tests of its own. Discovery is fed the announcements
 * printers make, word for word.
 */
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createServer, type Server, type TLSSocket } from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '@nebula-home/logging';
import type {
  BundleSdk,
  DiscoverySource,
  ManagedUdpSocketOptions,
  OpenRtsp,
  RtspFrame,
  Sighting,
  StreamFactory,
  StreamFrame,
  StreamTrack,
} from '@nebula-home/package-runtime';

import { createUdpSockets } from '../transports/managed-udp.js';

import { createBundleSdk } from './bundle-sdk.js';

/** A vendor with nothing saved: what a listener that needs no settings is handed. */
const NO_SETTINGS = { settings: async (): Promise<Record<string, never>> => Promise.resolve({}) };

/** The bundle, where the service reads it from. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/bambu-lab');

/** The certificate the fake printer presents, signed by nobody, as the real one's is. */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../transports/fixtures');

/** What the camera module exports besides its factory. */
type CameraModule = {
  readonly default: StreamFactory;
  readonly stillGreeting: (accessCode: string) => Buffer;
  readonly cutStills: (buffer: Buffer) => { readonly pictures: Buffer[]; readonly rest: Buffer };
};

/** What the discovery module exports besides its factory. */
type DiscoveryModule = {
  readonly default: (sdk: BundleSdk) => DiscoverySource;
  readonly announcementOf: (
    text: string,
    from: string,
  ) =>
    { host: string; serial: string; model?: string; name?: string; version?: string } | undefined;
};

const camera = (await import(
  pathToFileURL(path.join(BUNDLE, 'camera/stream.js')).href
)) as CameraModule;
const discovery = (await import(
  pathToFileURL(path.join(BUNDLE, 'lan/discovery.js')).href
)) as DiscoveryModule;

const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });

/** The access code the fake printer takes. */
const CODE = '12345678';

/**
 * A picture framed the way the printer sends it: a 16-byte header whose first bytes are the
 * length, then the JPEG.
 *
 * @param body - What the picture holds between its markers.
 * @returns The frame.
 */
function framed(body: number): Buffer {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, body, 0xff, 0xd9]);
  const header = Buffer.alloc(16);

  header.writeUInt32LE(jpeg.length, 0);

  return Buffer.concat([header, jpeg]);
}

/**
 * Builds the SDK, with the RTSP client replaced when a test says.
 *
 * @param openRtsp - The RTSP client to hand the module.
 * @returns The SDK.
 */
function sdkWith(openRtsp?: OpenRtsp): BundleSdk {
  const sdk = createBundleSdk({
    version: '1.2.0',
    logger,
    openUdpSocket: createUdpSockets(logger).open,
    platform: { mqtt: null },
  });

  return openRtsp === undefined ? sdk : { ...sdk, openRtsp };
}

/** What a stream handed over. */
type Collected = { tracks: StreamTrack[]; frames: StreamFrame[] };

/**
 * A sink that keeps what it is handed, and ends the stream after so many frames.
 *
 * @param abort - Ends the stream.
 * @param enough - How many frames to take.
 * @returns The sink, and what it kept.
 */
function collecting(
  abort: AbortController,
  enough: number,
): { readonly sink: Parameters<ReturnType<StreamFactory>['open']>[2]; readonly kept: Collected } {
  const kept: Collected = { tracks: [], frames: [] };

  return {
    kept,
    sink: {
      describe: (track) => {
        kept.tracks.push(track);
      },
      frame: (frame) => {
        kept.frames.push(frame);

        if (kept.frames.length >= enough) {
          abort.abort();
        }
      },
    },
  };
}

describe('the still camera protocol', () => {
  it('greets with the user and the access code, each padded to 32 bytes', () => {
    const greeting = camera.stillGreeting(CODE);

    expect(greeting.length).toBe(80);
    expect(greeting.readUInt32LE(0)).toBe(0x40);
    expect(greeting.readUInt32LE(4)).toBe(0x3000);
    expect(greeting.subarray(8, 16).every((byte) => byte === 0)).toBe(true);
    expect(greeting.subarray(16, 20).toString('ascii')).toBe('bblp');
    expect(greeting.subarray(20, 48).every((byte) => byte === 0)).toBe(true);
    expect(greeting.subarray(48, 56).toString('ascii')).toBe(CODE);
  });

  it('cuts whole pictures and keeps the one still arriving', () => {
    const stream = Buffer.concat([framed(1), framed(2)]);
    const cut = camera.cutStills(stream.subarray(0, stream.length - 3));

    expect(cut.pictures).toHaveLength(1);
    expect(cut.pictures[0]?.[4]).toBe(1);
    expect(cut.rest.length).toBe(stream.length - 3 - framed(1).length);
  });

  it('refuses a header naming a length no picture has', () => {
    const header = Buffer.alloc(16);

    header.writeUInt32LE(0, 0);

    expect(() => camera.cutStills(header)).toThrow(/0 bytes/u);
  });
});

describe('the still camera, against a fake printer', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => {
      if (server === undefined) {
        resolve(undefined);
      } else {
        server.close(resolve);
      }
    });
    server = undefined;
  });

  /**
   * Starts a printer that checks the greeting and then does what the test says.
   *
   * @param onGreeted - What it does once greeted, with whether the greeting was right.
   * @returns Its port.
   */
  async function printer(
    onGreeted: (socket: TLSSocket, isRight: boolean) => void,
  ): Promise<number> {
    server = createServer(
      {
        key: readFileSync(path.join(FIXTURES, 'self-signed.key.pem')),
        cert: readFileSync(path.join(FIXTURES, 'self-signed.cert.pem')),
      },
      (socket) => {
        let received = Buffer.alloc(0);

        socket.on('error', () => undefined);
        socket.on('data', (chunk: Buffer) => {
          received = Buffer.concat([received, chunk]);

          if (received.length >= 80) {
            onGreeted(socket, received.subarray(0, 80).equals(camera.stillGreeting(CODE)));
          }
        });
      },
    );
    await new Promise((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        resolve(undefined);
      });
    });

    return (server.address() as AddressInfo).port;
  }

  it('reads the pictures a printer sends once greeted, one frame each', async () => {
    const port = await printer((socket, isRight) => {
      if (isRight) {
        const both = Buffer.concat([framed(1), framed(2)]);

        // Split mid-picture, as TLS records are.
        socket.write(both.subarray(0, 20));
        setTimeout(() => socket.write(both.subarray(20)), 20);
      } else {
        socket.destroy();
      }
    });
    const abort = new AbortController();
    const { sink, kept } = collecting(abort, 2);
    const source = camera.default(sdkWith());

    await source.open(
      { url: 'mqtts://127.0.0.1:8883', password: CODE },
      { kind: 'chamber-image', port },
      sink,
      abort.signal,
    );

    expect(kept.tracks).toEqual([{ kind: 'jpeg' }]);
    expect(kept.frames.map((frame) => [frame.data[4], frame.isKey])).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it('says to check the access code when the printer hangs up before a picture', async () => {
    const port = await printer((socket) => {
      socket.destroy();
    });
    const source = camera.default(sdkWith());
    const { sink } = collecting(new AbortController(), 1);

    await expect(
      source.open(
        { url: 'mqtts://127.0.0.1:8883', password: 'wrong123' },
        { kind: 'chamber-image', port },
        sink,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/access code/u);
  });
});

describe('the RTSP camera', () => {
  it('plays the printer on port 322 as bblp, and says the codec before the first frame', async () => {
    const asked: string[] = [];
    const frames: RtspFrame[] = [
      {
        data: new Uint8Array([0, 0, 0, 1, 0x67]),
        isKey: true,
        timestampUs: 0,
        codec: 'avc1.64001f',
      },
      {
        data: new Uint8Array([0, 0, 0, 1, 0x41]),
        isKey: false,
        timestampUs: 33_000,
        codec: 'avc1.64001f',
      },
    ];

    /**
     * Stands in for the RTSP client.
     *
     * @param options - What the module asked for.
     * @param options.url - The stream.
     * @yields {RtspFrame} The frames.
     */
    const openRtsp: OpenRtsp = async function* fake(options) {
      asked.push(options.url);
      await Promise.resolve();
      yield* frames;
    };
    const abort = new AbortController();
    const { sink, kept } = collecting(abort, 5);

    await camera
      .default(sdkWith(openRtsp))
      .open(
        { url: 'mqtts://192.168.1.60:8883', password: CODE },
        { kind: 'rtsp' },
        sink,
        abort.signal,
      );

    expect(asked).toEqual([`rtsps://bblp:${CODE}@192.168.1.60:322/streaming/live/1`]);
    expect(kept.tracks).toEqual([{ kind: 'h264', codec: 'avc1.64001f' }]);
    expect(kept.frames.map((frame) => frame.isKey)).toEqual([true, false]);
  });

  it('says to turn on LAN Mode Liveview when nothing listens on the port', async () => {
    /**
     * An RTSP client whose connection was refused.
     *
     * @yields {RtspFrame} Nothing.
     */
    const openRtsp: OpenRtsp = async function* refused() {
      await Promise.resolve();
      yield* [];
      throw new Error('connect ECONNREFUSED 192.168.1.60:322');
    };
    const { sink } = collecting(new AbortController(), 1);

    await expect(
      camera
        .default(sdkWith(openRtsp))
        .open(
          { url: 'mqtts://192.168.1.60:8883', password: CODE },
          { kind: 'rtsp' },
          sink,
          new AbortController().signal,
        ),
    ).rejects.toThrow(/LAN Mode Liveview/u);
  });
});

/** An announcement as a P1S makes it. */
const NOTIFY = [
  'NOTIFY * HTTP/1.1',
  'HOST: 239.255.255.250:1990',
  'Server: Buildroot/2018.02-rc3 UPnP/1.0 ssdpd/1.8',
  'Location: 192.168.1.60',
  'NT: urn:bambulab-com:device:3dprinter:1',
  'NTS: ssdp:alive',
  'USN: 01P00A123456789',
  'Cache-Control: max-age=1800',
  'DevModel.bambu.com: C12',
  'DevName.bambu.com: Workshop P1S',
  'DevConnect.bambu.com: lan',
  'DevBind.bambu.com: free',
  'DevVersion.bambu.com: 01.07.00.00',
  '',
  '',
].join('\r\n');

describe('finding printers', () => {
  it('reads what a printer says about itself', () => {
    expect(discovery.announcementOf(NOTIFY, '192.168.1.60')).toEqual({
      host: '192.168.1.60',
      serial: '01P00A123456789',
      model: 'C12',
      name: 'Workshop P1S',
      version: '01.07.00.00',
    });
  });

  it('ignores everybody else on the group', () => {
    const router = NOTIFY.replace('urn:bambulab-com:device:3dprinter:1', 'upnp:rootdevice').replace(
      'DevModel.bambu.com: C12\r\n',
      '',
    );

    expect(discovery.announcementOf(router, '192.168.1.1')).toBeUndefined();
    expect(discovery.announcementOf('M-SEARCH * HTTP/1.1\r\n\r\n', '192.168.1.2')).toBeUndefined();
  });

  it('reports a printer once however often it announces, with the broker it runs', async () => {
    const listeners: ManagedUdpSocketOptions[] = [];
    const sdk: BundleSdk = {
      ...sdkWith(),
      openUdpSocket: (options) => {
        listeners.push(options);

        return {
          port: options.port ?? 0,
          send: async () => Promise.resolve(),
          close: async () => Promise.resolve(),
        };
      },
    };
    const abort = new AbortController();
    const source = discovery.default(sdk);
    const sightings: Sighting[] = [];
    const listening = (async () => {
      for await (const sighting of source.listen(abort.signal, NO_SETTINGS)) {
        sightings.push(sighting);
      }
    })();

    await Promise.resolve();

    const from = { address: '192.168.1.60', port: 1990 };

    for (const listener of listeners) {
      listener.onMessage(Buffer.from(NOTIFY), from);
    }

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    await listening;

    expect(listeners.map((listener) => listener.port).sort()).toEqual([1990, 2021]);
    expect(sightings).toEqual([
      {
        config: { url: 'mqtts://192.168.1.60:8883' },
        payload: {
          serial: '01P00A123456789',
          host: '192.168.1.60',
          model: 'C12',
          name: 'Workshop P1S',
          version: '01.07.00.00',
        },
      },
    ]);
  });
});
