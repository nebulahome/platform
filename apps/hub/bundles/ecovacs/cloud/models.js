// @ts-check
/**
 * Which robot on the account is which: a GOAT mower, a DEEBOT vacuum, or one this bundle does not
 * drive - from the product category and the product name ECOVACS lists it under.
 *
 * The cloud's device list names each robot's product in words - `GOAT G1-800`, `DEEBOT X1 OMNI` -
 * and a category (`GOATBOT`, `DEEBOT`). What that decides:
 *
 * - **the driver** - `mower` or `vacuum` - and the model the device is added as, a code the
 *   driver's `modelCodes` maps to one of its models;
 * - **the dialect** its commands are spoken in. The GOATs speak two: `g1` - the G1 line (G1,
 *   G1-800, G1-1600, G1-2000): `clean_V2` and `getCleanInfo_V2`, UWB beacons, validated against a
 *   G1-800 by the ecovacs-goat-g1 project - and `rtk` - the O series (O800 RTK first, confirmed from
 *   a capture): `clean` and `getCleanInfo`, every act with `content.type = "auto"`. The DEEBOTs
 *   speak `v2` - `clean_V2` with a `content`, every model since the OZMO T8 - or `v1`, `clean` with
 *   a type, the older ones. A wrong guess costs one refused request: the transport falls back to
 *   the other dialect when a robot answers that it does not know a command.
 *
 * A robot neither a GOAT nor a DEEBOT - an AIRBOT air purifier, a WINBOT window cleaner - is left
 * alone, and said so on the vendor's page. Longer names first: `O1200 LiDAR Pro` is not an `O1200`.
 */

/**
 * One robot model the bundle offers.
 *
 * @typedef {object} RobotModel
 * @property {string} code - What the driver's `modelCodes` maps: `g1-800`, `x1-omni`.
 * @property {Dialect} dialect - Which dialect its commands are in.
 * @property {RegExp} pattern - What a product name, in upper case without spaces or dashes,
 *   holds when it is this one.
 */

/** @typedef {'g1' | 'rtk' | 'v1' | 'v2'} Dialect */

/** @type {readonly RobotModel[]} */
const GOATS = [
  { code: 'o1200-lidar-pro', dialect: 'rtk', pattern: /O1200LIDARPRO/u },
  { code: 'o1000-lidar-pro', dialect: 'rtk', pattern: /O1000/u },
  { code: 'a3000-lidar-pro', dialect: 'rtk', pattern: /A3000LIDARPRO/u },
  { code: 'a3000-lidar', dialect: 'rtk', pattern: /A3000/u },
  { code: 'a2000-lidar-pro', dialect: 'rtk', pattern: /A2000/u },
  { code: 'a1600-rtk', dialect: 'rtk', pattern: /A1600/u },
  { code: 'o1200-rtk', dialect: 'rtk', pattern: /O1200/u },
  { code: 'o800-rtk', dialect: 'rtk', pattern: /O800/u },
  { code: 'o500-panorama', dialect: 'rtk', pattern: /O500/u },
  { code: 'g1-2000', dialect: 'g1', pattern: /G12000/u },
  { code: 'g1-1600', dialect: 'g1', pattern: /G11600/u },
  { code: 'g1-800', dialect: 'g1', pattern: /G1800|G800/u },
  { code: 'gx-600', dialect: 'g1', pattern: /GX600/u },
  { code: 'g1', dialect: 'g1', pattern: /G1/u },
];

