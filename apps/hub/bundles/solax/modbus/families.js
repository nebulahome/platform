// @ts-check
/**
 * Where each SolaX family keeps its readings in its Modbus registers, and which family a serial
 * number is.
 *
 * Over Modbus an inverter says what it is only through its serial number: fourteen ASCII
 * characters in seven holding registers, whose first letters name the generation and the kind -
 * `H450…` an X1-Hybrid G4, `H34A…` an X3-Hybrid G4, `XB3…` an X1-Boost, `MPT…` an X3-MIC PRO. The
 * prefixes, the register of every reading, whether it is an input or a holding register, its
 * scale and its sign are the ones the Home Assistant integration `solax_modbus` reads
 * (github.com/wills106/homeassistant-solax-modbus, `plugin_solax.py`, Apache-2.0), re-expressed
 * here as data. Its names are not kept: a reading is called what the HTTP transport calls it, so
 * `values.battery_power` means the same whichever way the inverter is reached.
 *
 * Thirty-two bit values are two registers, low word first, the way SolaX lays them out
 * (`order32="little"` in the integration). Signs, everywhere: `grid_power` is positive when the
 * house feeds the grid and negative when it buys; `battery_power` and `battery_current` are
 * positive while the battery charges.
 *
 * The fifth and sixth generations moved some readings when SolaX's register document reached
 * version 1.00: the integration reads that version (holding 0x82) and picks the old layout below
 * it and the new one from it on. `legacy` and `current` are those two halves here.
 */

/**
 * One step a register goes through: which table it is in (input unless `holding`), a sign, a
 * scale, or a table of the words a code stands for.
 *
 * @typedef {'holding' | 's16' | 's32' | '/10' | '/100' | '/1000' | '*10' | Readonly<Record<string, string>>} ModbusStep
 */

/**
 * Where one reading is - a register, or two read low word first - then its steps, in order.
 *
 * @typedef {Readonly<[number | Readonly<[number, number]>, ...ModbusStep[]]>} ModbusReading
 */

/**
 * One family: its readings, and where the layout depends on the register document's version.
 *
 * @typedef {object} ModbusFamily
 * @property {string} id - The family: generation, phases and kind, `hybrid_g4_x1`.
 * @property {Readonly<Record<string, ModbusReading>>} values - Every reading, by name.
 * @property {Readonly<Record<string, ModbusReading>>} [legacy] - Readings below version 1.00.
 * @property {Readonly<Record<string, ModbusReading>>} [current] - Readings from version 1.00.
 * @property {readonly number[]} [splitAt] - Registers a read must start at: the integration
 * starts a new block there, because older firmware refuses a read across it.
 */

/**
 * A serial number prefix, and what it says the inverter is.
 *
 * @typedef {object} ModbusModel
 * @property {string} prefix - What the serial starts with.
 * @property {string} family - Which table reads it.
 * @property {string} model - What it is called.
 */

/** What the second and third generation report they are doing. */
const RUN_MODES_G23 = {
  0: 'Waiting',
  1: 'Checking',
  2: 'Normal',
  3: 'Off',
  4: 'Permanent Fault',
  5: 'Updating',
  6: 'EPS Check',
  7: 'EPS Mode',
  8: 'Self Test',
  9: 'Idle',
  10: 'Standby',
};

/** What the fourth to sixth generation report they are doing. */
const RUN_MODES_G4 = {
  0: 'Waiting',
  1: 'Checking',
  2: 'Normal',
  3: 'Fault',
  4: 'Permanent Fault',
  5: 'Updating',
  6: 'Off-Grid Waiting',
  7: 'Off-Grid',
  8: 'Self Test',
  9: 'Idle',
  10: 'Standby',
  20: 'Normal (R)',
  21: 'TOU Self use',
  22: 'TOU Charging',
  23: 'TOU Discharging',
  24: 'TOU Battery hold',
  25: 'TOU Peak Shaving',
  26: 'Normal (Gen)',
  27: 'Waiting to Charge',
  28: 'Normal SS',
};

