// @ts-check
/**
 * SolaX inverters over Modbus TCP: a Pocket WiFi 3.0 dongle, the LAN port of a second- or
 * third-generation hybrid, or an RS485-to-Ethernet adapter on the inverter's COM port. All of them
 * are a Modbus server at `host:port` (502) answering for one unit id (1 unless it was changed).
 *
 * The platform has no Modbus transport, so the bundle ships this one: a small Modbus client -
 * function codes 03 (holding registers) and 04 (input registers), nothing else - over `node:net`.
 * It **only reads**. Writing, and the unlock code SolaX asks for before a setting may change, are
 * not here.
 *
 * - **One socket per address, in the whole hub.** Many gateways, and the Pocket WiFi 3.0, take one
 *   client at a time, so every read of every unit behind `host:port` - polls, the Test button,
 *   identification, the discovery sweep - goes through the one socket, one request after another
 *   and a short pause apart. A request that times out drops the socket; the next one opens it
 *   again, and a poll's block that timed out is asked once more before the poll gives up.
 * - **Lenient answers.** With one request on the wire, an answer to the function asked is taken
 *   even when a gateway echoes another unit id, or 0 for the transaction, as some do.
 * - **Two framings.** Modbus TCP (the MBAP header, a transaction id per request) is what the
 *   Pocket WiFi, the inverter's own port and an adapter in "Modbus TCP to RTU" mode speak. An
 *   adapter in transparent mode passes RTU frames through as they are (CRC and all): pick
 *   "RTU over TCP" for that one.
 * - **Blocks, not entities.** A poll does not ask one register per reading. The registers the
 *   family needs are grouped into blocks - contiguous, at most 100 registers (the block size the
 *   Home Assistant integration uses for SolaX), a gap of more than 16 unused registers starting a
 *   new one - and each block is read once per interval. An X3-Hybrid G4 is three requests.
 * - **Named values.** What comes back is decoded with the family's table (`families.js`) into
 *   named, scaled values, the way `solax/local` delivers them, so a profile reads
 *   `values.battery_power` whichever way the inverter is reached.
 *
 * Identifying an inverter is reading its serial number (holding 0x0, else 0x300, else 0x1A10,
 * seven registers of ASCII - the next place is tried when one is refused or left unanswered) and
 * looking its prefix up; the Test button asks no more than that. A block the inverter refuses
 * with a Modbus exception - a register its firmware does not have - is left out and the rest still
 * delivered, as the integration does; a unit that does not answer at all fails the poll.
 *
 * This file is what ships in the bundle. It imports nothing from the platform: zod and
 * `defineTransport` arrive as the `sdk` it is called with, and the socket is Node's own.
 */
import { connect as openSocket } from 'node:net';

import { MODBUS_FAMILIES, MODBUS_MODELS } from './families.js';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').Transport} Transport */
/** @typedef {import('@nebulahome/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebulahome/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebulahome/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('@nebulahome/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebulahome/contracts').JsonObject} JsonObject */
/** @typedef {import('./families.js').ModbusFamily} ModbusFamily */
/** @typedef {import('./families.js').ModbusReading} ModbusReading */
/** @typedef {import('./families.js').ModbusStep} ModbusStep */

/**
 * What an owner configures to reach one inverter.
 *
 * @typedef {object} Config
 * @property {string} host - The Modbus server: dongle, inverter or adapter.
 * @property {number} port - Its port, 502 unless changed.
 * @property {number} unitId - The inverter's Modbus address behind it, 1 unless changed.
 * @property {'tcp' | 'rtu'} framing - Modbus TCP, or RTU frames over TCP for a transparent adapter.
 * @property {number} timeoutMs - How long one request has.
 */

/**
 * Which registers one request reads.
 *
 * @typedef {object} Block
 * @property {'input' | 'holding'} table - Function 04 or 03.
 * @property {number} start - The first register.
 * @property {number} count - How many.
 */

/**
 * A request waiting for its answer.
 *
 * @typedef {object} Pending
 * @property {number} transaction - Its MBAP transaction id; unused over RTU.
 * @property {number} unit - The unit asked.
 * @property {number} code - The function code asked.
 * @property {number} count - How many registers were asked for.
 * @property {(registers: number[]) => void} resolve - Settles it with the registers.
 * @property {(error: Error) => void} reject - Fails it.
 */

/** The id this transport registers under: the vendor's, then the name in `manifest.json`. */
const ID = 'solax/modbus';

/** Read holding registers. */
const READ_HOLDING = 0x03;

/** Read input registers. */
const READ_INPUT = 0x04;

/** The most registers one read asks for: the integration's block size for SolaX. */
const MAX_BLOCK = 100;

/** The most unused registers a block reads across before a new block is started. */
const MAX_GAP = 16;

/** The shortest a poll may be: the integration's own advice for the slowest serial links. */
const MIN_POLL_MS = 5000;

/** The pause between one request's answer and the next request, for a dongle that needs it. */
const REQUEST_GAP_MS = 100;

/** Where the serial number may be, in the order the integration tries: seven registers each. */
const SERIAL_ADDRESSES = [0x0, 0x300, 0x1a10];

