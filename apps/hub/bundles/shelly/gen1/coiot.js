// @ts-check
/**
 * The one UDP socket Shelly Gen1 devices are heard on: CoIoT, Shelly's dialect of CoAP.
 *
 * A Gen1 device with CoIoT on - the default since firmware 1.8 - multicasts its status to
 * 224.0.1.187, port 5683, whenever something changes, and every `update_period` seconds (15 unless
 * changed) when nothing does: a CoAP request with the non-standard code 0.30 on the URI `/cit/s`.
 *
 * The status in those packets is not read here. Its payload is a list of numbered sensors whose
 * meaning lives in a description (`/cit/d`) that differs per model and firmware; the same status,
 * named, is one HTTP request away. So a packet is taken as the device saying "read me now". Two of
 * its options make that cheap: one says who sent it - `<type>#<device id>#<version>` - and one is a
 * serial the device moves on at every change, so a periodic packet that repeats the last serial is
 * a device saying nothing new, and costs nothing.
 *
 * One socket for the whole vendor, shared by every connection, opened with the first and closed
 * with the last - the way Govee's is. The hub joins the group, and closes the socket anyway when
 * the vendor is unloaded. A port already taken is logged and leaves the devices on their timer.
 */

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').ManagedUdpSocket} ManagedUdpSocket */
/** @typedef {import('@nebula-home/package-runtime').UdpPeer} UdpPeer */

/** The multicast group Gen1 devices publish their status to. */
export const COIOT_GROUP = '224.0.1.187';

/** CoAP's port, which CoIoT keeps. */
export const COIOT_PORT = 5683;

/** The only CoAP version there is. */
const COAP_VERSION = 1;

/** The request code a status is published with: class 0, detail 30. */
const STATUS_CODE = 30;

/** The CoAP option that carries one segment of the URI path. */
const OPTION_URI_PATH = 11;

/** CoIoT's option naming the device: `<type>#<device id>#<version>`. */
const OPTION_DEVICE_ID = 3332;

/** CoIoT's option carrying the status serial, moved on at every change. */
const OPTION_SERIAL = 3420;

/** What ends the options and starts the payload. */
const PAYLOAD_MARKER = 0xff;

/** The path a status is published on. */
const STATUS_PATH = 'cit/s';

/**
 * What a status packet says about who sent it.
 *
 * @typedef {object} CoiotStatus
 * @property {string | undefined} deviceType - The model code, `SHSW-25`, when the packet names one.
 * @property {string | undefined} deviceId - The device's id: its MAC, or the last six hex digits of it.
 * @property {number | undefined} serial - Moves on at every change of status.
 */

/**
 * Called with every status packet any device publishes.
 *
 * @callback Listener
 * @param {CoiotStatus} status - What the packet says of its sender.
 * @param {UdpPeer} from - Where it came from.
 * @returns {void}
 */

/**
 * A hold on the socket.
 *
 * @typedef {object} Link
 * @property {() => Promise<void>} release - Lets go; the socket closes with the last hold.
 */

/**
 * The socket while somebody holds it.
 *
 * @type {{ socket: ManagedUdpSocket, listeners: Set<Listener> } | undefined}
 */
let shared;

/**
 * Reads an option's extended delta or length, when the nibble says it is one.
 *
 * @param {number} nibble - The four bits in the option's first byte.
 * @param {Buffer} bytes - The packet.
 * @param {number} offset - Where the extension would start.
 * @returns {{ value: number, offset: number } | undefined} The value and where reading goes on,
 * or nothing for the reserved nibble or a packet that ends too soon.
 */
function extended(nibble, bytes, offset) {
  if (nibble < 13) {
    return { value: nibble, offset };
  }

  if (nibble === 13 && offset + 1 <= bytes.length) {
    return { value: (bytes[offset] ?? 0) + 13, offset: offset + 1 };
  }

  if (nibble === 14 && offset + 2 <= bytes.length) {
    return { value: bytes.readUInt16BE(offset) + 269, offset: offset + 2 };
  }

  return undefined;
}

/**
 * Reads one datagram as a CoIoT status publish.
 *
 * @param {Buffer} bytes - What arrived on the port.
 * @returns {CoiotStatus | undefined} What the packet says of its sender, or nothing for anything
 * that is not a status publish: another CoAP message, a description, noise.
 */
export function parseCoiotStatus(bytes) {
  const first = bytes[0];

  if (bytes.length < 4 || first === undefined || first >> 6 !== COAP_VERSION) {
    return undefined;
  }

  if (bytes[1] !== STATUS_CODE) {
    return undefined;
  }

  const tokenLength = first & 0x0f;
  let offset = 4 + tokenLength;
  let number = 0;
  /** @type {string[]} */
  const path = [];
  /** @type {string | undefined} */
  let deviceField;
  /** @type {number | undefined} */
  let serial;

  if (tokenLength > 8 || offset > bytes.length) {
    return undefined;
  }

  while (offset < bytes.length) {
    const header = bytes[offset] ?? 0;

    if (header === PAYLOAD_MARKER) {
      break;
    }

    const delta = extended(header >> 4, bytes, offset + 1);
    const length = delta === undefined ? undefined : extended(header & 0x0f, bytes, delta.offset);

    if (delta === undefined || length === undefined) {
      return undefined;
    }

    const end = length.offset + length.value;

    if (end > bytes.length) {
      return undefined;
    }

    number += delta.value;

    const value = bytes.subarray(length.offset, end);

    if (number === OPTION_URI_PATH) {
      path.push(value.toString('utf8'));
    } else if (number === OPTION_DEVICE_ID) {
      deviceField = value.toString('utf8');
    } else if (number === OPTION_SERIAL && value.length > 0 && value.length <= 4) {
      serial = value.readUIntBE(0, value.length);
    }

    offset = end;
  }

  // A publish that names its path names /cit/s; one that names none is taken at its code.
  if (path.length > 0 && path.join('/') !== STATUS_PATH) {
    return undefined;
  }

  const [deviceType, deviceId] = (deviceField ?? '').split('#');

  return {
    deviceType: deviceType === undefined || deviceType.length === 0 ? undefined : deviceType,
    deviceId: deviceId === undefined || deviceId.length === 0 ? undefined : deviceId,
    serial,
  };
}

/**
 * Takes a hold on the socket, opening it if nobody holds it yet.
 *
 * @param {BundleSdk} sdk - What the hub handed the vendor.
 * @param {Listener} listener - Called with every status packet while the hold lasts.
 * @returns {Link} The hold.
 */
export function acquire(sdk, listener) {
  if (shared === undefined) {
    /** @type {Set<Listener>} */
    const listeners = new Set();

    shared = {
      listeners,
      socket: sdk.openUdpSocket({
        port: COIOT_PORT,
        reuseAddr: true,
        multicast: { group: COIOT_GROUP },

        /**
         * Hands every status packet to everybody holding the socket.
         *
         * @param {Buffer} bytes - What arrived.
         * @param {UdpPeer} from - Who sent it.
         */
        onMessage: (bytes, from) => {
          const status = parseCoiotStatus(bytes);

          if (status !== undefined) {
            for (const each of listeners) {
              each(status, from);
            }
          }
        },

        /**
         * Says the devices are down to their timer. The hub has logged the failure already.
         *
         * @param {Error} error - What failed: most often the port, taken by something else.
         */
        onError: (error) => {
          sdk.logger.info(
            { err: error },
            'Shelly Gen1 devices are not heard over CoIoT; each is read on its timer alone',
          );
        },
      }),
    };
  }

  const held = shared;
  let isHeld = true;

  held.listeners.add(listener);

  return {
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
