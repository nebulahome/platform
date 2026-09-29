// @ts-check
/**
 * A GOAT mower's state, put together from what it answers and what it pushes, and its commands.
 *
 * A mower says things one at a time - its battery in `onBattery`, what it is doing in
 * `onCleanInfo_V2`, a setting changed in the app in `onRainDelay` - and answers a grouped read
 * (`getInfo`) with several at once. Every one of them is folded into one record here, named and
 * already in the units the platform reads (square metres, seconds, percent), and the transport
 * hands the whole record to the device each time it changes: the driver's profile is then a table
 * of paths, and a partial push never makes the rest of the state unknown.
 *
 * Going the other way, the profile asks for a setting by name - `rainDelay`, `mowingEfficiency` -
 * and this turns it into the command the mower takes, with what the command needs that the
 * profile does not say: the other half of a pair (rain sensor and its delay are one command),
 * the job the mower is on (`bdTaskID`, which the app sends with every write during a job).
 *
 * The readings and their meaning are the ecovacs-goat-g1 project's (MIT), observed from the app.
 * Pure: no clock, no I/O.
 */

/** @typedef {'mowing' | 'paused' | 'returning' | 'docked' | 'idle' | 'error'} Activity */

/** @typedef {'g1' | 'rtk'} Dialect */

/**
 * The mower's settings.
 *
 * @typedef {object} MowerSettings
 * @property {boolean | null} rainSensor - Whether it stops for rain.
 * @property {number | null} rainDelay - How long it waits after rain, in minutes.
 * @property {boolean | null} animalProtection - Whether it stays in at night for animals.
 * @property {string | null} animalStart - When that starts, `HH:MM`.
 * @property {string | null} animalEnd - When it ends, `HH:MM`.
 * @property {boolean | null} aiRecognition - Whether its camera looks for obstacles.
 * @property {boolean | null} edgeMowing - Whether it mows along the edges.
 * @property {number | null} edgeMode - How it does, as the mower numbers it.
 * @property {boolean | null} saferMode - Whether its buttons are locked.
 * @property {boolean | null} liftWarning - Whether it sounds when lifted.
 * @property {boolean | null} borderWarning - Whether it warns on crossing the map's border.
 * @property {number | null} cutDirection - The angle it mows its lines at, in degrees.
 * @property {string | null} mowingEfficiency - `quick` or `delicate`.
 * @property {string | null} obstacleAvoidance - `short_grass`, `general` or `bumpy_tall_grass`.
 */

/**
 * Everything the platform reads of one mower.
 *
 * @typedef {object} MowerState
 * @property {Activity | null} activity - What it is doing; null until it has said.
 * @property {string | null} taskId - The job it is on, which writes carry.
 * @property {number | null} battery - Percent.
 * @property {boolean | null} isCharging - Whether it charges.
 * @property {number | null} errorCode - The fault it reports; 0 for none.
 * @property {string | null} error - The fault, in words; `No fault` for none.
 * @property {boolean | null} hasError - Whether it reports a fault.
 * @property {{ ssid: string | null; rssi: number | null; ip: string | null }} wifi - Its Wi-Fi.
 * @property {{ area: number | null; jobArea: number | null; progress: number | null;
 *   duration: number | null }} job - The job: mowed and planned area in m², percent, seconds.
 * @property {{ area: number | null; duration: number | null; count: number | null }} totals -
 *   Everything it ever mowed, in m², seconds and jobs.
 * @property {{ blade: number | null; lensBrush: number | null }} lifespans - Percent left.
 * @property {MowerSettings} settings - Its settings.
 */

/** The fault codes that are no fault. */
const NO_FAULT = new Set([0, 100]);

/** The fault that sends a mower home: a weak signal. */
const WEAK_SIGNAL = 422;

/** What the known faults are called. */
const FAULTS = new Map([
  [422, 'Weak signal: going back to its station'],
  [500, 'The request timed out'],
  [4200, 'The mower cannot be reached'],
]);

/** How mowing efficiency is numbered, both ways. */
const EFFICIENCY_BY_LEVEL = new Map([
  [1, 'quick'],
  [2, 'delicate'],
]);

/** How the height of what it treats as an obstacle is numbered, both ways. */
const OBSTACLE_BY_LEVEL = new Map([
  [1, 'short_grass'],
  [2, 'general'],
  [3, 'bumpy_tall_grass'],
]);