/** The holding register that says which version of SolaX's register document the inverter follows. */
const PROTOCOL_ADDRESS = 0x82;

/** The families whose layout depends on that version. */
const VERSIONED = new Set(
  MODBUS_FAMILIES.filter((family) => family.legacy !== undefined).map((family) => family.id),
);

/** What a Modbus exception code means, for the words a failure uses. */
const EXCEPTIONS = /** @type {Readonly<Record<number, string>>} */ ({
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
  10: 'gateway path unavailable',
  11: 'gateway target device failed to respond',
});

/** A server that took no connection: nothing listens there, or it refused. */
export class NoConnectionError extends Error {}

/** A unit that took the request and said nothing in time. */
export class SilenceError extends Error {}

/** A unit that answered, but with no serial number this bundle can place. */
export class NoSerialError extends Error {}

/**
 * Waits a moment, without keeping the process alive for it.
 *
 * @param {number} ms - How long.
 * @returns {Promise<void>} Settles once it has passed.
 */
function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/** A Modbus exception: the unit answered, and said no. */
export class ModbusException extends Error {
  /**
   * Names the exception.
   *
   * @param {number} code - The exception code.
   * @param {number} functionCode - The function it answered.
   */
  constructor(code, functionCode) {
    super(
      `Modbus exception ${String(code)} (${EXCEPTIONS[code] ?? 'unknown'}) to function ${String(functionCode)}`,
    );
    this.name = 'ModbusException';
    this.code = code;
  }
}

/**
 * The Modbus CRC of an RTU frame.
 *
 * @param {Buffer} bytes - The frame without its CRC.
 * @returns {number} The CRC, to be written low byte first.
 */
