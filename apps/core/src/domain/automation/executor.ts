/**
 * Running an automation's `then`: an interpreter over its blocks.
 *
 * Actions run in order unless a block says otherwise (ARCHITECTURE.md §6.1). Each one is a step
 * in the trace, with when it started, how long it took, how it went and what it saw or did; a
 * control block records the branch it took before the blocks inside it run.
 *
 * How a run ends:
 * - **an action fails** - a command refused, a scene that does not exist - and the run fails
 *   with it. A scene that reached some of its members but not all is *partial*, and the run
 *   carries on: one lamp that did not answer must not stop "Good night" before it locks the door;
 * - **a wait times out**, which is recorded and the run carries on, as the block's own timeout
 *   says it should;
 * - **"End this run"**, which ends it as a success;
 * - **the signal aborts it**: the run went past its time, was replaced by a restart, or its
 *   automation was edited or removed.
 *
 * Loops are bounded twice over: an iteration cap per loop and an action budget per run, and each
 * time round a loop yields to the event loop, so a `while` whose condition never changes cannot
 * starve the rest of `core` while the run's own time runs out.
 *
 * Pure: everything the blocks reach - the clock, sleeping, the state of the house, commands,
 * scenes, other automations, packages - comes in through the ports.
 */
import type {
  AutomationAction,
  AutomationTrigger,
  BooleanTree,
  CapabilityName,
  JsonObject,
  TraceStep,
  TraceStepResult,
  TriggerOutcome,
} from '@nebulahome/contracts';

import type { ConditionOutcome } from './conditions.js';
import type { TraceRecorder } from './trace.js';

/** What the blocks reach the world through. */
export type ExecutorPorts = {
  readonly now: () => Date;

  /** Resolves after `ms`, or when the signal aborts. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  /** Lets the rest of the process run before carrying on. */
  readonly yieldTurn: () => Promise<void>;

  /** Evaluates a tree of checks against the house now. */
  readonly evaluate: (tree: BooleanTree, path: string) => ConditionOutcome;

  /** Resolves true once the tree holds, false when the timeout passes first. */
  readonly waitForCondition: (
    tree: BooleanTree,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<boolean>;

  /** Resolves true once the trigger fires, false when the timeout passes first. */
  readonly waitForTrigger: (
    trigger: AutomationTrigger,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<boolean>;

  /** Sends a command and resolves once it is accepted. */
  readonly command: (
    entityId: string,
    capability: CapabilityName,
    params: JsonObject,
    signal: AbortSignal,
  ) => Promise<void>;

  /** Applies a scene by key. */
  readonly applyScene: (sceneKey: string, signal: AbortSignal) => Promise<SceneOutcome>;

  /** Starts another automation by key; does not wait for it. */
  readonly startAutomation: (automationKey: string) => Promise<StartOutcome>;

  /** Calls a service of an installed package. */
  readonly callPackageService: (
    packageId: string,
    service: string,
    params: JsonObject,
    signal: AbortSignal,
  ) => Promise<void>;

  /** An entity's state as one word. */
  readonly stateTokenOf: (entityId: string) => string | undefined;
};

/** How applying a scene went. */
export type SceneOutcome =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly applied: number;
      readonly failed: number;
      readonly firstError: string | null;
    };

/** How starting another automation went. */
export type StartOutcome =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly outcome: TriggerOutcome;
      readonly reason?: string | undefined;
    };

/** The bounds of one run. */
export type ExecutorLimits = {
  /** How many times one loop may go round. */
  readonly maxIterations: number;

  /** How many blocks one run may execute in all. */
  readonly maxActions: number;
};

/** The default bounds. */
export const DEFAULT_EXECUTOR_LIMITS: ExecutorLimits = {
  maxIterations: 10_000,
  maxActions: 20_000,
};

/** Why a run was cut short from outside. */
export type AbortReason = 'timeout' | 'cancelled';