/** What a MIC inverter reports it is doing. */
const RUN_MODES_MIC = {
  0: 'Waiting',
  1: 'Checking',
  2: 'Normal',
  3: 'Fault',
  4: 'Permanent Fault',
};

/** What a fourth-generation X1-Boost, X1-Mini or X1-Smart reports it is doing. */
const RUN_MODES_MIC_G4 = {
  ...RUN_MODES_MIC,
  5: 'Updating',
  6: 'EPS Check',
  7: 'EPS Mode',
};

/** How a second- or third-generation hybrid is told to use its battery. */
const BATTERY_MODES_G23 = {
  0: 'Self Use Mode',
  1: 'Force Time Use',
  2: 'Back Up Mode',
  3: 'Feed-in Priority',
};

/** How a fourth- to sixth-generation hybrid is told to use its battery. */
const BATTERY_MODES_G4 = {
  0: 'Self Use Mode',
  1: 'Feed-in Priority',
  2: 'Back Up Mode',
  3: 'Manual Mode',
  4: 'Peak Shaving',
  5: 'Smart Schedule',
};

/**
 * What the inverter puts out, on a single-phase hybrid or retrofit.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const OUTPUT_X1 = {
  ac_voltage: [0x00, '/10'],
  ac_current: [0x01, 's16', '/10'],
  ac_power: [0x02, 's16'],
};

/**
 * What the inverter puts out on each phase of a three-phase hybrid or retrofit.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const PHASES = {
  ac_voltage_l1: [0x6a, '/10'],
  ac_current_l1: [0x6b, 's16', '/10'],
  ac_power_l1: [0x6c, 's16'],
  ac_voltage_l2: [0x6e, '/10'],
  ac_current_l2: [0x6f, 's16', '/10'],
  ac_power_l2: [0x70, 's16'],
  ac_voltage_l3: [0x72, '/10'],
  ac_current_l3: [0x73, 's16', '/10'],
  ac_power_l3: [0x74, 's16'],
};

/**
 * The two strings of a hybrid.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const PANELS = {
  pv1_voltage: [0x03, '/10'],
  pv2_voltage: [0x04, '/10'],
  pv1_current: [0x05, '/10'],
  pv2_current: [0x06, '/10'],
  pv1_power: [0x0a],
  pv2_power: [0x0b],
};

/**
 * The third string of a fifth- or sixth-generation hybrid that has one, in its newer place.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const THIRD_STRING = {
  pv3_voltage: [0x122, '/10'],
  pv3_current: [0x123, '/10'],
  pv3_power: [0x124],
};

/**
 * The third string of a sixth-generation hybrid below register document 1.00.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const THIRD_STRING_LEGACY = {
  pv3_voltage: [0x2a, '/10'],
  pv3_current: [0x2b, '/10'],
  pv3_power: [0x2c],
};

/**
 * What every hybrid and retrofit from the second generation on reports in the same place: the
 * grid, the battery, and the grid meter's counters.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const COMMON = {
  grid_frequency: [0x07, '/100'],
  inverter_temperature: [0x08, 's16'],
  battery_voltage: [0x14, 's16', '/10'],
  battery_current: [0x15, 's16', '/10'],
  battery_temperature: [0x18, 's16'],
  battery_discharge_total: [[0x1d, 0x1e], '/10'],
  battery_charge_total: [[0x21, 0x22], '/10'],
  grid_power: [[0x46, 0x47], 's32'],
  feed_in_total: [[0x48, 0x49], '/100'],
  consumption_total: [[0x4a, 0x4b], '/100'],
};

/**
 * The battery's power and level where the third and fourth generation keep them.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const BATTERY = {
  battery_power: [0x16, 's16'],
  battery_soc: [0x1c],
};

/**
 * What the inverter made, today and ever.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const YIELD = {
  yield_today: [0x50, '/10'],
  yield_total: [[0x52, 0x53], '/10'],
};

/**
 * The battery of a fifth- or sixth-generation hybrid below register document 1.00: two ports,
 * each with its power and level, and a total level that is only there when it is not zero.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const TWO_BATTERIES_LEGACY = {
  battery1_power: [0x16, 's16'],
  battery1_soc: [0x1c],
  battery2_power: [0x129, 's16'],
  battery2_soc: [0x12d],
  battery_soc_total: [0x12e],
};

/**
 * The same from version 1.00: one power over two registers, one level.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const TWO_BATTERIES_CURRENT = {
  battery_power: [[0x38, 0x39], 's32'],
  battery_soc: [0x3c],
};

/**
 * How the second and third generation are told to use the battery, and what they are doing.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const MODES_G23 = {
  run_mode: [0x09, RUN_MODES_G23],
  battery_mode: [0x8b, 'holding', BATTERY_MODES_G23],
};

/**
 * The same from the fourth generation on.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const MODES_G4 = {
  run_mode: [0x09, RUN_MODES_G4],
  battery_mode: [0x8b, 'holding', BATTERY_MODES_G4],
};

/**
 * A sixth-generation hybrid's lifetime counters below version 1.00, in watt-hours rather than
 * tenths of a kilowatt-hour.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const G6_COUNTERS_LEGACY = {
  battery_discharge_total: [[0x1d, 0x1e], '/1000'],
  battery_charge_total: [[0x21, 0x22], '/1000'],
  yield_total: [[0x52, 0x53], '/1000'],
};

/**
 * What a MIC inverter of the second generation (X1-Boost, X1-Mini, X1-Air) and a three-phase
 * X3-MIC share, from register 0x400.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const MIC = {
  pv1_voltage: [0x400, '/10'],
  pv2_voltage: [0x401, '/10'],
  pv1_current: [0x402, '/10'],
  pv2_current: [0x403, '/10'],
  grid_frequency: [0x407, '/100'],
  inverter_temperature: [0x40d],
  ac_power: [0x40e],
  run_mode: [0x40f, RUN_MODES_MIC],
  pv1_power: [0x414],
  pv2_power: [0x415],
};

/**
 * The phases of an X3-MIC.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const MIC_PHASES = {
  ac_voltage_l1: [0x404, '/10'],
  ac_voltage_l2: [0x405, '/10'],
  ac_voltage_l3: [0x406, '/10'],
  ac_current_l1: [0x40a, '/10'],
  ac_current_l2: [0x40b, '/10'],
  ac_current_l3: [0x40c, '/10'],
  ac_power_l1: [0x410],
  ac_power_l2: [0x411],
  ac_power_l3: [0x412],
};

/**
 * A second-generation MIC's yield and grid meter, the meter in a block of its own.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const MIC_G2_COUNTERS = {
  yield_total: [[0x423, 0x424], '/10'],
  yield_today: [[0x425, 0x426], '/10'],
  grid_power: [[0x43b, 0x43c], 's32'],
  feed_in_total: [[0x43d, 0x43e], '/100'],
  consumption_total: [[0x43f, 0x440], '/100'],
};

/**
 * A fourth-generation X1-Boost, X1-Mini or X1-Smart, from register 0x400: another layout.
 *
 * @type {Readonly<Record<string, ModbusReading>>}
 */
