// @ts-check
/**
 * Finding SolaX inverters: asking the house network, since nothing of SolaX's announces itself.
 *
 * A Pocket WiFi or Pocket LAN dongle speaks no mDNS and no SSDP, and neither does a Modbus TCP
 * server. So this listener does what the owner would do by hand: it asks every address of the
 * networks the hub is on - read from the interface's own netmask, so a /22 is 1022 addresses and
 * not the 254 of a /24 guessed from the address - on the two ports SolaX answers on:
 *
 * - **502**, Modbus TCP: the serial number, in seven holding registers at 0x0 (0x300, 0x1A10 as
 *   the transport falls back), which no password guards and whose prefix says the model;
 * - **80**, the dongle's local API: `ReadRealTimeData` without a password, which an older dongle
 *   - or one whose password is empty - answers with its data. One with a password answers with a
 *   refusal that says nothing about who it is, and is not proposed: it is added by address.
 *
 * An address is asked only once its port accepts a connection, with a short timeout, a few dozen
 * at a time; the whole of a /22 takes seconds. Asked when listening starts, every half hour after,
 * and whenever the owner asks to look now. Networks wider than a /22 are asked only around the
 * hub's own address - a /16 of a campus is not a house.
 *
 * What answers is reported as it is, through the vendor's own transports' identification, so a
 * device is proposed exactly as it will be identified; which driver takes it is the vendor's
 * `discovery.json`'s to decide.
 */
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

import createSolaxLocal from '../local/transport.js';
import { MODBUS_MODELS } from '../modbus/families.js';
import createSolaxModbus from '../modbus/transport.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').DiscoverySource} DiscoverySource */
/** @typedef {import('@nebula-home/package-runtime').Sighting} Sighting */
/** @typedef {import('@nebula-home/package-runtime').Transport} Transport */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */

/** How often the network is asked again. */
const SWEEP_INTERVAL_MS = 30 * 60_000;

/** How long an address has to accept a connection before it is taken to have nothing there. */
const CONNECT_TIMEOUT_MS = 600;

/** How long an address that accepted has to answer who it is. */
const ASK_TIMEOUT_MS = 5000;

/** How many addresses are asked at once. */
const CONCURRENCY = 48;

/** The names virtual machines' and containers' network interfaces go by. */
const VIRTUAL_INTERFACE =
  /^(?:vEthernet|docker|br-|veth|virbr|vmnet|vboxnet|VirtualBox|Hyper-V|WSL|tailscale|zt)/iu;

/** The widest network asked whole: a /22, 1022 addresses. */
const WIDEST_PREFIX = 22;

/**
 * An IPv4 address as a number.
 *
 * @param {string} address - Dotted quad.
 * @returns {number} The number, unsigned.
 */
function toNumber(address) {
  return address.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
}

/**
 * A number as an IPv4 address.
 *
 * @param {number} value - Unsigned.
 * @returns {string} Dotted quad.
 */
function toAddress(value) {
  return [24, 16, 8, 0].map((shift) => String(Math.floor(value / 2 ** shift) % 256)).join('.');
}

/**
 * Whether an address is one a house network uses.
 *
 * @param {string} address - Dotted quad.
 * @returns {boolean} True for 10/8, 172.16/12 and 192.168/16.
 */
function isPrivate(address) {
  const [a = 0, b = 0] = address.split('.').map(Number);

  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The addresses of one network, the hub's own left out.
 *
 * @param {string} address - The hub's address on it.
 * @param {number} prefix - The network's prefix length, from its netmask.
 * @returns {string[]} Every other host address, at most a /22's worth.
 */
export function hostsOf(address, prefix) {
  const bits = Math.max(prefix, WIDEST_PREFIX);

  if (bits >= 31) {
    return [];
  }

  const size = 2 ** (32 - bits);
  const own = toNumber(address);
  const network = own - (own % size);
  /** @type {string[]} */
  const hosts = [];

  for (let value = network + 1; value < network + size - 1; value += 1) {
    if (value !== own) {
      hosts.push(toAddress(value));
    }
  }

  return hosts;
}

/**
 * The addresses of every house network the hub is on.
 *
 * @returns {string[]} Every host address, each once.
 */
export function lanHosts() {
  /** @type {Set<string>} */
  const hosts = new Set();

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    // A virtual machine's or a container's network is not the house's: sweeping it finds
    // nothing, a thousand addresses at a time.
    if (VIRTUAL_INTERFACE.test(name)) {
      continue;
    }

    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivate(entry.address)) {
        continue;
      }

      const prefix = Number(entry.cidr?.split('/')[1] ?? 24);

      for (const host of hostsOf(entry.address, prefix)) {
        hosts.add(host);
      }
    }
  }

  return [...hosts];
}

/**
 * Whether a port accepts a connection.
 *
 * @param {string} host - The address.
 * @param {number} port - The port.
 * @param {AbortSignal} signal - Gives up.
 * @returns {Promise<boolean>} True when it accepted, within the timeout.
 */
