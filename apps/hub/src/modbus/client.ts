/**
 * The hub's Modbus TCP client: one socket per server, and the requests going through it one at a
 * time.
 *
 * A Modbus gateway answers one client, and many answer one request at a time: a Pocket WiFi or a
 * transparent RS485 adapter asked twice at once answers neither. So every part of the hub that
 * speaks to a server - a device's poll, the template editor's test, the network search, an
 * integration's own code - asks through the one {@link ModbusClient} the {@link ModbusPool} keeps
 * for it, and the client sends each request only once the one before it settled.
 *
 * Frames are MBAP over TCP, or RTU frames with their CRC carried over TCP by a transparent
 * adapter. Answers are taken leniently: a TCP gateway that puts 0 in the transaction id or echoes
 * another unit is still answering the one request on the wire.
 */
import { connect as openSocket, type Socket } from 'node:net';

import type { ModbusFraming } from '@nebulahome/contracts';

/** What a Modbus exception code means, for the words a failure uses. */
const EXCEPTIONS: Readonly<Record<number, string>> = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
  10: 'gateway path unavailable',
  11: 'gateway target device failed to respond',
};

/** The pause after each answer before the next request, for the dongles that need it. */
const REQUEST_GAP_MS = 100;

/** How long a request has, once sent, unless said. */
export const MODBUS_TIMEOUT_MS = 3000;

/** How far back the traffic the Brokers page shows is counted. */
const TRAFFIC_WINDOW_MS = 60_000;

/** A server that took no connection: nothing listens there, or it refused. */
export class NoConnectionError extends Error {
  /**
   * Names the failure.
   *
   * @param message - Why, in a sentence.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ModbusNoConnection';
  }
}

/** A unit that took the request and said nothing in time. */
export class SilenceError extends Error {
  /**
   * Names the failure.
   *
   * @param message - Why, in a sentence.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ModbusSilence';
  }
}

/** A Modbus exception: the unit answered, and said no. */
export class ModbusException extends Error {
  /** The exception code. */
  readonly code: number;

  /**
   * Names the exception.
   *
   * @param code - The exception code.
   * @param functionCode - The function it answered.
   */
  constructor(code: number, functionCode: number) {
    super(
      `Exception ${String(code).padStart(2, '0')} (${EXCEPTIONS[code] ?? 'unknown'}) to function ${String(functionCode).padStart(2, '0')}`,
    );
    this.name = 'ModbusException';
    this.code = code;
  }
}

/**
 * The Modbus CRC of an RTU frame.
 *
 * @param bytes - The frame without its CRC.
 * @returns The CRC, to be written low byte first.
 */
export function crc16(bytes: Buffer): number {
  let crc = 0xff_ff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa0_01 : crc >>> 1;
    }
  }

  return crc;
}

/**
 * A frame's bytes as the template editor shows them.
 *
 * @param bytes - The bytes.
 * @returns `01 00 00 00 01`.
 */
export function hexOf(bytes: Buffer): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Where a server is, and how frames travel to it. */
export type ModbusAddress = {
  readonly host: string;
  readonly port: number;
  readonly framing: ModbusFraming;
};

/** One read: a run of bits or registers of one unit. */
export type ModbusReadSpec = {
  readonly unitId: number;
  readonly function: 1 | 2 | 3 | 4;
  readonly address: number;
  readonly count: number;
  readonly timeoutMs?: number;
};

/** One write: a coil, a register, coils or registers of one unit. */
export type ModbusWriteSpec = {
  readonly unitId: number;
  readonly function: 5 | 6 | 15 | 16;
  readonly address: number;

  /** The word for 05 and 06; the bits for 15; the registers for 16. */
  readonly values: readonly number[];
  readonly timeoutMs?: number;
};

/** What one request sent and got back: the PDUs, and how long the answer took. */
export type ModbusExchange = {
  readonly request: Buffer;
  readonly response: Buffer;
  readonly ms: number;
};

/** A read's answer: one number per bit or register, with what was sent and got back. */
export type ModbusReadResult = ModbusExchange & { readonly values: number[] };

/** The request in flight, waiting for its answer. */
type Pending = {
  readonly transaction: number;
  readonly unit: number;
  readonly code: number;
  resolve: (pdu: Buffer) => void;
  reject: (error: Error) => void;
};

/**
 * The PDU of a read.
 *
 * @param spec - The read.
 * @returns The function code, the address and the count.
 */
function readPdu(spec: ModbusReadSpec): Buffer {
  const pdu = Buffer.alloc(5);

  pdu.writeUInt8(spec.function, 0);
  pdu.writeUInt16BE(spec.address, 1);
  pdu.writeUInt16BE(spec.count, 3);

  return pdu;
}

