/**
 * An RTSP client that plays one H.264 stream over TCP and yields its access units.
 *
 * What a camera's stream source asks for when the camera speaks RTSP - a Bambu Lab X1 or H2 on
 * port 322, over TLS; most IP cameras on 554. Only what that takes: `DESCRIBE` for the session's
 * description, `SETUP` of its video track with the RTP interleaved on the same connection, `PLAY`,
 * a `GET_PARAMETER` every so often so the camera does not time the session out, and `TEARDOWN`
 * at the end. Basic and Digest authentication, from the credentials in the URL.
 *
 * RTP carries H.264 as NAL units, one per packet, several per packet (STAP-A) or one across
 * several (FU-A). They are put back together into access units - every NAL of one picture - and
 * handed on in Annex B, a start code before each NAL, which is what the browser's decoder takes
 * without further description. A key frame is preceded by the sequence and picture parameter
 * sets, from the stream when it sends them and from the description when it does not, so a
 * viewer joining at any key frame can start decoding. The codec string is read from the
 * sequence parameters.
 *
 * Nothing is decoded or transcoded here; nothing here depends on anything but Node.
 */
import { createHash } from 'node:crypto';
import { connect as connectTcp, isIP, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

import type { OpenRtsp, RtspFrame, RtspOptions } from '@nebula-home/package-runtime';

/** How long an answer to one request may take. */
const REQUEST_TIMEOUT_MS = 10_000;

/** How often the session is kept alive. */
const KEEPALIVE_MS = 25_000;

/** How long the stream may go without a packet before it is taken to have died. */
const SILENCE_MS = 15_000;

/** How many access units may wait for the reader before the oldest are dropped. */
const QUEUE_LIMIT = 30;

/** The start code before every NAL unit in Annex B. */
const START_CODE = new Uint8Array([0, 0, 0, 1]);

/** One RTSP response, headers lowercased. */
type Response = {
  readonly status: number;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
};

/** What the description says about the video track. */
export type VideoTrack = {
  /** Where to `SETUP` it. */
  readonly control: string;

  /** The RTP payload type it is sent as. */
  readonly payloadType: number;

  /** Its sequence and picture parameter sets, when the description carries them. */
  readonly parameterSets: readonly Uint8Array[];
};

/**
 * Reads the video track out of a session description.
 *
 * @param sdp - The description.
 * @param base - The URL relative controls are resolved against.
 * @returns The track, or undefined when there is no H.264 video in it.
 */
export function videoTrackOf(sdp: string, base: string): VideoTrack | undefined {
  const lines = sdp.split(/\r?\n/u);
  let isVideo = false;
  let payloadType: number | undefined;
  let control: string | undefined;
  let isH264 = false;
  let parameterSets: Uint8Array[] = [];

  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (isVideo && isH264) {
        break;
      }

      isVideo = line.startsWith('m=video');
      payloadType = isVideo ? Number(line.split(' ')[3]) : undefined;
      control = undefined;
      isH264 = false;
      parameterSets = [];
      continue;
    }

    if (!isVideo) {
      continue;
    }

    if (line.startsWith('a=rtpmap:') && /H264\/90000/iu.test(line)) {
      isH264 = true;
      payloadType = Number(line.slice('a=rtpmap:'.length).split(' ')[0]);
    } else if (line.startsWith('a=control:')) {
      control = line.slice('a=control:'.length).trim();
    } else if (line.startsWith('a=fmtp:')) {
      const sets = /sprop-parameter-sets=([^;\s]+)/u.exec(line)?.[1];

      parameterSets =
        sets === undefined
          ? []
          : sets.split(',').map((set) => new Uint8Array(Buffer.from(set, 'base64')));
    }
  }

  if (!isVideo || !isH264 || payloadType === undefined || Number.isNaN(payloadType)) {
    return undefined;
  }

  const resolved =
    control === undefined || control === '*'
      ? base
      : /^rtsps?:\/\//u.test(control)
        ? control
        : `${base.replace(/\/$/u, '')}/${control}`;

  return { control: resolved, payloadType, parameterSets };
}

