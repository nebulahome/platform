/**
 * Whether the installation is being restored, as `api` knows it.
 *
 * The `backup` service announces every change on `nebula.v1.event.maintenance`; `api` also asks
 * it once at start, since an `api` restarted in the middle of a restore - which the restore
 * itself does - must still answer 503 until it ends. While it is restoring every request but a
 * handful is refused (server.ts); once it has restored, the access tokens issued before the
 * switch are refused too - the users, roles and sessions are the archive's now. What `api` holds
 * in memory needs no clearing: the restore starts it again, on the restored database.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  BACKUP_METHODS,
  BACKUP_SERVICE,
  backupStatusSchema,
  busSubjects,
  maintenanceStateSchema,
  type MaintenanceState,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { Authenticator } from '../auth/authenticator.js';

import { lastRestoreAt } from './backup.js';

/** No maintenance, and no restore to speak of. */
export const NO_MAINTENANCE: MaintenanceState = {
  state: 'normal',
  runId: null,
  phase: null,
  percent: null,
  outcome: null,
  message: null,
  tokensInvalidBefore: null,
};

/** How long `api` waits, at start, for `backup` to say whether a restore is running. */
const STARTUP_ASK_TIMEOUT_MS = 3000;

/** What the monitor needs. */
export type MaintenanceMonitorOptions = {
  readonly authenticator: Authenticator;
  readonly logger: PlatformLogger;
};

/** The installation's maintenance state, as `api` knows it. */
export class MaintenanceMonitor {
  readonly #options: MaintenanceMonitorOptions;
  #state: MaintenanceState = NO_MAINTENANCE;
  #subscription: BusSubscription | null = null;

  /**
   * @param options - See {@link MaintenanceMonitorOptions}.
   */
  public constructor(options: MaintenanceMonitorOptions) {
    this.#options = options;
  }

  /**
   * The state now.
   *
   * @returns The state.
   */
  public get state(): MaintenanceState {
    return this.#state;
  }

  /**
   * Whether requests are refused.
   *
   * @returns True while a restore runs.
   */
  public get isRestoring(): boolean {
    return this.#state.state === 'restoring';
  }

  /**
   * Takes a new state, and refuses the tokens issued before a restore.
   *
   * @param state - The state.
   */
  public apply(state: MaintenanceState): void {
    const wasRestoring = this.isRestoring;

    this.#state = state;

    if (state.tokensInvalidBefore !== null) {
      this.#options.authenticator.rejectTokensIssuedBefore(state.tokensInvalidBefore);
    }

    if (wasRestoring && state.state === 'normal') {
      this.#options.logger.info(
        { runId: state.runId, outcome: state.outcome },
        'The restore ended',
      );
    }
  }

  /**
   * Starts following the state: the cutoff of the last restore, what `backup` says now, and
   * every change it announces.
   *
   * @param bus - The bus, or undefined when it is away.
   * @param db - The database, for the last restore.
   */
  public async start(bus: BusClient | undefined, db: Database): Promise<void> {
    const restoredAt = await lastRestoreAt(db).catch(() => null);

    if (restoredAt !== null) {
      this.#options.authenticator.rejectTokensIssuedBefore(restoredAt);
    }

    if (bus === undefined) {
      return;
    }

    this.#subscription = bus.subscribe(
      busSubjects.maintenanceEvent(),
      maintenanceStateSchema,
      async (state) => {
        this.apply(state);

        return Promise.resolve();
      },
    );

    try {
      const status = await bus.request(
        busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.status),
        {},
        backupStatusSchema,
        { timeoutMs: STARTUP_ASK_TIMEOUT_MS },
      );

      this.apply(status.maintenance);
    } catch {
      // No backup service answering: nothing is being restored.
    }
  }

  /** Stops following. */
  public stop(): void {
    this.#subscription?.unsubscribe();
    this.#subscription = null;
  }
}
