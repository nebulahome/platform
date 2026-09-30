// @ts-check
/**
 * A DEEBOT robot vacuum's state, put together from what it answers and what it pushes, and its
 * commands - as `mower.js` is for a GOAT.
 *
 * A DEEBOT says things one at a time - its battery in `onBattery`, what it is doing in
 * `onCleanInfo_V2`, its suction in `onSpeed` - and answers a grouped read (`getInfo`) with several
 * at once. Every one is folded into one record, named and in the units the platform reads (square
 * metres, seconds, percent), and the transport hands the whole record to the device each time it
 * changes, so the driver's profile is a table of paths.
 *
 * **The map** is a record of its own inside the state (`map`): the rooms (`getMapSet` and each
 * `getMapSubSet`), the virtual walls and the no-mop zones set in the app (the same, of the types
 * `vw` and `mw`), where the robot and its station are (`getPos`, pushed as `onPos`), the pieces of
 * the floor plan (`getMajorMap` names them, `getMinorMap` sends each) - or, from a robot that sends
 * no pieces, the outline of its walls whole (`getMapInfo_V2`, pushed as `onMapInfo_V2`) - and the
 * path it took (`getMapTrace`). `map.js` draws it; the rooms are also the vacuum's own state, which
 * is what **Clean these rooms** picks from.
 *
 * The protocol is the ECOVACS HOME app's JSON one, as the DeebotUniverse client library observed
 * it (GPL-3.0): only its facts are used here - command names, fields and their meaning - and the
 * code is this bundle's own. Pure: no clock, no I/O.
 */

/** @typedef {'cleaning' | 'paused' | 'returning' | 'docked' | 'idle' | 'error'} Activity */

/** @typedef {'v1' | 'v2'} Dialect */

/**
 * One room of the map.
 *
 * @typedef {object} Room
 * @property {string} id - Its id on the map (`mssid`).
 * @property {string} name - What the app calls it, or the kind of room it is.
 * @property {Array<[number, number]>} outline - Its corners, in millimetres.
 */

/**
 * A line or an area set in the app that the robot keeps to: a virtual wall it does not cross, a
 * zone it does not mop.
 *
 * @typedef {object} Barrier
 * @property {string} id - Its id on the map (`mssid`).
 * @property {'virtual' | 'no_mop'} kind - Which: `vw` or `mw`.
 * @property {Array<[number, number]>} points - Its corners, in millimetres: two for a wall.
 */

/**
 * What is known of the robot's map.
 *
 * @typedef {object} VacuumMap
 * @property {string | null} mapId - The map in use (`mid`).
 * @property {Room[]} rooms - Its rooms.
 * @property {{ x: number; y: number; angle: number } | null} robot - Where the robot is, in
 *   millimetres, and which way it faces in degrees.
 * @property {{ x: number; y: number } | null} station - Where its station is.
 * @property {Array<string | null>} pieceCrcs - The 64 pieces of the floor plan, by what the robot
 *   says each holds; null for one it did not say.
 * @property {Record<string, string>} pieces - Each piece received, by index, as the robot sent it
 *   (base64, packed).
 * @property {Array<[number, number, boolean]>} trace - The path taken this job, in millimetres,
 *   and whether each point joins the one before.
 * @property {Barrier[]} barriers - Its virtual walls and no-mop zones.
 * @property {string | null} outline - The outline of its walls and rooms as the robot sent it
 *   whole (`getMapInfo_V2`: base64, packed), for a robot that sends no pieces; null for the rest.
 */