/**
 * The codec string a decoder is configured with, from a sequence parameter set.
 *
 * @param sps - The SPS NAL unit, its header byte first.
 * @returns `avc1.PPCCLL`: profile, constraints and level, in hex.
 */
export function codecOf(sps: Uint8Array): string {
  /**
   * Writes a byte as two hexadecimal digits.
   *
   * @param byte - The byte, or nothing for a short SPS.
   * @returns The digits.
   */
  const hex = (byte: number | undefined): string => (byte ?? 0).toString(16).padStart(2, '0');

  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

/**
 * Puts RTP packets of H.264 back into access units.
 *
 * Fed one RTP payload at a time with its timestamp and marker; says when an access unit is
 * complete - at the marker, or when a new timestamp starts one - and what it is.
 */
export class H264Depacketizer {
  #nals: Uint8Array[] = [];
  #fragment: Uint8Array[] | undefined;
  #timestamp: number | undefined;
  #sps: Uint8Array | undefined;
  #pps: Uint8Array | undefined;

  /**
   * Starts with the parameter sets the description gave, if any.
   *
   * @param parameterSets - From the description's `sprop-parameter-sets`.
   */
  public constructor(parameterSets: readonly Uint8Array[] = []) {
    for (const set of parameterSets) {
      this.#remember(set);
    }
  }

  /**
   * The codec string, once the sequence parameters are known.
   *
   * @returns It, or undefined before them.
   */
  public get codec(): string | undefined {
    return this.#sps === undefined ? undefined : codecOf(this.#sps);
  }

  /**
   * Takes one packet's payload.
   *
   * @param payload - The RTP payload.
   * @param timestamp - The RTP timestamp, in 90 kHz ticks.
   * @param isMarked - Whether the marker bit was set: the last packet of a picture.
   * @returns The access units completed by it: none, or one; two when a new timestamp closed
   * one left open by a lost marker.
   */
  public push(
    payload: Uint8Array,
    timestamp: number,
    isMarked: boolean,
  ): { data: Uint8Array; isKey: boolean; timestamp: number }[] {
    const done: { data: Uint8Array; isKey: boolean; timestamp: number }[] = [];

    if (this.#timestamp !== undefined && timestamp !== this.#timestamp && this.#nals.length > 0) {
      const unit = this.#flush();

      if (unit !== undefined) {
        done.push(unit);
      }
    }

    this.#timestamp = timestamp;

    const type = (payload[0] ?? 0) & 0x1f;

    if (type >= 1 && type <= 23) {
      this.#add(payload);
    } else if (type === 24) {
      // STAP-A: several NAL units, each after a two-byte size.
      let at = 1;

      while (at + 2 <= payload.length) {
        const size = ((payload[at] ?? 0) << 8) | (payload[at + 1] ?? 0);

        at += 2;

        if (size === 0 || at + size > payload.length) {
          break;
        }

        this.#add(payload.subarray(at, at + size));
        at += size;
      }
    } else if (type === 28) {
      // FU-A: one NAL unit across packets; its header is rebuilt from the indicator and the
      // fragment header.
      const indicator = payload[0] ?? 0;
      const header = payload[1] ?? 0;
      const isStart = (header & 0x80) !== 0;
      const isEnd = (header & 0x40) !== 0;

      if (isStart) {
        this.#fragment = [new Uint8Array([(indicator & 0xe0) | (header & 0x1f)])];
      }

      this.#fragment?.push(payload.subarray(2));

      if (isEnd && this.#fragment !== undefined) {
        this.#add(Buffer.concat(this.#fragment));
        this.#fragment = undefined;
      }
    }

    if (isMarked) {
      const unit = this.#flush();

      if (unit !== undefined) {
        done.push(unit);
      }
    }

    return done;
  }

  /**
   * Keeps a NAL unit of the picture being gathered, and remembers parameter sets.
   *
   * @param nal - The NAL unit.
   */
  #add(nal: Uint8Array): void {
    this.#remember(nal);
    this.#nals.push(nal);
  }

  /**
   * Remembers a parameter set, so a key frame can be given it.
   *
   * @param nal - A NAL unit.
   */
  #remember(nal: Uint8Array): void {
    const type = (nal[0] ?? 0) & 0x1f;

    if (type === 7) {
      this.#sps = new Uint8Array(nal);
    } else if (type === 8) {
      this.#pps = new Uint8Array(nal);
    }
  }

  /**
   * Ends the picture being gathered.
   *
   * @returns It, in Annex B, or undefined when it held nothing.
   */
  #flush(): { data: Uint8Array; isKey: boolean; timestamp: number } | undefined {
    const nals = this.#nals;
    const timestamp = this.#timestamp ?? 0;

    this.#nals = [];

    if (nals.length === 0) {
      return undefined;
    }

    const types = new Set(nals.map((nal) => (nal[0] ?? 0) & 0x1f));
    const isKey = types.has(5);
    const parts: Uint8Array[] = [];

    // A key frame the camera sent without its parameter sets is given the ones known, so a
    // decoder can start from it.
    if (isKey && !types.has(7) && this.#sps !== undefined) {
      parts.push(START_CODE, this.#sps);
    }

    if (isKey && !types.has(8) && this.#pps !== undefined) {
      parts.push(START_CODE, this.#pps);
    }

    for (const nal of nals) {
      parts.push(START_CODE, nal);
    }

    return { data: new Uint8Array(Buffer.concat(parts)), isKey, timestamp };
  }
}