export function crc16(bytes) {
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
 * Reads one reading out of the blocks that were read.
 *
 * @param {(table: 'input' | 'holding', address: number) => number | undefined} register - Looks
 * a register up; nothing when its block was not read.
 * @param {ModbusReading} reading - Where it is and what is done to it.
 * @returns {number | string | undefined} The value, or nothing when a register is missing or a
 * code has no word.
 */
export function readRegisters(register, reading) {
  const [at, ...steps] = reading;
  const table = steps.includes('holding') ? 'holding' : 'input';
  /** @type {number | undefined} */
  let value;

  if (typeof at === 'number') {
    value = register(table, at);
  } else {
    const low = register(table, at[0]);
    const high = register(table, at[1]);

    value = low === undefined || high === undefined ? undefined : low + high * 0x1_0000;
  }

  if (value === undefined) {
    return undefined;
  }

  for (const step of steps) {
    if (typeof step === 'object') {
      return step[String(value)];
    }

    switch (step) {
      case 's16':
        value = value > 0x7f_ff ? value - 0x1_00_00 : value;
        break;
      case 's32':
        value = value > 0x7f_ff_ff_ff ? value - 0x1_00_00_00_00 : value;
        break;
      case '/10':
        value /= 10;
        break;
      case '/100':
        value /= 100;
        break;
      case '/1000':
        value /= 1000;
        break;
      case '*10':
        value *= 10;
        break;
      case 'holding':
        break;
    }
  }

  return value;
}

/**
 * The readings of a family, for the register document version the inverter follows.
 *
 * @param {ModbusFamily} family - The family.
 * @param {number} protocol - The version, times a hundred; 0 when the inverter does not say.
 * @returns {Readonly<Record<string, ModbusReading>>} Every reading, by name.
 */
function readingsOf(family, protocol) {
  const layout = protocol >= 100 ? family.current : family.legacy;

  return { ...family.values, ...layout };
}

/**
 * The registers a reading occupies, and in which table.
 *
 * @param {ModbusReading} reading - The reading.
 * @returns {{ table: 'input' | 'holding', addresses: number[] }} Where it is.
 */
function placeOf(reading) {
  const [at, ...steps] = reading;

  return {
    table: steps.includes('holding') ? 'holding' : 'input',
    addresses: typeof at === 'number' ? [at] : [at[0], at[1]],
  };
}

/**
 * Groups the registers a family needs into the reads that fetch them: contiguous, at most
 * {@link MAX_BLOCK} registers, a gap wider than {@link MAX_GAP} or a register the family says a
 * read must start at beginning a new one.
 *
 * @param {ModbusFamily} family - The family.
 * @param {number} protocol - The register document version, times a hundred.
 * @returns {Block[]} The reads, input registers first.
 */
export function planOf(family, protocol) {
  /** @type {Record<'input' | 'holding', Set<number>>} */
  const wanted = { input: new Set(), holding: new Set() };

  for (const reading of Object.values(readingsOf(family, protocol))) {
    const { table, addresses } = placeOf(reading);

    for (const address of addresses) {
      wanted[table].add(address);
    }
  }

  const splits = new Set(family.splitAt ?? []);
  /** @type {Block[]} */
  const blocks = [];

  for (const table of /** @type {const} */ (['input', 'holding'])) {
    /** @type {Block | undefined} */
    let open;

    for (const address of [...wanted[table]].toSorted((a, b) => a - b)) {
      const end = open === undefined ? -1 : open.start + open.count - 1;

      if (
        open === undefined ||
        splits.has(address) ||
        address - end - 1 > MAX_GAP ||
        address - open.start + 1 > MAX_BLOCK
      ) {
        open = { table, start: address, count: 1 };
        blocks.push(open);
      } else {
        open.count = address - open.start + 1;
      }
    }
  }

  return blocks;
}

/**
 * Adds what the registers say only in parts: the strings together, the phases together, the two
 * battery ports together, the house as what the inverter puts out less what goes to the grid.
 *
 * @param {Record<string, number | string>} values - The readings; completed in place.
 */
export function deriveValues(values) {
  /**
   * A reading, when it is a number.
   *
   * @param {string} name - Which.
   * @returns {number | undefined} It.
   */
  const number = (name) => {
    const value = values[name];

    return typeof value === 'number' ? value : undefined;
  };

  /**
   * Adds up readings, an absent one counting as nothing.
   *
   * @param {readonly (number | undefined)[]} parts - The readings.
   * @returns {number} Their sum.
   */
  const total = (parts) => parts.reduce((/** @type {number} */ sum, each) => sum + (each ?? 0), 0);

  const strings = ['pv1_power', 'pv2_power', 'pv3_power'].map(number);

  if (number('pv_power') === undefined && strings.some((each) => each !== undefined)) {
    values['pv_power'] = total(strings);
  }

  const phases = ['ac_power_l1', 'ac_power_l2', 'ac_power_l3'].map(number);

  if (number('ac_power') === undefined && phases.every((each) => each !== undefined)) {
    values['ac_power'] = total(phases);
  }

  const first = number('battery1_power');

  if (number('battery_power') === undefined && first !== undefined) {
    values['battery_power'] = first + (number('battery2_power') ?? 0);
  }

  if (number('battery_soc') === undefined) {
    // The integration's reading of the two ports: the total when it says one, else the ports
    // that report a level - the lower one when both do, the capacities being unknown here.
    const whole = number('battery_soc_total') ?? 0;
    const levels = [number('battery1_soc'), number('battery2_soc')].filter(
      (each) => each !== undefined && each > 0,
    );

    if (whole > 0) {
      values['battery_soc'] = whole;
    } else if (levels.length > 0) {
      values['battery_soc'] = Math.min(...levels.map((each) => each ?? 0));
    }
  }

  const output = number('ac_power');
  const grid = number('grid_power');

  if (number('home_power') === undefined && output !== undefined && grid !== undefined) {
    values['home_power'] = output - grid;
  }
}

/**
 * Finds the family a serial number is, by its prefix.
 *
 * @param {string} serial - The serial number.
 * @returns {{ family: ModbusFamily, model: string } | undefined} The family and the model, or
 * nothing when no prefix matches.
 */
export function modelOf(serial) {
  const found = MODBUS_MODELS.find((each) => serial.startsWith(each.prefix));
  const family = MODBUS_FAMILIES.find((each) => each.id === found?.family);

  return found === undefined || family === undefined ? undefined : { family, model: found.model };
}

/**
 * Reads a serial number out of seven registers of ASCII, two characters to a register.
 *
 * @param {readonly number[]} registers - The registers.
 * @param {number} address - Where they were read, for the byte-order fix at 0x300.
 * @returns {string} The serial, without padding.
 */
export function serialOf(registers, address) {
  const bytes = Buffer.alloc(registers.length * 2);

  registers.forEach((register, index) => {
    bytes.writeUInt16BE(register & 0xff_ff, index * 2);
  });

  let text = bytes
    .toString('latin1')
    .replaceAll(/[^ -~]/g, '')
    .trim();

  // Some inverters answer at 0x300 with each register's two bytes swapped; a SolaX serial read
  // there starts with M or X, so one that does not is swapped back (the integration does this).
  if (address === 0x300 && text.length > 0 && !/^[MX]/.test(text)) {
    const swapped = Buffer.alloc(bytes.length);

    for (let index = 0; index + 1 < bytes.length; index += 2) {
      swapped[index] = bytes[index + 1] ?? 0;
      swapped[index + 1] = bytes[index] ?? 0;
    }

    text = swapped
      .toString('latin1')
      .replaceAll(/[^ -~]/g, '')
      .trim();
  }

  return text;
}

/**
 * One socket to a Modbus server, and the requests going through it one at a time.
 */
class ModbusClient {
  /** @type {import('node:net').Socket | undefined} */
  #socket;

  /**
   * The socket being opened, until it is.
   *
   * @type {import('node:net').Socket | undefined}
   */
  #connecting;

  /** @type {Pending | undefined} */
  #pending;

  /** Bytes received and not yet a whole frame. */
  #buffer = Buffer.alloc(0);

  /** The last MBAP transaction id used. */
  #transaction = 0;

  /**
   * The request queue: each request starts when the one before it settled, so there is never
   * more than one request on the wire - what many gateways and the Pocket WiFi require.
   *
   * @type {Promise<unknown>}
   */
  #tail = Promise.resolve();

  /**
   * Prepares a client; nothing is opened until the first request.
   *
   * @param {string} host - The server.
   * @param {number} port - Its port.
   * @param {'tcp' | 'rtu'} framing - How frames are written.
   */
  constructor(host, port, framing) {
    this.host = host;
    this.port = port;
    this.framing = framing;

    /** How many holders share it; it closes when the last one lets go. */
    this.holders = 0;
  }

  /**
   * Reads registers from one unit, after every request queued before it.
   *
   * @param {number} unit - The unit id.
   * @param {'input' | 'holding'} table - Which registers.
   * @param {number} start - The first.
   * @param {number} count - How many, at most 125.
   * @param {number} timeoutMs - How long the request has, once it is sent.
   * @param {AbortSignal} signal - Gives up.
   * @returns {Promise<number[]>} The registers.
   */
  read(unit, table, start, count, timeoutMs, signal) {
    /**
     * Sends it, once its turn has come.
     *
     * @returns {Promise<number[]>} The registers.
     */
    const run = () =>
      this.#exchange(
        unit,
        table === 'input' ? READ_INPUT : READ_HOLDING,
        start,
        count,
        timeoutMs,
        signal,
      );
    const result = this.#tail.then(run, run);

    this.#tail = result.catch(() => undefined).then(() => pause(REQUEST_GAP_MS));

    return result;
  }

  /**
   * Closes the socket; a later request opens it again.
   *
   * @param {string} reason - Why, for the request in flight.
   * @param {new (message: string) => Error} [Kind] - What the request in flight fails with.
   */
  reset(reason, Kind = Error) {
    const pending = this.#pending;

    this.#pending = undefined;
    this.#buffer = Buffer.alloc(0);
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#connecting?.destroy();
    this.#connecting = undefined;
    pending?.reject(new Kind(reason));
  }

  /**
   * Opens the socket, unless it is open. Only ever called by the request at the head of the
   * queue, so two openings never race.
   *
   * @param {number} timeoutMs - How long connecting may take.
   * @returns {Promise<void>} Settles once it is open.
   * @throws {Error} When it could not be opened, naming why.
   */
  #open(timeoutMs) {
    if (this.#socket !== undefined) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const socket = openSocket({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        this.#connecting = undefined;
        socket.destroy();
        reject(new NoConnectionError(`no connection to ${this.host}:${String(this.port)} in time`));
      }, timeoutMs);

      this.#connecting = socket;
      socket.setNoDelay(true);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.#connecting = undefined;
        this.#socket = socket;
        resolve();
      });
      socket.on('data', (chunk) => {
        this.#receive(chunk);
      });
      socket.on('error', (error) => {
        clearTimeout(timer);

        if (this.#socket !== socket) {
          const code =
            'code' in error && typeof error.code === 'string' ? error.code : error.message;

          this.#connecting = undefined;
          reject(
            new NoConnectionError(`no connection to ${this.host}:${String(this.port)}: ${code}`),
          );
        }
      });
      socket.on('close', () => {
        if (this.#socket === socket) {
          this.reset(`${this.host}:${String(this.port)} closed the connection`);
        } else {
          clearTimeout(timer);
          reject(new NoConnectionError(`no connection to ${this.host}:${String(this.port)}`));
        }
      });
    });
  }

  /**
   * Sends one request and waits for its answer.
   *
   * @param {number} unit - The unit id.
   * @param {number} code - The function code.
   * @param {number} start - The first register.
   * @param {number} count - How many.
   * @param {number} timeoutMs - How long it has.
   * @param {AbortSignal} signal - Gives up.
   * @returns {Promise<number[]>} The registers.
   * @throws {Error} On a timeout, a closed socket, or a Modbus exception.
   */
  async #exchange(unit, code, start, count, timeoutMs, signal) {
    if (signal.aborted) {
      throw new Error('abandoned');
    }

    await this.#open(timeoutMs);

    const socket = this.#socket;

    if (socket === undefined) {
      throw new NoConnectionError(`no connection to ${this.host}:${String(this.port)}`);
    }

    this.#transaction = (this.#transaction + 1) & 0xff_ff;

    const transaction = this.#transaction;
    const pdu = Buffer.alloc(5);

    pdu.writeUInt8(code, 0);
    pdu.writeUInt16BE(start, 1);
    pdu.writeUInt16BE(count, 3);

    return new Promise((resolve, reject) => {
      /** Gives up: the socket is reset, since an answer may still be on its way. */
      const giveUp = () => {
        this.reset(
          `unit ${String(unit)} at ${this.host}:${String(this.port)} did not answer in time`,
          SilenceError,
        );
      };
      const timer = setTimeout(giveUp, timeoutMs);

      /** Stops waiting: the timer and the abort listener go. */
      const stopWaiting = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', giveUp);
      };

      /**
       * Settles the request with its registers.
       *
       * @param {number[]} registers - What the unit answered.
       */
      const succeed = (registers) => {
        stopWaiting();
        resolve(registers);
      };

      /**
       * Fails the request.
       *
       * @param {Error} error - Why.
       */
      const fail = (error) => {
        stopWaiting();
        reject(error);
      };

      signal.addEventListener('abort', giveUp, { once: true });
      this.#pending = { transaction, unit, code, count, resolve: succeed, reject: fail };

      if (this.framing === 'rtu') {
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
  }

  /**
   * Takes bytes off the socket and settles the request in flight once its frame is whole.
   *
   * @param {Buffer} chunk - What arrived.
   */
  #receive(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    for (;;) {
      const frame = this.framing === 'rtu' ? this.#takeRtu() : this.#takeTcp();

      if (frame === undefined) {
        return;
      }

      this.#settle(frame.unit, frame.pdu, frame.transaction);
    }
  }

  /**
   * Takes one MBAP frame off the buffer.
   *
   * @returns {{ unit: number, pdu: Buffer, transaction: number } | undefined} The frame, or
   * nothing until one is whole.
   */
  #takeTcp() {
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
   * Takes one RTU frame off the buffer, checking its CRC.
   *
   * @returns {{ unit: number, pdu: Buffer, transaction: number } | undefined} The frame, or
   * nothing until one is whole.
   */
  #takeRtu() {
    if (this.#buffer.length < 3) {
      return undefined;
    }

    const code = this.#buffer.readUInt8(1);
    const size = code & 0x80 ? 5 : 3 + this.#buffer.readUInt8(2) + 2;

    if (this.#buffer.length < size) {
      return undefined;
    }

    const frame = this.#buffer.subarray(0, size);

    this.#buffer = this.#buffer.subarray(size);

    if (crc16(frame.subarray(0, size - 2)) !== frame.readUInt16LE(size - 2)) {
      this.#pending?.reject(new Error('the answer failed its CRC'));
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
   * @param {number} unit - Who answered.
   * @param {Buffer} pdu - The function code and what follows.
   * @param {number} transaction - The frame's transaction id.
   */
  #settle(unit, pdu, transaction) {
    const pending = this.#pending;

    if (pending === undefined) {
      return;
    }

    // Whose answer it is: over RTU the unit says, over TCP the transaction does - or 0, which some
    // gateways put there whatever was asked. The unit a TCP gateway echoes is not held against it:
    // one request is ever on the wire, and a socket whose request timed out is dropped with it.
    const isOurs =
      this.framing === 'rtu'
        ? unit === pending.unit
        : transaction === pending.transaction || transaction === 0;

    if (!isOurs) {
      return;
    }

    this.#pending = undefined;

    const code = pdu.readUInt8(0);

    if (code === (pending.code | 0x80)) {
      pending.reject(new ModbusException(pdu.readUInt8(1), pending.code));

      return;
    }

    const length = pdu.readUInt8(1);

    if (code !== pending.code || length !== pending.count * 2 || pdu.length < 2 + length) {
      pending.reject(new Error(`unit ${String(unit)} answered a different question`));

      return;
    }

    /** @type {number[]} */
    const registers = [];

    for (let index = 0; index < pending.count; index += 1) {
      registers.push(pdu.readUInt16BE(2 + index * 2));
    }

    pending.resolve(registers);
  }
}

