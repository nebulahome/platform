// @ts-check
/**
 * The one UDP socket Govee lights answer on.
 *
 * The LAN API sends every answer - to a scan, to a status request - to port 4002 of whoever
 * asked, whichever light it comes from. So there is one socket bound to 4002 for the whole
 * vendor, shared by the transport's connections and by the discovery listener, each of which
 * hears every answer and keeps what is theirs. The socket opens with the first user and closes
 * with the last; the hub closes it anyway when the vendor is unloaded.
 *
 * This module is imported by both `transport.js` and `discovery.js`, and a module is evaluated
 * once however many times it is imported, which is what makes the socket one.
 */

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').ManagedUdpSocket} ManagedUdpSocket */
/** @typedef {import('@nebula-home/package-runtime').UdpPeer} UdpPeer */

/** Where a light listens for a scan. */
export const SCAN_PORT = 4001;

/** Where lights answer, whatever they were asked. */
export const REPLY_PORT = 4002;

/** Where a light takes its commands and status requests. */
export const COMMAND_PORT = 4003;

/** The multicast group a scan goes to. */
export const SCAN_GROUP = '239.255.255.250';

/**
 * One message of the LAN API, as it travels inside `{ "msg": … }`.
 *
 * @typedef {object} LanMessage
 * @property {string} cmd - What it is: `scan`, `devStatus`, `turn`, `brightness`, `colorwc`.
 * @property {Record<string, unknown>} data - What it carries.
 */

/**
 * Called with every answer any light sends.
 *
 * @callback Listener
 * @param {LanMessage} message - The answer.
 * @param {UdpPeer} from - Who sent it.
 * @returns {void}
 */

/**
 * A hold on the socket.
 *
 * @typedef {object} Link
 * @property {(message: LanMessage, address: string, port: number) => Promise<void>} send - Sends
 * one message.
 * @property {() => Promise<void>} release - Lets go; the socket closes with the last hold.
 */

/**
 * The socket while somebody holds it.
 *
 * @type {{ socket: ManagedUdpSocket, listeners: Set<Listener> } | undefined}
 */
let shared;

/**
 * Reads one datagram as a LAN API message.
 *
 * @param {Buffer} bytes - What arrived.
 * @returns {LanMessage | undefined} The message, or nothing for anything else on the port.
 */
function messageOf(bytes) {
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    const msg = parsed?.msg;

    return typeof msg?.cmd === 'string' && typeof msg?.data === 'object' && msg.data !== null
      ? { cmd: msg.cmd, data: msg.data }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Takes a hold on the socket, opening it if nobody holds it yet.
 *
 * @param {BundleSdk} sdk - What the hub handed the vendor.
 * @param {Listener} listener - Called with every answer while the hold lasts.
 * @returns {Link} The hold.
 */
export function acquire(sdk, listener) {
  if (shared === undefined) {
    /** @type {Set<Listener>} */
    const listeners = new Set();

    shared = {
      listeners,
      socket: sdk.openUdpSocket({
        port: REPLY_PORT,
        reuseAddr: true,
        /**
         * Hands every answer to everybody holding the socket.
         *
         * @param {Buffer} bytes - What arrived.
         * @param {UdpPeer} from - Who sent it.
         */
        onMessage: (bytes, from) => {
          const message = messageOf(bytes);

          if (message !== undefined) {
            for (const each of listeners) {
              each(message, from);
            }
          }
        },
        /**
         * Logs a failure of the socket.
         *
         * @param {Error} error - What failed.
         */
        onError: (error) => {
          sdk.logger.warn({ err: error }, 'The Govee LAN socket failed');
        },
      }),
    };
  }

  const held = shared;
  let isHeld = true;

  held.listeners.add(listener);

  return {
    /**
     * Sends one message.
     *
     * @param {LanMessage} message - What to send.
     * @param {string} address - To whom.
     * @param {number} port - On which port.
     * @returns {Promise<void>} Settles once it is sent.
     */
    send: async (message, address, port) => {
      await held.socket.send(JSON.stringify({ msg: message }), port, address);
    },
    /**
     * Lets go; the socket closes with the last hold.
     *
     * @returns {Promise<void>} Settles once let go of.
     */
    release: async () => {
      if (!isHeld) {
        return;
      }

      isHeld = false;
      held.listeners.delete(listener);

      if (held.listeners.size === 0 && shared === held) {
        shared = undefined;
        await held.socket.close();
      }
    },
  };
}

/**
 * The address a scan answer came from: the one the light says it has, or where it came from.
 *
 * @param {LanMessage} message - The answer.
 * @param {UdpPeer} from - Who sent it.
 * @returns {string} The light's address.
 */
export function addressOf(message, from) {
  const ip = message.data['ip'];

  return typeof ip === 'string' && ip.length > 0 ? ip : from.address;
}