/**
 * Everything the platform reads of one robot vacuum.
 *
 * @typedef {object} VacuumState
 * @property {Activity | null} activity - What it is doing; null until it has said.
 * @property {boolean} isResumable - Whether a job it stopped part way - paused, or stopped by a
 *   fault - is there to carry on from where it got to.
 * @property {number | null} battery - Percent.
 * @property {boolean | null} isCharging - Whether it charges.
 * @property {number | null} errorCode - The fault it reports; 0 for none.
 * @property {string | null} error - The fault, in words; `No fault` for none.
 * @property {boolean | null} hasError - Whether it reports a fault.
 * @property {{ ssid: string | null; rssi: number | null; ip: string | null }} wifi - Its Wi-Fi.
 * @property {{ area: number | null; duration: number | null }} job - The job: m² and seconds.
 * @property {{ area: number | null; duration: number | null; count: number | null }} totals -
 *   Everything it ever cleaned, in m², seconds and jobs.
 * @property {{ brush: number | null; sideBrush: number | null; filter: number | null }} lifespans
 *   - Percent left of each consumable.
 * @property {{ suction: string | null; water: string | null; volume: number | null;
 *   continuousCleaning: boolean | null; carpetBoost: boolean | null; cleanCount: number | null }}
 *   settings - Its settings.
 * @property {Array<{ id: string; name: string }>} rooms - The rooms of its map, for the vacuum.
 * @property {VacuumMap} map - What is known of its map.
 */

/** The most points of the path kept: a long job's path, drawn, stays a few tens of kilobytes. */
const TRACE_MAXIMUM_POINTS = 20_000;

/** The most virtual walls and no-mop zones kept, of each kind. */
const BARRIERS_MAXIMUM = 64;

/**
 * What each type of map set drawn beside the rooms is.
 *
 * @type {Readonly<Record<string, 'virtual' | 'no_mop'>>}
 */
const BARRIER_KINDS = { vw: 'virtual', mw: 'no_mop' };

/** The fault codes that are no fault. */
const NO_FAULT = new Set([0, 100]);

/** What the common faults are called. */
const FAULTS = new Map([
  [101, 'The battery is low'],
  [102, 'The main brush is stuck'],
  [103, 'A wheel is stuck'],
  [104, 'The bumper is stuck'],
  [105, 'The side brush is stuck'],
  [106, 'The dust bin is missing'],
  [110, 'The water tank is empty'],
  [111, 'The mop is missing'],
  [113, 'The robot is stuck'],
  [114, 'The cliff sensor is dirty'],
  [4200, 'The robot cannot be reached'],
]);

/** Suction, both ways: the robot's number, the setting's word. */
const SUCTION = new Map([
  [1000, 'quiet'],
  [0, 'standard'],
  [1, 'max'],
  [2, 'max_plus'],
]);

/** Water, both ways. */
const WATER = new Map([
  [1, 'low'],
  [2, 'medium'],
  [3, 'high'],
  [4, 'ultrahigh'],
]);

/**
 * What each kind of room is called when the app gave it no name, by its `subtype`.
 *
 * @type {ReadonlyMap<string, string>}
 */
const ROOM_KINDS = new Map([
  ['1', 'Living room'],
  ['2', 'Dining room'],
  ['3', 'Bedroom'],
  ['4', 'Study'],
  ['5', 'Kitchen'],
  ['6', 'Bathroom'],
  ['7', 'Laundry'],
  ['8', 'Lounge'],
  ['9', 'Storeroom'],
  ['10', "Kids' room"],
  ['11', 'Sunroom'],
  ['12', 'Corridor'],
  ['13', 'Balcony'],
  ['14', 'Gym'],
]);

/**
 * The grouped reads a DEEBOT is asked for its whole state, as the app asks them.
 *
 * @param {Dialect} dialect - The robot's dialect.
 * @returns {string[][]} The groups, each one `getInfo`.
 */
export function readGroupsOf(dialect) {
  const cleanInfo = dialect === 'v2' ? 'getCleanInfo_V2' : 'getCleanInfo';

  return [
    ['getChargeState', cleanInfo, 'getBattery', 'getStats', 'getError'],
    [
      'getSpeed',
      'getWaterInfo',
      'getVolume',
      'getBreakPoint',
      'getCarpertPressure',
      'getCleanCount',
    ],
  ];
}

/** The reads a DEEBOT is asked one by one, less often: they change slowly. */
export const SLOW_READS = ['getNetInfo', 'getLifeSpan', 'getTotalStats'];

/**
 * What a read carries: the consumables asked for by name, nothing for the rest.
 *
 * @param {string} command - The read.
 * @returns {unknown} What it carries.
 */
export function readDataOf(command) {
  return command === 'getLifeSpan' ? ['brush', 'sideBrush', 'heap'] : {};
}

/**
 * A robot nothing has been heard from.
 *
 * @returns {VacuumState} The state, every value unknown.
 */