/**
 * The PDU of a write.
 *
 * @param spec - The write.
 * @returns The function code, the address and what is written.
 * @throws {Error} When it writes nothing, or a word that is not one.
 */
function writePdu(spec: ModbusWriteSpec): Buffer {
  const { values } = spec;

  if (
    values.length === 0 ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)
  ) {
    throw new Error('A write carries words from 0 to 65535');
  }

  if (spec.function === 5 || spec.function === 6) {
    const pdu = Buffer.alloc(5);

    pdu.writeUInt8(spec.function, 0);
    pdu.writeUInt16BE(spec.address, 1);
    pdu.writeUInt16BE(values[0] ?? 0, 3);

    return pdu;
  }

  const body =
    spec.function === 15
      ? Buffer.from(
          [...Array(Math.ceil(values.length / 8)).keys()].map((byte) =>
            values
              .slice(byte * 8, byte * 8 + 8)
              .reduce((bits, value, bit) => (value === 0 ? bits : bits | (1 << bit)), 0),
          ),
        )
      : Buffer.concat(
          values.map((value) => {
            const word = Buffer.alloc(2);

            word.writeUInt16BE(value, 0);

            return word;
          }),
        );
  const head = Buffer.alloc(6);

  head.writeUInt8(spec.function, 0);
  head.writeUInt16BE(spec.address, 1);
  head.writeUInt16BE(values.length, 3);
  head.writeUInt8(body.length, 5);

  return Buffer.concat([head, body]);
}

/**
 * Checks that an answer answers a request.
 *
 * @param request - The request's PDU.
 * @param response - The answer's PDU.
 * @param unit - Who answered, for the words a failure uses.
 * @throws {ModbusException} When the unit said no.
 * @throws {Error} When the answer is not to that request.
 */
function checkAnswer(request: Buffer, response: Buffer, unit: number): void {
  const code = request.readUInt8(0);
  const answered = response.readUInt8(0);

  if (answered === (code | 0x80) && response.length >= 2) {
    throw new ModbusException(response.readUInt8(1), code);
  }

  const isWrite = code === 5 || code === 6 || code === 15 || code === 16;
  const expected = isWrite
    ? 0
    : code <= 2
      ? Math.ceil(request.readUInt16BE(3) / 8)
      : request.readUInt16BE(3) * 2;
  const isWhole = isWrite
    ? response.length >= 5 && response.readUInt16BE(1) === request.readUInt16BE(1)
    : response.length >= 2 + expected && response.readUInt8(1) === expected;

  if (answered !== code || !isWhole) {
    throw new Error(`Unit ${String(unit)} answered a different question`);
  }
}

/**
 * The numbers a read's answer holds.
 *
 * @param request - The read's PDU.
 * @param response - The answer's PDU, already checked.
 * @returns One number per bit (0 or 1) or register.
 */
function valuesOf(request: Buffer, response: Buffer): number[] {
  const code = request.readUInt8(0);
  const count = request.readUInt16BE(3);

  return [...Array(count).keys()].map((index) =>
    code <= 2
      ? (response.readUInt8(2 + Math.floor(index / 8)) >> (index % 8)) & 1
      : response.readUInt16BE(2 + index * 2),
  );
}

/**
 * Waits a moment, without keeping the process alive for it.
 *
 * @param ms - How long.
 * @returns Settles once it has passed.
 */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/** One socket to a Modbus server, and the requests going through it one at a time. */
export class ModbusClient {
  readonly address: ModbusAddress;

  /** How many hold it; it closes when the last one lets go. */
  holders = 0;

  #socket: Socket | undefined;

  /** The socket being opened, until it is. */
  #connecting: Socket | undefined;

  #pending: Pending | undefined;

  /** Bytes received and not yet a whole frame. */
  #buffer: Buffer = Buffer.alloc(0);

  /** The last MBAP transaction id used. */
  #transaction = 0;

  /** Each request starts when the one before it settled: never more than one on the wire. */
  #tail: Promise<unknown> = Promise.resolve();

  readonly #gapMs: number;
  readonly #onDone: (ms: number) => void;

  /**
   * Prepares a client; nothing is opened until the first request.
   *
   * @param address - The server.
   * @param gapMs - The pause after each answer.
   * @param onDone - Told how long each answered request took.
   */
  constructor(address: ModbusAddress, gapMs: number, onDone: (ms: number) => void) {
    this.address = address;
    this.#gapMs = gapMs;
    this.#onDone = onDone;
  }

