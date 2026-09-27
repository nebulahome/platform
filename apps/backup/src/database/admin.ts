/**
 * What the backup asks the database as its superuser: versions, roles, sizes, what to leave out
 * of a dump without the history, and the database-level steps of a restore.
 *
 * TimescaleDB's internal catalogue has changed shape between versions, so nothing here reads it:
 * only the `timescaledb_information` views, which are its public interface.
 */
import postgres from 'postgres';

import { connectionOf } from './pg-tools.js';

/** A superuser connection. */
export type AdminSql = postgres.Sql;

/** Ignores a notice. */
function ignoreNotice(): void {
  // Nothing to do.
}

/**
 * Opens one superuser connection.
 *
 * @param url - The superuser's URL.
 * @param database - Another database on the same server, instead of the URL's.
 * @returns The connection; the caller ends it.
 */
export function connectAdmin(url: string, database?: string): AdminSql {
  const target = connectionOf(url, database);
  const parsed = new URL(target.url);

  parsed.password = encodeURIComponent(target.password);

  return postgres(parsed.toString(), {
    max: 1,
    connect_timeout: 10,
    // What the server says in passing - "extension already exists, skipping" - is not news.
    onnotice: ignoreNotice,
    connection: { application_name: 'backup' },
  });
}

/**
 * The database's name in a URL.
 *
 * @param url - A `postgres://` URL.
 * @returns The database it names; `postgres` when it names none.
 */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//u, '')) || 'postgres';
}

/** The server and extension versions, and the roles the platform's grants name. */
export type DatabaseFacts = {
  readonly postgresVersion: string;
  readonly timescaledbVersion: string | null;
  readonly roles: readonly string[];
  readonly schema: { readonly version: number; readonly latestHash: string | null };
};

/**
 * Reads what a dump has to record about the database it came from.
 *
 * @param sql - A superuser connection to the database.
 * @returns The facts.
 */
export async function databaseFacts(sql: AdminSql): Promise<DatabaseFacts> {
  const [versions] = await sql<{ server: string; timescaledb: string | null }[]>`
    SELECT current_setting('server_version') AS server,
           (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb`;
  const roles = await sql<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname LIKE 'nebula\\_%' ORDER BY rolname`;
  const [schema] = await sql<{ version: number; latest_hash: string | null }[]>`
    SELECT version, latest_hash FROM system.v_schema_version`;

  return {
    postgresVersion: versions?.server ?? 'unknown',
    timescaledbVersion: versions?.timescaledb ?? null,
    roles: roles.map((row) => row.rolname),
    schema: { version: schema?.version ?? 0, latestHash: schema?.latest_hash ?? null },
  };
}

/**
 * The tables whose rows a dump without the history leaves out: every chunk of every hypertable in
 * `history`, of the materialisations of its continuous aggregates, and every compressed chunk.
 *
 * The compressed chunks go all at once, by name, because which hypertable one belongs to is only
 * in the catalogue this module does not read - which is safe while the one hypertable kept,
 * `system.audit_log`, is never compressed (a test holds that).
 *
 * @param sql - A superuser connection to the database.
 * @returns `--exclude-table-data` patterns; none when the history has no chunks yet.
 */
export async function historyExclusions(sql: AdminSql): Promise<string[]> {
  const chunks = await sql<{ chunk_name: string }[]>`
    SELECT chunk_name FROM timescaledb_information.chunks
    WHERE hypertable_schema = 'history'
       OR (hypertable_schema = '_timescaledb_internal' AND hypertable_name IN (
             SELECT materialization_hypertable_name
             FROM timescaledb_information.continuous_aggregates
             WHERE view_schema = 'history'))`;
  const ids = new Set<string>();

  for (const { chunk_name: name } of chunks) {
    const match = /^_hyper_(\d+)_\d+_chunk$/u.exec(name);

    if (match?.[1] !== undefined) {
      ids.add(match[1]);
    }
  }

  const patterns = ['_timescaledb_internal.compress_hyper_*'];

  if (ids.size > 0) {
    patterns.unshift(
      `_timescaledb_internal._hyper_(${[...ids].sort((a, b) => Number(a) - Number(b)).join('|')})_*_chunk`,
    );
  }

  return patterns;
}

/**
 * How much the database's parts take on disk: the configuration - every table of `auth`,
 * `registry` and `system`, with the audit log's chunks - and the history, with its aggregates.
 *
 * Tables and their TOAST, not indexes: a dump carries rows, and rebuilds indexes on restore.
 *
 * @param sql - A superuser connection to the database.
 * @returns The bytes of each.
 */
export async function databasePartSizes(
  sql: AdminSql,
): Promise<{ readonly configuration: number; readonly history: number }> {
  const [plain] = await sql<{ bytes: string }[]>`
    SELECT coalesce(sum(pg_table_size(c.oid)), 0)::text AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('auth', 'registry', 'system') AND c.relkind IN ('r', 'm')`;
  const hypertables = await sql<{ schema: string; name: string; bytes: string }[]>`
    SELECT h.hypertable_schema AS schema, h.hypertable_name AS name,
           (SELECT coalesce(sum(d.table_bytes + d.toast_bytes), 0)
            FROM hypertable_detailed_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) d
           )::text AS bytes
    FROM timescaledb_information.hypertables h`;
  const materialisations = new Set(
    (
      await sql<{ name: string }[]>`
        SELECT materialization_hypertable_name AS name
        FROM timescaledb_information.continuous_aggregates WHERE view_schema = 'history'`
    ).map((row) => row.name),
  );
  let configuration = Number(plain?.bytes ?? 0);
  let history = 0;

  for (const row of hypertables) {
    if (row.schema === 'history' || materialisations.has(row.name)) {
      history += Number(row.bytes);
    } else if (row.schema === 'system') {
      configuration += Number(row.bytes);
    }
  }

  return { configuration, history };
}

/**
 * Whether this server can install the TimescaleDB version a dump was taken with.
 *
 * @param sql - A superuser connection.
 * @param version - The version, or null for a dump without it.
 * @returns True when it can.
 */
export async function canInstallTimescale(sql: AdminSql, version: string | null): Promise<boolean> {
  if (version === null) {
    return true;
  }

  const rows = await sql<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_available_extension_versions
                   WHERE name = 'timescaledb' AND version = ${version}) AS found`;

  return rows[0]?.found === true;
}