/**
 * A level's number, from its name in one of the tables.
 *
 * @param {Map<number, string>} table - The table.
 * @param {unknown} name - The name.
 * @returns {number | undefined} The level.
 */
function levelOf(table, name) {
  for (const [level, each] of table) {
    if (each === name) {
      return level;
    }
  }

  return undefined;
}

/**
 * The writes the app sends the current job with.
 *
 * @type {ReadonlySet<string>}
 */
const WITH_TASK = new Set([
  'charge',
  'clean_V2',
  'setAnimProtect',
  'setBorderSwitch',
  'setChildLock',
  'setCrossMapBorderWarning',
  'setCutDirection',
  'setCutEfficiency',
  'setMoveupWarning',
  'setObstacleHeight',
  'setRainDelay',
  'setRecognization',
]);

/**
 * The grouped reads a mower is asked for its whole state, as the app asks them. `getCleanInfo_V2`
 * is the G1 line's; the O series answers `getCleanInfo`.
 *
 * @param {Dialect} dialect - The mower's dialect.
 * @returns {string[][]} The groups, each one `getInfo`.
 */
export function readGroupsOf(dialect) {
  const cleanInfo = dialect === 'g1' ? 'getCleanInfo_V2' : 'getCleanInfo';

  return [
    ['getChargeState', cleanInfo, 'getBattery', 'getStats', 'getError'],
    ['getRainDelay', 'getAnimProtect', 'getRecognization', 'getBorderSwitch', 'getChildLock'],
    [
      'getMoveupWarning',
      'getCrossMapBorderWarning',
      'getCutDirection',
      'getCutEfficiency',
      'getObstacleHeight',
    ],
  ];
}

/** The reads a mower is asked one by one, less often: they change slowly. */
export const SLOW_READS = ['getWifiList', 'getLifeSpan', 'getTotalStats'];

/**
 * A mower nothing has been heard from.
 *
 * @returns {MowerState} The state, every value unknown.
 */
export function emptyState() {
  return {
    activity: null,
    taskId: null,
    battery: null,
    isCharging: null,
    errorCode: null,
    error: null,
    hasError: null,
    wifi: { ssid: null, rssi: null, ip: null },
    job: { area: null, jobArea: null, progress: null, duration: null },
    totals: { area: null, duration: null, count: null },
    lifespans: { blade: null, lensBrush: null },
    settings: {
      rainSensor: null,
      rainDelay: null,
      animalProtection: null,
      animalStart: null,
      animalEnd: null,
      aiRecognition: null,
      edgeMowing: null,
      edgeMode: null,
      saferMode: null,
      liftWarning: null,
      borderWarning: null,
      cutDirection: null,
      mowingEfficiency: null,
      obstacleAvoidance: null,
    },
  };
}

/**
 * Reads an object out of a value, or nothing.
 *
 * @param {unknown} value - The value.
 * @returns {Record<string, unknown> | undefined} It, when it is one.
 */
function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;
}

/**
 * Reads a whole number, or nothing.
 *
 * @param {unknown} value - A number, or text holding one.
 * @returns {number | null} It, truncated.
 */
function integerOf(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

  return typeof number === 'number' && Number.isFinite(number) ? Math.trunc(number) : null;
}

/**
 * Reads a number, or nothing.
 *
 * @param {unknown} value - A number, or text holding one.
 * @returns {number | null} It.
 */
function numberOf(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/**
 * Reads a flag the way the mower writes one: `1`, `0`, `"1"`, or a boolean.
 *
 * @param {unknown} value - The flag.
 * @returns {boolean | null} It.
 */
function flagOf(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const number = integerOf(value);

  return number === null ? null : number !== 0;
}

/**
 * A time the way the mower writes it - `19:0` - as `19:00`.
 *
 * @param {unknown} value - The time.
 * @returns {string | null} It, or null when it is none.
 */
export function timeOf(value) {
  const match = typeof value === 'string' ? /^(\d{1,2}):(\d{1,2})$/u.exec(value.trim()) : null;

  if (match === null) {
    return null;
  }

  return `${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}`;
}

/**
 * An area the mower reports in square centimetres, in square metres.
 *
 * @param {unknown} value - The area.
 * @returns {number | null} It, in m², to a hundredth.
 */
function squareMetresOf(value) {
  const area = numberOf(value);

  return area === null ? null : Math.round(area / 100) / 100;
}

/**
 * The job a report is about, where the app's payloads put it.
 *
 * @param {Record<string, unknown>} data - The report.
 * @param {string | null} current - The job known before.
 * @returns {string | null} The job.
 */
function taskOf(data, current) {
  for (const source of [data, recordOf(data['cleanState']) ?? {}]) {
    for (const key of ['bdTaskID', 'mowid', 'cid', 'cleanId']) {
      const value = source[key];

      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }
    }
  }

  return current;
}

