/**
 * The ops the hub sends a device that plays a role for one of its brokers - an IR blaster, a
 * Bluetooth proxy - over its instance's connection, as `{ deviceKey, op, args }`, and the GATT ops
 * the platform transport `bluetooth` carries.
 *
 * A module of its own, importing nothing, because an integration's code imports these names
 * through the SDK: the SDK's entry point is bundled into every module an integration builds, and
 * those validate with the hub's zod (`sdk.z`), never one of their own - so nothing that reaches
 * them may import zod. The arguments' schemas stay with their brokers, in `infrared.ts` and
 * `bluetooth.ts`.
 */

/**
 * The ops the hub sends a blaster over its instance's connection, as `{ deviceKey, op, args }`.
 * Reserved: no integration uses these names for anything else.
 */
export const INFRARED_OPS = {
  /** Sends a code. */
  send: 'infrared.send',

  /** Listens for one code: resolves with it, or rejects when nothing came in time. */
  learn: 'infrared.learn',

  /** Searches the RF frequency of a button held down: resolves with it. */
  sweep: 'infrared.sweep',

  /** Stops a learn or a sweep under way. */
  cancel: 'infrared.cancel',
} as const;

/**
 * The ops the hub sends a proxy over its instance's connection, as `{ deviceKey, op, args }`.
 * Reserved: no integration uses these names for anything else.
 */
export const BLUETOOTH_PROXY_OPS = {
  /** Whether it can be a proxy and whether it is: answers `bluetoothProxyStateSchema`. */
  state: 'bluetooth-proxy.state',

  /** Installs the script, or the one shipped now over an older one, and starts it scanning. */
  install: 'bluetooth-proxy.install',

  /** Stops the script and removes it. */
  remove: 'bluetooth-proxy.remove',

  /** Which addresses it forwards: the house's, or everything while Nearby is open. */
  filter: 'bluetooth-proxy.filter',
} as const;

/**
 * The ops the platform transport `bluetooth` carries to a device it connects to, GATT on the local
 * adapter only.
 */
export const BLUETOOTH_GATT_OPS = {
  read: 'gatt.read',
  write: 'gatt.write',
  notify: 'gatt.notify',
} as const;
