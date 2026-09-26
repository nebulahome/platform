/**
 * The RTSP client: putting H.264 back together from RTP, and a whole session against a camera in
 * this process that asks for Digest credentials, as a Bambu Lab printer's does.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { codecOf, digestAuthorization, H264Depacketizer, openRtsp, videoTrackOf } from './rtsp.js';

/** A sequence parameter set: High profile, level 4.0. */
const SPS = new Uint8Array([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]);

/** A picture parameter set. */
const PPS = new Uint8Array([0x68, 0xeb, 0xe3, 0xcb]);

/** An IDR slice. */
const IDR = new Uint8Array([0x65, 0x88, 0x84, 0x00, 0x33, 0xff]);

/** A non-IDR slice. */
const SLICE = new Uint8Array([0x41, 0x9a, 0x21, 0x6c]);

/**
 * Annex B of some NAL units.
 *
 * @param nals - The units.
 * @returns Them, each after a start code.
 */
function annexB(...nals: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(nals.flatMap((nal) => [Buffer.from([0, 0, 0, 1]), nal])));
}

describe('H264Depacketizer', () => {
  it('gathers the NAL units of one picture until the marker, and hands them on in Annex B', () => {
    const depacketizer = new H264Depacketizer();

    expect(depacketizer.push(SPS, 1000, false)).toEqual([]);
    expect(depacketizer.push(PPS, 1000, false)).toEqual([]);

    const [unit] = depacketizer.push(IDR, 1000, true);

    expect(unit).toEqual({ data: annexB(SPS, PPS, IDR), isKey: true, timestamp: 1000 });
    expect(depacketizer.codec).toBe('avc1.640028');
  });

  it('puts a unit split across packets (FU-A) back together', () => {
    const depacketizer = new H264Depacketizer();
    const indicator = ((IDR[0] ?? 0) & 0xe0) | 28;
    const type = (IDR[0] ?? 0) & 0x1f;
    const first = new Uint8Array([indicator, 0x80 | type, ...IDR.subarray(1, 3)]);
    const last = new Uint8Array([indicator, 0x40 | type, ...IDR.subarray(3)]);

    depacketizer.push(first, 2000, false);

    const [unit] = depacketizer.push(last, 2000, true);

    expect(unit?.data).toEqual(annexB(IDR));
    expect(unit?.isKey).toBe(true);
  });

  it('splits units carried together (STAP-A), and gives a key frame the parameter sets it lacks', () => {
    const depacketizer = new H264Depacketizer([SPS, PPS]);
    const stap = new Uint8Array([24, 0, IDR.length, ...IDR, 0, SLICE.length, ...SLICE]);

    const [unit] = depacketizer.push(stap, 3000, true);

    expect(unit?.data).toEqual(annexB(SPS, PPS, IDR, SLICE));
  });

  it('closes a picture whose marker was lost when the next one starts', () => {
    const depacketizer = new H264Depacketizer([SPS, PPS]);

    depacketizer.push(SLICE, 4000, false);

    const done = depacketizer.push(SLICE, 7000, true);

    expect(done.map((unit) => unit.timestamp)).toEqual([4000, 7000]);
    expect(done.every((unit) => !unit.isKey)).toBe(true);
  });
});

describe('the session description', () => {
  it('finds the H.264 track, its payload type, its control and its parameter sets', () => {
    const sdp = [
      'v=0',
      'm=audio 0 RTP/AVP 97',
      'a=control:trackID=0',
      'm=video 0 RTP/AVP 96',
      'a=rtpmap:96 H264/90000',
      `a=fmtp:96 packetization-mode=1;sprop-parameter-sets=${Buffer.from(SPS).toString('base64')},${Buffer.from(PPS).toString('base64')}`,
      'a=control:trackID=1',
    ].join('\r\n');

    const track = videoTrackOf(sdp, 'rtsps://camera:322/streaming/live/1/');

    expect(track?.payloadType).toBe(96);
    expect(track?.control).toBe('rtsps://camera:322/streaming/live/1/trackID=1');
    expect(track?.parameterSets).toEqual([SPS, PPS]);
    expect(codecOf(SPS)).toBe('avc1.640028');
  });
});

/** The fake camera and what it was asked. */
let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();

      return;
    }

    server.close(() => {
      resolve();
    });
  });
  server = undefined;
});

