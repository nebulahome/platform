// @ts-check
/**
 * Where each SolaX family keeps its readings in the array the dongle answers with.
 *
 * The Pocket WiFi and Pocket LAN dongles answer one question - the real-time data - with a JSON
 * object whose `Data` is a flat list of numbers: the inverter's registers, most of them 16-bit,
 * some scaled by ten or a hundred, some signed, some counters spread over two registers low word
 * first. Which register is which depends on the family, and the family is told by `type` - an
 * integer code on dongles from 2.034 on, a model string on the older ones - and, where two
 * families share a code, by how many registers came back.
 *
 * The positions, scales and signs are the ones the `solax` Python library reads (MIT,
 * github.com/squishykid/solax, the library Home Assistant's `solax` integration requires),
 * re-expressed here as data: one table per family, each reading a position and the steps its
 * value goes through. Where this table departs from the library it says so beside the reading,
 * and why. Names are the platform's, not the library's: the same thing is called the same in
 * every family, so a profile reads `values.battery_power` whichever family it drives.
 *
 * Signs, everywhere: `grid_power` is positive when the house feeds the grid and negative when
 * it buys; `battery_power` and `battery_current` are positive while the battery charges and
 * negative while it discharges. That is how SolaX reports them, and how they are delivered.
 */

/**
 * One step a register goes through: a 16- or 32-bit sign, a divisor, or a table of the words a
 * code stands for.
 *
 * @typedef {'int16' | 'int32' | '/10' | '/100' | Readonly<Record<string, string>>} Step
 */

/**
 * Where one reading is - a register, or two read low word first - then its steps, in order.
 *
 * @typedef {Readonly<[number | Readonly<[number, number]>, ...Step[]]>} Reading
 */

/**
 * One family: which answers it reads, and where its readings are.
 *
 * @typedef {object} Family
 * @property {string} id - The library's name for it: `x1_boost`, `x3_hybrid_g4`.
 * @property {readonly number[]} [types] - The integer `type` codes it reads.
 * @property {string} [prefix] - What a model-string `type` starts with, on the older dongles.
 * @property {boolean} [isLegacy] - Whether it answers the X-Hybrid's own GET, and only that.
 * @property {readonly (readonly [number, number])[]} lengths - How many registers it answers
 * with, as ranges.
 * @property {Readonly<Record<string, string>>} [models] - What each integer code is called.
 * @property {number} [serialAt] - Where in `Information` the inverter's own serial is.
 * @property {string} [manufacturer] - Who sells it, when that is not SolaX.
 * @property {Readonly<Record<string, Reading>>} values - Each reading, by the platform's name.
 */

/** What the Hybrid G4 and Ultra report they are doing. */
const RUN_MODES = {
  0: 'Waiting',
  1: 'Checking',
  2: 'Normal',
  3: 'Fault',
  4: 'Permanent Fault',
  5: 'Updating',
  6: 'EPS Check',
  7: 'EPS Mode',
  8: 'Self Test',
  9: 'Idle',
  10: 'Standby',
};

/** The same, as the Q.VOLT words it: 3 is off rather than a fault. */
const QVOLT_RUN_MODES = { ...RUN_MODES, 3: 'Off' };

/** What the X3-MIC PRO G2 reports it is doing. */
const MIC_RUN_MODES = {
  0: 'Waiting',
  1: 'Checking',
  2: 'Normal',
  3: 'Fault',
  4: 'Permanent Fault',
  5: 'Updating',
};

/** How a hybrid is told to use its battery. */
const BATTERY_MODES = {
  0: 'Self Use Mode',
  1: 'Force Time Use',
  2: 'Back Up Mode',
  3: 'Feed-in Priority',
};

/** What the X3-EVC says it is doing. */
const CHARGER_STATES = {
  0: 'Preparing',
  1: 'Preparing',
  2: 'Charging',
  3: 'Finishing',
  4: 'Faulted',
  5: 'Unavailable',
  6: 'Reserved',
  7: 'SuspendedEV',
  8: 'SuspendedEVSE',
};

/** How the X3-EVC was told to charge. */
const CHARGER_MODES = { 0: 'STOP', 1: 'FAST', 2: 'ECO', 3: 'GREEN' };

