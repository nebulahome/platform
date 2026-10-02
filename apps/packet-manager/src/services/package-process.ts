/**
 * One `node` package's process: started with the platform's runner, watched, started again when
 * it exits, and stopped when asked.
 *
 * The process is a child of the packet-manager: `node <runner> <entry>` in the package's folder,
 * with an environment of its own - the package's id and release, its folders, its settings with
 * their secrets opened, the bus - and nothing else of the packet-manager's: not the database's
 * address, not the instance key. Its stdout and stderr are its log (log-ring.ts). An exit it was
 * not asked for is followed by a start after the restart policy's pause, or by `failed` when the
 * policy gives up, with the last line it wrote to stderr as the reason.
 */
import { spawn, type ChildProcess } from 'node:child_process';

import type { PlatformLogger } from '@nebulahome/logging';

import { LogRing } from '../domain/log-ring.js';
import { RestartPolicy } from '../domain/restart-policy.js';

/** How long a process is given to stop after SIGTERM before it is killed. */
const STOP_GRACE_MS = 12_000;

/** Where a package's process stands, as it tells the service. */
export type ProcessState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'exited'; readonly reason: string; readonly willRestartInMs: number }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'stopped' };

/** What a package's process is started from. */
export type ProcessSpec = {
  readonly id: string;

  /** The runner: `@nebulahome/package-host`'s `run.js`. */
  readonly runner: string;

  /** The package's server module, absolute. */
  readonly entry: string;

  /** Its folder, the process's working directory. */
  readonly cwd: string;

  /** Its whole environment. */
  readonly env: Readonly<Record<string, string>>;
};

/** What the process needs besides. */
export type ProcessOptions = {
  readonly logger: PlatformLogger;

  /** Told each time where it stands. */
  readonly onState: (state: ProcessState) => void;
  readonly policy?: RestartPolicy;
  readonly spawn?: typeof spawn;
};

/** One package's process. */
export class PackageProcess {
  /** What it wrote. */
  public readonly logs = new LogRing();

  readonly #spec: ProcessSpec;
  readonly #options: ProcessOptions;
  readonly #policy: RestartPolicy;
  #child: ChildProcess | undefined;
  #startedAtMs = 0;
  #isStopping = false;
  #restart: NodeJS.Timeout | undefined;
  #exited: Promise<void> = Promise.resolve();

  /**
   * Makes the process, not started.
   *
   * @param spec - What it is started from.
   * @param options - The logger, where its state goes, the restart policy.
   */
  public constructor(spec: ProcessSpec, options: ProcessOptions) {
    this.#spec = spec;
    this.#options = options;
    this.#policy = options.policy ?? new RestartPolicy();
  }

  /**
   * Whether a process is running now.
   *
   * @returns True while one is.
   */
  public get isRunning(): boolean {
    return this.#child !== undefined;
  }

  /** Starts it; a manual start forgets the exits counted so far. */
  public start(): void {
    this.#isStopping = false;
    this.#policy.reset();
    this.#spawn();
  }

  /**
   * Stops it: SIGTERM, then SIGKILL when it does not leave in time.
   *
   * @returns Once it has exited.
   */
  public async stop(): Promise<void> {
    this.#isStopping = true;

    if (this.#restart !== undefined) {
      clearTimeout(this.#restart);
      this.#restart = undefined;
    }

    const child = this.#child;

    if (child === undefined) {
      this.#options.onState({ kind: 'stopped' });

      return;
    }

    const kill = setTimeout(() => {
      child.kill('SIGKILL');
    }, STOP_GRACE_MS);

    child.kill('SIGTERM');
    await this.#exited;
    clearTimeout(kill);
  }

  /** Spawns the process and follows it. */
  #spawn(): void {
    const spec = this.#spec;
    const child = (this.#options.spawn ?? spawn)(process.execPath, [spec.runner, spec.entry], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = this.logs.writer('stdout');
    const err = this.logs.writer('stderr');

    this.#child = child;
    this.#startedAtMs = Date.now();
    this.#options.onState({ kind: 'starting' });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      out.write(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      err.write(chunk);
    });

    this.#exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        out.flush();
        err.flush();
        this.#child = undefined;
        this.#exitedWith(code, signal);
        resolve();
      });
      child.once('error', (error) => {
        this.logs.push('stderr', `Could not start the package: ${error.message}`);
      });
    });
  }

  /**
   * Decides what follows an exit.
   *
   * @param code - Its exit code.
   * @param signal - The signal that ended it.
   */
  #exitedWith(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#isStopping) {
      this.#options.onState({ kind: 'stopped' });

      return;
    }

    const reason =
      this.logs.lastError() ??
      (signal === null ? `It exited with code ${String(code)}` : `It was ended by ${signal}`);
    const decision = this.#policy.exited(this.#startedAtMs);

    if (decision.kind === 'give-up') {
      this.#options.logger.warn(
        { package: this.#spec.id, exits: decision.exits, reason },
        'Gave up on a package that keeps exiting',
      );
      this.#options.onState({ kind: 'failed', reason });

      return;
    }

    this.#options.onState({ kind: 'exited', reason, willRestartInMs: decision.delayMs });
    this.#restart = setTimeout(() => {
      this.#restart = undefined;

      if (!this.#isStopping) {
        this.#spawn();
      }
    }, decision.delayMs);
    this.#restart.unref();
  }
}
