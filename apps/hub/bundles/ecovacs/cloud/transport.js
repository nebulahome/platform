// @ts-check
/**
 * ECOVACS's cloud, as a transport: one connection per account, shared by every robot on it -
 * GOAT mowers and DEEBOT vacuums alike.
 *
 * What a connection does:
 *
 * - **uses the account** the hub hands it (`context.account`), connected by the owner from the
 *   vendor's page (`sign-in.js`): its session and credentials, renewed when they run out
 *   (`account.js`). A device's configuration names the account (`account`) and the robot (`did`);
 * - **hears the robots** over the account's MQTT session on ECOVACS's broker: every robot pushes
 *   what changes on `iot/atr/<what>/<did>/<class>/<resource>/j`;
 * - **reads them** when they are first followed, a few seconds after a push that says something
 *   moved, before a command when what is known is old, and every half hour besides - grouped
 *   reads (`getInfo`), as the app asks, one command at a time for a robot that refuses a group;
 * - **hands each robot its whole state** (mower.js, vacuum.js) whenever it changes, so the
 *   drivers' profiles are tables of paths - a vacuum's with its map drawn as an SVG (map.js),
 *   which its image entity shows;
 * - **carries the commands**: `mow` or `clean` with an act - `resume` among them, which carries
 *   on a job a fault stopped where `start` would begin it again - `set` with a setting and a
 *   value, `refresh`.
 *
 * A robot answers a command it does not know with code 20003. Cleaning and mowing are sent in the
 * dialect its model is believed to speak (models.js), and in the other one when refused; the one
 * that worked is kept for the rest of the connection. A read the robot refuses is not asked of it
 * again.
 *
 * The session's password is the portal's token, which runs out after about a week: the
 * connection renews it before then and opens the session again with the new one.
 */
import { accountFor } from './account.js';
import { EcovacsError } from './api.js';
import {
  barrierSetOf,
  createMapDrawer,
  piecesToAsk,
  tracePointsOf,
  unpackedSubset,
} from './map.js';
import { robotKindOf } from './models.js';
import * as mower from './mower.js';
import * as vacuum from './vacuum.js';

/** @typedef {import('@nebulahome/package-runtime').AccountHandle} AccountHandle */
/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebulahome/package-runtime').ManagedMqtt} ManagedMqtt */
/** @typedef {import('@nebulahome/package-runtime').Transport} Transport */
/** @typedef {import('@nebulahome/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebulahome/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebulahome/package-runtime').TransportLookContext} TransportLookContext */
/** @typedef {import('@nebulahome/package-runtime').TransportRequest} TransportRequest */
/** @typedef {import('@nebulahome/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('./account.js').Account} Account */
/** @typedef {import('./api.js').CloudDevice} CloudDevice */
/** @typedef {import('./models.js').RobotKind} RobotKind */
/** @typedef {import('./models.js').Dialect} Dialect */
/** @typedef {import('./mower.js').Command} Command */
/** @typedef {import('./mower.js').MowerState} MowerState */
/** @typedef {import('./vacuum.js').VacuumState} VacuumState */

/** How long what is known of a robot is trusted before a command reads it again. */
const FRESH_MS = 5 * 60_000;

/** How often every robot is read, besides what it pushes. */
const READ_EVERY_MS = 30 * 60_000;

/** How often a vacuum at work is asked where it is and where it went. */
const LIVE_EVERY_MS = 30_000;

/** How long after a push that says something moved the robot is read. */
const READBACK_AFTER_MS = 3000;

/** When a robot is read after a command, to see it done: at once it has not moved yet. */
const AFTER_COMMAND_MS = [4000, 15_000];

/** How often the credentials are looked at, to open the session again with fresh ones. */
const CREDENTIALS_CHECK_MS = 60 * 60_000;

/** How many points of the path one read asks for. */
const TRACE_PAGE_POINTS = 400;

/**
 * What a device's configuration holds: the account it is on, and the robot's id.
 *
 * @typedef {object} Config
 * @property {string} account - The account's id at ECOVACS.
 * @property {string | undefined} [did] - The robot's id on it.
 */

/**
 * What is known of a robot, mower or vacuum: what the connection reads of it itself is what it
 * is doing; the rest is its model's module's.
 *
 * @typedef {{ activity: string | null } & Record<string, unknown>} RobotState
 */