describe('openRtsp', () => {
  it('answers a Digest challenge, sets the track up interleaved, plays, and yields pictures', async () => {
    const asked: string[] = [];
    const realm = 'BambuCamera';
    const nonce = 'abc123';
    const sdp = [
      'v=0',
      'm=video 0 RTP/AVP 96',
      'a=rtpmap:96 H264/90000',
      `a=fmtp:96 sprop-parameter-sets=${Buffer.from(SPS).toString('base64')},${Buffer.from(PPS).toString('base64')}`,
      'a=control:trackID=1',
    ].join('\r\n');

    /**
     * Sends one RTP packet, interleaved on channel 0.
     *
     * @param socket - The connection.
     * @param payload - The payload.
     * @param timestamp - The RTP timestamp.
     * @param isMarked - The marker bit.
     */
    const rtp = (
      socket: Socket,
      payload: Uint8Array,
      timestamp: number,
      isMarked: boolean,
    ): void => {
      const header = Buffer.alloc(12);

      header[0] = 0x80;
      header[1] = (isMarked ? 0x80 : 0) | 96;
      header.writeUInt32BE(timestamp, 4);

      const packet = Buffer.concat([header, payload]);
      const frame = Buffer.alloc(4);

      frame[0] = 0x24;
      frame[1] = 0;
      frame.writeUInt16BE(packet.length, 2);
      socket.write(Buffer.concat([frame, packet]));
    };

    server = createServer((socket) => {
      let text = '';

      // The client drops the connection when it has what it wants.
      socket.on('error', () => undefined);

      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');

        for (;;) {
          const end = text.indexOf('\r\n\r\n');

          if (end === -1) {
            return;
          }

          const request = text.slice(0, end);

          text = text.slice(end + 4);

          const [line = ''] = request.split('\r\n');
          const [method = '', uri = ''] = line.split(' ');
          const cseq = /CSeq: (\d+)/u.exec(request)?.[1] ?? '0';
          const authorization = /Authorization: (.*)/u.exec(request)?.[1];

          asked.push(method);

          const md5 = (value: string): string => createHash('md5').update(value).digest('hex');
          const expected = md5(
            `${md5(`bblp:${realm}:12345678`)}:${nonce}:${md5(`${method}:${uri}`)}`,
          );

          if (authorization?.includes(`response="${expected}"`) !== true) {
            socket.write(
              `RTSP/1.0 401 Unauthorized\r\nCSeq: ${cseq}\r\nWWW-Authenticate: Digest realm="${realm}", nonce="${nonce}"\r\n\r\n`,
            );
            continue;
          }

          if (method === 'DESCRIBE') {
            socket.write(
              `RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nContent-Base: ${uri}/\r\nContent-Length: ${String(Buffer.byteLength(sdp))}\r\n\r\n${sdp}`,
            );
          } else if (method === 'SETUP') {
            socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nSession: 42;timeout=60\r\n\r\n`);
          } else if (method === 'PLAY') {
            socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nSession: 42\r\n\r\n`);
            rtp(socket, IDR, 90_000, true);
            rtp(socket, SLICE, 93_000, true);
          } else {
            socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\n\r\n`);
          }
        }
      });
    });

    const port = await new Promise<number>((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();

        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
    const abort = new AbortController();
    const frames = [];

    for await (const frame of openRtsp({
      url: `rtsp://bblp:12345678@127.0.0.1:${String(port)}/streaming/live/1`,
      signal: abort.signal,
    })) {
      frames.push(frame);

      if (frames.length === 2) {
        abort.abort();
      }
    }

    expect(asked.slice(0, 4)).toEqual(['DESCRIBE', 'DESCRIBE', 'SETUP', 'PLAY']);
    expect(frames).toEqual([
      { codec: 'avc1.640028', data: annexB(SPS, PPS, IDR), isKey: true, timestampUs: 0 },
      { codec: 'avc1.640028', data: annexB(SLICE), isKey: false, timestampUs: 33_333 },
    ]);
  });

  it('answers a challenge the way the Digest scheme says', () => {
    const header = digestAuthorization(
      'Digest realm="r", nonce="n"',
      'DESCRIBE',
      'rtsp://h/p',
      'u',
      'p',
    );
    const md5 = (value: string): string => createHash('md5').update(value).digest('hex');

    expect(header).toContain(
      `response="${md5(`${md5('u:r:p')}:n:${md5('DESCRIBE:rtsp://h/p')}`)}"`,
    );
  });
});
