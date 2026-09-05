/**
 * Everything a route can reach.
 *
 * Assembled once at startup and handed to each route module, rather than imported from a module
 * that holds it in a variable. A singleton would make the whole service impossible to stand up
 * twice in one process, which is exactly what the tests do.
 */
import type { BusClient } from '@nebula-home/bus';
import type { Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import type { Authenticator } from './auth/authenticator.js';
import type { ChallengeStore } from './auth/challenges.js';
import type { ApiConfig } from './config.js';
import type { IdempotencyStore } from './http/idempotency.js';
import type { AuditLog } from './services/audit.js';
import type { EventFanout } from './services/events.js';

/** Everything a route can reach. */
export type ApiContext = {
  /** The validated environment. */
  readonly config: ApiConfig;

  /** The database. */
  readonly db: Database;

  /**
   * The bus, for commanding entities and for the live channel.
   *
   * Undefined when the broker was unreachable at startup. `api` still serves everything it can
   * read from the database in that state, because a house whose lights cannot be switched is
   * still a house whose state is worth showing (ARCHITECTURE.md 7.4).
   */
  readonly bus: BusClient | undefined;

  /** The logger. */
  readonly logger: PlatformLogger;

  /** Verifies credentials. */
  readonly authenticator: Authenticator;

  /** Pending two-factor challenges. */
  readonly challenges: ChallengeStore;

  /** Remembered command replies, keyed by `Idempotency-Key`. */
  readonly idempotency: IdempotencyStore;

  /** The audit trail. */
  readonly audit: AuditLog;

  /** The live channel's fan-out. */
  readonly events: EventFanout;

  /** The signing key for access tokens. */
  readonly jwtSecret: Uint8Array;

  /** The key TOTP secrets are encrypted with. */
  readonly totpKey: Buffer;

  /** The clock, injectable so tests can control expiry. */
  readonly now: () => Date;
};