/** @type {readonly RobotModel[]} */
const DEEBOTS = [
  { code: 'x5-omni', dialect: 'v2', pattern: /X5/u },
  { code: 'x2-omni', dialect: 'v2', pattern: /X2/u },
  { code: 'x1-omni', dialect: 'v2', pattern: /X1/u },
  { code: 't30-omni', dialect: 'v2', pattern: /T30/u },
  { code: 't20-omni', dialect: 'v2', pattern: /T20/u },
  { code: 't10', dialect: 'v2', pattern: /T10/u },
  { code: 't9', dialect: 'v2', pattern: /T9/u },
  { code: 't8', dialect: 'v2', pattern: /T8/u },
  { code: 'n20', dialect: 'v2', pattern: /N20/u },
  { code: 'n10', dialect: 'v2', pattern: /N10/u },
  { code: 'n8', dialect: 'v2', pattern: /N8/u },
  { code: 'ozmo-950', dialect: 'v1', pattern: /OZMO950|OZMO920/u },
  { code: 'ozmo-900', dialect: 'v1', pattern: /OZMO9/u },
];

/**
 * What a robot on the account is, for the drivers.
 *
 * @typedef {object} RobotKind
 * @property {'mower' | 'vacuum'} role - Which driver takes it.
 * @property {string} code - The model code: one of the driver's, or `goat` / `deebot` for one
 *   the table does not know.
 * @property {Dialect} dialect - The dialect to speak first.
 */

/**
 * A product name, compared.
 *
 * @param {string} name - What ECOVACS calls the product.
 * @returns {string} It, in upper case without spaces, dashes or underscores.
 */
function compact(name) {
  return name.toUpperCase().replace(/[\s_-]+/gu, '');
}

/**
 * Says whether a robot on the account is a GOAT mower.
 *
 * The product category is the account's own word for it; the product name only when the
 * category is missing.
 *
 * @param {{ category: string | null; deviceName: string }} device - The robot.
 * @returns {boolean} True for a mower.
 */
export function isGoat(device) {
  if (device.category !== null && device.category.trim() !== '') {
    return device.category.trim().toUpperCase() === 'GOATBOT';
  }

  return /GOAT/iu.test(device.deviceName);
}

/**
 * Says whether a robot on the account is a DEEBOT vacuum.
 *
 * @param {{ category: string | null; deviceName: string }} device - The robot.
 * @returns {boolean} True for a vacuum.
 */
export function isDeebot(device) {
  if (device.category !== null && device.category.trim() !== '') {
    return device.category.trim().toUpperCase() === 'DEEBOT';
  }

  return /DEEBOT|OZMO/iu.test(device.deviceName);
}

/**
 * Which GOAT a product name is.
 *
 * @param {string} deviceName - What ECOVACS calls the product.
 * @returns {{ code: string; dialect: 'g1' | 'rtk' }} Its model code and dialect.
 */
export function goatKindOf(deviceName) {
  const name = compact(deviceName);
  const known = GOATS.find((model) => model.pattern.test(name));

  if (known !== undefined) {
    return { code: known.code, dialect: known.dialect === 'rtk' ? 'rtk' : 'g1' };
  }

  // A newer GOAT: an O or A with three or more digits is the newer generation's.
  return { code: 'goat', dialect: /[OA]\d{3,}/u.test(name) ? 'rtk' : 'g1' };
}

/**
 * Which DEEBOT a product name is.
 *
 * @param {string} deviceName - What ECOVACS calls the product.
 * @returns {{ code: string; dialect: 'v1' | 'v2' }} Its model code and dialect.
 */
export function deebotKindOf(deviceName) {
  const name = compact(deviceName);
  const known = DEEBOTS.find((model) => model.pattern.test(name));

  if (known !== undefined) {
    return { code: known.code, dialect: known.dialect === 'v1' ? 'v1' : 'v2' };
  }

  // Everything sold since the OZMO T8 speaks the second dialect.
  return { code: 'deebot', dialect: 'v2' };
}

/**
 * What a robot on the account is, or null for one this bundle does not drive.
 *
 * @param {{ category: string | null; deviceName: string }} device - The robot.
 * @returns {RobotKind | null} The driver, model and dialect.
 */
export function robotKindOf(device) {
  if (isGoat(device)) {
    return { role: 'mower', ...goatKindOf(device.deviceName) };
  }

  if (isDeebot(device)) {
    return { role: 'vacuum', ...deebotKindOf(device.deviceName) };
  }

  return null;
}
