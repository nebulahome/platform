/**
 * Writing the audit trail.
 *
 * ARCHITECTURE.md 12.4 lists what has to be recorded: sign-in and sign-out, failed
 * authentication, permission changes, user creation and deletion, package changes, automation
 * and scene changes, settings changes, and manual commands to locks and security devices.
 *
 * `actorLabel` snapshots the username at the time of the action, and `actorUserId` is
 * deliberately not a foreign key, so that a record survives the deletion of the person it names.
 * An audit trail that forgets who did the thing when the account is closed is not one.
 */
import type { Identity } from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

/** What kind of actor performed an action. */
export const ACTOR_TYPES = ['user', 'token', 'system', 'anonymous'] as const;

/** What kind of actor performed an action. */
export type ActorType = (typeof ACTOR_TYPES)[number];

/** One thing worth remembering that somebody did. */
export type AuditEntry = {
  /** What happened, in `resource.verb` form, e.g. `auth.login`. */
  readonly action: string;

  /** What kind of thing it happened to. */
  readonly resourceType: string;

  /** Which one. */
  readonly resourceId?: string | null;

  /** Whether it worked. */
  readonly result: 'success' | 'failure';

  /** Who did it, when the request was authenticated. */
  readonly identity?: Identity | undefined;

  /** Who they claimed to be, when it was not. */
  readonly actorLabel?: string;

  /** Where from. */
  readonly ipAddress?: string | null;

  /** What with. */
  readonly userAgent?: string | null;

  /** The request's trace id, so an entry links to the log lines it produced. */
  readonly traceId: string;

  /** Anything else worth keeping. Never secrets or personal data. */
  readonly details?: Record<string, unknown>;
};

/** Writes audit entries, and never lets a failure to write one break the request. */
export class AuditLog {
  /** The database. */
  readonly #db: Database;

  /** Where a failed write is reported. */
  readonly #logger: PlatformLogger;

  /**
   * Creates the writer.
   *
   * @param db - The database.
   * @param logger - Where failures are reported.
   */
  public constructor(db: Database, logger: PlatformLogger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Records one entry.
   *
   * A failed write is logged and swallowed. The alternative - failing the request - would mean
   * a full audit table stops people signing in, and a system that locks its owner out to protect
   * its own bookkeeping has the priorities backwards. The log line is what makes the gap
   * visible.
   *
   * @param entry - What happened.
   */
  public async record(entry: AuditEntry): Promise<void> {
    const actorType: ActorType =
      entry.identity === undefined
        ? 'anonymous'
        : entry.identity.credential === 'access_token'
          ? 'token'
          : 'user';

    try {
      await this.#db.insert(schema.system.auditLog).values({
        actorType,
        actorUserId: entry.identity?.userId ?? null,

        // Not null: the column is NOT NULL because an entry that cannot say who acted is
        // not worth keeping. An unauthenticated attempt records what was typed as the
        // username, which is the only identity there is at that moment.
        actorLabel: entry.identity?.username ?? entry.actorLabel ?? 'unknown',

        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        result: entry.result,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        traceId: entry.traceId,
        details: entry.details ?? {},
      });
    } catch (error: unknown) {
      this.#logger.error(
        { err: error, action: entry.action, traceId: entry.traceId },
        'Audit entry could not be written',
      );
    }
  }
}
