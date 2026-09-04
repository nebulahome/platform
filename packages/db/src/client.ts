/**
 * The database connection every service opens.
 *
 * Each service connects with its own PostgreSQL role holding the minimum privileges it needs
 * (DATABASE.md 12), so a compromise of one service is not a compromise of the database. That
 * separation is configuration, not code: the connection string carries the role, and this module
 * only makes sure the connection is bounded and identifiable.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

/** How a service opens its connection pool. */
export type DatabaseOptions = {
  /** The full `postgres://` URL, including the service's own role. */
  connectionString: string;

  /**
   * Recorded as `application_name`, so `pg_stat_activity` says which service holds a connection.
   *
   * Without it, diagnosing a lock contention means guessing from the query text.
   */
  applicationName: string;

  /** Maximum pooled connections. */
  maxConnections?: number;

  /**
   * Server-side cap on how long a single statement may run.
   *
   * Every I/O call in the platform has a timeout (RULES.md 9), and this is the one that holds
   * even when the client-side one is forgotten: a runaway query is cancelled by the server
   * rather than pinning a connection until someone notices.
   */
  statementTimeoutMs?: number;

  /** How long to wait for a connection to be established. */
  connectTimeoutSeconds?: number;
};

/** A connected database handle, typed against the full schema. */
export type Database = PostgresJsDatabase<typeof schema>;

/** A handle plus the underlying connection, which the owner has to close on shutdown. */
export type DatabaseHandle = {
  /** The query builder. */
  db: Database;

  /**
   * Closes the pool.
   *
   * @param timeoutSeconds - How long in-flight queries are given before connections are cut.
   * @returns A promise that settles once every connection is closed.
   */
  close: (timeoutSeconds?: number) => Promise<void>;
};

const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const DEFAULT_CLOSE_TIMEOUT_SECONDS = 5;

/**
 * Opens a connection pool and returns a typed query builder over it.
 *
 * @param options - Connection string, service identity and the bounds on the pool.
 * @returns The query builder and the function that closes the pool.
 */
export function createDatabase(options: DatabaseOptions): DatabaseHandle {
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    connect_timeout: options.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS,
    connection: {
      application_name: options.applicationName,
      statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    },

    // Timestamps are `timestamptz` everywhere and always UTC. Letting the driver apply the
    // server's local zone would silently shift every history query by the host's offset.
    types: {},
  });

  return {
    db: drizzle(sql, { schema }),

    /**
     * Closes the pool.
     *
     * @param timeoutSeconds - How long in-flight queries are given before connections are cut.
     * @returns A promise that settles once every connection is closed.
     */
    close: async (timeoutSeconds = DEFAULT_CLOSE_TIMEOUT_SECONDS): Promise<void> => {
      await sql.end({ timeout: timeoutSeconds });
    },
  };
}