/**
 * What a robot model's module offers, mower or vacuum, as the connection uses it (`role` in
 * mower.js and vacuum.js).
 *
 * @typedef {object} Role
 * @property {(dialect: Dialect) => string[][]} readGroupsOf - The grouped reads.
 * @property {readonly string[]} slowReads - The reads asked one by one, less often.
 * @property {(command: string) => unknown} readDataOf - What a read carries.
 * @property {() => RobotState} emptyState - Nothing known yet.
 * @property {(state: RobotState, command: string, data: unknown) => RobotState} applyReport -
 *   Folds a report.
 * @property {(command: string) => boolean} isTelling - Whether a push means a read.
 * @property {(setting: string, value: unknown, state: RobotState) => Command} settingCommandOf -
 *   A setting's write.
 * @property {(command: Command) => { command: string; data: unknown } | null} echoOf - What a
 *   write amounts to, as a report.
 * @property {(command: Command, state: RobotState) => Command} withTask - A command, with what
 *   the robot needs to know of the job.
 * @property {(dialect: Dialect) => Dialect} otherDialect - The dialect it may speak instead.
 * @property {(cleanInfo: string) => Dialect} dialectOfCleanInfo - Which dialect answers which
 *   clean read.
 */

/**
 * Each model's module, as the connection uses it. Each module's own functions take its own
 * state, and a robot's module is picked by what the robot is, so they meet as the one shape here.
 *
 * @type {Record<'mower' | 'vacuum', Role>}
 */
const ROLES = {
  mower: /** @type {Role} */ (/** @type {unknown} */ (mower.role)),
  vacuum: /** @type {Role} */ (/** @type {unknown} */ (vacuum.role)),
};

/**
 * A vacuum's state, for what only a vacuum has: its map.
 *
 * @param {RobotState} state - What is known of it.
 * @returns {VacuumState} It.
 */
function vacuumStateOf(state) {
  return /** @type {VacuumState} */ (/** @type {unknown} */ (state));
}

/**
 * What a robot says of itself as the listener proposes it and identification finds it.
 *
 * @param {CloudDevice} device - The robot, as the account lists it.
 * @param {RobotKind} kind - What it is.
 * @returns {Record<string, unknown>} `role`, `did`, `name`, `model` (the driver's code) and
 *   `product` (ECOVACS's name for it).
 */
export function robotSighting(device, kind) {
  return {
    role: kind.role,
    did: device.did,
    name: device.name,
    model: kind.code,
    product:
      device.deviceName === '' ? (kind.role === 'mower' ? 'GOAT' : 'DEEBOT') : device.deviceName,
  };
}

/**
 * The robots on the account this bundle drives, each with what it is.
 *
 * @param {Account} account - The account.
 * @param {boolean} [force] - Whether to ask ECOVACS rather than reuse a recent list.
 * @returns {Promise<Array<{ device: CloudDevice; kind: RobotKind }>>} The robots.
 */
export async function robotsOf(account, force = false) {
  return (await account.devices(force)).flatMap((device) => {
    const kind = robotKindOf(device);

    return kind === null ? [] : [{ device, kind }];
  });
}

/**
 * The account a connection, a scan or a probe is for, or why there is none.
 *
 * @param {Config} config - The configuration.
 * @param {AccountHandle | undefined} handle - What the hub handed.
 * @returns {AccountHandle} The account.
 * @throws {Error} When the hub handed none, or one the owner must sign in to again.
 */
function handleOf(config, handle) {
  if (handle === undefined) {
    throw new Error(
      `The ECOVACS account this robot is on (${config.account}) is not connected: connect it from Integrations → Ecovacs`,
    );
  }

  if (handle.status !== 'connected') {
    throw new Error(
      `The ECOVACS account ${handle.label} needs signing in again: do it from Integrations → Ecovacs`,
    );
  }

  return handle;
}

/**
 * One robot a connection follows.
 *
 * @typedef {object} Followed
 * @property {CloudDevice} device - As the account lists it.
 * @property {RobotKind} kind - What it is.
 * @property {Role} role - Its model's module.
 * @property {Dialect} dialect - The dialect its commands are sent in.
 * @property {RobotState} state - What is known of it.
 * @property {number} readAtMs - When it was last read whole; 0 before.
 * @property {string} delivered - What was last handed on, to hand on only a change.
 * @property {Set<string>} refused - The reads it said it does not know.
 * @property {ReturnType<typeof setTimeout> | undefined} readback - A read waiting to be made.
 * @property {ReturnType<typeof setTimeout> | undefined} mapReadback - A map read waiting.
 * @property {boolean} isReadingMap - Whether its map is being read.
 * @property {number} traceCount - How many points of this job's path the robot has sent.
 * @property {((map: import('./vacuum.js').VacuumMap) => string | null) | undefined} draw - Draws
 *   its map, for a vacuum.
 * @property {string} drawnFrom - What the map drawn last was drawn from.
 * @property {string | null} svg - The map drawn last.
 */

/**
 * Builds the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @param {{ fetch?: typeof fetch }} [options] - For a test: the HTTP client.
 * @returns {Transport} `ecovacs/cloud`.
 */