export function isOpen(host, port, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);

      return;
    }

    const socket = connect({ host, port });
    /**
     * Settles once, and lets the socket go.
     *
     * @param {boolean} value - Whether it accepted.
     */
    const done = (value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abandon);
      socket.destroy();
      resolve(value);
    };
    /** Gives up. */
    const abandon = () => {
      done(false);
    };
    const timer = setTimeout(abandon, CONNECT_TIMEOUT_MS);

    signal.addEventListener('abort', abandon, { once: true });
    socket.once('connect', () => {
      done(true);
    });
    socket.once('error', abandon);
  });
}

/**
 * The first answer a transport's scan gives for one address, or nothing.
 *
 * @param {Transport} transport - The transport.
 * @param {JsonObject} config - The address, in its terms.
 * @param {AbortSignal} signal - Gives up.
 * @returns {Promise<JsonObject | undefined>} What answered.
 */
async function firstAnswer(transport, config, signal) {
  const asked = AbortSignal.any([signal, AbortSignal.timeout(ASK_TIMEOUT_MS)]);

  try {
    for await (const found of transport.scan(config, {}, asked)) {
      const { payload } = found;

      return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? /** @type {JsonObject} */ (payload)
        : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Asks one address on both ports.
 *
 * @param {Transport} modbus - The vendor's Modbus transport.
 * @param {Transport} local - The vendor's dongle transport.
 * @param {string} host - The address.
 * @param {AbortSignal} signal - Gives up.
 * @returns {Promise<Sighting[]>} What answered as SolaX.
 */
async function ask(modbus, local, host, signal) {
  /** @type {Sighting[]} */
  const found = [];

  if (await isOpen(host, 502, signal)) {
    const config = { host, port: 502, unitId: 1, framing: 'tcp' };
    const payload = await firstAnswer(modbus, config, signal);
    const serial = payload?.['serial'];

    if (payload !== undefined && typeof serial === 'string') {
      const model = MODBUS_MODELS.find((each) => serial.startsWith(each.prefix));

      found.push({
        config,
        payload: { ...payload, ...(model === undefined ? {} : { prefix: model.prefix }) },
      });
    }
  }

  if (await isOpen(host, 80, signal)) {
    const config = { host };
    const payload = await firstAnswer(local, config, signal);

    if (payload !== undefined && typeof payload['sn'] === 'string') {
      found.push({ config, payload });
    }
  }

  return found;
}

/**
 * Makes the listener.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {DiscoverySource} The listener.
 */
export default function createSolaxDiscovery(sdk) {
  const quiet = { ...sdk, logger: sdk.logger.child({ module: 'solax/discovery' }) };
  const modbus = createSolaxModbus(quiet);
  const local = createSolaxLocal(quiet);
  /** @type {(() => void) | undefined} */
  let sweepNow;

  return {
    /**
     * Asks the network, and reports every SolaX that answers, until told to stop.
     *
     * @param {AbortSignal} signal - Ends the listening.
     * @yields {Sighting} Each inverter or dongle, each time it answers.
     */
    listen: async function* listen(signal) {
      /** @type {Sighting[]} */
      const heard = [];
      /** @type {(() => void) | undefined} */
      let wake;
      let isSweeping = false;

      /** Asks every address, a few dozen at a time, unless a sweep is running already. */
      const sweep = () => {
        if (isSweeping || signal.aborted) {
          return;
        }

        isSweeping = true;

        const hosts = lanHosts();
        let next = 0;

        /**
         * Asks addresses one after the other until none is left.
         *
         * @returns {Promise<void>} Settles when the list is done.
         */
        const worker = async () => {
          while (next < hosts.length && !signal.aborted) {
            const host = hosts[next];

            next += 1;

            if (host === undefined) {
              continue;
            }

            // One address at a time per worker, by design: the workers are the concurrency.
            // eslint-disable-next-line no-await-in-loop -- see above
            for (const each of await ask(modbus, local, host, signal)) {
              heard.push(each);
              wake?.();
            }
          }
        };

        void Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => {
          isSweeping = false;
          sdk.logger.debug({ addresses: hosts.length }, 'SolaX sweep done');
        });
      };
      const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

      timer.unref();
      sweepNow = sweep;
      sweep();

      try {
        while (!signal.aborted) {
          const found = heard.shift();

          if (found !== undefined) {
            yield found;
            continue;
          }

          // One wait at a time, by design: the next answer, or the end of listening.
          // eslint-disable-next-line no-await-in-loop -- see above
          await new Promise((resolve) => {
            /** Wakes the loop for the answer that just arrived, or for the end. */
            wake = () => {
              resolve(undefined);
            };
            signal.addEventListener('abort', wake, { once: true });
          });
          wake = undefined;
        }
      } finally {
        clearInterval(timer);
        sweepNow = undefined;
      }
    },

    /**
     * Asks the network again now, while listening; answers arrive through `listen`.
     */
    scan: () => {
      sweepNow?.();
    },
  };
}
