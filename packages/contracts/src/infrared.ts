/**
 * The house's Infrared broker, as the hub runs it and the Brokers page shows it.
 *
 * Infrared is one of the platform's brokers: the remotes the house has learned. An IR blaster - a
 * device of an integration whose profile declares {@link infraredProfileSchema} - only sends and
 * listens; what it sends belongs to a **remote**, a device of the platform's own `infrared` vendor
 * (driver `infrared/remote`, transport `infrared`, device key `infrared-<remoteId>`). Each learned
 * button is a `button` entity of that remote, and pressing it sends the button's code through the
 * remote's blaster.
 *
 * A code is kept in {@link infraredCodeSchema}'s shape - timings, plus the protocol when one is
 * recognised - and never in a blaster's own format, so a remote moves to another blaster, of
 * another brand even, without learning again. A blaster's integration converts to and from its
 * own format with the SDK's codec; the hub sends it the reserved {@link INFRARED_OPS} over its
 * instance's connection.
 */
import { z } from 'zod';

import { BROKER_STATES } from './brokers.js';
import { iconIdSchema } from './icons.js';
import { integrationIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { timestampSchema } from './timestamp.js';

/** The platform transport every remote is reached through. */
export const INFRARED_TRANSPORT = 'infrared';

/** The platform's own vendor: the remotes the house learned. */
export const INFRARED_VENDOR = 'infrared';

/** The driver of the platform's own vendor: a remote, a button entity per learned button. */
export const INFRARED_REMOTE_KIND = `${INFRARED_VENDOR}/remote`;

/**
 * The device key of a remote.
 *
 * @param remoteId - The remote's id.
 * @returns `infrared-<remoteId>`.
 */
export function infraredDeviceKeyOf(remoteId: string): string {
  return `${INFRARED_VENDOR}-${remoteId}`;
}

/** Where the broker stands. */
export const HUB_INFRARED_STATUS_METHOD = 'infrared_status';

/** The IR-capable devices the integrations provide. */
export const HUB_INFRARED_BLASTERS_METHOD = 'infrared_blasters';

/** Every remote, without its buttons. */
export const HUB_INFRARED_REMOTES_METHOD = 'infrared_remotes';

/** One remote, with its buttons. */
export const HUB_INFRARED_REMOTE_METHOD = 'infrared_remote';

/** Saves a remote, new or changed: its name, kind and blaster. */
export const HUB_INFRARED_REMOTE_SAVE_METHOD = 'infrared_remote_save';

/** Removes a remote and its buttons. */
export const HUB_INFRARED_REMOTE_REMOVE_METHOD = 'infrared_remote_remove';

/** Saves a button, new or changed: its name, icon, cell and code. */
export const HUB_INFRARED_BUTTON_SAVE_METHOD = 'infrared_button_save';

/** Moves a button to an empty cell of its remote's keypad. */
export const HUB_INFRARED_BUTTON_MOVE_METHOD = 'infrared_button_move';

/** Removes a button. */
export const HUB_INFRARED_BUTTON_REMOVE_METHOD = 'infrared_button_remove';

/** Sends a saved button's code through its remote's blaster, as a click on its tile does. */
export const HUB_INFRARED_BUTTON_PRESS_METHOD = 'infrared_button_press';

/** Sends a code not saved yet through a blaster, as Learn's and Import's Test do. */
export const HUB_INFRARED_TEST_METHOD = 'infrared_test';

/** Starts learning a code on a blaster. */
export const HUB_INFRARED_LEARN_METHOD = 'infrared_learn';

/** Reads a learn job until it ends. */
export const HUB_INFRARED_LEARN_JOB_METHOD = 'infrared_learn_job';

/** Stops a learn job before it captured anything. */
export const HUB_INFRARED_LEARN_CANCEL_METHOD = 'infrared_learn_cancel';

/** Reads pasted or dropped codes - Broadlink, Pronto, raw timings, a Flipper Zero file. */
export const HUB_INFRARED_IMPORT_PARSE_METHOD = 'infrared_import_parse';

/** Adds the codes the owner kept from an import as buttons of a remote. */
export const HUB_INFRARED_IMPORT_METHOD = 'infrared_import';

/** A code in each format Show code copies it as. */
export const HUB_INFRARED_CODE_FORMATS_METHOD = 'infrared_code_formats';

/** What a code is sent as: infrared, or radio on 433 MHz. */
export const INFRARED_SIGNALS = ['ir', 'rf'] as const;

/** What a code is sent as. */
export type InfraredSignal = (typeof INFRARED_SIGNALS)[number];

/** The protocols the codec recognises a code as; one it does not is raw timings. */
export const INFRARED_PROTOCOLS = [
  'nec',
  'nec-ext',
  'samsung32',
  'sirc',
  'sirc15',
  'sirc20',
  'rc5',
] as const;

/** A protocol the codec recognises. */
export type InfraredProtocolName = (typeof INFRARED_PROTOCOLS)[number];

/** What a remote is, for its icon: a TV, an air conditioner, a fan, audio, a light, or other. */
export const INFRARED_REMOTE_KINDS = [
  'tv',
  'air-conditioner',
  'fan',
  'audio',
  'light',
  'other',
] as const;

/** What a remote is. */
export type InfraredRemoteKind = (typeof INFRARED_REMOTE_KINDS)[number];

/** The formats Show code copies a code as. */
export const INFRARED_CODE_FORMATS = ['broadlink', 'pronto', 'raw'] as const;

/** A format Show code copies a code as. */
export type InfraredCodeFormat = (typeof INFRARED_CODE_FORMATS)[number];

/** The formats Import reads: those, and the Flipper Zero `.ir` file. */
export const INFRARED_IMPORT_FORMATS = [...INFRARED_CODE_FORMATS, 'flipper'] as const;

/** How a learn job goes: sweeping is the RF frequency search; captured and after are its end. */
export const INFRARED_LEARN_PHASES = [
  'ready',
  'sweeping',
  'listening',
  'captured',
  'failed',
  'cancelled',
] as const;

/** How a learn job goes. */
export type InfraredLearnPhase = (typeof INFRARED_LEARN_PHASES)[number];

/** The most pulses one code carries. */
export const INFRARED_MAXIMUM_PULSES = 2048;

/** A code recognised as a protocol: its address and command. */
export const infraredProtocolSchema = z.object({
  name: z.enum(INFRARED_PROTOCOLS),
  address: z.int().min(0).max(0xff_ff_ff_ff),
  command: z.int().min(0).max(0xff_ff_ff_ff),
});

/** A code recognised as a protocol. */
export type InfraredProtocol = z.output<typeof infraredProtocolSchema>;

/**
 * A code, whichever blaster learned it: the pulses in microseconds, a mark then a space in turn,
 * starting with a mark; the carrier an IR code is modulated on (0 for RF, which is on-off keyed);
 * an RF code's frequency; and the protocol, when the codec recognises one.
 */
export const infraredCodeSchema = z
  .object({
    signal: z.enum(INFRARED_SIGNALS),
    carrierHz: z.int().min(0).max(1_000_000),
    frequencyHz: z.int().min(1_000_000).max(10_000_000_000).optional(),
    pulses: z.array(z.int().min(1).max(10_000_000)).min(1).max(INFRARED_MAXIMUM_PULSES),
    protocol: infraredProtocolSchema.optional(),
  })
  .refine((code) => code.signal === 'rf' || code.frequencyHz === undefined, {
    message: 'Only a radio code has a frequency',
    path: ['frequencyHz'],
  })
  .refine((code) => code.signal === 'rf' || code.carrierHz > 0, {
    message: 'An infrared code has a carrier',
    path: ['carrierHz'],
  });

/** A code. */
export type InfraredCode = z.output<typeof infraredCodeSchema>;

/** What a blaster declares in its profile: the signals it sends, and whether it can learn. */
export const infraredProfileSchema = z.strictObject({
  signals: z.union([z.tuple([z.literal('ir')]), z.tuple([z.literal('ir'), z.literal('rf')])]),
  receives: z.boolean(),
});

/** What a blaster declares. */
export type InfraredProfile = z.output<typeof infraredProfileSchema>;

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

/** Arguments of `infrared.send`. */
export const infraredSendArgsSchema = z.object({ code: infraredCodeSchema });

/** How long a blaster listens or sweeps at most. */
const timeoutSchema = z.int().min(1000).max(120_000);

/** Arguments of `infrared.learn`; it resolves with an {@link infraredCodeSchema}. */
export const infraredLearnArgsSchema = z.object({
  signal: z.enum(INFRARED_SIGNALS),
  timeoutMs: timeoutSchema,
});

/** Arguments of `infrared.sweep`. */
export const infraredSweepArgsSchema = z.object({ timeoutMs: timeoutSchema });

/** What `infrared.sweep` resolves with. */
export const infraredSweepResultSchema = z.object({
  frequencyHz: z.int().min(1_000_000).max(10_000_000_000),
});

/** Arguments of `infrared.cancel`. */
export const infraredCancelArgsSchema = z.object({});

/** A blaster: an IR-capable device an integration provides. */
export const infraredBlasterSchema = z.object({
  deviceId: integrationIdSchema,
  name: z.string().max(256),
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  vendorName: z.string().max(128),
  areaId: z.uuid().nullable(),
  isOnline: z.boolean(),
  signals: z.array(z.enum(INFRARED_SIGNALS)).min(1).max(INFRARED_SIGNALS.length),
  receives: z.boolean(),
  lastSentAt: timestampSchema.nullable(),

  /** How many remotes send through it. */
  remotes: z.int().min(0),
});

/** A blaster. */
export type InfraredBlaster = z.output<typeof infraredBlasterSchema>;

/** Every blaster, by name. */
export const infraredBlastersReplySchema = z.object({ items: z.array(infraredBlasterSchema) });

/** A learn job under way on a blaster, as the Learning card says it. */
export const infraredListeningSchema = z.object({
  jobId: z.string().min(1).max(64),
  blasterId: integrationIdSchema,
  blasterName: z.string().max(256),
});

/** Where the broker stands, as the Brokers page and the health cards show it. */
export const infraredStatusSchema = z.object({
  state: z.enum(BROKER_STATES),
  error: z.string().max(2048).nullable(),
  blasters: z.object({ total: z.int().min(0), online: z.int().min(0) }),
  remotes: z.int().min(0),

  /** The last button sent; null before any. */
  lastSent: z
    .object({
      remoteId: z.uuid(),
      remoteName: z.string().max(128),
      buttonId: z.uuid(),
      buttonName: z.string().max(64),
      blasterName: z.string().max(256).nullable(),
      at: timestampSchema,
    })
    .nullable(),

  /** The learn jobs listening or sweeping now. */
  learning: z.array(infraredListeningSchema).max(64),

  /** The remotes, and how many have a blaster online: the Brokers card's count. */
  devices: z.object({ total: z.int().min(0), online: z.int().min(0) }),
});

/** Where the broker stands. */
export type InfraredStatus = z.output<typeof infraredStatusSchema>;

/** A remote's name, as the owner writes it. */
const remoteNameSchema = z.string().trim().min(1, 'Needed: a name').max(128);

/** A button's name, as the owner writes it. */
const buttonNameSchema = z.string().trim().min(1, 'Needed: a name').max(64);

/** The most columns a keypad has. */
export const INFRARED_MAXIMUM_COLUMNS = 6;

/** The most buttons a remote has. */
export const INFRARED_MAXIMUM_BUTTONS = 256;

/** A cell of a keypad, counted along the rows from 0. */
const cellSchema = z.int().min(0).max(1023);

/** A remote, without its buttons. */
export const infraredRemoteSchema = z.object({
  id: z.uuid(),
  name: z.string().max(128),
  kind: z.enum(INFRARED_REMOTE_KINDS),

  /** The blaster its codes go through; null after it was removed, until the owner picks one. */
  blasterId: integrationIdSchema.nullable(),
  blasterName: z.string().max(256).nullable(),
  isBlasterOnline: z.boolean(),

  /** Whether the blaster sends RF, so the RF screens show. */
  canRf: z.boolean(),
  columns: z.int().min(1).max(INFRARED_MAXIMUM_COLUMNS),

  /** The device it is in the house; null until it was added. */
  deviceId: integrationIdSchema.nullable(),
  areaId: z.uuid().nullable(),
  buttonCount: z.int().min(0),
  lastPressedAt: timestampSchema.nullable(),
});

/** A remote. */
export type InfraredRemote = z.output<typeof infraredRemoteSchema>;

/** Every remote, by name. */
export const infraredRemotesReplySchema = z.object({ items: z.array(infraredRemoteSchema) });

/** A button of a remote. */
export const infraredButtonSchema = z.object({
  id: z.uuid(),
  remoteId: z.uuid(),
  name: z.string().max(64),
  icon: iconIdSchema.nullable(),
  cell: cellSchema,
  code: infraredCodeSchema,
  lastPressedAt: timestampSchema.nullable(),
});

/** A button of a remote. */
export type InfraredButton = z.output<typeof infraredButtonSchema>;

/** A remote with its buttons, by cell. */
export const infraredRemoteDetailSchema = infraredRemoteSchema.extend({
  buttons: z.array(infraredButtonSchema).max(INFRARED_MAXIMUM_BUTTONS),
});

/** A remote with its buttons. */
export type InfraredRemoteDetail = z.output<typeof infraredRemoteDetailSchema>;

/** Names a remote or a button. */
export const infraredIdRequestSchema = z.object({ id: z.uuid() });

/** Saves a remote: a new one has no id. */
export const infraredRemoteSaveRequestSchema = z.object({
  id: z.uuid().optional(),
  name: remoteNameSchema,
  kind: z.enum(INFRARED_REMOTE_KINDS),
  blasterId: integrationIdSchema.nullable(),
  columns: z.int().min(1).max(INFRARED_MAXIMUM_COLUMNS).default(3),

  /** The room its device is put in when it is added; ignored afterwards, the device's own. */
  areaId: z.uuid().nullable().optional(),
});

/** A remote to save. */
export type InfraredRemoteSaveRequest = z.output<typeof infraredRemoteSaveRequestSchema>;

/** Whether there was such a thing, and it is gone. */
export const infraredRemoveReplySchema = z.object({ isRemoved: z.boolean() });

/** Saves a button: a new one has no id, and goes in the first empty cell when none is said. */
export const infraredButtonSaveRequestSchema = z.object({
  remoteId: z.uuid(),
  id: z.uuid().optional(),
  name: buttonNameSchema,
  icon: iconIdSchema.nullable().default(null),
  cell: cellSchema.optional(),
  code: infraredCodeSchema,
});

/** A button to save. */
export type InfraredButtonSaveRequest = z.output<typeof infraredButtonSaveRequestSchema>;

/** Moves a button to an empty cell. */
export const infraredButtonMoveRequestSchema = z.object({ id: z.uuid(), cell: cellSchema });

/** When the button was sent. */
export const infraredButtonPressReplySchema = z.object({ pressedAt: timestampSchema });

/** Sends a code through a blaster. */
export const infraredTestRequestSchema = z.object({
  blasterId: integrationIdSchema,
  code: infraredCodeSchema,
});

/** Starts learning a code on a blaster. */
export const infraredLearnRequestSchema = z.object({
  blasterId: integrationIdSchema,
  signal: z.enum(INFRARED_SIGNALS).default('ir'),

  /** How long it listens: about 30 s, as a Broadlink does. */
  timeoutMs: timeoutSchema.default(30_000),
});

/** One learn job: listening on a blaster until a code comes, or it fails or is cancelled. */
export const infraredLearnJobSchema = z.object({
  id: z.string().min(1).max(64),
  blasterId: integrationIdSchema,
  blasterName: z.string().max(256),
  signal: z.enum(INFRARED_SIGNALS),
  phase: z.enum(INFRARED_LEARN_PHASES),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),

  /** When listening or sweeping stops on its own; for the countdown ring. */
  endsAt: timestampSchema.nullable(),

  /** An RF code's frequency, once the sweep found it. */
  frequencyHz: z.int().min(1_000_000).max(10_000_000_000).nullable(),

  /** The code, once captured. */
  code: infraredCodeSchema.nullable(),

  /** Why it failed - nothing heard, or the integration's error - in a sentence. */
  error: z.string().max(2048).nullable(),
});

