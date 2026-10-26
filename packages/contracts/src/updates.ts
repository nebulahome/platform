/**
 * Updates: of Nebula Home itself, of the packages and of the integrations
 * (docs/releases-and-updates.md 4, board N-Settings-System).
 *
 * The packet-manager runs a round of updates - one at a time, whether started by Update, Update
 * all or the schedule - backing up first when asked; Nebula Home is updated by the supervisor,
 * last, from the GitHub release it checks for. `api` gathers the three into one list.
 */
import { z } from 'zod';

import { timeOfDaySchema } from './backup.js';
import { timestampSchema } from './timestamp.js';

/**
 * Which releases a kind follows: stable only, betas too (`-beta.K`), or development builds too
 * (`-alpha.K`).
 */
export const UPDATE_CHANNELS = ['stable', 'beta', 'dev'] as const;

/** Which releases a kind follows. */
export const updateChannelSchema = z.enum(UPDATE_CHANNELS);

/** Which releases a kind follows. */
export type UpdateChannel = z.output<typeof updateChannelSchema>;

/** When automatic updates run: a fixed time of day, or the quietest (`sensor.system_quiet_time`). */
export const updateWindowSchema = z.object({
  mode: z.enum(['quietest', 'fixed']),

  /** The fixed time, `HH:MM` on the house's clock; the fallback while the quietest is learned. */
  time: timeOfDaySchema,
});

/** When automatic updates run. */
export type UpdateWindow = z.output<typeof updateWindowSchema>;

/** One thing a round updates. */
export const updateItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('core'), version: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('package'), id: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('integration'), id: z.string().min(1).max(64) }),
]);

/** One thing a round updates. */
export type UpdateItem = z.output<typeof updateItemSchema>;

/** Where one item of a round is. */
export const UPDATE_ITEM_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;

/** A round of updates: what it updates, and how far it got. */
export const updateRoundSchema = z.object({
  id: z.uuid(),
  trigger: z.enum(['manual', 'schedule']),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  status: z.enum(['running', 'done', 'failed']),

  /** The backup taken first: skipped (off, or a recent one is enough), taken, or failed. */
  backup: z.enum(['off', 'recent', 'taken', 'failed']).nullable(),

  items: z.array(
    z.object({
      item: updateItemSchema,
      status: z.enum(UPDATE_ITEM_STATUSES),
      error: z.string().max(1024).nullable(),
    }),
  ),
});

/** A round of updates. */
export type UpdateRound = z.output<typeof updateRoundSchema>;

/** Who asked, for the record. */
const requesterSchema = z.object({ id: z.uuid(), username: z.string() }).nullable().default(null);

/** `svc.packet-manager.run_updates`: a round, as the owner picked it. */
export const runUpdatesRequestSchema = z.strictObject({
  items: z.array(updateItemSchema).min(1).max(256),
  requestedBy: requesterSchema,
});

/** The reply: the round started, answered before it ends. */
export const runUpdatesReplySchema = z.object({ round: updateRoundSchema });

/** `svc.packet-manager.update_status`: the round running or last run. */
export const updateStatusReplySchema = z.object({ round: updateRoundSchema.nullable() });

/** A release of Nebula Home on GitHub. */
export const platformReleaseSchema = z.object({
  version: z.string().max(64),

  /** Its notes, Markdown as GitHub has them. */
  notes: z.string().max(65_536),
  url: z.url().max(1024),
  publishedAt: timestampSchema,
});

/** A release of Nebula Home on GitHub. */
export type PlatformRelease = z.output<typeof platformReleaseSchema>;

/** How the last update of Nebula Home ended, as the updater wrote it in `/data/updates/last.json`. */
export const platformUpdateOutcomeSchema = z.object({
  fromVersion: z.string().max(64),
  toVersion: z.string().max(64),
  status: z.enum(['success', 'rolled_back', 'failed']),
  finishedAt: timestampSchema,
  error: z.string().max(2048).nullable(),

  /** What the updater did, and the new version's last lines when it did not start; in English. */
  log: z.array(z.string().max(16_384)).max(200).default([]),

  /** How long putting the old version back took; null when nothing was put back. */
  restoredInMs: z.int().nonnegative().nullable().default(null),
});

/** How the last update of Nebula Home ended. */
export type PlatformUpdateOutcome = z.output<typeof platformUpdateOutcomeSchema>;

/** `svc.supervisor.platform_releases`: the newest of each channel, and whether it can update. */
export const platformReleasesReplySchema = z.object({
  /** The version running. */
  installedVersion: z.string().max(64),
  stable: platformReleaseSchema.nullable(),
  beta: platformReleaseSchema.nullable(),
  dev: platformReleaseSchema.nullable(),
  checkedAt: timestampSchema.nullable(),
  error: z.string().max(1024).nullable(),

  /** Why it cannot update itself here, in English; null when it can. */
  refusal: z.string().max(512).nullable(),
  lastUpdate: platformUpdateOutcomeSchema.nullable(),
});

