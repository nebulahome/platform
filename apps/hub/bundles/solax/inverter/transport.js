// @ts-check
/**
 * A SolaX inverter, whichever way it is reached: over Modbus TCP, or through its dongle's web API.
 *
 * The owner picks in the form - "Connection" - and this transport hands every request to the one
 * that speaks it:
 *
 * - `modbus` (the default): `solax/modbus`, for a Pocket WiFi 3.0 on firmware 3.004.03 or later,
 *   the LAN port of a second- or third-generation hybrid, or an RS485 adapter on the COM port;
 * - `dongle`: `solax/local`, for a Pocket WiFi 2.0, a Pocket LAN, or a Pocket WiFi 3.0 on older
 *   firmware.
 *
 * Both already deliver the same named readings - `values.battery_power` means the same either way
 * - so one profile reads the inverter whichever way it is reached. What still differs is made the
 * same here, on every payload:
 *
 * - `serial` is the inverter's own serial number: read from its registers over Modbus, and from
 *   the dongle's `Information` through the web API where the dongle reports it; the dongle's `sn`
 *   stands in when it does not, and goes along as `dongleSerial` whenever there is one;
 * - `protocol`, SolaX's register document version, is 0 through the web API, which has none;
 * - `connection` says which way it was read.
 *
 * A Test that fails says which way to try instead when the failure points at one: a dongle whose
 * web API answers HTTP 405 has closed it to the LAN, and a Pocket WiFi 3.0 answers Modbus TCP; a
 * dongle that takes no Modbus connection may be one on older firmware, whose web API answers.
 *
 * This file is what ships in the bundle. It imports nothing from the platform, only the vendor's
 * two transports beside it.
 */
import createSolaxLocal from '../local/transport.js';
import createSolaxModbus, { NoConnectionError } from '../modbus/transport.js';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').Transport} Transport */
/** @typedef {import('@nebulahome/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebulahome/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebulahome/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebulahome/contracts').JsonObject} JsonObject */

/**
 * Which way the inverter is read.
 *
 * @typedef {'modbus' | 'dongle'} Connection
 */

/**
 * What an owner configures: the way, and whatever that way asks for - the Modbus server's port,
 * unit and framing, or the dongle's username and password. Each transport reads its own keys.
 *
 * @typedef {{ connection: Connection } & Record<string, unknown>} Config
 */

/** The id this transport registers under: the vendor's, then the name in `manifest.json`. */
const ID = 'solax/inverter';

/** The ways, the first being the default. */
const CONNECTIONS = /** @type {const} */ (['modbus', 'dongle']);

/** What the form's choice is called, for the advice a failed Test gives. */
const CONNECTION_LABELS = /** @type {const} */ ({
  modbus: "'Modbus TCP'",
  dongle: "'Dongle web API'",
});

/**
 * Makes a payload the same whichever way it was read.
 *
 * @param {unknown} payload - What the transport delivered.
 * @param {Connection} connection - Which way it was read.
 * @returns {unknown} The payload with `serial`, `dongleSerial`, `protocol` and `connection` as
 * the head of this file says; anything that is not an object, unchanged.
 */
export function normalized(payload, connection) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }

  const raw = /** @type {JsonObject} */ (payload);
  const inverterSerial =
    typeof raw['serial'] === 'string'
      ? raw['serial']
      : typeof raw['inverterSn'] === 'string'
        ? raw['inverterSn']
        : undefined;
  const dongleSerial = typeof raw['sn'] === 'string' ? raw['sn'] : undefined;
  const serial = inverterSerial ?? dongleSerial;

  return {
    ...raw,
    ...(serial === undefined ? {} : { serial }),
    ...(dongleSerial === undefined ? {} : { dongleSerial }),
    protocol: typeof raw['protocol'] === 'number' ? raw['protocol'] : 0,
    connection,
  };
}

/**
 * A failed Test's error, with the other way suggested when the failure points at it.
 *
 * @param {unknown} error - What the chosen way failed with.
 * @param {Connection} connection - The way that was tried.
 * @returns {unknown} The error to throw.
 */
function withAdvice(error, connection) {
  if (!(error instanceof Error)) {
    return error;
  }

  if (connection === 'dongle' && error.cause === 'locked') {
    return new Error(`${error.message} - set Connection to ${CONNECTION_LABELS.modbus}`, {
      cause: error.cause,
    });
  }

  if (connection === 'dongle' && error.cause === 'unreachable') {
    return new Error(
      `${error.message}; for a Pocket WiFi 3.0, set Connection to ${CONNECTION_LABELS.modbus}`,
      { cause: error.cause },
    );
  }

  if (connection === 'modbus' && error instanceof NoConnectionError) {
    return new NoConnectionError(
      `${error.message} - for one of those, set Connection to ${CONNECTION_LABELS.dongle}`,
      { cause: error },
    );
  }

  return error;
}

/**
 * Makes the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {Transport} The transport, registered as `solax/inverter`.
 */
export default function createSolaxInverter(sdk) {
  const { z } = sdk;
  const ways = /** @type {const} */ ({
    modbus: createSolaxModbus(sdk),
    dongle: createSolaxLocal(sdk),
  });

  /**
   * What a connection is shared under: the way, then what that way shares it under.
   *
   * @param {Config} config - The settings.
   * @returns {string} The key.
   */
  const connectionKeyOf = (config) =>
    `${ID}:${config.connection}:${ways[config.connection].connectionKey(config)}`;

  return sdk.defineTransport({
    id: ID,
    configSchema: z.looseObject({
      connection: z.enum(CONNECTIONS).default('modbus'),
    }),

    connectionKey: connectionKeyOf,

    /**
     * Opens the chosen way's connection, and makes what it delivers the same either way.
     *
     * @param {Config} config - The inverter.
     * @param {TransportContext} context - Where readings go.
     * @returns {Promise<TransportConnection>} The connection.
     */
    connect: async (config, context) => {
      const key = connectionKeyOf(config);
      const inner = await ways[config.connection].connect(config, {
        logger: context.logger,
        report: context.report,

        /**
         * Hands a reading on, as this transport's and made the same.
         *
         * @param {import('@nebulahome/package-runtime').TransportInbound} message - What the way
         * delivered.
         */
        deliver: (message) => {
          context.deliver({
            ...message,
            connectionKey: key,
            payload: normalized(message.payload, config.connection),
          });
        },
      });

      return { ...inner, key };
    },

    /**
     * Asks the chosen way who is at the address.
     *
     * @param {Config} config - The inverter.
     * @param {JsonObject} terms - Handed on.
     * @param {AbortSignal} signal - Ends the scan.
     * @yields {Discovered} What the way found, made the same.
     */
    scan: async function* scan(config, terms, signal) {
      for await (const found of ways[config.connection].scan(config, terms, signal)) {
        yield { ...found, payload: normalized(found.payload, config.connection) };
      }
    },

    /**
     * Tries the chosen way, and says which to try instead when its failure points there.
     *
     * @param {Config} config - The inverter.
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<string>} What answered.
     * @throws {Error} When nothing answered, naming why.
     */
    probe: async (config, signal) => {
      try {
        return await ways[config.connection].probe(config, signal);
      } catch (error) {
        throw withAdvice(error, config.connection);
      }
    },
  });
}
