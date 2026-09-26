/**
 * The camera player: it authenticates first, says why it cannot play, and starts decoding only at
 * a key frame - against a fake socket and a fake of the browser's video decoder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeCameraFrame } from '@nebula-home/contracts';

import { CameraPlayer, type CameraCanvas, type CameraSocket } from './camera-player';

/** A socket the test drives. */
type FakeSocket = CameraSocket & { readonly sent: string[]; closed: boolean };

/**
 * Makes a socket the test drives.
 *
 * @returns The socket.
 */
function fakeSocket(): FakeSocket {
  const socket = {
    binaryType: 'blob' as BinaryType,
    readyState: 1,
    sent: [] as string[],
    closed: false,
    send(data: string): void {
      socket.sent.push(data);
    },
    close(): void {
      socket.closed = true;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  return socket as unknown as FakeSocket;
}

/** A canvas that draws nowhere. */
const CANVAS: CameraCanvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }) };

/**
 * Starts a player on a fake socket.
 *
 * @returns The player, its socket, and what it said.
 */
function started(): {
  readonly player: CameraPlayer;
  readonly socket: FakeSocket;
  readonly statuses: string[];
} {
  const socket = fakeSocket();
  const statuses: string[] = [];
  const player = new CameraPlayer({
    url: 'ws://house/api/v1/cameras/camera.printer_chamber/live',
    readAccessToken: () => 'token-1',
    canvas: CANVAS,
    onStatus: (status, message) => {
      statuses.push(message === undefined ? status : `${status}: ${message}`);
    },
    openSocket: () => socket,
  });

  player.start();
  (socket.onopen as (() => void) | null)?.();

  return { player, socket, statuses };
}

/**
 * Sends the player a text message.
 *
 * @param socket - The socket.
 * @param message - The message.
 */
function say(socket: FakeSocket, message: unknown): void {
  (socket.onmessage as ((event: { data: unknown }) => void) | null)?.({
    data: JSON.stringify(message),
  });
}

/**
 * Sends the player a frame.
 *
 * @param socket - The socket.
 * @param isKey - Whether it is a key frame.
 */
function frame(socket: FakeSocket, isKey: boolean): void {
  const bytes = encodeCameraFrame({
    isKey,
    timestampUs: 0,
    data: new Uint8Array([0, 0, 0, 1, 0x65]),
  });

  (socket.onmessage as ((event: { data: unknown }) => void) | null)?.({
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CameraPlayer', () => {
  it('authenticates with its first message, with no token in the address', () => {
    const { socket, statuses } = started();

    expect(socket.sent).toEqual([JSON.stringify({ type: 'auth', token: 'token-1' })]);
    expect(statuses).toEqual(['connecting']);
  });

  it('says why the server would not play', () => {
    const { socket, statuses } = started();

    say(socket, { type: 'error', message: 'No camera has that id' });

    expect(statuses.at(-1)).toBe('error: No camera has that id');
  });

  it('says so when the browser cannot decode the video', async () => {
    vi.stubGlobal('VideoDecoder', undefined);

    const { socket, statuses } = started();

    say(socket, { type: 'init', track: { kind: 'h264', codec: 'avc1.640028' } });
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toMatch(/^unsupported/u);
    });
  });

  it('decodes nothing before a key frame, and everything from one on', async () => {
    const decoded: string[] = [];

    /** A decoder that records what it is fed. */
    class FakeDecoder {
      public state = 'unconfigured';
      public decodeQueueSize = 0;

      /**
       * Checks a configuration.
       *
       * @returns That it is supported.
       */
      public static isConfigSupported(): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: true });
      }

      /** Takes a configuration. */
      public configure(): void {
        this.state = 'configured';
      }

      /**
       * Takes a chunk.
       *
       * @param chunk - The chunk.
       * @param chunk.type - Key or delta.
       */
      public decode(chunk: { type: string }): void {
        decoded.push(chunk.type);
      }

      /** Lets go. */
      public close(): void {
        this.state = 'closed';
      }
    }

    vi.stubGlobal('VideoDecoder', FakeDecoder);
    vi.stubGlobal(
      'EncodedVideoChunk',
      class {
        public readonly type: string;

        /**
         * Holds a chunk's type.
         *
         * @param init - The chunk.
         * @param init.type - Key or delta.
         */
        public constructor(init: { type: string }) {
          this.type = init.type;
        }
      },
    );

    const { socket, player } = started();

    say(socket, { type: 'init', track: { kind: 'h264', codec: 'avc1.640028' } });
    await vi.waitFor(() => {
      frame(socket, false);
      expect(decoded.length).toBe(0);
      frame(socket, true);
      expect(decoded).toEqual(['key']);
    });
    frame(socket, false);

    expect(decoded).toEqual(['key', 'delta']);
    player.stop();
    expect(socket.closed).toBe(true);
  });
});