/**
 * The open clients, by framing and address.
 *
 * Kept by the module rather than by each transport made from it: the hub loads this file once, and
 * the polls, the Test button, the discovery sweep and the `solax/inverter` transport that reads
 * through this one all ask through the same client - so a Pocket WiFi 3.0, which takes one client
 * at a time, is never opened twice.
 *
 * @type {Map<string, ModbusClient>}
 */
const CLIENTS = new Map();

/**
 * What a client is kept under.
 *
 * @param {{ host: string, port: number, framing: 'tcp' | 'rtu' }} address - The server.
 * @returns {string} The key.
 */
function clientKeyOf(address) {
  return `${address.framing}:${address.host}:${String(address.port)}`;
}

/**
 * Takes hold of the client for an address, opening none yet.
 *
 * @param {Config} config - The address.
 * @returns {ModbusClient} The client.
 */
function acquire(config) {
  const key = clientKeyOf(config);
  let client = CLIENTS.get(key);

  if (client === undefined) {
    client = new ModbusClient(config.host, config.port, config.framing);
    CLIENTS.set(key, client);
  }

  client.holders += 1;

  return client;
}

/**
 * Lets go of a client, closing it when nobody holds it any more.
 *
 * @param {Config} config - The address.
 * @param {ModbusClient} client - The client.
 */