/**
 * The answer to a Digest challenge.
 *
 * @param challenge - The `WWW-Authenticate` header.
 * @param method - The request's method.
 * @param uri - The request's URI.
 * @param username - Who.
 * @param password - Their password.
 * @returns The `Authorization` header.
 */
export function digestAuthorization(
  challenge: string,
  method: string,
  uri: string,
  username: string,
  password: string,
): string {
  /**
   * Reads one field of the challenge.
   *
   * @param name - The field.
   * @returns Its value, or empty.
   */
  const field = (name: string): string =>
    new RegExp(`${name}="?([^",]+)"?`, 'iu').exec(challenge)?.[1] ?? '';
  const realm = field('realm');
  const nonce = field('nonce');
  /**
   * Digests text the way the scheme does.
   *
   * @param text - The text.
   * @returns The digest, in hexadecimal.
   */
  const md5 = (text: string): string => createHash('md5').update(text).digest('hex');
  const response = md5(
    `${md5(`${username}:${realm}:${password}`)}:${nonce}:${md5(`${method}:${uri}`)}`,
  );

  return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
}

/**
 * Plays an RTSP stream and yields its access units.
 *
 * @param options - The URL, whether its certificate is checked, and what ends it.
 * @yields {RtspFrame} Each access unit, in order.
 * @throws {Error} When the camera refused, answered nothing usable, or went silent.
 */
