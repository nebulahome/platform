/**
 * `pg_dump` and `pg_restore`, run as child processes.
 *
 * Never through a shell, and never with the password on the command line: the connection goes
 * as a URL without it, and the password as `PGPASSWORD` in the child's environment only. What the
 * tools write on stderr is kept - its last lines are the error a failed run reports - except the
 * warnings TimescaleDB's catalogue always causes, which say nothing wrong.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** Where the tools are, and how to reach the database. */
export type PgToolsOptions = {
  /** The folder the tools are in; the PATH when absent. */
  readonly binDir?: string | undefined;
};

/** The warnings every dump of a TimescaleDB database prints, which mean nothing is wrong. */
const HARMLESS = [
  /circular foreign-key constraints/u,
  /You might not be able to restore the dump without using --disable-triggers/u,
  /Consider using a full dump instead of a --data-only dump/u,
  /^pg_dump: detail: /u,
  /^pg_restore: (processing|creating|executing|connecting|entering|finished)/u,
];

/** How many of the last stderr lines a failure reports. */
const REPORTED_LINES = 8;

/**
 * Splits a connection URL into one without its password, and the password.
 *
 * @param url - A `postgres://` URL.
 * @param database - Another database on the same server, instead of the URL's.
 * @returns The URL to pass, and the password for the environment.
 */
export function connectionOf(
  url: string,
  database?: string,
): { readonly url: string; readonly password: string } {
  const parsed = new URL(url);
  const password = decodeURIComponent(parsed.password);

  parsed.password = '';

  if (database !== undefined) {
    parsed.pathname = `/${encodeURIComponent(database)}`;
  }

  return { url: parsed.toString(), password };
}

/**
 * Runs one of the tools to completion.
 *
 * @param options - Where the tools are.
 * @param tool - `pg_dump` or `pg_restore`.
 * @param args - Its arguments.
 * @param password - The password, for the environment.
 * @param signal - Stops it.
 * @param onLine - Each line it writes on stderr, for progress.
 * @returns A promise that settles when it exits cleanly.
 */
async function run(
  options: PgToolsOptions,
  tool: 'pg_dump' | 'pg_restore',
  args: readonly string[],
  password: string,
  signal: AbortSignal | undefined,
  onLine?: (line: string) => void,
): Promise<void> {
  const command = options.binDir === undefined ? tool : path.join(options.binDir, tool);
  const lines: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      // The child inherits this process's environment, as any child does, with the password
      // added: nothing is read from it here. PGPASSWORD keeps the password out of the arguments.
      // eslint-disable-next-line no-restricted-properties -- see above
      env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '10' },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      ...(signal === undefined ? {} : { signal }),
    });
    let partial = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      partial += chunk;

      const complete = partial.split('\n');

      partial = complete.pop() ?? '';

      for (const line of complete) {
        onLine?.(line);

        if (!HARMLESS.some((pattern) => pattern.test(line)) && line.trim() !== '') {
          lines.push(line);

          if (lines.length > 200) {
            lines.shift();
          }
        }
      }
    });
    child.on('error', (error) => {
      reject(
        'code' in error && error.code === 'ENOENT'
          ? new Error(`${tool} is not installed on this machine`)
          : error,
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();

        return;
      }

      const said = lines.slice(-REPORTED_LINES).join('\n');

      reject(new Error(`${tool} failed (exit ${String(code)})${said === '' ? '' : `: ${said}`}`));
    });
  });
}

/**
 * Dumps a whole database into a file, in pg_dump's custom format.
 *
 * @param options - Where the tools are.
 * @param dump - What to dump and where.
 * @param dump.url - The superuser's connection URL.
 * @param dump.output - The file.
 * @param dump.excludeTableData - Tables whose rows are left out - their definitions stay.
 * @param dump.signal - Stops it.
 * @returns A promise that settles when the dump is complete.
 */
export async function dumpDatabase(
  options: PgToolsOptions,
  dump: {
    readonly url: string;
    readonly output: string;
    readonly excludeTableData: readonly string[];
    readonly signal?: AbortSignal;
  },
): Promise<void> {
  const connection = connectionOf(dump.url);

  await run(
    options,
    'pg_dump',
    [
      '--format=custom',
      '--compress=6',
      '--no-password',
      `--file=${dump.output}`,
      `--dbname=${connection.url}`,
      ...dump.excludeTableData.map((pattern) => `--exclude-table-data=${pattern}`),
    ],
    connection.password,
    dump.signal,
  );
}

/**
 * Restores a dump into a database that has been prepared for it.
 *
 * @param options - Where the tools are.
 * @param restore - What to restore where.
 * @param restore.url - The superuser's connection URL.
 * @param restore.database - The database to restore into.
 * @param restore.input - The dump.
 * @param restore.signal - Stops it.
 * @param restore.onLine - Each line it reports, for progress.
 * @returns A promise that settles when the restore is complete.
 */
export async function restoreDatabase(
  options: PgToolsOptions,
  restore: {
    readonly url: string;
    readonly database: string;
    readonly input: string;
    readonly signal?: AbortSignal;
    readonly onLine?: (line: string) => void;
  },
): Promise<void> {
  const connection = connectionOf(restore.url, restore.database);

  await run(
    options,
    'pg_restore',
    ['--no-password', '--exit-on-error', '--verbose', `--dbname=${connection.url}`, restore.input],
    connection.password,
    restore.signal,
    restore.onLine,
  );
}