/**
 * What a mowing report says the mower is doing.
 *
 * @param {Record<string, unknown>} data - `getCleanInfo_V2` or `getCleanInfo`.
 * @param {Activity | null} current - What it was doing.
 * @returns {Activity | null} What it is doing.
 */
function cleanActivityOf(data, current) {
  const state = data['state'];
  const motion = recordOf(data['cleanState'])?.['motionState'];
  const trigger = data['trigger'];

  if (trigger === 'alert') {
    return 'error';
  }

  if (motion === 'pause' || integerOf(data['paused']) === 1) {
    return 'paused';
  }

  if (state === 'goCharging' || motion === 'goCharging') {
    return 'returning';
  }

  if (state === 'clean' || state === 'working' || motion === 'working') {
    return 'mowing';
  }

  // A job the mower started on its own schedule says so in the trigger, in words that differ by
  // model; while it is not idle, it is mowing.
  if (
    (trigger === 'schedule' || trigger === 'appointment' || trigger === 'scheduleClean') &&
    state !== 'idle' &&
    state !== 'goCharging'
  ) {
    return 'mowing';
  }

  if (state === 'idle') {
    return current === 'docked' ? 'docked' : 'idle';
  }

  return current;
}

/**
 * Folds one report into the state.
 *
 * @param {MowerState} state - The state before.
 * @param {string} command - What the report answers or pushes: `getBattery`, `onRainDelay`, or
 *   `getInfo` for a group of them.
 * @param {unknown} data - What it says.
 * @returns {MowerState} The state after; the same object when the report says nothing known.
 */
