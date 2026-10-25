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

/** Which releases a kind follows. */
export const UPDATE_CHANNELS = ['stable', 'beta'] as const;

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
});

/** How the last update of Nebula Home ended. */
export type PlatformUpdateOutcome = z.output<typeof platformUpdateOutcomeSchema>;

/** `svc.supervisor.platform_releases`: the newest of each channel, and whether it can update. */
export const platformReleasesReplySchema = z.object({
  /** The version running. */
  installedVersion: z.string().max(64),
  stable: platformReleaseSchema.nullable(),
  beta: platformReleaseSchema.nullable(),
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
export const updatePlatformRequestSchema = z.strictObject({ version: z.string().min(1).max(64) });

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
