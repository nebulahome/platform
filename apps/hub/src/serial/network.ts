/**
 * Serial ports on the network: a ser2net, an ESP serial bridge, a terminal server.
 *
 * Two ways to speak one. Raw TCP is the port's bytes and nothing else: the line is set on the
 * bridge itself. RFC 2217 is Telnet with the COM-PORT-OPTION, which carries the line too: the hub
 * offers the option, and once the server says DO it sends the baud rate, data bits, parity, stop
 * bits and flow control as subnegotiations. Telnet reserves the byte 0xFF (IAC), so every 0xFF of
 * the port's bytes, both ways and inside a subnegotiation's value, is sent twice.
 *
 * Either way the open port is a {@link SerialSession}, the shape a local port has.
 */
import net from 'node:net';

import type { SerialLine, SerialNetworkAddress } from '@nebulahome/contracts';
import type { SerialSession } from '@nebulahome/package-runtime';

/** How long a port on the network has to take the connection, and to agree to RFC 2217. */
export const NETWORK_OPEN_TIMEOUT_MS = 5000;

/** Telnet's bytes (RFC 854, 855). */
export const IAC = 0xff;
const DONT = 0xfe;
export const DO = 0xfd;
const WONT = 0xfc;
export const WILL = 0xfb;
export const SB = 0xfa;
export const SE = 0xf0;

/** The options the hub offers: binary both ways, no go-ahead, and the COM port (RFC 2217). */
const BINARY = 0;
const SUPPRESS_GO_AHEAD = 3;
export const COM_PORT_OPTION = 44;

/** The COM-PORT-OPTION commands the hub sends. */
export const SET_BAUDRATE = 1;
const SET_DATASIZE = 2;
const SET_PARITY = 3;
const SET_STOPSIZE = 4;
const SET_CONTROL = 5;

/** RFC 2217's values for a parity. */
const PARITY: Readonly<Record<SerialLine['parity'], number>> = {
  none: 1,
  odd: 2,
  even: 3,
  mark: 4,
  space: 5,
};

/** RFC 2217's values for the stop bits: 1.5 is 3. */
const STOP_BITS: Readonly<Record<SerialLine['stopBits'], number>> = { 1: 1, 2: 2, 1.5: 3 };

/** RFC 2217's values for the flow control. */
const FLOW: Readonly<Record<SerialLine['flowControl'], number>> = {
  none: 1,
  xonxoff: 2,
  rtscts: 3,
};

/**
 * Bytes with every IAC doubled.
 *
 * @param bytes - The bytes.
 * @returns Them, escaped for Telnet.
 */
export function escapeIac(bytes: Uint8Array): Buffer {
  const out: number[] = [];

  for (const byte of bytes) {
    out.push(byte);

    if (byte === IAC) {
      out.push(IAC);
    }
  }

  return Buffer.from(out);
}

/**
 * One COM-PORT-OPTION subnegotiation.
 *
 * @param command - The command.
 * @param value - Its value's bytes.
 * @returns `IAC SB 44 <command> <value, escaped> IAC SE`.
 */
function subnegotiation(command: number, value: readonly number[]): Buffer {
  return Buffer.concat([
    Buffer.from([IAC, SB, COM_PORT_OPTION, command]),
    escapeIac(Uint8Array.from(value)),
    Buffer.from([IAC, SE]),
  ]);
}

/**
 * The subnegotiations that set a line.
 *
 * @param line - The line.
 * @returns Them, one after the other.
 */
export function lineSubnegotiations(line: SerialLine): Buffer {
  const baud = Buffer.alloc(4);

  baud.writeUInt32BE(line.baudRate);

  return Buffer.concat([
    subnegotiation(SET_BAUDRATE, [...baud]),
    subnegotiation(SET_DATASIZE, [line.dataBits]),
    subnegotiation(SET_PARITY, [PARITY[line.parity]]),
    subnegotiation(SET_STOPSIZE, [STOP_BITS[line.stopBits]]),
    subnegotiation(SET_CONTROL, [FLOW[line.flowControl]]),
  ]);
}

/** What a Telnet peer asked or answered about an option. */
type Negotiation = { readonly verb: number; readonly option: number };

/**
 * Takes Telnet apart, chunk by chunk: the port's bytes out, the negotiations aside, the
 * subnegotiations (the server's answers to the COM port commands) dropped. A sequence cut between
 * two chunks is picked up where it stopped.
 */
export class TelnetDecoder {
  #state: 'data' | 'iac' | 'option' | 'sb' | 'sb-iac' = 'data';
  #verb = 0;

