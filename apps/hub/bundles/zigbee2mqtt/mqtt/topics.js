// @ts-check
/**
 * What Zigbee2MQTT publishes, read into what the transport and the listener need.
 *
 * Zigbee2MQTT speaks on one broker under one base topic (`zigbee2mqtt`): the bridge about itself
 * under `bridge/` - `state` (online or offline), `info` (its version, the coordinator, whether
 * pairing is open), `devices` (every device it knows, each with its `exposes`) - and each device
 * under its friendly name, with `/availability` beside it. A friendly name may contain slashes, so
 * a topic is read against the names the bridge listed rather than split.
 *
 * Every device is known here by its IEEE address, which never changes, rather than by its
 * friendly name, which the owner can rename in Zigbee2MQTT at any time.
 */

/**
 * One device as `bridge/devices` lists it, the fields read.
 *
 * @typedef {object} BridgeDevice
 * @property {string} ieee_address - Its IEEE address: `0x00158d0001a2b3c4`.
 * @property {string} friendly_name - What it is called in Zigbee2MQTT.
 * @property {string} type - `Coordinator`, `Router` or `EndDevice`.
 * @property {boolean} [supported] - Whether Zigbee2MQTT knows the model.
 * @property {boolean} [disabled] - Whether the owner disabled it in Zigbee2MQTT.
 * @property {string} [interview_state] - `SUCCESSFUL` once it has been interviewed.
 * @property {boolean} [interview_completed] - The same, before Zigbee2MQTT 2.0.
 * @property {string | null} [software_build_id] - Its firmware.
 * @property {string} [power_source] - `Battery`, `Mains (single phase)`.
 * @property {Record<string, unknown> | null} [definition] - What Zigbee2MQTT knows about the
 *   model: `model`, `vendor`, `description`, `exposes`, `supports_ota`.
 */

/**
 * The bridge, as the transport hands it on: what it last said about itself.
 *
 * @typedef {object} BridgeSnapshot
 * @property {string | null} state - `online` or `offline`.
 * @property {Record<string, unknown> | null} info - What `bridge/info` said.
 * @property {number} deviceCount - How many devices it knows, the coordinator aside.
 */

/** The topic under the base that says a device's reachability. */
const AVAILABILITY = '/availability';

/** Where the bridge speaks. */
const BRIDGE = 'bridge/';

/**
 * Reads a payload as JSON, or as the text it is.
 *
 * @param {Buffer} payload - What arrived.
 * @returns {unknown} The value.
 */
export function readPayload(payload) {
  const text = payload.toString('utf8');

  try {
    return JSON.parse(text);
  } catch {
    // Zigbee2MQTT sends JSON; an older bridge said `online` as bare text.
    return text;
  }
}

/**
 * Reads `bridge/devices`.
 *
 * @param {unknown} value - What arrived.
 * @returns {BridgeDevice[]} The devices, the entries that are not devices left out.
 */
export function devicesOf(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.ieee_address === 'string' &&
      typeof entry.friendly_name === 'string',
  );
}

/**
 * Whether a device is ready to be offered: known, interviewed, not the coordinator, not switched
 * off by the owner in Zigbee2MQTT.
 *
 * @param {BridgeDevice} device - The device.
 * @returns {boolean} True when it is.
 */
export function isOfferable(device) {
  const isInterviewed =
    device.interview_state === undefined
      ? device.interview_completed !== false
      : device.interview_state === 'SUCCESSFUL';

  return (
    device.type !== 'Coordinator' &&
    device.supported !== false &&
    device.disabled !== true &&
    isInterviewed &&
    typeof device.definition === 'object' &&
    device.definition !== null
  );
}

/**
 * Reads the bridge's state, which Zigbee2MQTT 2 sends as JSON and 1 sent as text.
 *
 * @param {unknown} value - What arrived on `bridge/state`.
 * @returns {string | null} `online`, `offline`, or null.
 */
export function bridgeStateOf(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'state' in value) {
    const { state } = /** @type {{ state: unknown }} */ (value);

    return typeof state === 'string' ? state : null;
  }

  return null;
}

/**
 * What a device says as the listener proposes it, and as the transport's scan finds it.
 *
 * @param {BridgeDevice} device - The device.
 * @returns {Record<string, unknown>} `role`, `ieee`, `name`, `model`, `vendor`, `version`, and the
 *   whole entry as `device`, which the driver describes the device from.
 */
export function deviceSighting(device) {
  const definition = /** @type {Record<string, unknown>} */ (device.definition ?? {});

  return {
    role: 'device',
    ieee: device.ieee_address,
    name: device.friendly_name,
    model: typeof definition['model'] === 'string' ? definition['model'] : null,
    vendor: typeof definition['vendor'] === 'string' ? definition['vendor'] : null,
    version: device.software_build_id ?? null,
    device,
  };
}

/**
 * What the bridge says as the listener proposes it, and as the transport's scan finds it.
 *
 * @param {Record<string, unknown>} info - What `bridge/info` said.
 * @returns {Record<string, unknown> | null} `role`, `ieee` (the coordinator's), `name`, `model`,
 *   `vendor`, `version`; null before the bridge has said which coordinator it runs.
 */
export function bridgeSighting(info) {
  const coordinator = /** @type {Record<string, unknown>} */ (info['coordinator'] ?? {});
  const ieee = coordinator['ieee_address'];

  if (typeof ieee !== 'string') {
    return null;
  }

  const type = typeof coordinator['type'] === 'string' ? coordinator['type'] : 'coordinator';

  return {
    role: 'bridge',
    ieee,
    name: 'Zigbee2MQTT',
    model: `Zigbee2MQTT on ${type}`,
    vendor: 'Zigbee2MQTT',
    version: typeof info['version'] === 'string' ? info['version'] : null,
  };
}

/**
 * What a topic under the base topic is about.
 *
 * @param {string} rest - The topic, without the base topic and its slash.
 * @param {ReadonlyMap<string, string>} ieeeByName - Every device's IEEE address, by friendly name.
 * @returns {{ kind: 'bridge', what: string }
 *   | { kind: 'state', ieee: string }
 *   | { kind: 'availability', ieee: string }
 *   | null} The bridge's subject, a device's state or availability, or null for anything else -
 *   a command echoed back, a device the bridge has not listed.
 */
export function topicOf(rest, ieeeByName) {
  if (rest.startsWith(BRIDGE)) {
    return { kind: 'bridge', what: rest.slice(BRIDGE.length) };
  }

  if (rest.endsWith(AVAILABILITY)) {
    const ieee = ieeeByName.get(rest.slice(0, -AVAILABILITY.length));

    return ieee === undefined ? null : { kind: 'availability', ieee };
  }

  const ieee = ieeeByName.get(rest);

  return ieee === undefined ? null : { kind: 'state', ieee };
}

/**
 * Reads a device's availability, which Zigbee2MQTT 2 sends as JSON and 1 sent as text.
 *
 * @param {unknown} value - What arrived.
 * @returns {boolean | null} Whether it is online, or null when the message says neither.
 */
export function isOnline(value) {
  const state = bridgeStateOf(value);

  return state === 'online' ? true : state === 'offline' ? false : null;
}