  /**
   * Whether the socket is open now.
   *
   * @returns True while it is.
   */
  get isOpen(): boolean {
    return this.#socket !== undefined;
  }

  /**
   * Sends one request after every request queued before it, and waits for its answer.
   *
   * @param unit - The unit id.
   * @param pdu - The request's PDU.
   * @param timeoutMs - How long it has, once sent.
   * @param signal - Gives up.
   * @returns What was sent and got back.
   */
  request(
    unit: number,
    pdu: Buffer,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ModbusExchange> {
    /**
     * Sends it, once its turn has come.
     *
     * @returns The exchange.
     */
    const run = async (): Promise<ModbusExchange> => {
      const startedAt = performance.now();
      const response = await this.#exchange(unit, pdu, timeoutMs, signal);
      const ms = Math.round(performance.now() - startedAt);

      this.#onDone(ms);

      return { request: pdu, response, ms };
    };
    const result = this.#tail.then(run, run);

    this.#tail = result.catch(() => undefined).then(() => pause(this.#gapMs));

    return result;
  }

  /**
   * Closes the socket; a later request opens it again.
   *
   * @param reason - Why, for the request in flight.
   * @param failure - What the request in flight fails with.
   */
  reset(
    reason: string,
    failure: (message: string) => Error = (message) => new Error(message),
  ): void {
    const pending = this.#pending;

    this.#pending = undefined;
    this.#buffer = Buffer.alloc(0);
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#connecting?.destroy();
    this.#connecting = undefined;
    pending?.reject(failure(reason));
  }

  /**
   * The server, for the words a failure uses.
   *
   * @returns `host:port`.
   */
  get #where(): string {
    return `${this.address.host}:${String(this.address.port)}`;
  }