export function emptyState() {
  return {
    activity: null,
    isResumable: false,
    battery: null,
    isCharging: null,
    errorCode: null,
    error: null,
    hasError: null,
    wifi: { ssid: null, rssi: null, ip: null },
    job: { area: null, duration: null },
    totals: { area: null, duration: null, count: null },
    lifespans: { brush: null, sideBrush: null, filter: null },
    settings: {
      suction: null,
      water: null,
      volume: null,
      continuousCleaning: null,
      carpetBoost: null,
      cleanCount: null,
    },
    rooms: [],
    map: {
      mapId: null,
      rooms: [],
      robot: null,
      station: null,
      pieceCrcs: [],
      pieces: {},
      trace: [],
      barriers: [],
      outline: null,
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
 * Reads a flag the way the robot writes one: `1`, `0`, `"1"`, or a boolean.
 *
 * @param {unknown} value - The flag.
 * @returns {boolean | null} It.
 */
function flagOf(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const number = numberOf(value);

  return number === null ? null : number !== 0;
}

/**
 * What a clean report says the robot is doing.
 *
 * @param {Record<string, unknown>} record - `getCleanInfo(_V2)`'s data.
 * @param {VacuumState} state - The state before, for what the report leaves out.
 * @returns {Activity | null} The activity.
 */
function cleanActivityOf(record, state) {
  const said = typeof record['state'] === 'string' ? record['state'] : '';
  const clean = recordOf(record['cleanState']);
  const motion = typeof clean?.['motionState'] === 'string' ? clean['motionState'] : '';

  if (said === 'goCharging') {
    return 'returning';
  }

  if (said === 'clean') {
    return motion === 'pause' ? 'paused' : motion === 'goCharging' ? 'returning' : 'cleaning';
  }

  if (said === 'idle') {
    return state.isCharging === true ? 'docked' : 'idle';
  }

  return state.activity;
}

/**
 * A room's outline, from `getMapSubSet`'s `value`: corners `x,y;x,y;…`, in millimetres.
 *
 * @param {unknown} value - The value.
 * @returns {Array<[number, number]>} The corners.
 */
export function outlineOf(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(';')
    .map((pair) => pair.split(',').map((part) => Number(part.trim())))
    .filter((pair) => pair.length === 2 && pair.every((part) => Number.isFinite(part)))
    .map((pair) => /** @type {[number, number]} */ ([pair[0] ?? 0, pair[1] ?? 0]));
}

/**
 * The corners of a virtual wall or a no-mop zone, from its `value`: every number in it, taken two
 * at a time - `[x1,y1,x2,y2]` and `x,y;x,y` alike - in millimetres.
 *
 * @param {unknown} value - The value.
 * @returns {Array<[number, number]>} The corners; none when there is no pair.
 */
export function cornersOf(value) {
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  const numbers = (text.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);

  /** @type {Array<[number, number]>} */
  const corners = [];

  for (let index = 0; index + 1 < numbers.length; index += 2) {
    corners.push([numbers[index] ?? 0, numbers[index + 1] ?? 0]);
  }

  return corners;
}

/**
 * The state with one kind of barrier listed afresh: the ones listed, their corners kept when the
 * list does not carry them.
 *
 * @param {VacuumState} state - The state before.
 * @param {'virtual' | 'no_mop'} kind - Which kind the list is of.
 * @param {Array<Record<string, unknown> | undefined>} subsets - The list, as the map set has it.
 * @returns {VacuumState} The state.
 */
function withBarriersListed(state, kind, subsets) {
  const known = new Map(
    state.map.barriers.filter((each) => each.kind === kind).map((each) => [each.id, each]),
  );
  const listed = subsets.flatMap((subset) => {
    const id = subset?.['mssid'];

    if (subset === undefined || (typeof id !== 'string' && typeof id !== 'number')) {
      return [];
    }

    const key = String(id);
    const points = cornersOf(subset['value']);

    return [
      { id: key, kind, points: points.length >= 2 ? points : (known.get(key)?.points ?? []) },
    ];
  });

  return withMap(state, {
    barriers: [
      ...state.map.barriers.filter((each) => each.kind !== kind),
      ...listed.slice(0, BARRIERS_MAXIMUM),
    ],
  });
}

/**
 * The name of a room: the one the app gave it, else the kind it is, else its number.
 *
 * @param {Record<string, unknown>} record - The room, as the map lists it.
 * @param {string} id - Its id.
 * @returns {string} Its name.
 */
function roomNameOf(record, id) {
  const given = typeof record['name'] === 'string' ? record['name'].trim() : '';

  if (given !== '') {
    return given.slice(0, 64);
  }

  return ROOM_KINDS.get(String(record['subtype'] ?? '')) ?? `Room ${id}`;
}

/**
 * The state with the map changed, the vacuum's rooms following the map's.
 *
 * @param {VacuumState} state - The state before.
 * @param {Partial<VacuumMap>} changes - What changed.
 * @returns {VacuumState} The state.
 */
function withMap(state, changes) {
  const map = { ...state.map, ...changes };

  return {
    ...state,
    map,
    rooms: map.rooms.map((room) => ({ id: room.id, name: room.name })),
  };
}

/**
 * Folds one report - an answer or a push - into the state.
 *
 * @param {VacuumState} state - The state before.
 * @param {string} command - What the report answers or pushes: `getBattery`, `onSpeed`, or
 *   `getInfo` for a group of them.
 * @param {unknown} data - What it says.
 * @returns {VacuumState} The state after; the same object when the report says nothing known.
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

  const name = command.replace(/^(get|on|report)/u, '');

  if (name === 'LifeSpan' && Array.isArray(data)) {
    const lifespans = { ...state.lifespans };

    for (const item of data.map(recordOf)) {
      const left = numberOf(item?.['left']);
      const total = numberOf(item?.['total']);

      if (left !== null && total !== null && total > 0) {
        const percent = Math.round((left / total) * 1000) / 10;
        const type = item?.['type'];

        if (type === 'brush') {
          lifespans.brush = percent;
        } else if (type === 'sideBrush') {
          lifespans.sideBrush = percent;
        } else if (type === 'heap') {
          lifespans.filter = percent;
        }
      }
    }

    return { ...state, lifespans };
  }

  const record = recordOf(data);

  if (record === undefined) {
    return state;
  }

  /**
   * The state with some settings changed.
   *
   * @param {Partial<VacuumState['settings']>} changes - What changed.
   * @returns {VacuumState} The state.
   */
  const settings = (changes) => ({ ...state, settings: { ...state.settings, ...changes } });

  switch (name) {
    case 'Battery': {
      return { ...state, battery: numberOf(record['value']) ?? state.battery };
    }

    case 'ChargeState': {
      const isCharging = flagOf(record['isCharging']);

      return {
        ...state,
        isCharging: isCharging ?? state.isCharging,
        activity:
          isCharging === true
            ? 'docked'
            : isCharging === false && state.activity === 'docked'
              ? 'idle'
              : state.activity,
      };
    }

    case 'CleanInfo_V2':
    case 'CleanInfo': {
      const activity = cleanActivityOf(record, state);

      const said = record['state'];

      return {
        ...state,
        activity,
        // A job stays open until the robot says it is idle: paused, going to charge half way, or
        // stopped by a fault in the middle of it.
        isResumable: said === 'clean' ? true : said === 'idle' ? false : state.isResumable,
        isCharging: activity === 'cleaning' ? false : state.isCharging,
        // A new job's path starts again; one carried on - after a pause, a charge half way, a
        // fault - keeps the path it had.
        map:
          activity === 'cleaning' &&
          !state.isResumable &&
          state.activity !== 'cleaning' &&
          state.activity !== 'paused'
            ? { ...state.map, trace: [] }
            : state.map,
      };
    }

    case 'Error': {
      const codes = Array.isArray(record['code']) ? record['code'] : [record['code']];
      const code = numberOf(codes.find((each) => !NO_FAULT.has(numberOf(each) ?? 0)) ?? codes[0]);
      const isFault = code !== null && !NO_FAULT.has(code);

      return {
        ...state,
        errorCode: code ?? 0,
        hasError: isFault,
        error: isFault ? (FAULTS.get(code) ?? `Fault ${String(code)}`) : 'No fault',
        activity: isFault ? 'error' : state.activity === 'error' ? 'idle' : state.activity,
      };
    }

    case 'Stats': {
      return {
        ...state,
        job: {
          area: numberOf(record['area']) ?? state.job.area,
          duration: numberOf(record['time']) ?? state.job.duration,
        },
      };
    }

    case 'TotalStats': {
      return {
        ...state,
        totals: {
          area: numberOf(record['area']) ?? state.totals.area,
          duration: numberOf(record['time']) ?? state.totals.duration,
          count: numberOf(record['count']) ?? state.totals.count,
        },
      };
    }

    case 'NetInfo': {
      return {
        ...state,
        wifi: {
          ssid: typeof record['ssid'] === 'string' ? record['ssid'] : state.wifi.ssid,
          rssi: numberOf(record['rssi']) ?? state.wifi.rssi,
          ip: typeof record['ip'] === 'string' ? record['ip'] : state.wifi.ip,
        },
      };
    }

    case 'Speed': {
      const speed = numberOf(record['speed']);

      return settings({
        suction: speed === null ? state.settings.suction : (SUCTION.get(speed) ?? null),
      });
    }

    case 'WaterInfo': {
      const amount = numberOf(record['amount']);

      return settings({
        water: amount === null ? state.settings.water : (WATER.get(amount) ?? null),
      });
    }

    case 'Volume': {
      return settings({ volume: numberOf(record['volume']) ?? state.settings.volume });
    }

    case 'BreakPoint': {
      return settings({
        continuousCleaning: flagOf(record['enable']) ?? state.settings.continuousCleaning,
      });
    }

    case 'CarpertPressure': {
      return settings({ carpetBoost: flagOf(record['enable']) ?? state.settings.carpetBoost });
    }

    case 'CleanCount': {
      return settings({ cleanCount: numberOf(record['count']) ?? state.settings.cleanCount });
    }

    case 'CachedMapInfo': {
      const info = Array.isArray(record['info']) ? record['info'].map(recordOf) : [];
      const used = info.find((each) => flagOf(each?.['using']) === true) ?? info[0];
      const mapId = used?.['mid'];

      return typeof mapId === 'string' || typeof mapId === 'number'
        ? withMap(state, { mapId: String(mapId) })
        : state;
    }

    case 'MapSet': {
      const barrier = BARRIER_KINDS[String(record['type'])];

      if (barrier !== undefined) {
        return withBarriersListed(
          state,
          barrier,
          Array.isArray(record['subsets']) ? record['subsets'].map(recordOf) : [],
        );
      }

      if (record['type'] !== undefined && record['type'] !== 'ar') {
        return state;
      }

      const subsets = Array.isArray(record['subsets']) ? record['subsets'].map(recordOf) : [];
      const known = new Map(state.map.rooms.map((room) => [room.id, room]));
      const rooms = subsets.flatMap((subset) => {
        const id = subset?.['mssid'];

        if (subset === undefined || (typeof id !== 'string' && typeof id !== 'number')) {
          return [];
        }

        const key = String(id);

        return [
          {
            id: key,
            name: roomNameOf(subset, key),
            outline: known.get(key)?.outline ?? outlineOf(subset['value']),
          },
        ];
      });

      return withMap(state, { rooms });
    }

    case 'MapSubSet': {
      const id = record['mssid'];

      if (typeof id !== 'string' && typeof id !== 'number') {
        return state;
      }

      const key = String(id);
      const barrier = BARRIER_KINDS[String(record['type'])];

      if (barrier !== undefined) {
        const points = cornersOf(record['value']);
        const isKnown = state.map.barriers.some((each) => each.kind === barrier && each.id === key);

        return points.length < 2
          ? state
          : withMap(state, {
              barriers: isKnown
                ? state.map.barriers.map((each) =>
                    each.kind === barrier && each.id === key ? { ...each, points } : each,
                  )
                : [...state.map.barriers, { id: key, kind: barrier, points }],
            });
      }

      const outline = outlineOf(record['value']);
      const rooms = state.map.rooms.some((room) => room.id === key)
        ? state.map.rooms.map((room) =>
            room.id === key
              ? {
                  ...room,
                  outline: outline.length > 0 ? outline : room.outline,
                  name: record['name'] === undefined ? room.name : roomNameOf(record, key),
                }
              : room,
          )
        : [...state.map.rooms, { id: key, name: roomNameOf(record, key), outline }];

      return withMap(state, { rooms });
    }

    case 'Pos': {
      const robot = recordOf(record['deebotPos']);
      const stations = Array.isArray(record['chargePos'])
        ? record['chargePos']
        : [record['chargePos']];
      const station = recordOf(stations[0]);
      const x = numberOf(robot?.['x']);
      const y = numberOf(robot?.['y']);
      const sx = numberOf(station?.['x']);
      const sy = numberOf(station?.['y']);

      return withMap(state, {
        robot:
          x !== null && y !== null && flagOf(robot?.['invalid']) !== true
            ? { x, y, angle: numberOf(robot?.['a']) ?? 0 }
            : state.map.robot,
        station: sx !== null && sy !== null ? { x: sx, y: sy } : state.map.station,
      });
    }

    case 'MajorMap': {
      const value = typeof record['value'] === 'string' ? record['value'] : '';
      const pieceCrcs =
        value === '' ? state.map.pieceCrcs : value.split(',').map((each) => each.trim());
      // A piece whose content changed is sent again; the others are kept.
      const pieces = Object.fromEntries(
        Object.entries(state.map.pieces).filter(
          ([index]) => state.map.pieceCrcs[Number(index)] === pieceCrcs[Number(index)],
        ),
      );

      return withMap(state, {
        pieceCrcs,
        pieces,
        mapId: record['mid'] === undefined ? state.map.mapId : String(record['mid']),
      });
    }

    case 'MapInfo_V2': {
      // Version 0 is a map the robot keeps and does not use; 1 is the one it cleans by.
      const version = record['outlineVer'];
      const info = record['info'];

      if ((version !== undefined && String(version) !== '1') || typeof info !== 'string') {
        return state;
      }

      return withMap(state, {
        outline: info === '' ? null : info,
        mapId: record['mid'] === undefined ? state.map.mapId : String(record['mid']),
      });
    }

    case 'MinorMap': {
      const index = numberOf(record['pieceIndex']);
      const value = record['pieceValue'];

      if (index === null || typeof value !== 'string') {
        return state;
      }

      return withMap(state, { pieces: { ...state.map.pieces, [String(index)]: value } });
    }

    default: {
      return state;
    }
  }
}

/**
 * Adds the path points a trace answer carried, once unpacked (`map.js`).
 *
 * @param {VacuumState} state - The state before.
 * @param {Array<[number, number, boolean]>} points - The new points.
 * @param {boolean} isFromStart - Whether they are the path from its start, replacing the kept one.
 * @returns {VacuumState} The state.
 */
export function withTrace(state, points, isFromStart) {
  const trace = isFromStart ? points : [...state.map.trace, ...points];

  return withMap(state, { trace: trace.slice(-TRACE_MAXIMUM_POINTS) });
}

/**
 * The pushes after which the robot is read again, since they mean something moved.
 *
 * @param {string} command - What was pushed.
 * @returns {boolean} True when the rest of its state may have moved with it.
 */
export function isTelling(command) {
  return /^on(CleanInfo|ChargeState|Error|Stats)/u.test(command);
}

/**
 * One command to send.
 *
 * @typedef {object} Command
 * @property {string} command - Its name.
 * @property {Record<string, unknown>} data - What it carries.
 * @property {string} [fallback] - The same act in the other dialect, for a robot that refuses the
 *   first.
 * @property {Record<string, unknown>} [fallbackData] - What that one carries.
 */

/**
 * What cleaning, pausing, ending, docking, locating, cleaning some rooms or carrying on a job
 * sends, in a dialect.
 *
 * @param {'start' | 'pause' | 'stop' | 'dock' | 'locate' | 'rooms' | 'resume'} act - The act:
 *   `resume` carries on the job the robot stopped, a fault's included.
 * @param {VacuumState} state - The state now: a paused job is resumed, not started again.
 * @param {Dialect} dialect - The dialect.
 * @param {readonly string[]} [rooms] - For `rooms`: which, by id.
 * @returns {Command} The command.
 */
export function cleanCommandOf(act, state, dialect, rooms = []) {
  if (act === 'dock') {
    return { command: 'charge', data: { act: 'go' } };
  }

  if (act === 'locate') {
    return { command: 'playSound', data: { count: 1, sid: 30 } };
  }

  const verb =
    act === 'start' && state.activity === 'paused' ? 'resume' : act === 'rooms' ? 'start' : act;
  const v1Acts = { start: 's', pause: 'p', resume: 'r', stop: 'h' };

  /**
   * The body of the act in one dialect.
   *
   * @param {Dialect} spoken - The dialect.
   * @returns {Record<string, unknown>} The body.
   */
  const body = (spoken) => {
    if (act === 'rooms') {
      return spoken === 'v2'
        ? { act: 'start', content: { type: 'spotArea', value: rooms.join(',') } }
        : { act: 'start', type: 'spotArea', content: rooms.join(',') };
    }

    return spoken === 'v2'
      ? { act: verb, content: { type: 'auto' } }
      : { act: v1Acts[/** @type {'start' | 'pause' | 'resume' | 'stop'} */ (verb)], type: 'auto' };
  };
  const other = dialect === 'v2' ? 'v1' : 'v2';

  return {
    command: dialect === 'v2' ? 'clean_V2' : 'clean',
    data: body(dialect),
    fallback: other === 'v2' ? 'clean_V2' : 'clean',
    fallbackData: body(other),
  };
}

/**
 * What changing one setting sends.
 *
 * @param {string} setting - The setting, by the name the profile uses: `suction`.
 * @param {unknown} value - What to set it to.
 * @returns {Command} The command.
 * @throws {Error} When the setting is not one the robot has, or the value not one it takes.
 */
export function settingCommandOf(setting, value) {
  /**
   * Refuses a value.
   *
   * @returns {never} Nothing: it throws.
   * @throws {Error} Always.
   */
  const refuse = () => {
    throw new Error(`${setting} cannot be set to ${JSON.stringify(value)}`);
  };

  /**
   * The number a word stands for, in one of the tables.
   *
   * @param {ReadonlyMap<number, string>} table - The table.
   * @returns {number} The number.
   */
  const numberFor = (table) => {
    for (const [number, word] of table) {
      if (word === value) {
        return number;
      }
    }

    return refuse();
  };

  switch (setting) {
    case 'suction': {
      return { command: 'setSpeed', data: { speed: numberFor(SUCTION) } };
    }

    case 'water': {
      return { command: 'setWaterInfo', data: { amount: numberFor(WATER) } };
    }

    case 'volume': {
      const volume = numberOf(value);

      return volume === null || volume < 0 || volume > 10 || !Number.isInteger(volume)
        ? refuse()
        : { command: 'setVolume', data: { volume } };
    }

    case 'continuousCleaning': {
      return typeof value === 'boolean'
        ? { command: 'setBreakPoint', data: { enable: value ? 1 : 0 } }
        : refuse();
    }

    case 'carpetBoost': {
      return typeof value === 'boolean'
        ? { command: 'setCarpertPressure', data: { enable: value ? 1 : 0 } }
        : refuse();
    }

    case 'cleanCount': {
      const count = numberOf(value);

      return count === 1 || count === 2 ? { command: 'setCleanCount', data: { count } } : refuse();
    }

    default: {
      throw new Error(`A DEEBOT has no setting ${setting}`);
    }
  }
}

/**
 * What a report of a setting written looks like, so the state shows it before the robot's own
 * report comes.
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
 * A command as it is sent: a DEEBOT's commands carry no job of their own.
 *
 * @param {Command} command - The command.
 * @returns {Command} The same command.
 */
export function withTask(command) {
  return command;
}

/**
 * The dialect a DEEBOT may speak instead of the one it was believed to.
 *
 * @param {Dialect} dialect - The one it was spoken to in.
 * @returns {Dialect} The other.
 */
export function otherDialect(dialect) {
  return dialect === 'v2' ? 'v1' : 'v2';
}

/**
 * Which dialect answers a clean read.
 *
 * @param {string} cleanInfo - `getCleanInfo` or `getCleanInfo_V2`.
 * @returns {Dialect} The dialect.
 */
export function dialectOfCleanInfo(cleanInfo) {
  return cleanInfo === 'getCleanInfo' ? 'v1' : 'v2';
}

/** Everything the transport uses of a DEEBOT, together. */
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