/** One learn job. */
export type InfraredLearnJob = z.output<typeof infraredLearnJobSchema>;

/** Names a learn job. */
export const infraredLearnJobRequestSchema = z.object({ jobId: z.string().min(1).max(64) });

/** The most an import reads: a pasted text or a dropped file. */
export const INFRARED_IMPORT_MAXIMUM_CHARACTERS = 1_000_000;

/** Reads pasted text, or a dropped file's contents and name. */
export const infraredImportParseRequestSchema = z.object({
  text: z.string().max(INFRARED_IMPORT_MAXIMUM_CHARACTERS),
  fileName: z.string().max(256).optional(),
});

/** One code an import found, named as its file named it or as the line it came from. */
export const infraredImportItemSchema = z.object({
  name: z.string().max(64),
  format: z.enum(INFRARED_IMPORT_FORMATS),
  code: infraredCodeSchema,
});

/** One code an import found. */
export type InfraredImportItem = z.output<typeof infraredImportItemSchema>;

/** The codes found, and the lines that were not understood and why. */
export const infraredImportParseReplySchema = z.object({
  items: z.array(infraredImportItemSchema).max(INFRARED_MAXIMUM_BUTTONS),
  problems: z
    .array(
      z.object({
        /** The line, counted from 1; null for a problem of the whole text. */
        line: z.int().min(1).nullable(),
        text: z.string().max(256),
        reason: z.string().max(512),
      }),
    )
    .max(INFRARED_MAXIMUM_BUTTONS),
});

/** Adds codes to a remote as buttons, each in the next empty cell. */
export const infraredImportRequestSchema = z.object({
  remoteId: z.uuid(),
  items: z
    .array(
      z.object({
        name: buttonNameSchema,
        icon: iconIdSchema.nullable().default(null),
        code: infraredCodeSchema,
      }),
    )
    .min(1)
    .max(INFRARED_MAXIMUM_BUTTONS),
});

/** Asks for a code in every format Show code copies. */
export const infraredCodeFormatsRequestSchema = z.object({ code: infraredCodeSchema });

/**
 * The code in each format - null for one that cannot carry it, Pronto has no RF - and what Show
 * code says of it: the protocol its pulses are, or "Raw · 68 pulses · 38 kHz".
 */
export const infraredCodeFormatsReplySchema = z.object({
  broadlink: z.string().max(16_384).nullable(),
  pronto: z.string().max(65_536).nullable(),
  raw: z.string().max(65_536),

  /** The protocol the pulses are read as now; null for raw timings and for RF. */
  protocol: infraredProtocolSchema.nullable(),
  pulseCount: z.int().min(1).max(INFRARED_MAXIMUM_PULSES),
  carrierHz: z.int().min(0).max(1_000_000),
});