  /**
   * Opens the socket, unless it is open. Only ever called by the request at the head of the
   * queue, so two openings never race.
   *
   * @param timeoutMs - How long connecting may take.
   * @returns Settles once it is open.
   * @throws {NoConnectionError} When it could not be opened, naming why.
   */
  #open(timeoutMs: number): Promise<void> {
    if (this.#socket !== undefined) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const socket = openSocket({ host: this.address.host, port: this.address.port });
      const timer = setTimeout(() => {
        this.#connecting = undefined;
        socket.destroy();
        reject(new NoConnectionError(`No connection to ${this.#where} in time`));
      }, timeoutMs);

      this.#connecting = socket;
      socket.setNoDelay(true);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.#connecting = undefined;
        this.#socket = socket;
        resolve();
      });
      socket.on('data', (chunk: Buffer) => {
        this.#receive(chunk);
      });
      socket.on('error', (error) => {
        clearTimeout(timer);

        if (this.#socket !== socket) {
          const code =
            'code' in error && typeof error.code === 'string' ? error.code : error.message;

          this.#connecting = undefined;
          reject(new NoConnectionError(`No connection to ${this.#where}: ${code}`));
        }
      });
      socket.on('close', () => {
        if (this.#socket === socket) {
          this.reset(`${this.#where} closed the connection`);
        } else {
          clearTimeout(timer);
          reject(new NoConnectionError(`No connection to ${this.#where}`));
        }
      });
    });
  }

  /**
   * Sends one request and waits for its answer.
   *
   * @param unit - The unit id.
   * @param pdu - The request's PDU.
   * @param timeoutMs - How long it has.
   * @param signal - Gives up.
   * @returns The answer's PDU, checked.
   * @throws {Error} On a timeout, a closed socket, a Modbus exception or a wrong answer.
   */
  async #exchange(
    unit: number,
    pdu: Buffer,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (signal?.aborted === true) {
      throw new Error('Abandoned');
    }

    await this.#open(timeoutMs);

    const socket = this.#socket;

    if (socket === undefined) {
      throw new NoConnectionError(`No connection to ${this.#where}`);
    }

    this.#transaction = (this.#transaction + 1) & 0xff_ff;

    const transaction = this.#transaction;
    const code = pdu.readUInt8(0);

    const response = await new Promise<Buffer>((resolve, reject) => {
      /** Gives up: the socket is reset, since an answer may still be on its way. */
      const giveUp = (): void => {
        this.reset(
          `Unit ${String(unit)} at ${this.#where} did not answer in time`,
          (message) => new SilenceError(message),
        );
      };
      const timer = setTimeout(giveUp, timeoutMs);

      /** Stops waiting: the timer and the abort listener go. */
      const stopWaiting = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', giveUp);
      };

      signal?.addEventListener('abort', giveUp, { once: true });
      this.#pending = {
        transaction,
        unit,
        code,
        /**
         * Settles the request with its answer.
         *
         * @param answer - The answer's PDU.
         */
        resolve: (answer) => {
          stopWaiting();
          resolve(answer);
        },
        /**
         * Fails the request.
         *
         * @param error - Why.
         */
        reject: (error) => {
          stopWaiting();
          reject(error);
        },
      };

      if (this.address.framing === 'rtu') {
        const frame = Buffer.concat([Buffer.from([unit]), pdu]);
        const crc = Buffer.alloc(2);

        crc.writeUInt16LE(crc16(frame), 0);
        socket.write(Buffer.concat([frame, crc]));
      } else {
        const header = Buffer.alloc(7);

        header.writeUInt16BE(transaction, 0);
        header.writeUInt16BE(0, 2);
        header.writeUInt16BE(pdu.length + 1, 4);
        header.writeUInt8(unit, 6);
        socket.write(Buffer.concat([header, pdu]));
      }
    });

    checkAnswer(pdu, response, unit);

    return response;
  }

  /**
   * Takes bytes off the socket and settles the request in flight once its frame is whole.
   *
   * @param chunk - What arrived.
   */
  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    for (;;) {
      const frame = this.address.framing === 'rtu' ? this.#takeRtu() : this.#takeTcp();

      if (frame === undefined) {
        return;
      }

      this.#settle(frame.unit, frame.pdu, frame.transaction);
    }
  }

  /**
   * Takes one MBAP frame off the buffer.
   *
   * @returns The frame, or nothing until one is whole.
   */
  #takeTcp(): { unit: number; pdu: Buffer; transaction: number } | undefined {
    if (this.#buffer.length < 7) {
      return undefined;
    }

    const size = 6 + this.#buffer.readUInt16BE(4);

    if (this.#buffer.length < size) {
      return undefined;
    }

    const frame = this.#buffer.subarray(0, size);

    this.#buffer = this.#buffer.subarray(size);

    return { transaction: frame.readUInt16BE(0), unit: frame.readUInt8(6), pdu: frame.subarray(7) };
  }

  /**
   * Takes one RTU frame off the buffer, checking its CRC. Its length follows from the function: a
   * read says its byte count, a write echoes four bytes, an exception carries one.
   *
   * @returns The frame, or nothing until one is whole.
   */
  #takeRtu(): { unit: number; pdu: Buffer; transaction: number } | undefined {
    if (this.#buffer.length < 3) {
      return undefined;
    }

    const code = this.#buffer.readUInt8(1);
    const size = code & 0x80 ? 5 : code <= 4 ? 3 + this.#buffer.readUInt8(2) + 2 : 8;

    if (this.#buffer.length < size) {
      return undefined;
    }

    const frame = this.#buffer.subarray(0, size);

    this.#buffer = this.#buffer.subarray(size);

    if (crc16(frame.subarray(0, size - 2)) !== frame.readUInt16LE(size - 2)) {
      this.#pending?.reject(new Error('The answer failed its CRC'));
      this.#pending = undefined;

      return undefined;
    }

    return {
      transaction: this.#pending?.transaction ?? 0,
      unit: frame.readUInt8(0),
      pdu: frame.subarray(1, size - 2),
    };
  }

  /**
   * Settles the request in flight with a frame, when the frame is its answer.
   *
   * @param unit - Who answered.
   * @param pdu - The function code and what follows.
   * @param transaction - The frame's transaction id.
   */
  #settle(unit: number, pdu: Buffer, transaction: number): void {
    const pending = this.#pending;

    if (pending === undefined || pdu.length === 0) {
      return;
    }

    // Whose answer it is: over RTU the unit says, over TCP the transaction does - or 0, which some
    // gateways put there whatever was asked. The unit a TCP gateway echoes is not held against it:
    // one request is ever on the wire, and a socket whose request timed out is dropped with it.
    const isOurs =
      this.address.framing === 'rtu'
        ? unit === pending.unit
        : transaction === pending.transaction || transaction === 0;

    if (isOurs) {
      this.#pending = undefined;
      pending.resolve(Buffer.from(pdu));
    }
  }
}

/** How the pool is told to pace its clients. */
export type ModbusPoolOptions = {
  /** The pause after each answer; 100 ms unless said. */
  readonly gapMs?: number;
};

/** What the Brokers page says of the traffic: the servers held, requests and their time. */
export type ModbusTraffic = {
  readonly gateways: number;
  readonly requestsPerMinute: number;
  readonly averageMs: number | null;
};