export function applyReport(state, command, data) {
  if (command === 'getInfo') {
    const group = recordOf(data) ?? {};

    return Object.entries(group).reduce((folded, [nested, value]) => {
      const inner = recordOf(value);

      return applyReport(
        folded,
        nested,
        inner !== undefined && 'data' in inner ? inner['data'] : value,
      );
    }, state);
  }

  const record = recordOf(data);
  const name = command.replace(/^(get|on|report)/u, '');

  if (name === 'LifeSpan' && Array.isArray(data)) {
    const lifespans = { ...state.lifespans };

    for (const item of data.map(recordOf)) {
      const left = numberOf(item?.['left']);
      const total = numberOf(item?.['total']);

      if (left !== null && total !== null && total > 0) {
        const percent = Math.round((left / total) * 1000) / 10;

        if (item?.['type'] === 'blade') {
          lifespans.blade = percent;
        } else if (item?.['type'] === 'lensBrush') {
          lifespans.lensBrush = percent;
        }
      }
    }

    return { ...state, lifespans };
  }

  if (record === undefined) {
    return state;
  }

  /**
   * The state with some settings changed.
   *
   * @param {Partial<MowerSettings>} changes - What changed.
   * @returns {MowerState} The state.
   */
  const settings = (changes) => ({
    ...state,
    settings: { ...state.settings, ...changes },
  });

  switch (name) {
    case 'Battery': {
      return { ...state, battery: integerOf(record['value']) ?? state.battery };
    }

    case 'ChargeState': {
      const isCharging = flagOf(record['isCharging']);

      return {
        ...state,
        isCharging: isCharging ?? state.isCharging,
        activity: isCharging === true ? 'docked' : state.activity,
      };
    }

    case 'CleanInfo_V2':
    case 'CleanInfo': {
      let activity = cleanActivityOf(record, state.activity);

      // Paused on the way home - a weak signal - is still going home.
      if (
        activity === 'paused' &&
        (state.activity === 'returning' || state.errorCode === WEAK_SIGNAL)
      ) {
        activity = 'returning';
      }

      return {
        ...state,
        activity,
        isCharging: activity === 'mowing' ? false : state.isCharging,
        taskId: taskOf(record, state.taskId),
      };
    }

    case 'Stats': {
      const mowed = numberOf(record['mowedArea']);
      const planned = numberOf(record['area']);
      let progress = null;

      for (const key of ['progress', 'cleanProgress', 'mowingProgress', 'percent', 'percentage']) {
        const value = numberOf(record[key]);

        if (value !== null) {
          progress =
            Math.round(Math.min(100, Math.max(0, value <= 1 ? value * 100 : value)) * 10) / 10;
          break;
        }
      }

      if (progress === null && mowed !== null && planned !== null && planned > 0) {
        progress = Math.round(Math.min(100, (mowed / planned) * 100) * 10) / 10;
      }

      return {
        ...state,
        taskId: taskOf(record, state.taskId),
        job: {
          area: squareMetresOf(mowed ?? planned),
          jobArea: squareMetresOf(planned),
          progress,
          duration: integerOf(record['time']),
        },
      };
    }

    case 'TotalStats': {
      return {
        ...state,
        totals: {
          area: squareMetresOf(record['area']),
          duration: integerOf(record['time']),
          count: integerOf(record['count']),
        },
      };
    }

    case 'Error': {
      const codes = record['code'];
      const code = integerOf(Array.isArray(codes) ? codes.at(-1) : codes);

      if (code === null) {
        return state;
      }

      const isFault = !NO_FAULT.has(code);
      /** @type {Activity | null} */
      let activity = state.activity;

      if (code === WEAK_SIGNAL) {
        activity =
          state.isCharging === true || state.activity === 'docked' ? 'docked' : 'returning';
      } else if (isFault) {
        activity = 'error';
      } else if (state.activity === 'error') {
        // The fault cleared: what it does now, the next report says.
        activity = state.isCharging === true ? 'docked' : 'idle';
      }

      return {
        ...state,
        errorCode: code,
        hasError: isFault && code !== WEAK_SIGNAL,
        error: isFault ? (FAULTS.get(code) ?? `Fault ${String(code)}`) : 'No fault',
        activity,
      };
    }

    case 'WifiList': {
      const first = recordOf(Array.isArray(record['list']) ? record['list'][0] : undefined) ?? {};

      return {
        ...state,
        wifi: {
          ssid: typeof first['ssid'] === 'string' ? first['ssid'] : state.wifi.ssid,
          rssi: integerOf(first['rssi']) ?? state.wifi.rssi,
          ip: typeof first['ip'] === 'string' ? first['ip'] : state.wifi.ip,
        },
      };
    }

    case 'RainDelay': {
      return settings({
        rainSensor: flagOf(record['enable']) ?? state.settings.rainSensor,
        rainDelay: integerOf(record['delay']) ?? state.settings.rainDelay,
      });
    }

    case 'AnimProtect': {
      return settings({
        animalProtection: flagOf(record['enable']) ?? state.settings.animalProtection,
        animalStart: timeOf(record['start']) ?? state.settings.animalStart,
        animalEnd: timeOf(record['end']) ?? state.settings.animalEnd,
      });
    }

    case 'ProtectState': {
      return settings({
        animalProtection: flagOf(record['isAnimProtect']) ?? state.settings.animalProtection,
        saferMode: flagOf(record['isLocked']) ?? state.settings.saferMode,
      });
    }

    case 'Recognization': {
      return settings({ aiRecognition: flagOf(record['state']) ?? state.settings.aiRecognition });
    }

    case 'BorderSwitch': {
      return settings({
        edgeMowing: flagOf(record['enable']) ?? state.settings.edgeMowing,
        edgeMode: integerOf(record['mode']) ?? state.settings.edgeMode,
      });
    }

    case 'ChildLock': {
      return settings({ saferMode: flagOf(record['on']) ?? state.settings.saferMode });
    }

    case 'MoveupWarning': {
      return settings({ liftWarning: flagOf(record['enable']) ?? state.settings.liftWarning });
    }

    case 'CrossMapBorderWarning': {
      return settings({ borderWarning: flagOf(record['enable']) ?? state.settings.borderWarning });
    }

    case 'CutDirection': {
      return settings({ cutDirection: integerOf(record['angle']) ?? state.settings.cutDirection });
    }

    case 'CutEfficiency': {
      const level = integerOf(record['level']);

      return settings({
        mowingEfficiency:
          (level === null ? undefined : EFFICIENCY_BY_LEVEL.get(level)) ??
          state.settings.mowingEfficiency,
      });
    }

    case 'ObstacleHeight': {
      const level = integerOf(record['level']);

      return settings({
        obstacleAvoidance:
          (level === null ? undefined : OBSTACLE_BY_LEVEL.get(level)) ??
          state.settings.obstacleAvoidance,
      });
    }

    default: {
      return state;
    }
  }
}