export default function createEcovacsCloud(sdk, options = {}) {
  const { z } = sdk;
  const configSchema = z.object({
    account: z.string().min(1).max(128),
    did: z.string().min(1).max(128).optional(),
  });

  /**
   * One connection per account.
   *
   * @param {Config} config - The account.
   * @returns {string} The key.
   */
  function connectionKey(config) {
    return `ecovacs/cloud:${config.account}`;
  }

  /**
   * Opens the account's MQTT session and follows the robots asked for.
   *
   * @param {Config} config - The account.
   * @param {TransportContext} context - Where the robots' states and the link's state go.
   * @returns {Promise<TransportConnection>} The connection.
   * @throws {Error} When the account is not connected, or cannot be signed in.
   */
  async function connect(config, context) {
    const key = connectionKey(config);
    const account = accountFor(handleOf(config, context.account), options);
    const { logger } = context;
    let credentials = await account.credentials();
    let isClosed = false;

    /** @type {Map<string, Followed>} */
    const followed = new Map();

    /** @type {Set<ReturnType<typeof setTimeout>>} */
    const timers = new Set();

    /**
     * Runs something later, unless the connection closes first.
     *
     * @param {number} afterMs - How long from now.
     * @param {() => void} run - What.
     * @returns {ReturnType<typeof setTimeout>} The timer.
     */
    const later = (afterMs, run) => {
      const timer = setTimeout(() => {
        timers.delete(timer);

        if (!isClosed) {
          run();
        }
      }, afterMs);

      timer.unref();
      timers.add(timer);

      return timer;
    };

    /**
     * The map a vacuum's image entity shows, drawn again only when what it is drawn from changed.
     *
     * @param {Followed} robot - The robot.
     * @returns {string | null} The SVG, or null while there is nothing to draw.
     */
    const svgOf = (robot) => {
      if (robot.draw === undefined) {
        return null;
      }

      const { map } = vacuumStateOf(robot.state);
      const from = JSON.stringify([
        map.pieceCrcs,
        Object.keys(map.pieces),
        map.rooms,
        map.barriers,
        map.outline,
        map.robot,
        map.station,
        map.trace.length,
        map.trace.at(-1),
      ]);

      if (from !== robot.drawnFrom) {
        robot.drawnFrom = from;

        try {
          robot.svg = robot.draw(map);
        } catch (error) {
          logger.debug({ err: error, robot: robot.device.did }, 'Could not draw the map');
        }
      }

      return robot.svg;
    };

    /**
     * Hands a robot's state on, when it changed.
     *
     * @param {Followed} robot - The robot.
     */
    const deliver = (robot) => {
      const svg = svgOf(robot);
      const payload = {
        ...robotSighting(robot.device, robot.kind),
        // What a vacuum's map is drawn from stays here: the picture is what is handed on.
        ...(robot.draw === undefined
          ? robot.state
          : Object.fromEntries(Object.entries(robot.state).filter(([name]) => name !== 'map'))),
        ...(svg === null ? {} : { mapSvg: svg }),
      };
      const text = JSON.stringify(payload);

      if (text !== robot.delivered) {
        robot.delivered = text;
        context.deliver({ connectionKey: key, deviceKey: robot.device.did, payload });
      }
    };

    /**
     * Sends one command to a robot, with its token.
     *
     * @param {Followed} robot - The robot.
     * @param {string} command - The command.
     * @param {unknown} data - What it carries.
     * @returns {Promise<unknown>} The data of the answer.
     */
    const control = async (robot, command, data) => {
      const token = await account.controlToken(robot.device);

      return account.api.control(token, robot.device, command, data);
    };

    /**
     * Asks a robot something it may not know, and remembers when it does not.
     *
     * @param {Followed} robot - The robot.
     * @param {string} command - The read.
     * @param {unknown} data - What it carries.
     * @returns {Promise<unknown>} The answer, or undefined when refused or failed.
     */
    const ask = async (robot, command, data) => {
      if (robot.refused.has(command)) {
        return undefined;
      }

      try {
        return await control(robot, command, data);
      } catch (error) {
        if (error instanceof EcovacsError && error.kind === 'unsupported') {
          robot.refused.add(command);
        } else {
          logger.debug({ err: error, robot: robot.device.did, command }, 'A read failed');
        }

        return undefined;
      }
    };

    /**
     * Folds a report into a robot's state: a vacuum's packed map data unpacked first.
     *
     * @param {Followed} robot - The robot.
     * @param {string} command - What the report answers or pushes.
     * @param {unknown} data - What it says.
     */
    const fold = (robot, command, data) => {
      if (data === undefined) {
        return;
      }

      const unpacked = /MapSubSet$/u.test(command) ? unpackedSubset(data, sdk.codecs.lzma) : data;

      robot.state = robot.role.applyReport(robot.state, command, unpacked);
    };

    /**
     * Adds the path points a trace answer or push carries.
     *
     * @param {Followed} robot - The vacuum.
     * @param {unknown} data - `{ traceStart, traceValue, totalCount }`.
     * @returns {{ added: number; total: number | null; isInOrder: boolean }} How many points came,
     *   how many the robot has, and whether they followed the ones held.
     */
    const foldTrace = (robot, data) => {
      const record =
        typeof data === 'object' && data !== null && !Array.isArray(data)
          ? /** @type {Record<string, unknown>} */ (data)
          : {};
      const start = Number(record['traceStart'] ?? 0);
      const total = Number(record['totalCount']);
      const value = record['traceValue'];

      if (typeof value !== 'string' || value === '' || !Number.isInteger(start)) {
        return { added: 0, total: Number.isFinite(total) ? total : null, isInOrder: true };
      }

      if (start !== 0 && start !== robot.traceCount) {
        return { added: 0, total: Number.isFinite(total) ? total : null, isInOrder: false };
      }

      let points;

      try {
        points = tracePointsOf(value, sdk.codecs.lzma);
      } catch (error) {
        logger.debug({ err: error, robot: robot.device.did }, 'Could not unpack the path');

        return { added: 0, total: null, isInOrder: true };
      }

      robot.state = /** @type {RobotState} */ (
        vacuum.withTrace(vacuumStateOf(robot.state), points, start === 0)
      );
      robot.traceCount = start + points.length;

      return {
        added: points.length,
        total: Number.isFinite(total) ? total : null,
        isInOrder: true,
      };
    };

    /**
     * Reads a vacuum's path from where it was left, or from the start.
     *
     * @param {Followed} robot - The vacuum.
     * @param {boolean} fromStart - Whether to read it all again.
     * @returns {Promise<void>} Once read.
     */
    const readTrace = async (robot, fromStart) => {
      if (fromStart) {
        robot.traceCount = 0;
      }

      for (let page = 0; page < 60; page += 1) {
        // One page after another: each starts where the last ended.
        // eslint-disable-next-line no-await-in-loop -- see above
        const data = await ask(robot, 'getMapTrace', {
          pointCount: TRACE_PAGE_POINTS,
          tid: '',
          traceStart: robot.traceCount,
        });
        const { added, total } = foldTrace(robot, data);

        if (added === 0 || total === null || robot.traceCount >= total) {
          return;
        }
      }
    };

    /**
     * Reads where a vacuum is, and the path it took since the last read.
     *
     * @param {Followed} robot - The vacuum.
     * @returns {Promise<void>} Once read.
     */
    const readLive = async (robot) => {
      fold(robot, 'getPos', await ask(robot, 'getPos', { pos: ['chargePos', 'deebotPos'] }));
      await readTrace(robot, false);
      deliver(robot);
    };

    /**
     * Reads a vacuum's virtual walls, or its no-mop zones: the list, then the corners of each the
     * list does not carry. A robot that refuses the list is asked its newer form, packed.
     *
     * @param {Followed} robot - The vacuum.
     * @param {string} mapId - The map in use.
     * @param {'vw' | 'mw'} type - Which.
     * @returns {Promise<void>} Once read, as far as it answered.
     */
    const readBarriers = async (robot, mapId, type) => {
      const listed = await ask(robot, 'getMapSet', { mid: mapId, type });

      if (listed === undefined) {
        const packed = await ask(robot, 'getMapSet_V2', { mid: mapId, type });

        fold(robot, 'getMapSet', barrierSetOf(packed, type, sdk.codecs.lzma));

        return;
      }

      fold(robot, 'getMapSet', listed);

      const kind = type === 'vw' ? 'virtual' : 'no_mop';

      for (const barrier of vacuumStateOf(robot.state).map.barriers) {
        if (barrier.kind === kind && barrier.points.length < 2) {
          // eslint-disable-next-line no-await-in-loop -- one after another, as the app asks
          const data = await ask(robot, 'getMapSubSet', { mid: mapId, mssid: barrier.id, type });

          fold(robot, 'getMapSubSet', data);
        }
      }
    };

    /**
     * Reads a vacuum's map: which one it uses, its rooms and their outlines, its virtual walls
     * and no-mop zones, the pieces of the floor plan that changed - or the outline of its walls,
     * from a robot that sends no pieces - where it is, and its path.
     *
     * @param {Followed} robot - The vacuum.
     * @returns {Promise<void>} Once read, as far as it answered.
     */
    const readMap = async (robot) => {
      if (robot.draw === undefined || robot.isReadingMap || isClosed) {
        return;
      }

      robot.isReadingMap = true;

      try {
        fold(robot, 'getCachedMapInfo', await ask(robot, 'getCachedMapInfo', {}));

        const mapId = vacuumStateOf(robot.state).map.mapId;

        if (mapId !== null) {
          fold(robot, 'getMapSet', await ask(robot, 'getMapSet', { mid: mapId, type: 'ar' }));

          for (const room of vacuumStateOf(robot.state).map.rooms.slice(0, 32)) {
            if (room.outline.length === 0) {
              // One room after another, as the app asks.
              // eslint-disable-next-line no-await-in-loop -- see above
              const data = await ask(robot, 'getMapSubSet', {
                mid: mapId,
                mssid: room.id,
                type: 'ar',
              });

              fold(robot, 'getMapSubSet', data);
            }
          }

          await readBarriers(robot, mapId, 'vw');
          await readBarriers(robot, mapId, 'mw');
        }

        fold(
          robot,
          'getMajorMap',
          await ask(robot, 'getMajorMap', mapId === null ? {} : { mid: mapId }),
        );

        // A robot without pieces sends the outline of its walls whole instead.
        if (
          vacuumStateOf(robot.state).map.pieceCrcs.length === 0 &&
          (mapId ?? vacuumStateOf(robot.state).map.mapId) !== null
        ) {
          fold(
            robot,
            'getMapInfo_V2',
            await ask(robot, 'getMapInfo_V2', {
              mid: mapId ?? vacuumStateOf(robot.state).map.mapId,
              type: '0',
            }),
          );
        }

        for (const index of piecesToAsk(vacuumStateOf(robot.state).map)) {
          // eslint-disable-next-line no-await-in-loop -- one piece after another, see above
          const data = await ask(robot, 'getMinorMap', {
            mid: vacuumStateOf(robot.state).map.mapId ?? mapId ?? '',
            type: 'ol',
            pieceIndex: index,
          });

          fold(robot, 'getMinorMap', data);
        }

        await readLive(robot);
      } finally {
        robot.isReadingMap = false;
      }
    };

    /**
     * Reads a vacuum's map a moment from now, once however many pushes come in that moment.
     *
     * @param {Followed} robot - The vacuum.
     */
    const readMapSoon = (robot) => {
      if (robot.mapReadback !== undefined) {
        clearTimeout(robot.mapReadback);
        timers.delete(robot.mapReadback);
      }

      robot.mapReadback = later(READBACK_AFTER_MS, () => {
        robot.mapReadback = undefined;
        void readMap(robot).catch((error) => {
          logger.debug({ err: error, robot: robot.device.did }, 'Reading the map failed');
        });
      });
    };

    /**
     * Reads a robot whole: the grouped reads, then the slow ones, handing on what changed.
     *
     * @param {Followed} robot - The robot.
     * @returns {Promise<void>} Once read, as far as it answered.
     */
    const readAll = async (robot) => {
      for (const group of robot.role.readGroupsOf(robot.dialect)) {
        const asked = group.filter((command) => !robot.refused.has(command));

        if (asked.length === 0) {
          continue;
        }

        try {
          // One group after another, as the app reads: a burst of them is refused.
          // eslint-disable-next-line no-await-in-loop -- see above
          fold(robot, 'getInfo', await control(robot, 'getInfo', asked));
        } catch (error) {
          if (isClosed) {
            return;
          }

          if (!(error instanceof EcovacsError) || error.kind === 'unavailable') {
            logger.debug({ err: error, robot: robot.device.did }, 'A grouped read failed');
          }

          // eslint-disable-next-line no-await-in-loop -- one at a time, see above
          await readEach(robot, asked);
        }
      }

      for (const command of robot.role.slowReads) {
        // eslint-disable-next-line no-await-in-loop -- one at a time, see above
        fold(robot, command, await ask(robot, command, robot.role.readDataOf(command)));
      }

      robot.readAtMs = Date.now();
      deliver(robot);
    };

    /**
     * Reads a group one command at a time, for a robot that refused it whole; a command it does
     * not know is not asked again, and one whose other dialect it knows switches it to that.
     *
     * @param {Followed} robot - The robot.
     * @param {readonly string[]} commands - The group.
     * @returns {Promise<void>} Once read.
     */
    const readEach = async (robot, commands) => {
      for (const command of commands) {
        try {
          // eslint-disable-next-line no-await-in-loop -- one at a time, see above
          fold(robot, 'getInfo', await control(robot, 'getInfo', [command]));
        } catch (error) {
          if (!(error instanceof EcovacsError) || error.kind !== 'unsupported') {
            continue;
          }

          robot.refused.add(command);

          const other =
            command === 'getCleanInfo_V2'
              ? 'getCleanInfo'
              : command === 'getCleanInfo'
                ? 'getCleanInfo_V2'
                : undefined;

          if (other !== undefined && !robot.refused.has(other)) {
            robot.dialect = robot.role.dialectOfCleanInfo(other);
            logger.info(
              { robot: robot.device.did, dialect: robot.dialect },
              'The robot speaks the other dialect',
            );
          }
        }
      }
    };

    /**
     * Reads a robot a moment from now, once however many pushes come in that moment.
     *
     * @param {Followed} robot - The robot.
     * @param {number} [afterMs] - How long from now.
     */
    const readSoon = (robot, afterMs = READBACK_AFTER_MS) => {
      if (robot.readback !== undefined) {
        clearTimeout(robot.readback);
        timers.delete(robot.readback);
      }

      robot.readback = later(afterMs, () => {
        robot.readback = undefined;
        void readAll(robot).catch((error) => {
          logger.debug({ err: error, robot: robot.device.did }, 'Reading the robot failed');
        });
      });
    };

    /**
     * The topic a robot pushes on.
     *
     * @param {CloudDevice} device - The robot.
     * @returns {string} The filter.
     */
    const topicOf = (device) =>
      `iot/atr/+/${device.did}/${device.deviceClass}/${device.resource}/j`;

    /**
     * Folds a push into the robot it is from.
     *
     * @param {Followed} robot - The robot.
     * @param {string} command - What was pushed: `onBattery`, `onPos`.
     * @param {unknown} data - What it says.
     */
    const heard = (robot, command, data) => {
      if (command === 'onMapTrace') {
        if (robot.draw !== undefined && !foldTrace(robot, data).isInOrder) {
          void readTrace(robot, false).catch(() => undefined);
        }

        deliver(robot);

        return;
      }

      const before = robot.state.activity;

      fold(robot, command, data);
      deliver(robot);

      if (robot.role.isTelling(command)) {
        readSoon(robot);
      }

      if (robot.draw === undefined) {
        return;
      }

      // The map changed in the app, or a piece of the floor plan did.
      if (/^on(MajorMap|MapSet|CachedMapInfo|MapSubSet)/u.test(command)) {
        readMapSoon(robot);
      }

      // A new job: its path starts again.
      if (robot.state.activity === 'cleaning' && before !== 'cleaning' && before !== 'paused') {
        robot.traceCount = 0;
      }
    };

    /**
     * Opens the account's session on ECOVACS's broker with the credentials held.
     *
     * @returns {ManagedMqtt} The session.
     */
    const openSession = () =>
      sdk.openMqtt({
        url: account.api.brokerUrl,
        clientId: `${credentials.userId}@ecouser/${account.api.clientId}`,
        username: credentials.userId,
        password: credentials.token,
        // ECOVACS's broker presents a certificate of its own, as it does to the app.
        tls: { rejectUnauthorized: false },
        logger,
        /** Says the link is up. */
        onConnect: () => {
          context.report('up');
        },

        /**
         * Folds a push into the robot it is from.
         *
         * @param {string} topic - `iot/atr/<what>/<did>/<class>/<resource>/j`.
         * @param {Buffer} payload - The app's envelope.
         */
        onMessage: (topic, payload) => {
          const [, , command = '', did = ''] = topic.split('/');
          const robot = followed.get(did);

          if (robot === undefined) {
            return;
          }

          let message;

          try {
            message = JSON.parse(payload.toString('utf8'));
          } catch {
            return;
          }

          const body = message?.body ?? message;

          heard(
            robot,
            command,
            body !== null && typeof body === 'object' && 'data' in body ? body.data : body,
          );
        },

        /**
         * Says the link is down; the session comes back by itself, with new credentials first
         * when it was the token that was refused.
         *
         * @param {string} reason - Why.
         */
        onClose: (reason) => {
          context.report('down');

          if (/not authori[sz]ed|bad user ?name or password/iu.test(reason)) {
            void renew(true);
          }
        },
      });

    let session = openSession();

    /**
     * Renews the credentials when they changed or were refused, and opens the session again
     * with the new ones.
     *
     * @param {boolean} [force] - Whether to renew them whatever they say.
     * @returns {Promise<void>} Once done, or found unnecessary.
     */
    const renew = async (force = false) => {
      let fresh;

      try {
        fresh = await account.credentials(force);
      } catch (error) {
        logger.warn({ err: error }, 'Could not renew the ECOVACS account’s credentials');

        return;
      }

      if (isClosed || fresh.token === credentials.token) {
        return;
      }

      credentials = fresh;

      const stale = session;

      session = openSession();

      for (const robot of followed.values()) {
        session.subscribe(topicOf(robot.device));
      }

      await stale.close();
    };

    const renewal = setInterval(() => {
      void renew();
    }, CREDENTIALS_CHECK_MS);
    const sweep = setInterval(() => {
      for (const robot of followed.values()) {
        void readAll(robot)
          .then(() => readMap(robot))
          .catch(() => undefined);
      }
    }, READ_EVERY_MS);
    const live = setInterval(() => {
      for (const robot of followed.values()) {
        const { activity } = robot.state;

        if (
          robot.draw !== undefined &&
          !robot.isReadingMap &&
          (activity === 'cleaning' || activity === 'returning')
        ) {
          void readLive(robot).catch(() => undefined);
        }
      }
    }, LIVE_EVERY_MS);

    renewal.unref();
    sweep.unref();
    live.unref();

    /**
     * The robot a request is for, read afresh when what is known is old.
     *
     * @param {string} did - The robot.
     * @returns {Promise<Followed>} It.
     * @throws {Error} When it is not followed.
     */
    const current = async (did) => {
      const robot = followed.get(did);

      if (robot === undefined) {
        throw new Error(`The account has no robot ${did} followed`);
      }

      if (Date.now() - robot.readAtMs > FRESH_MS) {
        await readAll(robot);
      }

      return robot;
    };

    /**
     * Sends a command, and the other dialect's when the robot does not know the first.
     *
     * @param {Followed} robot - The robot.
     * @param {Command} command - The command.
     * @returns {Promise<void>} Once taken.
     */
    const perform = async (robot, command) => {
      const sent = robot.role.withTask(command, robot.state);

      try {
        await control(robot, sent.command, sent.data);
      } catch (error) {
        if (
          !(error instanceof EcovacsError) ||
          error.kind !== 'unsupported' ||
          command.fallback === undefined
        ) {
          throw error;
        }

        const other = robot.role.withTask(
          { command: command.fallback, data: command.fallbackData ?? {} },
          robot.state,
        );

        await control(robot, other.command, other.data);
        robot.dialect = robot.role.otherDialect(robot.dialect);
        logger.info(
          { robot: robot.device.did, dialect: robot.dialect },
          'The robot speaks the other dialect',
        );
      }
    };

    /**
     * What a robot does once told to act, shown at once; what it really does, the reads after say.
     *
     * @param {Followed} robot - The robot.
     * @param {string} act - What it was told.
     * @returns {string | null} Its activity now.
     */
    const activityAfter = (robot, act) => {
      const { activity } = robot.state;

      switch (act) {
        case 'start':
        case 'resume':
        case 'rooms': {
          return robot.kind.role === 'mower' ? 'mowing' : 'cleaning';
        }

        case 'pause': {
          return 'paused';
        }

        case 'stop': {
          return 'idle';
        }

        case 'dock': {
          return activity === 'returning' && robot.kind.role === 'mower' ? 'paused' : 'returning';
        }

        default: {
          return activity;
        }
      }
    };

    /**
     * Whether a job is open once a robot was told to act, shown at once as its activity is: a
     * start or a resume opens one, an end closes it, the rest leave it as it was.
     *
     * @param {Followed} robot - The robot.
     * @param {string} act - What it was told.
     * @returns {boolean} Whether a job is there to carry on.
     */
    const isResumableAfter = (robot, act) =>
      act === 'stop'
        ? false
        : act === 'start' || act === 'resume' || act === 'rooms'
          ? true
          : robot.state['isResumable'] === true;

    return {
      key,

      /**
       * Carries one command.
       *
       * @param {TransportRequest} request - `mow` or `clean` with `act`, `set` with `setting` and
       *   `value`, or `refresh`.
       * @returns {Promise<null>} Nothing: the robot says what came of it.
       */
      send: async (request) => {
        const robot = await current(request.deviceKey);

        switch (request.op) {
          case 'mow': {
            const act = request.args['act'];

            if (
              robot.kind.role !== 'mower' ||
              (act !== 'start' &&
                act !== 'pause' &&
                act !== 'stop' &&
                act !== 'dock' &&
                act !== 'resume')
            ) {
              throw new Error(`A ${robot.kind.role} is not told to mow ${String(act)}`);
            }

            await perform(
              robot,
              mower.mowCommandOf(
                act,
                /** @type {MowerState} */ (/** @type {unknown} */ (robot.state)),
                robot.dialect === 'rtk' ? 'rtk' : 'g1',
              ),
            );
            robot.state = {
              ...robot.state,
              activity: activityAfter(robot, act),
              isResumable: isResumableAfter(robot, act),
            };
            deliver(robot);
            break;
          }

          case 'clean': {
            const act = request.args['act'];
            const rooms = request.args['rooms'];

            if (
              robot.kind.role !== 'vacuum' ||
              (act !== 'start' &&
                act !== 'pause' &&
                act !== 'stop' &&
                act !== 'dock' &&
                act !== 'locate' &&
                act !== 'rooms' &&
                act !== 'resume')
            ) {
              throw new Error(`A ${robot.kind.role} is not told to clean ${String(act)}`);
            }

            const ids =
              act === 'rooms' && Array.isArray(rooms)
                ? rooms.filter((each) => typeof each === 'string')
                : [];

            if (act === 'rooms' && ids.length === 0) {
              throw new Error('Cleaning rooms takes at least one room');
            }

            const before = robot.state.activity;

            await perform(
              robot,
              vacuum.cleanCommandOf(
                act,
                vacuumStateOf(robot.state),
                robot.dialect === 'v1' ? 'v1' : 'v2',
                ids,
              ),
            );
            robot.state = {
              ...robot.state,
              activity: activityAfter(robot, act),
              isResumable: isResumableAfter(robot, act),
            };

            // A new job's path starts again; a job carried on keeps the path it had.
            if ((act === 'start' && before !== 'paused') || act === 'rooms') {
              robot.traceCount = 0;
            }

            deliver(robot);
            break;
          }

          case 'set': {
            const setting = request.args['setting'];

            if (typeof setting !== 'string') {
              throw new Error('A setting is set by its name');
            }

            const command = robot.role.settingCommandOf(
              setting,
              request.args['value'],
              robot.state,
            );

            await perform(robot, command);

            const echo = robot.role.echoOf(command);

            if (echo !== null) {
              fold(robot, echo.command, echo.data);
            }

            deliver(robot);
            break;
          }

          case 'refresh': {
            await readAll(robot);
            await readMap(robot);

            return null;
          }

          default: {
            throw new Error(`ecovacs/cloud does not do ${request.op}`);
          }
        }

        for (const afterMs of AFTER_COMMAND_MS) {
          later(afterMs, () => {
            void readAll(robot).catch(() => undefined);
          });
        }

        return null;
      },

      /**
       * Follows the robots the instances ask for, and lets go of the rest.
       *
       * @param {readonly TransportSubscription[]} subscriptions - `follow`, each with its
       *   `deviceKey`.
       * @returns {Promise<void>} Once every new robot has been read.
       */
      apply: async (subscriptions) => {
        const wanted = new Set(
          subscriptions
            .filter((each) => each.op === 'follow')
            .map((each) => each.args['deviceKey'])
            .filter((each) => typeof each === 'string'),
        );

        for (const [did, robot] of followed) {
          if (!wanted.has(did)) {
            session.unsubscribe(topicOf(robot.device));
            followed.delete(did);
          }
        }

        const missing = [...wanted].filter((did) => !followed.has(did));

        if (missing.length === 0) {
          return;
        }

        const robots = await robotsOf(account, true);

        for (const did of missing) {
          const found = robots.find((each) => each.device.did === did);

          if (found === undefined) {
            logger.warn({ robot: did }, 'The ECOVACS account does not list that robot any more');
            continue;
          }

          const role = ROLES[found.kind.role];

          /** @type {Followed} */
          const robot = {
            device: found.device,
            kind: found.kind,
            role,
            dialect: found.kind.dialect,
            state: role.emptyState(),
            readAtMs: 0,
            delivered: '',
            refused: new Set(),
            readback: undefined,
            mapReadback: undefined,
            isReadingMap: false,
            traceCount: 0,
            draw: found.kind.role === 'vacuum' ? createMapDrawer(sdk) : undefined,
            drawnFrom: '',
            svg: null,
          };

          followed.set(did, robot);
          session.subscribe(topicOf(found.device));
          // eslint-disable-next-line no-await-in-loop -- one robot after another, see readAll
          await readAll(robot).catch((error) => {
            logger.warn({ err: error, robot: did }, 'Could not read the robot');
          });

          // The map is read after, in its own time: it is many requests, and not the state.
          if (robot.draw !== undefined) {
            void readMap(robot).catch((error) => {
              logger.debug({ err: error, robot: did }, 'Could not read the map');
            });
          }
        }
      },

      /**
       * Lets go of the session and every timer.
       *
       * @returns {Promise<void>} Once closed.
       */
      close: async () => {
        isClosed = true;
        clearInterval(renewal);
        clearInterval(sweep);
        clearInterval(live);

        for (const timer of timers) {
          clearTimeout(timer);
        }

        timers.clear();
        await session.close();
      },
    };
  }

  /**
   * Finds the robots on the account; `role` in the terms says which kind, `did` in the
   * configuration which one.
   *
   * @param {Config} config - The account, and a robot's id when looking for that one.
   * @param {import('@nebulahome/contracts').JsonObject} terms - `{ role }`.
   * @param {AbortSignal} signal - Ends the scan.
   * @param {TransportLookContext} [context] - The account, as the hub hands it.
   * @yields {Discovered} Each robot.
   */
  async function* scan(config, terms, signal, context) {
    const account = accountFor(handleOf(config, context?.account), options);

    for (const { device, kind } of await robotsOf(account)) {
      if (signal.aborted) {
        return;
      }

      if (
        (terms['role'] === undefined || terms['role'] === kind.role) &&
        (config.did === undefined || config.did === device.did)
      ) {
        yield { deviceKey: device.did, payload: robotSighting(device, kind) };
      }
    }
  }

  /**
   * Lists the robots on the account, keeping nothing open.
   *
   * @param {Config} config - The account.
   * @param {AbortSignal} _signal - Unused: each request has its own timeout.
   * @param {TransportLookContext} [context] - The account, as the hub hands it.
   * @returns {Promise<string>} What was found.
   * @throws {Error} When the account is not connected, or cannot be signed in.
   */
  async function probe(config, _signal, context) {
    const robots = await robotsOf(accountFor(handleOf(config, context?.account), options), true);

    if (robots.length === 0) {
      return 'Signed in to ECOVACS; the account has no GOAT or DEEBOT';
    }

    const names = robots
      .map((each) => `${each.device.name} (${each.device.deviceName})`)
      .join(', ');

    return robots.length === 1
      ? `Signed in to ECOVACS; the account has one robot: ${names}`
      : `Signed in to ECOVACS; the account has ${String(robots.length)} robots: ${names}`;
  }

  return sdk.defineTransport({
    id: 'ecovacs/cloud',
    configSchema,
    connectionKey,
    connect,
    scan,
    probe,
  });
}