/** Thrown by "End this run": the run ends here, as a success. */
export class StopRun extends Error {
  /** Builds the signal. */
  public constructor() {
    super('The run was ended by an End this run block');
    this.name = 'StopRun';
  }
}

/** Thrown when a block fails: the run fails with it. */
export class ActionFailed extends Error {
  public readonly path: string;

  /**
   * Builds the failure.
   *
   * @param message - What went wrong.
   * @param path - The block that failed.
   */
  public constructor(message: string, path: string) {
    super(message);
    this.name = 'ActionFailed';
    this.path = path;
  }
}

/** Thrown when the signal aborted the run. */
export class RunAborted extends Error {
  public readonly reason: AbortReason;

  /**
   * Builds the abort.
   *
   * @param reason - Why.
   */
  public constructor(reason: AbortReason) {
    super(reason === 'timeout' ? 'The run took longer than it may' : 'The run was cancelled');
    this.name = 'RunAborted';
    this.reason = reason;
  }
}

/**
 * Why a signal aborted.
 *
 * @param signal - The signal.
 * @returns `timeout` when the run ran out of time, `cancelled` otherwise.
 */
export function abortReasonOf(signal: AbortSignal): AbortReason {
  return signal.reason === 'timeout' ? 'timeout' : 'cancelled';
}

/**
 * A short sentence for something thrown.
 *
 * @param error - What was thrown.
 * @returns Its message, bounded.
 */
function messageOf(error: unknown): string {
  const message = error instanceof Error && error.message.length > 0 ? error.message : 'Failed';

  return message.slice(0, 500);
}

/**
 * Formats a duration for a trace line.
 *
 * @param ms - Milliseconds.
 * @returns `500 ms`, `12 s`, `10 min`, `2 h`.
 */
export function durationWords(ms: number): string {
  if (ms < 1_000) {
    return `${String(ms)} ms`;
  }

  if (ms < 60_000) {
    return `${String(Math.round(ms / 1_000))} s`;
  }

  if (ms < 3_600_000) {
    return `${String(Math.round(ms / 60_000))} min`;
  }

  return `${String(Math.round(ms / 360_000) / 10)} h`;
}

/** Runs one run's blocks. */
export class Executor {
  readonly #ports: ExecutorPorts;
  readonly #trace: TraceRecorder;
  readonly #limits: ExecutorLimits;
  #executed = 0;

  /**
   * Builds an executor for one run.
   *
   * @param ports - What the blocks reach the world through.
   * @param trace - Where the steps go.
   * @param limits - The run's bounds.
   */
  public constructor(
    ports: ExecutorPorts,
    trace: TraceRecorder,
    limits: ExecutorLimits = DEFAULT_EXECUTOR_LIMITS,
  ) {
    this.#ports = ports;
    this.#trace = trace;
    this.#limits = limits;
  }

  /**
   * Runs a list of blocks in order.
   *
   * @param actions - The blocks.
   * @param path - The list's path: `then`, `then.2.else`.
   * @param signal - Aborts the run.
   * @throws {StopRun} When a block ends the run.
   * @throws {ActionFailed} When a block fails.
   * @throws {RunAborted} When the signal aborts.
   */
  public async run(
    actions: readonly AutomationAction[],
    path: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (const [index, action] of actions.entries()) {
      // In order, on purpose: that is what a list of blocks means.
      // eslint-disable-next-line no-await-in-loop -- see above
      await this.#action(action, `${path}.${String(index)}`, signal);
    }
  }

  /**
   * Records the steps of an evaluated tree.
   *
   * @param outcome - What the tree said.
   */
  #recordConditions(outcome: ConditionOutcome): void {
    const at = this.#ports.now();