  /**
   * Reads one chunk.
   *
   * @param chunk - What arrived.
   * @returns The port's bytes in it, and what was negotiated.
   */
  push(chunk: Uint8Array): { data: Buffer; negotiations: Negotiation[] } {
    const data: number[] = [];
    const negotiations: Negotiation[] = [];

    for (const byte of chunk) {
      switch (this.#state) {
        case 'data':
          if (byte === IAC) {
            this.#state = 'iac';
          } else {
            data.push(byte);
          }

          break;
        case 'iac':
          if (byte === IAC) {
            data.push(IAC);
            this.#state = 'data';
          } else if (byte >= WILL && byte <= DONT) {
            this.#verb = byte;
            this.#state = 'option';
          } else {
            // SB opens a subnegotiation; any other command (NOP, GA…) is two bytes long.
            this.#state = byte === SB ? 'sb' : 'data';
          }

          break;
        case 'option':
          negotiations.push({ verb: this.#verb, option: byte });
          this.#state = 'data';
          break;
        case 'sb':
          if (byte === IAC) {
            this.#state = 'sb-iac';
          }

          break;
        case 'sb-iac':
          // IAC SE ends it; IAC IAC is an escaped 0xFF inside it.
          this.#state = byte === SE ? 'data' : 'sb';
          break;
      }
    }

    return { data: Buffer.from(data), negotiations };
  }
}

/** Options the hub offers itself and asks of the server, and so answers to neither. */
const OFFERED = new Set([BINARY, SUPPRESS_GO_AHEAD, COM_PORT_OPTION]);

/**
 * Opens a port on the network.
 *
 * @param address - Where it is, and how it is spoken to.
 * @param line - How it is spoken, sent to an RFC 2217 server; null leaves the server's line as it
 * is, as a test does. A raw TCP bridge has its own.
 * @param timeoutMs - How long it has to answer.
 * @returns The open port.
 * @throws {Error} When nothing answered, or an RFC 2217 server refused the COM port.
 */
export async function openNetworkPort(
  address: SerialNetworkAddress,
  line: SerialLine | null,
  timeoutMs = NETWORK_OPEN_TIMEOUT_MS,
): Promise<SerialSession> {
  const socket = net.connect({ host: address.host, port: address.port });
  const isTelnet = address.protocol === 'rfc2217';
  const decoder = new TelnetDecoder();
  const dataListeners = new Set<(bytes: Uint8Array) => void>();
  let reason = 'Closed';

  socket.setNoDelay(true);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            isTelnet
              ? `${address.host}:${String(address.port)} did not agree to RFC 2217 in time`
              : `Nothing answered at ${address.host}:${String(address.port)} in time`,
          ),
        );
      }, timeoutMs);

      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once('close', () => {
        clearTimeout(timer);
        reject(new Error(`${address.host}:${String(address.port)} closed the connection`));
      });

      socket.once('connect', () => {
        if (!isTelnet) {
          clearTimeout(timer);
          resolve();

          return;
        }

        socket.write(
          Buffer.from([
            ...[IAC, WILL, BINARY, IAC, DO, BINARY],
            ...[IAC, WILL, SUPPRESS_GO_AHEAD, IAC, DO, SUPPRESS_GO_AHEAD],
            ...[IAC, WILL, COM_PORT_OPTION],
          ]),
        );
      });

      socket.on('data', (chunk: Buffer) => {
        if (!isTelnet) {
          for (const listener of dataListeners) {
            listener(chunk);
          }

          return;
        }

        const { data, negotiations } = decoder.push(chunk);

        for (const { verb, option } of negotiations) {
          if (option === COM_PORT_OPTION && verb === DO) {
            if (line !== null) {
              socket.write(lineSubnegotiations(line));
            }

            clearTimeout(timer);
            resolve();
          } else if (option === COM_PORT_OPTION && verb === DONT) {
            clearTimeout(timer);
            reject(new Error(`${address.host}:${String(address.port)} does not speak RFC 2217`));
          } else if (!OFFERED.has(option) && (verb === DO || verb === WILL)) {
            // Refuse what was not offered, as Telnet asks.
            socket.write(Buffer.from([IAC, verb === DO ? WONT : DONT, option]));
          }
        }

        if (data.length > 0) {
          for (const listener of dataListeners) {
            listener(data);
          }
        }
      });
    });
  } catch (error: unknown) {
    socket.destroy();
    throw error;
  }

  socket.removeAllListeners('error');
  socket.removeAllListeners('close');
  socket.on('error', (error) => {
    reason = error.message;
  });

  return {
    /**
     * Sends bytes, each IAC doubled over Telnet.
     *
     * @param bytes - The bytes.
     * @returns Once the socket took them.
     */
    write: async (bytes) =>
      new Promise<void>((resolve, reject) => {
        if (socket.destroyed) {
          reject(Object.assign(new Error('The port is closed'), { name: 'SerialClosed' }));

          return;
        }

        socket.write(isTelnet ? escapeIac(bytes) : Buffer.from(bytes), (error) => {
          if (error === undefined || error === null) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
    /**
     * Hears the port's bytes.
     *
     * @param listener - Called with each chunk.
     * @returns Stops hearing.
     */
    onData: (listener) => {
      dataListeners.add(listener);

      return () => dataListeners.delete(listener);
    },

    /**
     * Hears the connection go.
     *
     * @param listener - Called with why.
     * @returns Stops hearing.
     */
    onClose: (listener) => {
      /** Says why the connection went. */
      const closed = (): void => {
        listener(reason);
      };

      socket.once('close', closed);

      return () => socket.off('close', closed);
    },

    /**
     * Closes the connection once what was written went out.
     *
     * @returns Once closed.
     */
    close: async () =>
      new Promise<void>((resolve) => {
        if (socket.destroyed) {
          resolve();

          return;
        }

        socket.once('close', () => {
          resolve();
        });
        // What was written goes out first; a peer that never closes its side is not waited for.
        socket.end(() => {
          socket.destroy();
        });
      }),
  };
}