const MIC_G4 = {
  ac_voltage: [0x400, '/10'],
  ac_current: [0x403, '/10'],
  grid_frequency: [0x406, '/100'],
  pv1_voltage: [0x40a, '/10'],
  pv2_voltage: [0x40b, '/10'],
  pv1_current: [0x40d, '/10'],
  pv2_current: [0x40e, '/10'],
  pv1_power: [0x410],
  pv2_power: [0x411],
  inverter_temperature: [0x413],
  run_mode: [0x415, RUN_MODES_MIC_G4],
  yield_total: [[0x42b, 0x42c], '/10'],
  feed_in_total: [[0x42f, 0x430], '/10'],
  consumption_total: [[0x431, 0x432], '/10'],
  yield_today: [0x437, '/10'],
};

/**
 * Every family this bundle reads over Modbus.
 *
 * @type {readonly ModbusFamily[]}
 */
export const MODBUS_FAMILIES = [
  {
    id: 'hybrid_g2_x1',
    values: {
      ...OUTPUT_X1,
      ...PANELS,
      ...COMMON,
      ...BATTERY,
      ...MODES_G23,
      battery_voltage: [0x14, 's16', '/100'],
      battery_current: [0x15, 's16', '/100'],
      battery_charge_total: [[0x20, 0x21], '/10'],
      yield_today: [[0x70, 0x71], '/10'],
    },
  },
  {
    id: 'hybrid_g3_x1',
    values: { ...OUTPUT_X1, ...PANELS, ...COMMON, ...BATTERY, ...YIELD, ...MODES_G23 },
  },
  {
    id: 'hybrid_g3_x3',
    values: {
      ...PHASES,
      ac_power: [0x02, 's16'],
      ...PANELS,
      ...COMMON,
      ...BATTERY,
      ...YIELD,
      ...MODES_G23,
    },
  },
  { id: 'ac_g3_x1', values: { ...OUTPUT_X1, ...COMMON, ...BATTERY, ...MODES_G23 } },
  {
    id: 'ac_g3_x3',
    values: { ...PHASES, ac_power: [0x02, 's16'], ...COMMON, ...BATTERY, ...MODES_G23 },
  },
  {
    id: 'hybrid_g4_x1',
    values: { ...OUTPUT_X1, ...PANELS, ...COMMON, ...BATTERY, ...YIELD, ...MODES_G4 },
  },
  {
    id: 'hybrid_g4_x3',
    values: {
      ...PHASES,
      ac_power: [0x02, 's16'],
      ...PANELS,
      ...COMMON,
      ...BATTERY,
      ...YIELD,
      ...MODES_G4,
    },
  },
  { id: 'ac_g4_x1', values: { ...OUTPUT_X1, ...COMMON, ...BATTERY, ...MODES_G4 } },
  {
    id: 'ac_g4_x3',
    values: { ...PHASES, ac_power: [0x02, 's16'], ...COMMON, ...BATTERY, ...MODES_G4 },
  },
  {
    id: 'hybrid_g5_x1',
    values: { ...OUTPUT_X1, ...PANELS, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: TWO_BATTERIES_LEGACY,
    current: TWO_BATTERIES_CURRENT,
  },
  {
    id: 'hybrid_g5_x1_pv3',
    values: { ...OUTPUT_X1, ...PANELS, ...THIRD_STRING, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: TWO_BATTERIES_LEGACY,
    current: TWO_BATTERIES_CURRENT,
  },
  {
    // The three-phase fifth generation reports its temperature in tenths below version 1.00.
    id: 'hybrid_g5_x3',
    values: { ...PHASES, ...PANELS, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: { ...TWO_BATTERIES_LEGACY, inverter_temperature: [0x08, 's16', '/10'] },
    current: TWO_BATTERIES_CURRENT,
  },
  {
    id: 'hybrid_g5_x3_pv3',
    values: { ...PHASES, ...PANELS, ...THIRD_STRING, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: { ...TWO_BATTERIES_LEGACY, inverter_temperature: [0x08, 's16', '/10'] },
    current: TWO_BATTERIES_CURRENT,
  },
  {
    // The X3-Aelio reports each battery port's power in tens of watts below version 1.00
    // (`CHARGE_SCALE_EXCEPTIONS` in the integration).
    id: 'hybrid_g5_x3_aelio',
    values: { ...PHASES, ...PANELS, ...THIRD_STRING, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: {
      ...TWO_BATTERIES_LEGACY,
      battery1_power: [0x16, 's16', '*10'],
      battery2_power: [0x129, 's16', '*10'],
      inverter_temperature: [0x08, 's16', '/10'],
    },
    current: TWO_BATTERIES_CURRENT,
  },
  {
    // Every X1-VAST has a third string (three or four MPPTs).
    id: 'hybrid_g6_x1',
    values: { ...OUTPUT_X1, ...PANELS, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: { ...TWO_BATTERIES_LEGACY, ...G6_COUNTERS_LEGACY, ...THIRD_STRING_LEGACY },
    current: { ...TWO_BATTERIES_CURRENT, ...THIRD_STRING },
  },
  {
    id: 'hybrid_g6_x3',
    values: { ...PHASES, ...PANELS, ...COMMON, ...YIELD, ...MODES_G4 },
    legacy: {
      ...TWO_BATTERIES_LEGACY,
      ...G6_COUNTERS_LEGACY,
      ...THIRD_STRING_LEGACY,
      inverter_temperature: [0x08, 's16', '/10'],
    },
    current: TWO_BATTERIES_CURRENT,
  },
  {
    id: 'mic_g2_x1',
    values: { ...MIC, ac_voltage: [0x404, '/10'], ac_current: [0x40a, '/10'], ...MIC_G2_COUNTERS },
    splitAt: [0x43b],
  },
  { id: 'mic_g4_x1', values: MIC_G4 },
  {
    id: 'mic_g4_x1_pv3',
    values: {
      ...MIC_G4,
      pv3_voltage: [0x40c, '/10'],
      pv3_current: [0x40f, '/10'],
      pv3_power: [0x412],
    },
  },
  {
    // The first X3-MIC counts its yield in watt-hours and keeps its meter lower, which the
    // integration reads only when the owner asks: a meter needs ARM firmware 1.38 or later.
    id: 'mic_g1_x3',
    values: {
      ...MIC,
      ...MIC_PHASES,
      yield_total: [[0x423, 0x424], '/1000'],
      yield_today: [[0x425, 0x426], '/1000'],
      grid_power: [[0x435, 0x436], 's32'],
      feed_in_total: [[0x437, 0x438], '/100'],
      consumption_total: [[0x439, 0x43a], '/100'],
    },
    splitAt: [0x435],
  },
  { id: 'mic_g2_x3', values: { ...MIC, ...MIC_PHASES, ...MIC_G2_COUNTERS }, splitAt: [0x43b] },
];

/**
 * Which family a serial number is, by its prefix, in the order the integration tries them: the
 * first prefix a serial starts with wins, so a longer prefix comes before a shorter one it
 * begins with.
 *
 * @type {readonly ModbusModel[]}
 */
export const MODBUS_MODELS = [
  ...['L30', 'L37', 'L50'].map((prefix) => ({
    prefix,
    family: 'hybrid_g2_x1',
    model: 'X1-Hybrid G2 (SK-TL)',
  })),
  ...['U30', 'U37', 'U50'].map((prefix) => ({
    prefix,
    family: 'hybrid_g2_x1',
    model: 'X1-Hybrid G2 (SK-SU)',
  })),
  ...['H1E', 'H1I', 'HCC', 'HUE', 'XRE'].map((prefix) => ({
    prefix,
    family: 'hybrid_g3_x1',
    model: 'X1-Hybrid G3',
  })),
  { prefix: 'XAC', family: 'ac_g3_x1', model: 'X1-AC' },
  { prefix: 'PRI', family: 'ac_g3_x1', model: 'X1-Fit' },
  ...['H3DE', 'H3E', 'H3LE', 'H3PE', 'H3UE'].map((prefix) => ({
    prefix,
    family: 'hybrid_g3_x3',
    model: 'X3-Hybrid G3',
  })),
  ...['F3D', 'F3E'].map((prefix) => ({ prefix, family: 'ac_g3_x3', model: 'X3-RetroFit' })),
  { prefix: '63150', family: 'hybrid_g4_x1', model: 'X1-TIGO TSI' },
  ...['H43', 'H44', 'H450', 'H460', 'H475'].map((prefix) => ({
    prefix,
    family: 'hybrid_g4_x1',
    model: 'X1-Hybrid G4',
  })),
  ...['F43', 'F450', 'F460', 'F475', 'PRE'].map((prefix) => ({
    prefix,
    family: 'ac_g4_x1',
    model: 'X1-RetroFit',
  })),
  { prefix: 'H53', family: 'hybrid_g5_x1', model: 'X1-IES' },
  ...['H55', 'H56', 'H58'].map((prefix) => ({
    prefix,
    family: 'hybrid_g5_x1_pv3',
    model: 'X1-IES',
  })),
  { prefix: '10M', family: 'hybrid_g6_x1', model: 'X1-VAST' },
  { prefix: 'H31', family: 'hybrid_g4_x3', model: 'X3-TIGO TSI' },
  { prefix: 'H34', family: 'hybrid_g4_x3', model: 'X3-Hybrid G4' },
  { prefix: 'F34', family: 'ac_g4_x3', model: 'X3-RetroFit' },
  ...['H35A0', 'H35A1', 'P35A0', 'P35A1', 'H35F0', 'H35F1'].map((prefix) => ({
    prefix,
    family: 'hybrid_g5_x3',
    model: 'X3-IES',
  })),
  // The X3-Ultra's with three strings first: `H3BC15L` before `H3BC15`.
  ...['C', 'D', 'F', 'G'].flatMap((revision) =>
    ['15L', '20L', '20K', '25', '30'].map((size) => ({
      prefix: `H3B${revision}${size}`,
      family: 'hybrid_g5_x3_pv3',
      model: 'X3-Ultra',
    })),
  ),
  ...['C', 'D', 'F', 'G'].map((revision) => ({
    prefix: `H3B${revision}`,
    family: 'hybrid_g5_x3',
    model: 'X3-Ultra',
  })),
  { prefix: '10K', family: 'hybrid_g6_x3', model: 'X3-Hybrid G4 Pro' },
  { prefix: '8021', family: 'hybrid_g5_x3_aelio', model: 'X3-Aelio' },
  ...['XAU', 'XB3', 'XBE', 'XBU'].map((prefix) => ({
    prefix,
    family: 'mic_g2_x1',
    model: 'X1-Boost',
  })),
  ...['XAT', 'XM2', 'XM3'].map((prefix) => ({ prefix, family: 'mic_g2_x1', model: 'X1-Mini' })),
  { prefix: 'XB4', family: 'mic_g4_x1', model: 'X1-Boost G4' },
  { prefix: 'XM4', family: 'mic_g4_x1', model: 'X1-Mini G4' },
  { prefix: 'XMA', family: 'mic_g2_x1', model: 'X1-Mini' },
  { prefix: 'ZA4', family: 'mic_g4_x1', model: 'X1-Boost G4' },
  { prefix: 'XST', family: 'mic_g4_x1_pv3', model: 'X1-Smart G2' },
  ...[
    'MC103T',
    'MP153T',
    'MC203T',
    'MC402T',
    'MC502T',
    'MU502T',
    'MC602T',
    'MU602T',
    'MC702T',
    'MU702T',
    'MC802T',
    'MCU08T',
    'MU802T',
    'MC803T',
    'MU803T',
    'MU902T',
    'MU103T',
  ].map((prefix) => ({ prefix, family: 'mic_g1_x3', model: 'X3-MIC' })),
  ...[
    'MC806T',
    'MU806T',
    'MC106T',
    'MC204T',
    'MC205T',
    'MC206T',
    'MC208T',
    'MC210T',
    'MC212T',
    'MC215T',
    'MP156T',
  ].map((prefix) => ({ prefix, family: 'mic_g2_x3', model: 'X3-MIC G2' })),
  { prefix: 'PU', family: 'mic_g2_x3', model: 'X3-MIC Pro' },
  { prefix: 'MPT', family: 'mic_g2_x3', model: 'X3-MIC PRO G2' },
];
