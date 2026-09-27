/**
 * The container's other services, stopped and started again around the moment a restore swaps
 * the database and the data directory's folders.
 *
 * s6 supervises them (ARCHITECTURE.md 14): `s6-svc -d` stops one and keeps it down, `-u` brings it
 * back, `-wD` waits until it is really down. Starting a service again is how it rebuilds what it
 * holds in memory - `core` its registry, `hub` its integrations, `api` its caches - from the
 * database it now finds.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The services a restore stops, in the order they stop; they start in the other. */
export const RESTORED_SERVICES = ['api', 'hub', 'core'] as const;

/** Controls the services the supervisor runs. */
export class Supervisor {
  readonly #serviceDir: string;

  /**
   * @param serviceDir - Where the supervisor keeps its services: `/run/service`.
   */
  public constructor(serviceDir: string) {
    this.#serviceDir = serviceDir;
  }

  /**
   * Whether the services are supervised here at all: not outside the container.
   *
   * @returns True when they are.
   */
  public isAvailable(): boolean {
    return RESTORED_SERVICES.every((name) => existsSync(path.join(this.#serviceDir, name)));
  }

  /**
   * Stops services and waits until they are down.
   *
   * @param names - Which.
   * @param timeoutMs - How long each may take.
   */
  public async stop(names: readonly string[], timeoutMs = 30_000): Promise<void> {
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop -- in order: api before what it calls.
      await run(
        's6-svc',
        ['-wD', '-T', String(timeoutMs), '-d', path.join(this.#serviceDir, name)],
        {
          timeout: timeoutMs + 5000,
        },
      );
    }
  }

  /**
   * Starts services again.
   *
   * @param names - Which.
   */
  public async start(names: readonly string[]): Promise<void> {
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop -- in order: core before what calls it.
      await run('s6-svc', ['-u', path.join(this.#serviceDir, name)], { timeout: 10_000 });
    }
  }
}

/**
 * Waits for `api` to answer that it is ready.
 *
 * @param apiUrl - Where it listens.
 * @param timeoutMs - How long to wait.
 * @returns True when it answered in time.
 */
export async function waitForApi(apiUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- polling, one attempt at a time.
      const response = await fetch(new URL('/readyz', apiUrl), {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // Not up yet.
    }

    // eslint-disable-next-line no-await-in-loop -- the wait is the poll's interval.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}