export const openRtsp: OpenRtsp = async function* openRtsp(
  options: RtspOptions,
): AsyncGenerator<RtspFrame> {
  const url = new URL(options.url);
  const isTls = url.protocol === 'rtsps:';
  const port = Number(url.port === '' ? (isTls ? 322 : 554) : url.port);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  // The URL as sent in requests: no credentials in it.
  const base = `${url.protocol}//${url.hostname}:${String(port)}${url.pathname}${url.search}`;
  const socket: Socket = isTls
    ? connectTls({
        host: url.hostname,
        port,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
        // SNI names a host, never an address (RFC 6066); a camera is usually reached by one.
        ...(isIP(url.hostname) === 0 ? { servername: url.hostname } : {}),
      })
    : connectTcp({ host: url.hostname, port });
  const queue: RtspFrame[] = [];
  let failure: Error | undefined;
  let isEnded = false;

  /**
   * Whether the session has ended.
   *
   * @returns True once it has.
   */
  const hasEnded = (): boolean => isEnded;
  let wake: (() => void) | undefined;
  let buffer: Buffer = Buffer.alloc(0);
  let sequence = 0;
  let session: string | undefined;
  let authorization: ((method: string, uri: string) => string) | undefined;
  let answer: ((response: Response) => void) | undefined;
  let lastPacketMs = Date.now();
  let depacketizer: H264Depacketizer | undefined;
  let payloadType = 96;
  let firstTimestamp: number | undefined;

  /**
   * Ends the stream, with why when it failed.
   *
   * @param error - Why, or nothing for an ordinary end.
   */
  const end = (error?: Error): void => {
    if (isEnded) {
      return;
    }

    isEnded = true;
    failure = error;
    socket.destroy();
    wake?.();
  };

  /**
   * Reads what arrived: RTSP responses, and RTP packets interleaved after `$`.
   */
  const parse = (): void => {
    for (;;) {
      if (buffer.length === 0) {
        return;
      }

      if (buffer[0] === 0x24) {
        if (buffer.length < 4) {
          return;
        }

        const channel = buffer[1] ?? 0;
        const size = buffer.readUInt16BE(2);

        if (buffer.length < 4 + size) {
          return;
        }

        const packet = buffer.subarray(4, 4 + size);

        buffer = buffer.subarray(4 + size);

        if (channel === 0) {
          onRtp(packet);
        }

        continue;
      }

      const headerEnd = buffer.indexOf('\r\n\r\n');

      if (headerEnd === -1) {
        return;
      }

      const head = buffer.subarray(0, headerEnd).toString('utf8');
      const lines = head.split('\r\n');
      const headers = new Map<string, string>();

      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');

        if (colon > 0) {
          headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
        }
      }

      const length = Number(headers.get('content-length') ?? 0);

      if (buffer.length < headerEnd + 4 + length) {
        return;
      }

      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');

      buffer = buffer.subarray(headerEnd + 4 + length);

      const status = Number(/^RTSP\/1\.0 (\d{3})/u.exec(lines[0] ?? '')?.[1] ?? 0);

      answer?.({ status, headers, body });
    }
  };

  /**
   * Takes one RTP packet.
   *
   * @param packet - The packet, header and all.
   */
  const onRtp = (packet: Buffer): void => {
    lastPacketMs = Date.now();

    if (packet.length < 12 || depacketizer === undefined) {
      return;
    }

    const first = packet[0] ?? 0;
    const second = packet[1] ?? 0;

    if ((second & 0x7f) !== payloadType) {
      return;
    }

    const hasPadding = (first & 0x20) !== 0;
    const hasExtension = (first & 0x10) !== 0;
    const csrcCount = first & 0x0f;
    const isMarked = (second & 0x80) !== 0;
    const timestamp = packet.readUInt32BE(4);
    let start = 12 + csrcCount * 4;

    if (hasExtension && packet.length >= start + 4) {
      start += 4 + packet.readUInt16BE(start + 2) * 4;
    }

    const end = hasPadding ? packet.length - (packet[packet.length - 1] ?? 0) : packet.length;

    if (start >= end) {
      return;
    }

    for (const unit of depacketizer.push(packet.subarray(start, end), timestamp, isMarked)) {
      const codec = depacketizer.codec;

      if (codec === undefined) {
        continue;
      }

      firstTimestamp ??= unit.timestamp;

      // RTP timestamps are 32 bits at 90 kHz: they wrap after thirteen hours.
      const ticks = (unit.timestamp - firstTimestamp + 2 ** 32) % 2 ** 32;

      queue.push({
        codec,
        data: unit.data,
        isKey: unit.isKey,
        timestampUs: Math.round((ticks / 90_000) * 1_000_000),
      });

      // A reader that fell behind loses the oldest pictures rather than the hub its memory.
      while (queue.length > QUEUE_LIMIT) {
        queue.shift();
      }

      wake?.();
    }
  };

  /**
   * Sends one request and waits for its answer, answering a challenge once.
   *
   * @param method - The method.
   * @param uri - The URI.
   * @param headers - Its own headers.
   * @returns The answer.
   * @throws {Error} When none came in time, or it was not a success.
   */
  const request = async (
    method: string,
    uri: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<Response> => {
    /**
     * Writes the request and waits for its answer.
     *
     * @returns The answer.
     */
    const send = (): Promise<Response> =>
      new Promise<Response>((resolve, reject) => {
        sequence += 1;

        const lines = [
          `${method} ${uri} RTSP/1.0`,
          `CSeq: ${String(sequence)}`,
          'User-Agent: NebulaHome',
          ...(session === undefined ? [] : [`Session: ${session}`]),
          ...(authorization === undefined ? [] : [`Authorization: ${authorization(method, uri)}`]),
          ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        ];
        const timer = setTimeout(() => {
          answer = undefined;
          reject(new Error(`the camera did not answer ${method} in time`));
        }, REQUEST_TIMEOUT_MS);

        /**
         * Takes the answer this request waits for.
         *
         * @param response - The answer.
         */
        answer = (response) => {
          clearTimeout(timer);
          answer = undefined;
          resolve(response);
        };
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      });

    let response = await send();

    if (response.status === 401 && authorization === undefined && username !== '') {
      const challenge = response.headers.get('www-authenticate') ?? '';

      authorization = /^digest/iu.test(challenge)
        ? (asked, askedUri) => digestAuthorization(challenge, asked, askedUri, username, password)
        : () => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      response = await send();
    }

    if (response.status === 401) {
      throw new Error('the camera refused the credentials (RTSP 401)');
    }

    if (response.status < 200 || response.status > 299) {
      throw new Error(`the camera answered ${method} with RTSP ${String(response.status)}`);
    }

    return response;
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

    try {
      parse();
    } catch (error: unknown) {
      end(error instanceof Error ? error : new Error(String(error)));
    }
  });
  socket.on('error', (error) => {
    end(error);
  });
  socket.on('close', () => {
    end(isEnded ? undefined : new Error('the camera closed the connection'));
  });

  /** Ends the session politely when the stream is no longer wanted. */
  const onAbort = (): void => {
    if (session !== undefined && socket.writable) {
      socket.write(
        `TEARDOWN ${base} RTSP/1.0\r\nCSeq: ${String(sequence + 1)}\r\nSession: ${session}\r\n\r\n`,
      );
    }

    end();
  };

  options.signal.addEventListener('abort', onAbort, { once: true });

  const keepalive = setInterval(() => {
    if (Date.now() - lastPacketMs > SILENCE_MS) {
      end(new Error('the camera stopped sending'));

      return;
    }

    request('GET_PARAMETER', base).catch(() => undefined);
  }, KEEPALIVE_MS);

  keepalive.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once(isTls ? 'secureConnect' : 'connect', () => {
        resolve();
      });
      socket.once('error', reject);
    });

    const described = await request('DESCRIBE', base, { Accept: 'application/sdp' });
    const contentBase = described.headers.get('content-base') ?? base;
    const track = videoTrackOf(described.body, contentBase);

    if (track === undefined) {
      throw new Error('the camera describes no H.264 video');
    }

    payloadType = track.payloadType;
    depacketizer = new H264Depacketizer(track.parameterSets);

    const setup = await request('SETUP', track.control, {
      Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1',
    });

    session = (setup.headers.get('session') ?? '').split(';')[0];
    await request('PLAY', base, { Range: 'npt=0.000-' });
    lastPacketMs = Date.now();

    // Read through a call: the flag is set by the socket's handlers, which narrowing cannot see.
    while (!hasEnded() || queue.length > 0) {
      const next = queue.shift();

      if (next !== undefined) {
        yield next;
        continue;
      }

      // One wait at a time, by design: the next picture, or the end.
      // eslint-disable-next-line no-await-in-loop -- see above
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }

    if (failure !== undefined && !options.signal.aborted) {
      throw failure;
    }
  } finally {
    clearInterval(keepalive);
    options.signal.removeEventListener('abort', onAbort);
    end();
  }
};