/**
 * The readings every older single-phase dongle answers with, already scaled: the firmware before
 * 2.034 sends real numbers rather than registers.
 *
 * @type {Readonly<Record<string, Reading>>}
 */
const OLD_SINGLE_PHASE = {
  pv1_current: [0],
  pv2_current: [1],
  pv1_voltage: [2],
  pv2_voltage: [3],
  ac_current: [4],
  ac_voltage: [5],
  ac_power: [6],
  inverter_temperature: [7],
  yield_today: [8],
  yield_total: [9],
  grid_power: [10],
  pv1_power: [11],
  pv2_power: [12],
  feed_in_total: [41],
  consumption_total: [42],
  grid_frequency: [50],
};

/**
 * The battery of an older hybrid, beside the readings above.
 *
 * @type {Readonly<Record<string, Reading>>}
 */
const OLD_BATTERY = {
  battery_voltage: [13],
  battery_current: [14],
  battery_power: [15],
  battery_temperature: [16],
};

/**
 * The three phases of a newer three-phase inverter, in the first nine registers.
 *
 * @type {Readonly<Record<string, Reading>>}
 */
const PHASES = {
  ac_voltage_l1: [0, '/10'],
  ac_voltage_l2: [1, '/10'],
  ac_voltage_l3: [2, '/10'],
  ac_current_l1: [3, 'int16', '/10'],
  ac_current_l2: [4, 'int16', '/10'],
  ac_current_l3: [5, 'int16', '/10'],
  ac_power_l1: [6, 'int16'],
  ac_power_l2: [7, 'int16'],
  ac_power_l3: [8, 'int16'],
};

/**
 * The X1-Boost, X1-Air and X1-Mini of the third generation, and the X1-Smart, share these.
 *
 * @type {Readonly<Record<string, Reading>>}
 */
const X1_GEN3 = {
  ac_voltage: [0, '/10'],
  ac_current: [1, '/10'],
  ac_power: [2],
  pv1_voltage: [3, '/10'],
  pv2_voltage: [4, '/10'],
  pv1_current: [5, '/10'],
  pv2_current: [6, '/10'],
  pv1_power: [7],
  pv2_power: [8],
  grid_frequency: [9, '/100'],
  yield_today: [13, '/10'],
};

/**
 * Every family the library reads, in the order an answer is matched: where two families take the
 * same answer, the first one here reads it unless the owner picked the other.
 *
 * @type {readonly Family[]}
 */