/**
 * The hub's clients, one per server: everything that speaks Modbus asks through it, so no server
 * is ever opened twice.
 */
export class ModbusPool {
  readonly #clients = new Map<string, ModbusClient>();
  readonly #gapMs: number;

  /** When each request of the last minute was answered, and how long it took. */
  #done: { readonly at: number; readonly ms: number }[] = [];

  /**
   * Prepares the pool; nothing is opened until the first request.
   *
   * @param options - How to pace the clients.
   */
  constructor(options: ModbusPoolOptions = {}) {
    this.#gapMs = options.gapMs ?? REQUEST_GAP_MS;
  }

  /**
   * Takes hold of the client for a server, opening none yet.
   *
   * @param address - The server.
   * @returns The client, held until {@link release}.
   */
  acquire(address: ModbusAddress): ModbusClient {
    const key = keyOf(address);
    let client = this.#clients.get(key);

    if (client === undefined) {
      client = new ModbusClient(address, this.#gapMs, (ms) => {
        this.#note(ms);
      });
      this.#clients.set(key, client);
    }

    client.holders += 1;

    return client;
  }

  /**
   * Lets go of a client, closing it when nobody holds it any more.
   *
   * @param client - The client.
   */
  release(client: ModbusClient): void {
    client.holders -= 1;

    const key = keyOf(client.address);

    if (client.holders <= 0 && this.#clients.get(key) === client) {
      this.#clients.delete(key);
      client.reset('Closed');
    }
  }

  /**
   * Whether something holds a client to this server now - a poll - so a caller about to knock on
   * the port with a connection of its own asks through that one instead.
   *
   * @param address - The server.
   * @returns True while it is held.
   */
  isHeld(address: ModbusAddress): boolean {
    return (this.#clients.get(keyOf(address))?.holders ?? 0) > 0;
  }

  /**
   * Reads bits or registers through the server's client, held for the read.
   *
   * @param address - The server.
   * @param spec - The read.
   * @param signal - Gives up.
   * @returns One number per bit or register, and what was sent and got back.
   */
  async read(
    address: ModbusAddress,
    spec: ModbusReadSpec,
    signal?: AbortSignal,
  ): Promise<ModbusReadResult> {
    const client = this.acquire(address);

    try {
      const pdu = readPdu(spec);
      const exchange = await client.request(
        spec.unitId,
        pdu,
        spec.timeoutMs ?? MODBUS_TIMEOUT_MS,
        signal,
      );

      return { ...exchange, values: valuesOf(pdu, exchange.response) };
    } finally {
      this.release(client);
    }
  }

  /**
   * Writes through the server's client, held for the write.
   *
   * @param address - The server.
   * @param spec - The write.
   * @param signal - Gives up.
   * @returns What was sent and got back.
   */
  async write(
    address: ModbusAddress,
    spec: ModbusWriteSpec,
    signal?: AbortSignal,
  ): Promise<ModbusExchange> {
    const client = this.acquire(address);

    try {
      return await client.request(
        spec.unitId,
        writePdu(spec),
        spec.timeoutMs ?? MODBUS_TIMEOUT_MS,
        signal,
      );
    } finally {
      this.release(client);
    }
  }

  /**
   * What the Brokers page says of the traffic.
   *
   * @returns The servers held open, the requests of the last minute and their average time.
   */
  traffic(): ModbusTraffic {
    this.#prune();

    const total = this.#done.reduce((sum, each) => sum + each.ms, 0);

    return {
      gateways: [...this.#clients.values()].filter((client) => client.isOpen).length,
      requestsPerMinute: this.#done.length,
      averageMs: this.#done.length === 0 ? null : Math.round(total / this.#done.length),
    };
  }

  /** Closes every client, for the hub stopping. */
  closeAll(): void {
    for (const client of this.#clients.values()) {
      client.reset('Closed');
    }

    this.#clients.clear();
  }

  /**
   * Counts one answered request.
   *
   * @param ms - How long it took.
   */
  #note(ms: number): void {
    this.#done.push({ at: Date.now(), ms });
    this.#prune();
  }

  /** Forgets requests older than the window. */
  #prune(): void {
    const since = Date.now() - TRAFFIC_WINDOW_MS;
    const first = this.#done.findIndex((each) => each.at >= since);

    this.#done = first < 0 ? [] : this.#done.slice(first);
  }
}

/**
 * What a client is kept under.
 *
 * @param address - The server.
 * @returns `tcp:192.168.1.60:502`.
 */
function keyOf(address: ModbusAddress): string {
  return `${address.framing}:${address.host}:${String(address.port)}`;
}