function release(config, client) {
  client.holders -= 1;

  if (client.holders <= 0 && CLIENTS.get(clientKeyOf(config)) === client) {
    CLIENTS.delete(clientKeyOf(config));
    client.reset('closed');
  }
}

/**
 * Whether something in the hub holds a client to this server now - a poll, most likely - so a
 * caller about to knock on the port with a connection of its own should ask through that one.
 *
 * @param {string} host - The server.
 * @param {number} port - Its port.
 * @param {'tcp' | 'rtu'} [framing] - How it is spoken to.
 * @returns {boolean} True while it is held.
 */
export function isServerHeld(host, port, framing = 'tcp') {
  return (CLIENTS.get(clientKeyOf({ host, port, framing }))?.holders ?? 0) > 0;
}

/**
 * The address a device of this transport is known by: the server, and the unit behind it.
 *
 * @param {Config} config - The settings.
 * @returns {string} `host:port#unit`.
 */
function deviceKeyOf(config) {
  return `${config.host}:${String(config.port)}#${String(config.unitId)}`;
}

/**
 * The unit a device key names.
 *
 * @param {string} deviceKey - `host:port#unit`.
 * @param {number} fallback - The configured unit, when the key names none.
 * @returns {number} The unit.
 */
function unitOf(deviceKey, fallback) {
  const unit = Number(deviceKey.slice(deviceKey.lastIndexOf('#') + 1));

  return deviceKey.includes('#') && Number.isInteger(unit) ? unit : fallback;
}