/**
 * The pushes after which the mower is read again, since they mean something moved.
 *
 * @param {string} command - What was pushed.
 * @returns {boolean} True when the rest of its state may have moved with it.
 */
export function isTelling(command) {
  return /^on(CleanInfo|ChargeState|Error|Stats|WorkState|BreakPointStatus)/u.test(command);
}

/**
 * One command to send.
 *
 * @typedef {object} Command
 * @property {string} command - Its name.
 * @property {Record<string, unknown>} data - What it carries.
 * @property {string} [fallback] - The same act in the other dialect, for a mower that refuses the
 *   first.
 * @property {Record<string, unknown>} [fallbackData] - What that one carries.
 */

/**
 * What mowing, pausing, ending or docking sends, in a dialect.
 *
 * @param {'start' | 'pause' | 'stop' | 'dock'} act - The act.
 * @param {MowerState} state - The state now: a paused job is resumed, not started again, and a
 *   mower on its way home is stopped rather than sent home twice.
 * @param {Dialect} dialect - The dialect.
 * @returns {Command} The command.
 */
export function mowCommandOf(act, state, dialect) {
  if (act === 'dock') {
    return state.activity === 'returning'
      ? { command: 'charge', data: { act: 'stop' } }
      : { command: 'charge', data: { act: 'go' } };
  }

  const verb =
    act === 'start' && (state.activity === 'paused' || state.activity === 'returning')
      ? 'resume'
      : act;

  /**
   * The body of the act in one dialect.
   *
   * @param {Dialect} spoken - The dialect.
   * @returns {Record<string, unknown>} The body.
   */
  const body = (spoken) => {
    if (spoken === 'rtk') {
      return { act: verb, content: { type: 'auto' } };
    }

    if (verb === 'start') {
      return { act: 'start', content: { type: 'auto' } };
    }

    return verb === 'stop' ? { act: 'stop', content: { type: '' } } : { act: verb };
  };
  const other = dialect === 'g1' ? 'rtk' : 'g1';

  return {
    command: dialect === 'g1' ? 'clean_V2' : 'clean',
    data: body(dialect),
    fallback: other === 'g1' ? 'clean_V2' : 'clean',
    fallbackData: body(other),
  };
}

/**
 * A flag as the mower writes one.
 *
 * @param {boolean} value - The flag.
 * @returns {0 | 1} It.
 */
function bit(value) {
  return value ? 1 : 0;
}

/**
 * What changing one setting sends, with what the command needs beside the one value.
 *
 * @param {string} setting - The setting, by the name the profile uses: `rainSensor`.
 * @param {unknown} value - What to set it to.
 * @param {MowerState} state - The state now, for the other half of a pair.
 * @returns {Command} The command.
 * @throws {Error} When the setting is not one the mower has, or the value not one it takes.
 */
