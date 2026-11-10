/**
 * Running the actions of an alias's parts: on a command that reaches a part, and when a part's
 * value changes.
 *
 * The steps are an automation's, run by the automation engine as a run no automation owns
 * ({@link RunActions}); what this keeps is the alias's side of it:
 *
 * - **one run per action**: a newer command or change stops the one still going (as an
 *   automation in restart mode would), so dragging a slider ends on the last value;
 * - **a guard**: an action that starts more than thirty times a minute is refused, which ends
 *   two aliases commanding each other back and forth;
 * - **"for at least"**: a change waits, and is dropped when the value leaves before the time;
 * - **the record**: every run is a row of `history.alias_action_runs`, which the alias's History
 *   lists and its page reads the last of.
 */
import { randomUUID } from 'node:crypto';

import {
  aliasCommandMatches,
  busSubjects,
  isBlockEnabled,
  type AliasAction,
  type AliasActionRunWhen,
  type AliasBinding,
  type AliasPartDef,
  type ChangeContext,
  type JsonObject,
  type JsonValue,
  type LibraryEvent,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { changeFires, changeHolds, resolveFormulas } from '../domain/alias-actions.js';
import type { AliasDefinition } from '../domain/alias-catalog.js';
import type { PartValue } from '../domain/alias-values.js';
import { LoopGuard } from '../domain/automation/run-rules.js';

import type { ActionsRunOutcome, ActionsRunRequest } from './automation-engine.js';

/** Runs the steps of an action: the automation engine's {@link AutomationEngine.runActions}. */
export type RunActions = (request: ActionsRunRequest) => Promise<ActionsRunOutcome | undefined>;

/** How long one run of an action may take. */
export const ALIAS_ACTION_MAX_MS = 300_000;

/** What the runner needs. */
export type AliasActionsOptions = {
  readonly db: Database;
  readonly logger: PlatformLogger;

  /** Runs the steps; without it (a `core` that runs no automations) actions do nothing. */
  readonly run?: RunActions | undefined;

  /** An entity's reading, for a name a formula reads. */
  readonly bind: (name: string) => AliasBinding;

  /** Says a run ended, for the page to read its action's last run again. */
  readonly publish: (subject: string, event: LibraryEvent) => void;
};

/** One action of one part, with what started it. */
type Start = {
  readonly alias: AliasDefinition;
  readonly part: string;
  readonly action: AliasAction;
  readonly when: AliasActionRunWhen;
  readonly origin: ChangeContext | undefined;

  /** The command that started it, whose values its formulas read. */
  readonly command?: JsonObject | undefined;
};

/**
 * The key a run and a wait are kept under.
 *
 * @param aliasId - The alias.
 * @param part - The part.
 * @param actionId - The action.
 * @returns The key.
 */
const keyOf = (aliasId: string, part: string, actionId: string): string =>
  `${aliasId}\u0000${part}\u0000${actionId}`;

/** Runs, guards, waits and records the actions of every alias. */
export class AliasActions {
  readonly #options: AliasActionsOptions;
  readonly #runs = new Map<string, AbortController>();
  readonly #holds = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #guard = new LoopGuard();

  /**
   * @param options - Collaborators.
   */
  public constructor(options: AliasActionsOptions) {
    this.#options = options;
  }

  /**
   * The actions a command starts, by part: those of the parts it touches with its name and a
   * match that holds.
   *
   * A command an alias's own action sent to it starts none: it does what it would with no action,
   * or the alias would answer itself forever.
   *
   * @param alias - The alias.
   * @param touched - The parts the command touches.
   * @param command - The command.
   * @param context - What sent it.
   * @returns The actions of each part that has some, by part key.
   */
  public forCommand(
    alias: AliasDefinition,
    touched: readonly AliasPartDef[],
    command: JsonObject,
    context: ChangeContext | undefined,
  ): Map<string, AliasAction[]> {
    const found = new Map<string, AliasAction[]>();

    if (this.#options.run === undefined || (context?.type === 'alias' && context.id === alias.id)) {
      return found;
    }

    for (const def of touched) {
      const actions = (alias.parts[def.key]?.actions ?? []).filter(
        (action) => isBlockEnabled(action) && aliasCommandMatches(action.when, command),
      );

      if (actions.length > 0) {
        found.set(def.key, actions);
      }
    }

    return found;
  }

  /**
   * Starts the actions a command found, without waiting for them: the command is answered now.
   *
   * @param alias - The alias.
   * @param found - The actions, by part.
   * @param command - The command.
   * @param context - What sent it.
   */
  public startForCommand(
    alias: AliasDefinition,
    found: ReadonlyMap<string, readonly AliasAction[]>,
    command: JsonObject,
    context: ChangeContext | undefined,
  ): void {
    for (const [part, actions] of found) {
      for (const action of actions) {
        this.#start({
          alias,
          part,
          action,
          when: { kind: 'command', command },
          origin: context,
          command,
        });
      }
    }
  }

  /**
   * Starts the actions a run of an alias's values sets off: each part's changes, compared with
   * its value before. A change with "for at least" waits; one whose value left meanwhile is
   * dropped.
   *
   * @param alias - The alias.
   * @param before - Each part's value before the run.
   * @param after - Each part's value now.
   * @param context - What caused the run.
   */
  public onValues(
    alias: AliasDefinition,
    before: (def: AliasPartDef) => PartValue | undefined,
    after: ReadonlyMap<string, PartValue>,
    context: ChangeContext | undefined,
  ): void {
    if (this.#options.run === undefined) {
      return;
    }

    for (const def of alias.defs) {
      const changes = (alias.parts[def.key]?.actions ?? []).filter(
        (action) => action.when.kind === 'change' && isBlockEnabled(action),
      );

      if (changes.length === 0) {
        continue;
      }

      const was = before(def);
      const now = after.get(def.key);

      for (const action of changes) {
        if (action.when.kind !== 'change') {
          continue;
        }

        const key = keyOf(alias.id, def.key, action.id);
        const hold = this.#holds.get(key);

        if (hold !== undefined && !changeHolds(action.when.change, now)) {
          clearTimeout(hold);
          this.#holds.delete(key);
        }

        // The first values after `core` starts are not a change: there is nothing before them.
        if (was === undefined || !changeFires(action.when.change, was, now)) {
          continue;
        }

        const start: Start = {
          alias,
          part: def.key,
          action,
          when: {
            kind: 'change',
            from: (was ?? null) as JsonValue,
            to: (now ?? null) as JsonValue,
          },
          origin: context,
        };
        const forMs = action.when.forMs ?? 0;

        if (forMs <= 0) {
          this.#start(start);
        } else if (!this.#holds.has(key)) {
          const timer = setTimeout(() => {
            this.#holds.delete(key);
            this.#start(start);
          }, forMs);

          timer.unref();
          this.#holds.set(key, timer);
        }
      }
    }
  }

  /**
   * Stops every run and wait of an alias that changed or went: an edit is a new setup, and the
   * runs of the old one end with it.
   *
   * @param aliasId - The alias.
   */
  public forget(aliasId: string): void {
    const prefix = `${aliasId}\u0000`;

    for (const [key, controller] of this.#runs) {
      if (key.startsWith(prefix)) {
        controller.abort('cancelled');
        this.#runs.delete(key);
      }
    }

    for (const [key, timer] of this.#holds) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.#holds.delete(key);
      }
    }
  }

  /** Stops everything: `core` is shutting down. */
  public stop(): void {
    for (const controller of this.#runs.values()) {
      controller.abort('cancelled');
    }

    for (const timer of this.#holds.values()) {
      clearTimeout(timer);
    }

    this.#runs.clear();
    this.#holds.clear();
  }

  /**
   * Starts one run of an action, replacing the one still going, unless the guard refuses it.
   *
   * @param start - The action and what started it.
   */
  #start(start: Start): void {
    const run = this.#options.run;

    if (run === undefined) {
      return;
    }

    const key = keyOf(start.alias.id, start.part, start.action.id);
    const admitted = this.#guard.admit(key, [], Date.now());

    if (!admitted.ok) {
      const now = new Date();

      this.#options.logger.warn(
        { aliasId: start.alias.id, part: start.part, action: start.action.id },
        admitted.reason,
      );
      void this.#record(start, randomUUID(), {
        result: 'cancelled',
        error: admitted.reason,
        steps: [],
        startedAt: now,
        finishedAt: now,
      });

      return;
    }

    this.#runs.get(key)?.abort('cancelled');

    const controller = new AbortController();
    const id = randomUUID();

    this.#runs.set(key, controller);

    void run({
      steps: start.action.then,
      context: { type: 'alias', id: start.alias.id },
      startedBy: { kind: 'alias', aliasId: start.alias.id, part: start.part },
      signal: controller.signal,
      maxMs: ALIAS_ACTION_MAX_MS,
      /**
       * Fills in the formulas of a command just before it is sent.
       *
       * @param capability - The capability commanded.
       * @param params - The command body.
       * @returns It, plain.
       */
      resolveParams: (capability, params) =>
        resolveFormulas(capability, params, start.command, this.#options.bind),
    })
      .then(async (outcome) => {
        if (outcome !== undefined) {
          await this.#record(start, id, outcome);
        }
      })
      .catch((cause: unknown) => {
        this.#options.logger.warn(
          { err: cause, aliasId: start.alias.id, part: start.part, action: start.action.id },
          'An alias action could not run',
        );
      })
      .finally(() => {
        if (this.#runs.get(key) === controller) {
          this.#runs.delete(key);
        }
      });
  }

  /**
   * Writes a run's row and says it ended.
   *
   * @param start - The action and what started it.
   * @param id - The run's id.
   * @param outcome - How it went.
   */
  async #record(start: Start, id: string, outcome: ActionsRunOutcome): Promise<void> {
    try {
      await this.#options.db.insert(schema.history.aliasActionRuns).values({
        id,
        time: outcome.startedAt,
        aliasId: start.alias.id,
        part: start.part,
        actionId: start.action.id,
        when: start.when,
        origin: start.origin ?? { type: 'alias', id: start.alias.id },
        result: outcome.result,
        finishedAt: outcome.finishedAt,
        durationMs: Math.max(0, outcome.finishedAt.getTime() - outcome.startedAt.getTime()),
        trace: outcome.steps,
        error: outcome.error,
      });
    } catch (cause: unknown) {
      this.#options.logger.warn(
        { err: cause, aliasId: start.alias.id },
        'Could not keep the run of an alias action',
      );

      return;
    }

    this.#options.publish(busSubjects.libraryEvent(), { kind: 'aliases' });
  }
}