/**
 * Makes the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {Transport} The transport, registered as `solax/modbus`.
 */
export default function createSolaxModbus(sdk) {
  const { z } = sdk;

  /**
   * Reads the serial number, trying each place the integration tries.
   *
   * @param {ModbusClient} client - The client.
   * @param {Config} config - How long a request has.
   * @param {number} unit - The unit.
   * @param {AbortSignal} signal - Gives up.
   * @returns {Promise<string>} The serial.
   * @throws {Error} When no place held one, or the unit did not answer.
   */
  const readSerial = async (client, config, unit, signal) => {
    /** @type {string[]} */
    const refusals = [];

    /** Whether every place tried so far went unanswered, rather than refused or empty. */
    let wasSilent = true;

    /**
     * Tries the places from one onwards.
     *
     * @param {number} index - The place to try now.
     * @returns {Promise<string>} The serial.
     * @throws {Error} When none is left.
     */
    const attempt = async (index) => {
      const address = SERIAL_ADDRESSES[index];

      if (address === undefined) {
        throw wasSilent
          ? new SilenceError(
              `unit ${String(unit)} at ${config.host}:${String(config.port)} did not answer`,
            )
          : new NoSerialError(
              `unit ${String(unit)} gave no serial number (${refusals.join('; ')})`,
            );
      }

      try {
        const serial = serialOf(
          await client.read(unit, 'holding', address, 7, config.timeoutMs, signal),
          address,
        );

        if (serial.length > 0) {
          return serial;
        }

        wasSilent = false;
        refusals.push(`nothing at 0x${address.toString(16)}`);
      } catch (error) {
        // Refused, or left unanswered - some units keep quiet about a range they do not have
        // rather than refuse it - is a reason to try the next place; anything else is not.
        if (error instanceof ModbusException) {
          wasSilent = false;
          refusals.push(`${error.message} at 0x${address.toString(16)}`);
        } else if (!(error instanceof SilenceError) || signal.aborted) {
          throw error;
        } else {
          refusals.push(`no answer at 0x${address.toString(16)}`);
        }
      }

      return attempt(index + 1);
    };

    return attempt(0);
  };

  /**
   * Reads the register document version, for the families whose layout depends on it.
   *
   * @param {ModbusClient} client - The client.
   * @param {Config} config - How long a request has.
   * @param {number} unit - The unit.
   * @param {AbortSignal} signal - Gives up.
   * @returns {Promise<number>} The version times a hundred, or 0 when the inverter does not say.
   * @throws {Error} When the unit stopped answering.
   */
  const readProtocol = async (client, config, unit, signal) => {
    try {
      const [version = 0] = await client.read(
        unit,
        'holding',
        PROTOCOL_ADDRESS,
        1,
        config.timeoutMs,
        signal,
      );

      return version > 0 && version < 1000 ? version : 0;
    } catch (error) {
      if (error instanceof ModbusException) {
        return 0;
      }

      throw error;
    }
  };

  /**
   * Reads every block of a family once and decodes the values.
   *
   * @param {ModbusClient} client - The client.
   * @param {Config} config - How long a request has.
   * @param {number} unit - The unit.
   * @param {ModbusFamily} family - The family.
   * @param {number} protocol - The register document version, times a hundred.
   * @param {AbortSignal} signal - Gives up.
   * @returns {Promise<{ values: Record<string, number | string>, requests: number, refused: number }>}
   * The values, and how many reads were made and refused.
   * @throws {Error} When the unit stopped answering.
   */
  const readValues = async (client, config, unit, family, protocol, signal) => {
    const blocks = planOf(family, protocol);

    /**
     * Reads one block, asking once more when the first answer never came - a dongle on a weak
     * link loses a request now and then, and one lost request should not cost a whole poll.
     *
     * @param {Block} block - The block.
     * @returns {Promise<number[]>} Its registers.
     * @throws {Error} When the second try fails too, or the first failed otherwise.
     */
    const readBlock = async (block) => {
      try {
        return await client.read(
          unit,
          block.table,
          block.start,
          block.count,
          config.timeoutMs,
          signal,
        );
      } catch (error) {
        if (!(error instanceof SilenceError) || signal.aborted) {
          throw error;
        }

        return client.read(unit, block.table, block.start, block.count, config.timeoutMs, signal);
      }
    };
    /** @type {Map<string, number>} */
    const registers = new Map();
    let refused = 0;

    /**
     * Reads the blocks from one onwards.
     *
     * @param {number} index - The block to read now.
     * @returns {Promise<void>} Settles once all are read.
     * @throws {Error} When the unit stopped answering.
     */
    const readFrom = async (index) => {
      const block = blocks[index];

      if (block === undefined) {
        return;
      }

      try {
        const answer = await readBlock(block);

        answer.forEach((value, offset) => {
          registers.set(`${block.table}:${String(block.start + offset)}`, value);
        });
      } catch (error) {
        // A block the firmware does not have is left out, the way the integration ignores a
        // failed block: the readings in it stay as they were, the others are delivered.
        if (!(error instanceof ModbusException)) {
          throw error;
        }

        refused += 1;
      }

      await readFrom(index + 1);
    };

    await readFrom(0);

    /** @type {Record<string, number | string>} */
    const values = {};

    for (const [name, reading] of Object.entries(readingsOf(family, protocol))) {
      const value = readRegisters(
        (table, address) => registers.get(`${table}:${String(address)}`),
        reading,
      );

      if (value !== undefined) {
        values[name] = value;
      }
    }

    deriveValues(values);

    return { values, requests: blocks.length, refused };
  };

  /**
   * Identifies the unit, and reads it once when asked to.
   *
   * @param {Config} config - The inverter.
   * @param {AbortSignal} signal - Gives up.
   * @param {boolean} withValues - Whether to read the readings too: identification and a poll
   * that lost its claim do, while the Test button and the discovery sweep need only who it is -
   * a slow dongle is then asked a request or four fewer.
   * @returns {Promise<JsonObject>} The payload: `serial`, `family`, `model`, `protocol`, and
   * `values` when asked for.
   * @throws {Error} When nothing answered, or what answered is not a model this bundle reads.
   */
  const identify = async (config, signal, withValues) => {
    const client = acquire(config);

    try {
      const serial = await readSerial(client, config, config.unitId, signal);
      const known = modelOf(serial);

      if (known === undefined) {
        throw new NoSerialError(
          `serial ${serial} is not a SolaX model this bundle reads over Modbus`,
        );
      }

      const protocol = VERSIONED.has(known.family.id)
        ? await readProtocol(client, config, config.unitId, signal)
        : 0;
      const identity = { serial, family: known.family.id, model: known.model, protocol };

      if (!withValues) {
        return identity;
      }

      const { values } = await readValues(
        client,
        config,
        config.unitId,
        known.family,
        protocol,
        signal,
      );

      return { ...identity, values };
    } finally {
      release(config, client);
    }
  };

  /**
   * Says why a Test failed, in the words an owner can act on.
   *
   * @param {unknown} error - What reading the serial failed with.
   * @param {Config} config - What was tried.
   * @returns {unknown} The error to throw: of the same kind, with a sentence that says what to do.
   */
  const explained = (error, config) => {
    const where = `${config.host}:${String(config.port)}`;

    if (error instanceof NoConnectionError) {
      const detail =
        /: (\S+)$/u.exec(error.message)?.[1] ??
        (error.message.endsWith('in time') ? 'nothing answered in time' : 'refused');

      return new NoConnectionError(
        `${where} takes no Modbus TCP connection (${detail}). A Pocket WiFi 3.0 answers on port 502 from firmware 3.004.03; older firmware, a Pocket WiFi 2.0 and a Pocket LAN have no Modbus`,
        { cause: error },
      );
    }

    if (error instanceof SilenceError) {
      return new SilenceError(
        `${where} took the connection, but unit ${String(config.unitId)} did not answer: check the Modbus unit ID - 1 for a Pocket WiFi 3.0, the address in the inverter's Modbus menu otherwise`,
        { cause: error },
      );
    }

    if (error instanceof NoSerialError) {
      return new NoSerialError(
        `${where} answers Modbus, but ${error.message} - is it a SolaX inverter?`,
        { cause: error },
      );
    }

    return error;
  };

  return sdk.defineTransport({
    id: ID,
    configSchema: z.object({
      host: z.string().min(1).max(256),
      port: z.coerce.number().int().min(1).max(65_535).default(502),
      unitId: z.coerce.number().int().min(0).max(255).default(1),
      framing: z.enum(['tcp', 'rtu']).default('tcp'),
      timeoutMs: z.coerce.number().int().min(500).max(60_000).default(5000),
    }),

    /**
     * One connection per server and framing: every unit behind it shares the one socket.
     *
     * @param {Config} config - The inverter.
     * @returns {string} The key.
     */
    connectionKey: (config) => `${ID}:${config.framing}:${config.host}:${String(config.port)}`,

    /**
     * Starts the timers the subscriptions ask for, each reading its unit's blocks once per
     * interval and delivering one payload.
     *
     * @param {Config} config - The server.
     * @param {TransportContext} context - Where readings go.
     * @returns {Promise<TransportConnection>} The connection.
     */
    connect: async (config, context) => {
      const key = `${ID}:${config.framing}:${config.host}:${String(config.port)}`;
      const client = acquire(config);
      const stop = new AbortController();
      /** @type {Map<string, ReturnType<typeof setInterval>>} */
      const timers = new Map();
      /**
       * Polls still waiting, so a slow unit is not asked twice at once.
       *
       * @type {Set<string>}
       */
      const busy = new Set();

      /**
       * Reads one unit and delivers what it said.
       *
       * @param {string} id - The poll's key.
       * @param {string} deviceKey - `host:port#unit`.
       * @param {JsonObject} args - The subscription's arguments: the family and version the
       * device was identified with.
       */
      const poll = (id, deviceKey, args) => {
        if (busy.has(id)) {
          return;
        }

        busy.add(id);

        const unit = unitOf(deviceKey, config.unitId);

        /**
         * Reads the unit, identifying it again when the claim says nothing usable.
         *
         * @returns {Promise<JsonObject>} The payload.
         * @throws {Error} When the unit did not answer.
         */
        const read = async () => {
          const family = MODBUS_FAMILIES.find((each) => each.id === args['family']);
          const protocol = typeof args['protocol'] === 'number' ? args['protocol'] : 0;

          if (family === undefined) {
            return identify({ ...config, unitId: unit }, stop.signal, true);
          }

          const { values } = await readValues(client, config, unit, family, protocol, stop.signal);

          return { family: family.id, protocol, values };
        };

        read()
          .then((payload) => {
            context.deliver({ connectionKey: key, deviceKey, payload });
          })
          .catch((/** @type {unknown} */ error) => {
            // An inverter asleep at night, or a gateway rebooting, is the ordinary case.
            context.logger.debug({ err: error, deviceKey }, 'SolaX Modbus poll failed');
          })
          .finally(() => {
            busy.delete(id);
          });
      };

      context.report('up');

      return {
        key,

        /**
         * Refuses: this release only reads.
         *
         * @returns {Promise<unknown>} Never.
         * @throws {Error} Always.
         */
        send: () =>
          Promise.reject(new Error(`${ID} only reads: writing registers is not in this release`)),

        /**
         * Replaces the polling timers.
         *
         * @param {readonly TransportSubscription[]} subscriptions - The polls to run.
         * @returns {Promise<void>} Settles once the timers match.
         */
        apply: (subscriptions) => {
          /** @type {Map<string, TransportSubscription>} */
          const wanted = new Map();

          for (const subscription of subscriptions) {
            if (subscription.op === 'poll' && typeof subscription.args['deviceKey'] === 'string') {
              wanted.set(JSON.stringify(subscription), subscription);
            }
          }

          for (const [id, timer] of timers) {
            if (!wanted.has(id)) {
              clearInterval(timer);
              timers.delete(id);
            }
          }

          for (const [id, subscription] of wanted) {
            const deviceKey = subscription.args['deviceKey'];

            if (timers.has(id) || typeof deviceKey !== 'string') {
              continue;
            }

            const everyMs = Math.max(Number(subscription.args['everyMs'] ?? 15_000), MIN_POLL_MS);
            const timer = setInterval(() => {
              poll(id, deviceKey, subscription.args);
            }, everyMs);

            timer.unref();
            timers.set(id, timer);
            poll(id, deviceKey, subscription.args);
          }

          return Promise.resolve();
        },

        /**
         * Stops every timer and lets go of the socket.
         *
         * @returns {Promise<void>} Settles once nothing is left running.
         */
        close: () => {
          stop.abort();

          for (const timer of timers.values()) {
            clearInterval(timer);
          }

          timers.clear();
          release(config, client);

          return Promise.resolve();
        },
      };
    },

    /**
     * Identifies the unit at the address an owner typed and reads it once - or, asked with
     * `identityOnly` as the discovery sweep asks, only says who it is.
     *
     * @param {Config} config - The inverter.
     * @param {JsonObject} terms - `identityOnly: true` to skip the readings.
     * @param {AbortSignal} signal - Ends the scan.
     * @yields {Discovered} The inverter, when it answered with a serial this bundle knows.
     */
    scan: async function* scan(config, terms, signal) {
      /** @type {JsonObject | undefined} */
      let payload;

      try {
        payload = await identify(config, signal, terms['identityOnly'] !== true);
      } catch (error) {
        sdk.logger.debug(
          { err: error, host: config.host, unit: config.unitId },
          'SolaX Modbus unit not identified',
        );

        return;
      }

      yield { deviceKey: deviceKeyOf(config), payload };
    },

    /**
     * Reads the unit's serial number, the one question a Test needs answered: a slow dongle
     * answers it well inside the time a Test has.
     *
     * @param {Config} config - The inverter.
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<string>} What answered.
     * @throws {Error} When nothing answered, or what answered is not a model this bundle reads -
     * a {@link NoConnectionError}, {@link SilenceError} or {@link NoSerialError} saying what to do.
     */
    probe: async (config, signal) => {
      try {
        const payload = await identify(config, signal, false);

        return `${config.host}:${String(config.port)} unit ${String(config.unitId)} answered: ${String(payload['model'])}, serial ${String(payload['serial'])}`;
      } catch (error) {
        throw explained(error, config);
      }
    },
  });
}