export function settingCommandOf(setting, value, state) {
  const { settings } = state;

  /**
   * Refuses a value.
   *
   * @returns {never} Nothing: it throws.
   * @throws {Error} Always, saying which value was refused.
   */
  const refuse = () => {
    throw new Error(`${setting} cannot be set to ${JSON.stringify(value)}`);
  };

  /**
   * The value, as the on or off a switch sends.
   *
   * @returns {boolean} It.
   */
  const flag = () => (typeof value === 'boolean' ? value : refuse());

  switch (setting) {
    case 'rainSensor': {
      return {
        command: 'setRainDelay',
        data: { enable: bit(flag()), delay: settings.rainDelay ?? 180 },
      };
    }

    case 'rainDelay': {
      const delay = typeof value === 'number' && value >= 0 ? Math.round(value) : refuse();

      return {
        command: 'setRainDelay',
        data: { enable: bit(settings.rainSensor ?? true), delay },
      };
    }

    case 'animalProtection': {
      return {
        command: 'setAnimProtect',
        data: {
          enable: bit(flag()),
          start: settings.animalStart ?? '19:00',
          end: settings.animalEnd ?? '08:00',
        },
      };
    }

    case 'animalStart':
    case 'animalEnd': {
      const time = timeOf(value) ?? refuse();

      return {
        command: 'setAnimProtect',
        data: {
          enable: bit(settings.animalProtection ?? false),
          start: setting === 'animalStart' ? time : (settings.animalStart ?? '19:00'),
          end: setting === 'animalEnd' ? time : (settings.animalEnd ?? '08:00'),
        },
      };
    }

    case 'aiRecognition': {
      return { command: 'setRecognization', data: { state: bit(flag()) } };
    }

    case 'edgeMowing': {
      return { command: 'setBorderSwitch', data: { enable: bit(flag()) } };
    }

    case 'saferMode': {
      return { command: 'setChildLock', data: { on: bit(flag()) } };
    }

    case 'liftWarning': {
      return { command: 'setMoveupWarning', data: { enable: bit(flag()) } };
    }

    case 'borderWarning': {
      return { command: 'setCrossMapBorderWarning', data: { enable: bit(flag()) } };
    }

    case 'cutDirection': {
      if (
        state.activity === 'mowing' ||
        state.activity === 'paused' ||
        state.activity === 'returning'
      ) {
        throw new Error(
          'The cut direction changes only while the mower is in its station or idle: end the job first',
        );
      }

      const angle =
        typeof value === 'number' && value >= 0 && value <= 180 ? Math.round(value) : refuse();

      return { command: 'setCutDirection', data: { angle } };
    }

    case 'mowingEfficiency': {
      return {
        command: 'setCutEfficiency',
        data: { level: levelOf(EFFICIENCY_BY_LEVEL, value) ?? refuse() },
      };
    }

    case 'obstacleAvoidance': {
      return {
        command: 'setObstacleHeight',
        data: { level: levelOf(OBSTACLE_BY_LEVEL, value) ?? refuse() },
      };
    }

    default: {
      throw new Error(`The mower has no setting ${setting}`);
    }
  }
}

/**
 * Adds the job the mower is on to a write that the app sends it with.
 *
 * @param {Command} command - The write.
 * @param {MowerState} state - The state now.
 * @returns {Command} The write, with the job when there is one.
 */
export function withTask(command, state) {
  if (!WITH_TASK.has(command.command) || state.taskId === null || 'bdTaskID' in command.data) {
    return command;
  }

  return { ...command, data: { ...command.data, bdTaskID: state.taskId } };
}

/**
 * What a report of a setting written looks like, so the state shows it before the mower's own
 * report comes: the answer to a write carries nothing to read.
 *
 * @param {Command} command - The write that was taken.
 * @returns {{ command: string; data: unknown } | null} The report it amounts to.
 */
export function echoOf(command) {
  if (!command.command.startsWith('set')) {
    return null;
  }

  return { command: `get${command.command.slice(3)}`, data: command.data };
}

/**
 * What a read carries: nothing - a GOAT answers every read whole.
 *
 * @returns {Record<string, never>} Nothing.
 */
export function readDataOf() {
  return {};
}

/**
 * The dialect a GOAT may speak instead of the one it was believed to.
 *
 * @param {Dialect} dialect - The one it was spoken to in.
 * @returns {Dialect} The other.
 */
export function otherDialect(dialect) {
  return dialect === 'g1' ? 'rtk' : 'g1';
}

/**
 * Which dialect answers a clean read.
 *
 * @param {string} cleanInfo - `getCleanInfo` or `getCleanInfo_V2`.
 * @returns {Dialect} The dialect.
 */
export function dialectOfCleanInfo(cleanInfo) {
  return cleanInfo === 'getCleanInfo' ? 'rtk' : 'g1';
}

/** Everything the transport uses of a GOAT, together. */
export const role = {
  readGroupsOf,
  slowReads: SLOW_READS,
  readDataOf,
  emptyState,
  applyReport,
  isTelling,
  settingCommandOf,
  echoOf,
  withTask,
  otherDialect,
  dialectOfCleanInfo,
};