    for (const step of outcome.steps) {
      this.#trace.add({ ...step, kind: 'condition', at, durationMs: 0 });
    }
  }

  /**
   * Records one action step.
   *
   * @param action - The block.
   * @param path - Where it is.
   * @param at - When it started.
   * @param result - How it went.
   * @param more - What it saw or did, and the entity it was about.
   */
  #record(
    action: AutomationAction,
    path: string,
    at: Date,
    result: TraceStepResult,
    more: Partial<Pick<TraceStep, 'detail' | 'error' | 'entityId'>> = {},
  ): void {
    this.#trace.add({
      path,
      kind: 'action',
      type: action.type,
      at,
      durationMs: Math.max(0, this.#ports.now().getTime() - at.getTime()),
      result,
      ...(more.entityId === undefined ? {} : { entityId: more.entityId }),
      ...(more.detail === undefined ? {} : { detail: more.detail.slice(0, 500) }),
      ...(more.error === undefined ? {} : { error: more.error.slice(0, 500) }),
    });
  }

  /**
   * Fails a block: records it, and returns the error for the caller to throw.
   *
   * @param action - The block.
   * @param path - Where it is.
   * @param at - When it started.
   * @param message - Why.
   * @param entityId - The entity it was about.
   * @returns The failure.
   */
  #fail(
    action: AutomationAction,
    path: string,
    at: Date,
    message: string,
    entityId?: string,
  ): ActionFailed {
    this.#record(action, path, at, 'failed', {
      error: message,
      ...(entityId === undefined ? {} : { entityId }),
    });

    return new ActionFailed(message, path);
  }

  /**
   * Throws when the signal has aborted.
   *
   * @param signal - The run's signal.
   * @throws {RunAborted} When it has.
   */
  #checkAbort(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new RunAborted(abortReasonOf(signal));
    }
  }

  /**
   * Waits for a port, turning what it throws into the run's end: aborted when the signal says
   * so, the block's failure otherwise.
   *
   * @param work - The port's promise.
   * @param action - The block.
   * @param path - Where it is.
   * @param at - When it started.
   * @param signal - The run's signal.
   * @returns What the port resolved to.
   * @throws {RunAborted} When the signal aborted.
   * @throws {ActionFailed} When the port failed.
   */
  async #await<T>(
    work: Promise<T>,
    action: AutomationAction,
    path: string,
    at: Date,
    signal: AbortSignal,
  ): Promise<T> {
    try {
      return await work;
    } catch (error: unknown) {
      this.#checkAbort(signal);

      throw this.#fail(action, path, at, messageOf(error));
    }
  }

  /**
   * Counts one block against the run's budget.
   *
   * @param action - The block.
   * @param path - Where it is.
   * @throws {ActionFailed} When the run has spent its budget.
   */
  #spend(action: AutomationAction, path: string): void {
    this.#executed += 1;

    if (this.#executed > this.#limits.maxActions) {
      throw this.#fail(
        action,
        path,
        this.#ports.now(),
        `Stopped after ${String(this.#limits.maxActions)} blocks in one run`,
      );
    }
  }

  /**
   * Runs one block.
   *
   * @param action - The block.
   * @param path - Where it is.
   * @param signal - Aborts the run.
   */
  async #action(action: AutomationAction, path: string, signal: AbortSignal): Promise<void> {
    this.#checkAbort(signal);
    this.#spend(action, path);

    const at = this.#ports.now();

    switch (action.type) {
      case 'command': {
        try {
          await this.#ports.command(
            action.entityId,
            action.capability as CapabilityName,
            action.params as JsonObject,
            signal,
          );
        } catch (error: unknown) {
          this.#checkAbort(signal);
          throw this.#fail(action, path, at, messageOf(error), action.entityId);
        }

        const name = action.params['command'];

        this.#record(action, path, at, 'ok', {
          entityId: action.entityId,
          detail: `sent ${typeof name === 'string' ? name : 'a command'}`,
        });

        return;
      }
      case 'scene': {
        let outcome: SceneOutcome;

        try {
          outcome = await this.#ports.applyScene(action.sceneKey, signal);
        } catch (error: unknown) {
          this.#checkAbort(signal);
          throw this.#fail(action, path, at, messageOf(error));
        }

        if (!outcome.found) {
          throw this.#fail(action, path, at, `No scene has the key ${action.sceneKey}`);
        }

        this.#checkAbort(signal);

        if (outcome.failed === 0) {
          this.#record(action, path, at, 'ok', {
            detail: `${action.sceneKey}: ${String(outcome.applied)} set`,
          });
        } else {
          this.#record(action, path, at, 'partial', {
            detail: `${action.sceneKey}: ${String(outcome.applied)} set, ${String(outcome.failed)} did not`,
            ...(outcome.firstError === null ? {} : { error: outcome.firstError }),
          });
        }

        return;
      }
      case 'automation': {
        const outcome = await this.#await(
          this.#ports.startAutomation(action.automationKey),
          action,
          path,
          at,
          signal,
        );

        if (!outcome.found) {
          throw this.#fail(action, path, at, `No automation has the key ${action.automationKey}`);
        }

        if (outcome.outcome === 'ignored') {
          this.#record(action, path, at, 'skipped', {
            detail: `${action.automationKey} did not start: ${outcome.reason ?? 'it was busy'}`,
          });
        } else {
          this.#record(action, path, at, 'ok', {
            detail: `${action.automationKey} ${outcome.outcome}`,
          });
        }

        return;
      }
      case 'wait_duration': {
        await this.#await(this.#ports.sleep(action.durationMs, signal), action, path, at, signal);
        this.#checkAbort(signal);
        this.#record(action, path, at, 'ok', {
          detail: `waited ${durationWords(action.durationMs)}`,
        });

        return;
      }
      case 'wait_for': {
        const holds = await this.#await(
          this.#ports.waitForCondition(action.condition, action.timeoutMs, signal),
          action,
          path,
          at,
          signal,
        );

        this.#checkAbort(signal);
        this.#record(action, path, at, holds ? 'ok' : 'timeout', {
          detail: holds ? 'the condition held' : `gave up after ${durationWords(action.timeoutMs)}`,
        });

        return;
      }
      case 'wait_for_trigger': {
        if (action.trigger.type === 'event') {
          throw this.#fail(action, path, at, 'Waiting for a device event is not available yet');
        }

        const fired = await this.#await(
          this.#ports.waitForTrigger(action.trigger, action.timeoutMs, signal),
          action,
          path,
          at,
          signal,
        );

        this.#checkAbort(signal);
        this.#record(action, path, at, fired ? 'ok' : 'timeout', {
          detail: fired ? 'it fired' : `gave up after ${durationWords(action.timeoutMs)}`,
        });

        return;
      }
      case 'notify': {
        throw this.#fail(action, path, at, 'Notifications are not available yet');
      }
      case 'package_service': {
        try {
          await this.#ports.callPackageService(
            action.packageId,
            action.service,
            action.params as JsonObject,
            signal,
          );
        } catch (error: unknown) {
          this.#checkAbort(signal);
          throw this.#fail(action, path, at, messageOf(error));
        }

        this.#record(action, path, at, 'ok', {
          detail: `called ${action.packageId} ${action.service}`,
        });

        return;
      }
      case 'sequence': {
        this.#record(action, path, at, 'ok', {
          detail: `${String(action.actions.length)} in order`,
        });
        await this.run(action.actions, `${path}.actions`, signal);

        return;
      }
      case 'parallel': {
        this.#record(action, path, at, 'ok', {
          detail: `${String(action.actions.length)} side by side`,
        });
        await this.#parallel(action.actions, `${path}.actions`, signal);

        return;
      }
      case 'if': {
        const outcome = this.#ports.evaluate(action.condition, `${path}.condition`);

        this.#recordConditions(outcome);
        this.#record(action, path, at, outcome.value ? 'true' : 'false', {
          detail: outcome.value ? 'then' : action.else === undefined ? 'no else' : 'else',
        });

        if (outcome.value) {
          await this.run(action.then, `${path}.then`, signal);
        } else if (action.else !== undefined) {
          await this.run(action.else, `${path}.else`, signal);
        }

        return;
      }
      case 'switch': {
        const token = this.#ports.stateTokenOf(action.entityId);
        const index = action.cases.findIndex((branch) => branch.value === token);
        const chosen = action.cases[index];

        this.#record(action, path, at, 'ok', {
          entityId: action.entityId,
          detail:
            chosen === undefined
              ? `is ${token ?? 'unknown'}: otherwise`
              : `is ${token ?? 'unknown'}: when "${chosen.value}"`,
        });

        if (chosen !== undefined) {
          await this.run(chosen.actions, `${path}.cases.${String(index)}`, signal);
        } else if (action.default !== undefined) {
          await this.run(action.default, `${path}.default`, signal);
        }

        return;
      }
      case 'while':
      case 'do_while': {
        await this.#loop(action, path, at, signal);

        return;
      }
      case 'for': {
        if (action.over.kind === 'each') {
          throw this.#fail(action, path, at, 'For each is not available yet');
        }

        this.#record(action, path, at, 'ok', { detail: `${String(action.over.count)} times` });

        if (action.over.count > this.#limits.maxIterations) {
          throw this.#fail(
            action,
            path,
            at,
            `Stopped: more than ${String(this.#limits.maxIterations)} times round`,
          );
        }

        for (let round = 0; round < action.over.count; round += 1) {
          // One round after another, which is what a loop is.
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.run(action.actions, `${path}.actions`, signal);
          // eslint-disable-next-line no-await-in-loop -- let the rest of core breathe
          await this.#ports.yieldTurn();
        }

        return;
      }
      case 'stop': {
        this.#record(action, path, at, 'ok', { detail: 'ended the run here' });

        throw new StopRun();
      }
    }
  }

  /**
   * Runs a while or do-while loop.
   *
   * @param action - The loop.
   * @param path - Where it is.
   * @param at - When it started.
   * @param signal - Aborts the run.
   */
  async #loop(
    action: Extract<AutomationAction, { type: 'while' | 'do_while' }>,
    path: string,
    at: Date,
    signal: AbortSignal,
  ): Promise<void> {
    let rounds = 0;

    this.#record(action, path, at, 'ok', {
      detail: action.type === 'while' ? 'checks, then runs' : 'runs, then checks',
    });

    for (;;) {
      if (action.type === 'while' || rounds > 0) {
        const outcome = this.#ports.evaluate(action.condition, `${path}.condition`);

        this.#recordConditions(outcome);

        if (!outcome.value) {
          return;
        }
      }

      if (rounds >= this.#limits.maxIterations) {
        throw this.#fail(
          action,
          path,
          at,
          `Stopped after ${String(this.#limits.maxIterations)} times round`,
        );
      }

      rounds += 1;
      // One round after another, which is what a loop is.
      // eslint-disable-next-line no-await-in-loop -- see above
      await this.run(action.actions, `${path}.actions`, signal);
      // eslint-disable-next-line no-await-in-loop -- let the rest of core breathe
      await this.#ports.yieldTurn();
    }
  }

  /**
   * Runs branches side by side; the first to fail or end the run stops the others.
   *
   * @param actions - One block per branch.
   * @param path - The branches' path.
   * @param signal - Aborts the run.
   */
  async #parallel(
    actions: readonly AutomationAction[],
    path: string,
    signal: AbortSignal,
  ): Promise<void> {
    const branches = new AbortController();

    /** Passes the run's abort on to the branches. */
    const forward = (): void => {
      branches.abort(signal.reason);
    };

    signal.addEventListener('abort', forward, { once: true });

    let first: unknown;

    try {
      await Promise.all(
        actions.map(async (action, index) => {
          try {
            await this.#action(action, `${path}.${String(index)}`, branches.signal);
          } catch (error: unknown) {
            if (first === undefined) {
              first = error;
              branches.abort('cancelled');
            }
          }
        }),
      );
    } finally {
      signal.removeEventListener('abort', forward);
    }

    this.#checkAbort(signal);

    if (first !== undefined) {
      throw first instanceof Error ? first : new Error('A branch failed');
    }
  }
}