export const FAMILIES = [
  {
    id: 'x_hybrid',
    isLegacy: true,
    lengths: [
      [58, 58],
      [68, 68],
    ],
    values: { ...OLD_SINGLE_PHASE, ...OLD_BATTERY, battery_soc: [17] },
  },
  {
    id: 'x1_mini',
    prefix: 'X1-',
    lengths: [[69, 69]],
    serialAt: 3,
    values: OLD_SINGLE_PHASE,
  },
  {
    id: 'x1',
    prefix: 'X1-',
    lengths: [
      [102, 103],
      [107, 107],
    ],
    serialAt: 3,
    values: { ...OLD_SINGLE_PHASE, ...OLD_BATTERY, battery_soc: [21] },
  },
  {
    id: 'x3',
    prefix: 'X3-',
    lengths: [
      [102, 103],
      [107, 107],
    ],
    serialAt: 3,
    values: {
      pv1_current: [0],
      pv2_current: [1],
      pv1_voltage: [2],
      pv2_voltage: [3],
      ac_current_l1: [4],
      ac_voltage_l1: [5],
      ac_power: [6],
      inverter_temperature: [7],
      yield_today: [8],
      yield_total: [9],
      grid_power: [10],
      pv1_power: [11],
      pv2_power: [12],
      ...OLD_BATTERY,
      battery_soc: [21],
      feed_in_total: [41],
      consumption_total: [42],
      ac_power_l1: [43],
      ac_power_l2: [44],
      ac_power_l3: [45],
      ac_current_l2: [46],
      ac_current_l3: [47],
      ac_voltage_l2: [48],
      ac_voltage_l3: [49],
      grid_frequency: [50],
    },
  },
  {
    // Before `x1_mini_v34`, so an answer both take is read as an X1-Boost unless the owner
    // picked the other table: they agree on the first fourteen registers and differ on the meter.
    id: 'x1_boost',
    types: [4],
    lengths: [
      [100, 100],
      [200, 200],
    ],
    models: { 4: 'X1-Boost-Air-Mini' },
    serialAt: 2,
    values: {
      ...X1_GEN3,
      yield_total: [[11, 12], '/10'],
      inverter_temperature: [39],
      grid_power: [48, 'int16'],
      feed_in_total: [[50, 51], '/100'],
      consumption_total: [[52, 53], '/100'],
    },
  },
  {
    id: 'x1_mini_v34',
    types: [4],
    lengths: [
      [69, 69],
      [100, 100],
      [200, 200],
    ],
    models: { 4: 'X1-Boost-Air-Mini' },
    serialAt: 2,
    values: {
      ...X1_GEN3,
      yield_total: [11, '/10'],
      feed_in_total: [41, '/10'],
      consumption_total: [42, '/10'],
      inverter_temperature: [55],
    },
  },
  {
    id: 'x1_smart',
    types: [8],
    lengths: [[100, 200]],
    models: { 8: 'X1-Smart' },
    serialAt: 2,
    values: {
      ...X1_GEN3,
      yield_total: [11, '/10'],
      inverter_temperature: [39],
      grid_power: [48, 'int16'],
      feed_in_total: [50, '/100'],
      consumption_total: [52, '/100'],
    },
  },
  {
    id: 'x1_g4_series',
    types: [18, 22],
    lengths: [[100, 100]],
    models: { 18: 'X1-Boost G4', 22: 'X1-Mini G4' },
    serialAt: 2,
    values: {
      ac_voltage: [0, '/10'],
      ac_current: [1, '/10'],
      grid_frequency: [2, '/100'],
      ac_power: [3],
      pv1_voltage: [4, '/10'],
      pv2_voltage: [5, '/10'],
      pv1_current: [8, '/10'],
      pv2_current: [9, '/10'],
      pv1_power: [13],
      pv2_power: [14],
      yield_total: [[19, 20], '/10'],
      yield_today: [21, '/10'],
      // The library packs 72 and 73 and then applies a 16-bit sign, which is right for an
      // export under 32 kW and wrong for every import (the high word is 0xFFFF then). The low
      // word alone, signed, is what the library gets wherever it is right, and an import besides.
      grid_power: [72, 'int16'],
      feed_in_total: [[74, 75], '/100'],
      consumption_total: [[76, 77], '/100'],
    },
  },
  {
    id: 'x1_hybrid_gen4',
    types: [15],
    lengths: [[200, 300]],
    models: { 15: 'X1-Hybrid G4' },
    serialAt: 2,
    values: {
      ac_voltage: [0, '/10'],
      ac_current: [1, '/10'],
      ac_power: [2, 'int16'],
      grid_frequency: [3, '/100'],
      pv1_voltage: [4, '/10'],
      pv2_voltage: [5, '/10'],
      pv1_current: [6, '/10'],
      pv2_current: [7, '/10'],
      pv1_power: [8],
      pv2_power: [9],
      yield_total: [[11, 12], '/10'],
      yield_today: [13, '/10'],
      battery_voltage: [14, '/100'],
      // The library reads this one unsigned, so a discharge would show as some 650 A; the power
      // beside it (16) is signed, and so is the battery current of every other hybrid.
      battery_current: [15, 'int16', '/100'],
      battery_power: [16, 'int16'],
      battery_temperature: [17],
      battery_soc: [18],
      inverter_temperature: [26],
      grid_power: [32, 'int16'],
      feed_in_total: [[34, 35], '/100'],
      consumption_total: [[36, 37], '/100'],
    },
  },
  {
    // The library takes any integer type with 200 to 300 registers as an X1-Lite LV; 103 is the
    // only code it has been seen with, so that is the one read here.
    id: 'x1_lite_lv',
    types: [103],
    lengths: [[200, 300]],
    models: { 103: 'X1-Lite LV' },
    serialAt: 2,
    values: {
      ac_voltage: [0, '/10'],
      ac_current: [1, 'int16', '/10'],
      ac_power: [2, 'int16'],
      grid_frequency: [3, '/100'],
      pv1_voltage: [5, '/10'],
      pv1_current: [6, '/10'],
      pv2_voltage: [7, '/10'],
      pv2_current: [8, '/10'],
      pv3_voltage: [9, '/10'],
      pv3_current: [10, '/10'],
      pv1_power: [11],
      pv2_power: [12],
      pv3_power: [13],
      yield_total: [[17, 18], '/10'],
      yield_today: [21, '/10'],
      battery_voltage: [23, '/10'],
      battery_current: [24, 'int16', '/10'],
      // In watts as it stands: the library divides it by ten, but its own samples say 2587 W
      // beside 53.8 V and 48.0 A, and -388 W beside 52.6 V and -7.3 A.
      battery_power: [25, 'int16'],
      // Lifetime counters over two registers, read unsigned: the library applies a 16-bit sign
      // to the pair, which takes 6553.6 kWh off once a counter passes 3276.7.
      battery_charge_total: [[26, 27], '/10'],
      battery_discharge_total: [[28, 29], '/10'],
      grid_power: [32, 'int16', '/10'],
      consumption_total: [[36, 37], '/10'],
      inverter_temperature: [68, '/10'],
      battery_soc: [75, '/10'],
      battery_temperature: [79],
    },
  },
  {
    id: 'x3_v34',
    types: [5],
    lengths: [[200, 200]],
    models: { 5: 'X3-Hybrid G3' },
    serialAt: 2,
    values: {
      ...PHASES,
      pv1_voltage: [9, '/10'],
      pv2_voltage: [10, '/10'],
      pv1_current: [11, '/10'],
      pv2_current: [12, '/10'],
      pv1_power: [13],
      pv2_power: [14],
      grid_frequency: [15, '/100'],
      yield_total: [[19, 20], '/10'],
      yield_today: [21, '/10'],
      battery_voltage: [24, '/100'],
      battery_current: [25, 'int16', '/100'],
      battery_power: [26, 'int16'],
      battery_temperature: [27],
      battery_soc: [28],
      battery_discharge_total: [[30, 31], '/10'],
      grid_power: [65, 'int16'],
      feed_in_total: [[67, 68], '/100'],
      consumption_total: [[69, 70], '/100'],
      battery_charge_total: [[87, 88], '/10'],
      ac_power: [181, 'int16'],
    },
  },
  {
    // Before `x3_hybrid_g4`: an answer of exactly 200 registers with type 14 is a Q.VOLT
    // unless the owner picked the other table. The Q.VOLT's 34 is signed on its own; its 35
    // is not the high word the Hybrid G4's is.
    id: 'qvolt_hyb_g3_3p',
    types: [14],
    lengths: [[200, 200]],
    models: { 14: 'Q.VOLT HYB-G3-3P' },
    serialAt: 2,
    manufacturer: 'Qcells',
    values: {
      ...PHASES,
      ac_power: [9, 'int16'],
      pv1_voltage: [10, '/10'],
      pv2_voltage: [11, '/10'],
      pv1_current: [12, '/10'],
      pv2_current: [13, '/10'],
      pv1_power: [14],
      pv2_power: [15],
      grid_frequency: [16, '/100'],
      run_mode: [19, QVOLT_RUN_MODES],
      grid_power: [34, 'int16'],
      battery_voltage: [39, '/100'],
      battery_current: [40, 'int16', '/100'],
      battery_power: [41, 'int16'],
      yield_total: [[68, 69], '/10'],
      battery_discharge_total: [[74, 75], '/10'],
      battery_charge_total: [[76, 77], '/10'],
      yield_today: [82, '/10'],
      feed_in_total: [[86, 87], '/100'],
      consumption_total: [[88, 89], '/100'],
      battery_soc: [103],
      battery_temperature: [105],
      battery_mode: [168, BATTERY_MODES],
    },
  },
  {
    id: 'x3_hybrid_g4',
    types: [14],
    lengths: [[200, 300]],
    models: { 14: 'X3-Hybrid G4' },
    serialAt: 2,
    values: {
      ...PHASES,
      pv1_voltage: [10, '/10'],
      pv2_voltage: [11, '/10'],
      pv1_current: [12, '/10'],
      pv2_current: [13, '/10'],
      pv1_power: [14],
      pv2_power: [15],
      grid_frequency: [16, '/100'],
      run_mode: [19, RUN_MODES],
      grid_power: [[34, 35], 'int32'],
      battery_current: [40, 'int16', '/100'],
      battery_power: [41, 'int16'],
      inverter_temperature: [54, 'int16'],
      yield_total: [[68, 69], '/10'],
      yield_today: [70, '/10'],
      battery_discharge_total: [[74, 75], '/10'],
      battery_charge_total: [[76, 77], '/10'],
      feed_in_total: [[86, 87], '/100'],
      consumption_total: [[88, 89], '/100'],
      battery_soc: [103],
      battery_temperature: [105, 'int16'],
      battery_mode: [168, BATTERY_MODES],
      battery_voltage: [[169, 170], '/100'],
    },
  },
  {
    id: 'x3_mic_pro_g2',
    types: [16],
    lengths: [[100, 100]],
    models: { 16: 'X3-MIC PRO G2' },
    serialAt: 2,
    values: {
      ...PHASES,
      pv1_voltage: [9, '/10'],
      pv2_voltage: [10, '/10'],
      pv3_voltage: [11, '/10'],
      pv1_current: [12, '/10'],
      pv2_current: [13, '/10'],
      pv3_current: [14, '/10'],
      pv1_power: [15],
      pv2_power: [16],
      pv3_power: [17],
      grid_frequency: [18, '/100'],
      run_mode: [21, MIC_RUN_MODES],
      yield_total: [[22, 23], '/10'],
      yield_today: [24, '/10'],
      grid_power: [[72, 73], 'int32'],
      feed_in_total: [[74, 75], '/100'],
      consumption_total: [[76, 77], '/100'],
    },
  },
  {
    // Two battery ports. The voltage, current and temperature are the first port's; the power
    // is both ports' together, derived from the two. The library's "Inverter Power" (159) is
    // not read: divided by ten as it does, it is a tenth of the three phases it should equal.
    id: 'x3_ultra',
    types: [25],
    lengths: [[300, 300]],
    models: { 25: 'X3-Ultra' },
    serialAt: 2,
    values: {
      ...PHASES,
      pv1_voltage: [10, '/10'],
      pv2_voltage: [11, '/10'],
      pv1_current: [12, '/10'],
      pv2_current: [13, '/10'],
      pv1_power: [14],
      pv2_power: [15],
      grid_frequency: [16, '/100'],
      run_mode: [19, RUN_MODES],
      grid_power: [[34, 35], 'int32'],
      battery_voltage: [39, '/10'],
      battery_current: [40, 'int16', '/100'],
      battery1_power: [41, 'int16'],
      inverter_temperature: [54, 'int16'],
      yield_total: [[58, 59], '/10'],
      yield_today: [70, '/10'],
      battery_discharge_total: [[74, 75], '/10'],
      battery_charge_total: [[76, 77], '/10'],
      feed_in_total: [[86, 87], '/100'],
      consumption_total: [[88, 89], '/100'],
      battery_temperature: [105, 'int16'],
      pv3_voltage: [129, '/10'],
      pv3_current: [130, '/10'],
      pv3_power: [131],
      battery2_power: [134, 'int16'],
      battery_soc: [158],
    },
  },
  {
    // A charger, not an inverter: its own driver.
    id: 'x3_evc',
    types: [1],
    lengths: [[96, 96]],
    models: { 1: 'X3-EVC' },
    serialAt: 2,
    values: {
      charger_state: [0, CHARGER_STATES],
      charger_mode: [1, CHARGER_MODES],
      ac_voltage_l1: [2, '/100'],
      ac_voltage_l2: [3, '/100'],
      ac_voltage_l3: [4, '/100'],
      ac_current_l1: [5, '/100'],
      ac_current_l2: [6, '/100'],
      ac_current_l3: [7, '/100'],
      ac_power_l1: [8],
      ac_power_l2: [9],
      ac_power_l3: [10],
      ac_power: [11],
      session_energy: [12, '/10'],
      // Read unsigned: the library applies a 16-bit sign to the pair, and says beside it that
      // it is not sure; a lifetime counter does not go negative.
      total_energy: [[14, 15], '/10'],
      plug_temperature: [23],
      board_temperature: [24],
    },
  },
];