/** `svc.supervisor.platform_releases`. */
export type PlatformReleasesReply = z.output<typeof platformReleasesReplySchema>;

/** `svc.supervisor.platform_releases`: `check` to ask GitHub again now. */
export const platformReleasesRequestSchema = z.strictObject({ check: z.boolean().default(false) });

/** `svc.supervisor.update_platform`: the release to update to. */
export const updatePlatformRequestSchema = z.strictObject({
  version: z.string().min(1).max(64),

  /** The size of the backup the round took or reused first, for the screen; null for none. */
  backupBytes: z.int().nonnegative().nullable().default(null),
});

/**
 * Where a restart or an update of Nebula Home is: its services stopping, the new version
 * downloading, the updater replacing the container, the new version being checked.
 */
export const PLATFORM_OPERATION_PHASES = [
  'stopping',
  'downloading',
  'installing',
  'checking',
] as const;

/**
 * A restart or an update of Nebula Home under way, which every open page shows over whatever it
 * was showing (boards N-Restart and N-Update).
 */
export const platformOperationSchema = z.object({
  kind: z.enum(['restart', 'update']),
  phase: z.enum(PLATFORM_OPERATION_PHASES),

  /** The version running when it began. */
  fromVersion: z.string().max(64),

  /** The version an update goes to; null for a restart. */
  toVersion: z.string().max(64).nullable(),

  /** How far the download has got, below a hundred; null before Docker says, or after. */
  percent: z.int().min(0).max(100).nullable(),

  /** The size of the backup taken or reused first; null when there was none. */
  backupBytes: z.int().nonnegative().nullable(),

  /** The new version's size, as far as the download has said; null before it does. */
  downloadBytes: z.int().nonnegative().nullable(),
  startedAt: timestampSchema,
});

/** A restart or an update of Nebula Home under way. */
export type PlatformOperation = z.output<typeof platformOperationSchema>;

/** `nebula.v1.event.platform`: the operation as it now stands, null once there is none. */
export const platformEventSchema = z.object({ operation: platformOperationSchema.nullable() });

/** A restart or an update starting, moving on or ending. */
export type PlatformEvent = z.output<typeof platformEventSchema>;

/**
 * `svc.supervisor.platform_state` and `GET /api/v1/system/platform`: the version running, what
 * is under way and how the last update ended - for every signed-in page, whatever its role.
 */
export const platformStateSchema = z.object({
  version: z.string().max(64),

  /** The machine's name, as Docker knows it; null without Docker. */
  machine: z.string().max(256).nullable(),
  operation: platformOperationSchema.nullable(),
  lastUpdate: platformUpdateOutcomeSchema.nullable(),
});

/** What every page knows of Nebula Home itself. */
export type PlatformState = z.output<typeof platformStateSchema>;

/**
 * `/data/updates/current.json`: written by the updater while it replaces the container, so the
 * version that comes up knows it is being checked.
 */
export const platformUpdateMarkerSchema = z.object({
  fromVersion: z.string().max(64),
  toVersion: z.string().max(64),
  startedAt: timestampSchema,
});

/** One row of the list of updates. */
export const systemUpdateRowSchema = z.object({
  item: updateItemSchema,
  name: z.string(),
  installedVersion: z.string(),
  latestVersion: z.string(),

  /** Its notes: Markdown for Nebula Home, a link for a package or an integration. */
  notes: z.string().nullable(),
  notesUrl: z.string().nullable(),
});

/**
 * A package or an integration's update starting or ending (`nebula.v1.event.update`): `sources` are
 * what `core` routes commands by - the package id, or the integration's instance ids. While a
 * source updates its entities say so and keep their last value, and commands to them wait.
 */
export const updateEventSchema = z.object({
  sources: z.array(z.string().min(1).max(128)).min(1).max(1024),
  phase: z.enum(['start', 'end']),
});

/** A package or an integration's update starting or ending. */
export type UpdateEvent = z.output<typeof updateEventSchema>;

/** `GET /api/v1/system/updates`: everything that can update, and how updates run. */
export const systemUpdatesViewSchema = z.object({
  core: platformReleasesReplySchema.extend({ channel: updateChannelSchema }).nullable(),
  rows: z.array(systemUpdateRowSchema),

  /** Why a list could not be read: the supervisor, or an index. */
  problems: z.array(z.string()),
  round: updateRoundSchema.nullable(),
});

/** `GET /api/v1/system/updates`. */
export type SystemUpdatesView = z.output<typeof systemUpdatesViewSchema>;

/** `POST /api/v1/system/updates/run`: some rows, or every one the list has. */
export const runSystemUpdatesBodySchema = z.strictObject({
  items: z.array(updateItemSchema).min(1).max(256).optional(),
});
