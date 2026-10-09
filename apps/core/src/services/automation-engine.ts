/**
 * The automation engine: what wakes automations, and what runs them (ARCHITECTURE.md §6.1).
 *
 * It holds every enabled automation, an index from each entity to the automations whose triggers
 * watch it, and a timer for every time trigger and every hold. Things happening reach it three
 * ways - a change of an entity (handed over by the ingest pipeline), a timer, and somebody pressing
 * Run - and each is turned into an event for the trigger tree in `domain/automation`. When a tree
 * fires, the automation's mode and the loop guard decide whether a run starts; a run checks `if`,
 * runs `then` through the interpreter, and writes one row to `history.automation_runs` with its
 * trace. Commands carry the run as their cause, so the change they produce says which run made
 * it - which is how history answers "why did this light turn on" and how the loop guard sees an
 * automation waking itself.
 *
 * The hot path is the ingest pipeline's, and this engine never blocks it: a change is queued and
 * looked at once the pipeline has moved on. For a short while after `core` starts, changes wake
 * nothing: the adapters are resynchronising, and a light that changed while `core` was down
 * reporting in is not a light turning on now.
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  flattenTriggers,
  isNebulaError,
  stateTokenOf,
  UNAVAILABLE_TRIGGER_TYPES,
  type AutomationEvent,
  type AutomationRunResult,
  type AutomationRunTrigger,
  type AutomationTrigger,
  type BooleanTree,
  type ChangeContext,
  type EntityId,
  type EntityState,
  type RemoveAutomationReply,
  type SyncAutomationReply,
  type SyncHouseReply,
  type TraceStep,
  type TriggerAutomationReply,
  type TriggerTree,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import {
  dependsOnClock,
  entitiesOfConditions,
  evaluateConditions,
  isOccupied,
  type ConditionContext,
} from '../domain/automation/conditions.js';
import { areasOfDefinition } from '../domain/automation/definition-walk.js';
import {
  ActionFailed,
  Executor,
  RunAborted,
  StopRun,
  type ExecutorPorts,
} from '../domain/automation/executor.js';
import { decideMode, LoopGuard } from '../domain/automation/run-rules.js';
import { nextFire, type House } from '../domain/automation/schedule.js';
import { TraceRecorder } from '../domain/automation/trace.js';
import {
  entitiesOfTriggers,
  reactTriggers,
  triggerLeaves,
  type TriggerEvent,
} from '../domain/automation/trigger-match.js';
import type { EntityRegistry, IngestResult } from '../domain/entity-registry.js';
import {
  automationIdByKey,
  insertRun,
  loadAutomation,
  loadAutomations,
  loadHouse,
  loadOccupancySensors,
  markTriggered,
  type AutomationRecord,
} from '../persistence/automation-store.js';

import type { CommandDispatcher } from './command-dispatch.js';
import type { SceneEngine } from './scene-engine.js';

/** What the engine needs. */
export type AutomationEngineOptions = {
  readonly db: Database;
  readonly client: BusClient;

  /** The live states triggers and checks read. */
  readonly registry: EntityRegistry;

  /** How commands go out. */
  readonly dispatcher: CommandDispatcher;

  /** How scenes are applied. */
  readonly scenes: SceneEngine;

  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;

  /** The clock. */
  readonly now?: () => Date;
};

/** How long a timer is set for at most; past it, the next moment is worked out again. */
const MAX_TIMER_MS = 3_600_000;

/** How long an area's sensor list is kept before it is read again. */
const OCCUPANCY_TTL_MS = 30_000;

/** How often a wait on a check that depends on the clock looks again. */
const CLOCK_RECHECK_MS = 15_000;

/** How long a package service has to answer. */
const PACKAGE_SERVICE_TIMEOUT_MS = 30_000;

/** How long a finished run is remembered, so the changes its last commands cause are its. */
const RUN_MEMORY_MS = 15_000;

/** One run that is going. */
type RunHandle = {
  readonly runId: string;
  readonly controller: AbortController;
  done: Promise<void>;
};

/** A run waiting its turn, for a queued automation. */
type PendingRun = {
  readonly runId: string;
  readonly trigger: AutomationRunTrigger;
  readonly chain: readonly string[];
};

/** Everything the engine keeps for one automation. */
type Slot = {
  record: AutomationRecord;
  readonly running: Set<RunHandle>;
  readonly queue: PendingRun[];
  readonly holds: Map<string, NodeJS.Timeout>;
  readonly times: Map<string, NodeJS.Timeout>;
  problems: string[];
};

/** A run listening for changes: a wait for a condition or a trigger. */
type Waiter = (result: IngestResult) => void;

/** What a run that ended or was refused says about itself. */
type RunEnding = {
  readonly result: AutomationRunResult;
  readonly error: string | null;
};

/**
 * Whether two automations would run the same: their documents, their modes and their limits.
 *
 * @param left - One.
 * @param right - The other.
 * @returns True when an edit between them changed nothing a run depends on.
 */
function runsTheSame(left: AutomationRecord, right: AutomationRecord): boolean {
  return (
    left.mode === right.mode &&
    left.maxRuntimeMs === right.maxRuntimeMs &&
    JSON.stringify(left.definition) === JSON.stringify(right.definition)
  );
}

/**
 * A short sentence for something thrown.
 *
 * @param error - What was thrown.
 * @returns Its message, bounded.
 */
function messageOf(error: unknown): string {
  const message =
    isNebulaError(error) || error instanceof Error ? error.message : 'Something went wrong';

  return message.slice(0, 500);
}

/**
 * What a trigger that fired saw, for the trace.
 *
 * @param trigger - The trigger.
 * @returns A line.
 */
function triggerDetail(trigger: AutomationRunTrigger): string {
  switch (trigger.kind) {
    case 'state': {
      return `${trigger.from ?? 'something'} → ${trigger.to ?? 'something'}`;
    }
    case 'numeric_state': {
      return trigger.value === undefined ? 'crossed' : `reads ${String(trigger.value)}`;
    }
    case 'time': {
      return 'its time came';
    }
    case 'manual': {
      return trigger.userId === undefined ? 'run by hand' : 'run from its Run button';
    }
    case 'automation': {
      return 'started by another automation';
    }
  }
}

/** The automation engine. */
export class AutomationEngine {
  readonly #options: AutomationEngineOptions;
  readonly #now: () => Date;
  readonly #slots = new Map<string, Slot>();
  readonly #byEntity = new Map<string, Set<string>>();
  readonly #byKey = new Map<string, string>();
  readonly #runs = new Map<string, { automationId: string; chain: readonly string[] }>();
  readonly #waiters = new Set<Waiter>();
  readonly #occupancy = new Map<string, { sensors: string[]; until: number }>();
  readonly #guard = new LoopGuard();
  readonly #refusedAt = new Map<string, number>();
  #house: House = { timeZone: 'UTC', position: null };

  /**
   * The live state of an entity.
   *
   * @param entityId - The entity.
   * @returns Its state, or undefined when it never reported.
   */
  readonly #stateOf = (entityId: string): EntityState | undefined =>
    this.#options.registry.get(entityId as EntityId);
  #isLive = false;
  #isStopped = false;

  /**
   * Builds the engine without loading anything.
   *
   * @param options - The database, the bus, the registry, the dispatcher and the scene engine.
   */
  public constructor(options: AutomationEngineOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Loads the house and every enabled automation, and arms the time triggers.
   *
   * @returns How many automations were loaded.
   */
  public async load(): Promise<number> {
    this.#house = await loadHouse(this.#options.db);

    for (const record of await loadAutomations(this.#options.db, this.#options.logger)) {
      this.#install(record);
    }

    return this.#slots.size;
  }

  /**
   * Starts letting changes wake automations: the adapters have resynchronised.
   */
  public goLive(): void {
    if (!this.#isLive) {
      this.#isLive = true;
      this.#options.logger.info({ automations: this.#slots.size }, 'Automations are listening');
    }
  }

  /**
   * The automations loaded, for tests.
   *
   * @returns Their ids.
   */
  public get loaded(): string[] {
    return [...this.#slots.keys()];
  }

  /**
   * Takes in an automation the API has just written or changed.
   *
   * An edit to what it does, how it runs or for how long cancels its running runs; one to its
   * name or description leaves them alone. A disabled automation is let go.
   *
   * @param automationId - Which.
   * @returns Whether it is loaded, and what it cannot do.
   */
  public async sync(automationId: string): Promise<SyncAutomationReply> {
    const record = await loadAutomation(this.#options.db, automationId, this.#options.logger);

    if (record?.isEnabled !== true) {
      this.#uninstall(automationId);

      return { isLoaded: false, problems: [] };
    }

    const slot = this.#slots.get(automationId);

    if (slot !== undefined && runsTheSame(slot.record, record)) {
      this.#byKey.delete(slot.record.key);
      slot.record = record;
      this.#byKey.set(record.key, record.id);

      return { isLoaded: true, problems: slot.problems };
    }

    this.#uninstall(automationId);

    const installed = this.#install(record);

    return { isLoaded: true, problems: installed.problems };
  }

  /**
   * Forgets an automation, cancelling its runs.
   *
   * @param automationId - Which.
   * @returns What was forgotten.
   */
  public remove(automationId: string): RemoveAutomationReply {
    this.#uninstall(automationId);
    this.#guard.forget(automationId);

    return { automationId };
  }

  /**
   * Reads the house again and re-arms every time trigger by it.
   *
   * @returns The zone and whether a position is known.
   */
  public async syncHouse(): Promise<SyncHouseReply> {
    this.#house = await loadHouse(this.#options.db);

    for (const slot of this.#slots.values()) {
      this.#armTimes(slot);
    }

    return { timeZone: this.#house.timeZone, hasPosition: this.#house.position !== null };
  }

  /**
   * Hands the engine a change. Never blocks and never throws: the change is looked at once the
   * ingest pipeline has moved on.
   *
   * @param result - What changed.
   */
  public onStateChanged(result: IngestResult): void {
    if (this.#isStopped) {
      return;
    }

    queueMicrotask(() => {
      try {
        this.#handleChange(result);
      } catch (error: unknown) {
        this.#options.logger.error(
          { err: error, entityId: result.entityId },
          'Automation engine failed on a change',
        );
      }
    });
  }

  /**
   * Runs an automation now, through its mode and its checks, as its Run button does.
   *
   * @param automationId - Which.
   * @param userId - Who pressed Run.
   * @returns What became of it.
   */
  public trigger(automationId: string, userId?: string): TriggerAutomationReply {
    const slot = this.#slots.get(automationId);

    if (slot === undefined) {
      return { runId: null, outcome: 'ignored', reason: 'It is turned off, or not loaded' };
    }

    return this.#wake(slot, { kind: 'manual', ...(userId === undefined ? {} : { userId }) }, []);
  }

  /**
   * Cancels every run, disarms every timer and waits for the cancelled runs to be written.
   *
   * @returns A promise that settles once every run has ended.
   */
  public async stop(): Promise<void> {
    this.#isStopped = true;

    const done: Promise<void>[] = [];

    for (const slot of this.#slots.values()) {
      slot.queue.length = 0;
      this.#disarm(slot);

      for (const run of slot.running) {
        run.controller.abort('cancelled');
        done.push(run.done);
      }
    }

    await Promise.allSettled(done);
  }

  // --- installing ------------------------------------------------------------------------

  /**
   * Holds an automation and arms its triggers.
   *
   * @param record - The automation.
   * @returns Its slot.
   */
  #install(record: AutomationRecord): Slot {
    const slot: Slot = {
      record,
      running: new Set(),
      queue: [],
      holds: new Map(),
      times: new Map(),
      problems: [],
    };

    this.#slots.set(record.id, slot);
    this.#byKey.set(record.key, record.id);

    for (const entityId of entitiesOfTriggers(record.definition.triggers)) {
      let watching = this.#byEntity.get(entityId);

      if (watching === undefined) {
        watching = new Set();
        this.#byEntity.set(entityId, watching);
      }

      watching.add(record.id);
    }

    this.#armTimes(slot);

    return slot;
  }

  /**
   * Lets an automation go: cancels its runs, disarms its timers, drops it from the indexes.
   *
   * @param automationId - Which.
   */
  #uninstall(automationId: string): void {
    const slot = this.#slots.get(automationId);

    if (slot === undefined) {
      return;
    }

    slot.queue.length = 0;
    this.#disarm(slot);

    for (const run of slot.running) {
      run.controller.abort('cancelled');
    }

    for (const watching of this.#byEntity.values()) {
      watching.delete(automationId);
    }

    this.#byKey.delete(slot.record.key);
    this.#slots.delete(automationId);
  }

  /**
   * Clears every timer an automation holds.
   *
   * @param slot - The automation.
   */
  #disarm(slot: Slot): void {
    for (const timer of [...slot.holds.values(), ...slot.times.values()]) {
      clearTimeout(timer);
    }

    slot.holds.clear();
    slot.times.clear();
  }

  /**
   * Arms a timer for every time trigger of an automation, and lists what it cannot do.
   *
   * @param slot - The automation.
   */
  #armTimes(slot: Slot): void {
    for (const timer of slot.times.values()) {
      clearTimeout(timer);
    }

    slot.times.clear();
    slot.problems = [];

    for (const { path, leaf } of triggerLeaves(slot.record.definition.triggers)) {
      if ((UNAVAILABLE_TRIGGER_TYPES as readonly string[]).includes(leaf.type)) {
        slot.problems.push('A device event trigger never fires yet: nothing reports device events');
      }

      if (leaf.type === 'time') {
        this.#armTime(slot, path, leaf, this.#now());
      }
    }

    if (slot.problems.length > 0) {
      this.#options.logger.warn(
        { automation: slot.record.key, problems: slot.problems },
        'An automation has triggers that cannot fire',
      );
    }
  }

  /**
   * Arms one time trigger for its next moment after an instant.
   *
   * @param slot - The automation.
   * @param path - The trigger's path.
   * @param leaf - The trigger.
   * @param after - The instant to look past.
   */
  #armTime(
    slot: Slot,
    path: string,
    leaf: Extract<AutomationTrigger, { type: 'time' }>,
    after: Date,
  ): void {
    const next = nextFire(leaf.at, this.#house, after);

    if ('problem' in next) {
      slot.problems.push(next.problem);

      return;
    }

    this.#armUntil(slot, path, leaf, next.at);
  }

  /**
   * Sets the timer for a moment, at most an hour ahead, then again until it comes.
   *
   * @param slot - The automation.
   * @param path - The trigger's path.
   * @param leaf - The trigger.
   * @param at - The moment.
   */
  #armUntil(
    slot: Slot,
    path: string,
    leaf: Extract<AutomationTrigger, { type: 'time' }>,
    at: Date,
  ): void {
    const delay = Math.max(0, at.getTime() - this.#now().getTime());

    slot.times.set(
      path,
      setTimeout(
        () => {
          slot.times.delete(path);

          if (this.#slots.get(slot.record.id) !== slot) {
            return;
          }

          if (this.#now().getTime() < at.getTime()) {
            this.#armUntil(slot, path, leaf, at);

            return;
          }

          this.#react(slot, { kind: 'time', path }, []);
          this.#armTime(slot, path, leaf, at);
        },
        Math.min(delay, MAX_TIMER_MS),
      ),
    );
  }

  // --- reacting --------------------------------------------------------------------------

  /**
   * Looks at one change: the waits listening for it, and the automations it may wake.
   *
   * @param result - What changed.
   */
  #handleChange(result: IngestResult): void {
    for (const waiter of [...this.#waiters]) {
      waiter(result);
    }

    if (!this.#isLive) {
      return;
    }

    const watching = this.#byEntity.get(result.entityId);

    if (watching === undefined || watching.size === 0) {
      return;
    }

    const event: TriggerEvent = {
      kind: 'state',
      entityId: result.entityId,
      previous: result.previous,
      current: result.current,
    };
    const chain = this.#chainOf(result.current.context);

    for (const automationId of watching) {
      const slot = this.#slots.get(automationId);

      if (slot !== undefined) {
        this.#react(slot, event, chain);
      }
    }
  }

  /**
   * The chain of automations a change came out of, from the run that caused it.
   *
   * @param context - The change's cause.
   * @returns The automations, oldest first; empty when no automation caused it.
   */
  #chainOf(context: ChangeContext | undefined): string[] {
    if (context?.type !== 'automation' || context.id === undefined) {
      return [];
    }

    const run = this.#runs.get(context.id);

    return run === undefined ? [] : [...run.chain, run.automationId];
  }

  /**
   * Hands an event to an automation's trigger tree and acts on what it says.
   *
   * @param slot - The automation.
   * @param event - What happened.
   * @param chain - The automations that led to it.
   */
  #react(slot: Slot, event: TriggerEvent, chain: readonly string[]): void {
    const reaction = reactTriggers(slot.record.definition.triggers, event, {
      stateOf: this.#stateOf,
      now: this.#now(),
    });

    for (const path of reaction.cancels) {
      const timer = slot.holds.get(path);

      if (timer !== undefined) {
        clearTimeout(timer);
        slot.holds.delete(path);
      }
    }

    for (const hold of reaction.holds) {
      slot.holds.set(
        hold.path,
        setTimeout(() => {
          slot.holds.delete(hold.path);

          if (this.#slots.get(slot.record.id) === slot) {
            this.#react(
              slot,
              { kind: 'hold', path: hold.path, expectToken: hold.expectToken },
              chain,
            );
          }
        }, hold.ms),
      );
    }

    if (reaction.fired !== null) {
      this.#wake(slot, reaction.fired, chain);
    }
  }

  // --- running ---------------------------------------------------------------------------

  /**
   * Wakes an automation: its mode and the loop guard decide whether a run starts.
   *
   * @param slot - The automation.
   * @param trigger - What woke it.
   * @param chain - The automations that led to it.
   * @returns What became of the wake.
   */
  #wake(
    slot: Slot,
    trigger: AutomationRunTrigger,
    chain: readonly string[],
  ): TriggerAutomationReply {
    const { record } = slot;
    const decision = decideMode(record.mode, slot.running.size, slot.queue.length);

    if (decision === 'drop') {
      this.#options.logger.debug(
        { automation: record.key },
        'Already running; the wake is dropped',
      );

      return { runId: null, outcome: 'ignored', reason: 'It is already running' };
    }

    const guard = this.#guard.admit(record.id, chain, this.#now().getTime());

    if (!guard.ok) {
      this.#refuse(slot, trigger, guard.reason);

      return { runId: null, outcome: 'ignored', reason: guard.reason };
    }

    const runId = randomUUID();

    if (decision === 'queue') {
      slot.queue.push({ runId, trigger, chain });

      return { runId, outcome: 'queued' };
    }

    if (decision === 'restart') {
      for (const run of slot.running) {
        run.controller.abort('cancelled');
      }
    }

    this.#start(slot, runId, trigger, chain);

    return { runId, outcome: 'started' };
  }

  /**
   * Records a run the loop guard refused, once a minute at most, so the list can say why the
   * automation stopped running without a row for every refusal.
   *
   * @param slot - The automation.
   * @param trigger - What woke it.
   * @param reason - Why it was refused.
   */
  #refuse(slot: Slot, trigger: AutomationRunTrigger, reason: string): void {
    const now = this.#now();
    const last = this.#refusedAt.get(slot.record.id) ?? 0;

    this.#options.logger.warn({ automation: slot.record.key, reason }, 'A run was refused');

    if (now.getTime() - last < 60_000) {
      return;
    }

    this.#refusedAt.set(slot.record.id, now.getTime());

    const runId = randomUUID();

    this.#finish(slot.record, runId, trigger, now, [], { result: 'failed', error: reason });
  }

  /**
   * Starts a run.
   *
   * @param slot - The automation.
   * @param runId - The run's id.
   * @param trigger - What woke it.
   * @param chain - The automations that led to it.
   */
  #start(slot: Slot, runId: string, trigger: AutomationRunTrigger, chain: readonly string[]): void {
    const { record } = slot;
    const controller = new AbortController();
    const startedAt = this.#now();
    const timeout = setTimeout(() => {
      controller.abort('timeout');
    }, record.maxRuntimeMs);
    const handle: RunHandle = { runId, controller, done: Promise.resolve() };

    this.#runs.set(runId, { automationId: record.id, chain });
    slot.running.add(handle);
    this.#announce(record.id, { kind: 'started', runId, time: startedAt });

    markTriggered(this.#options.db, record.id, startedAt).catch((error: unknown) => {
      this.#options.logger.warn(
        { err: error, automation: record.key },
        'Could not record a trigger',
      );
    });

    handle.done = this.#execute(record, runId, trigger, chain, controller.signal, startedAt)
      .catch((error: unknown) => {
        this.#options.logger.error(
          { err: error, automation: record.key },
          'A run failed outside its steps',
        );
      })
      .finally(() => {
        clearTimeout(timeout);
        slot.running.delete(handle);
        setTimeout(() => {
          this.#runs.delete(runId);
        }, RUN_MEMORY_MS).unref();
        this.#drain(slot);
      });
  }

  /**
   * Starts the next queued run, when there is one and nothing is running.
   *
   * @param slot - The automation.
   */
  #drain(slot: Slot): void {
    if (this.#isStopped || slot.running.size > 0 || this.#slots.get(slot.record.id) !== slot) {
      return;
    }

    const next = slot.queue.shift();

    if (next !== undefined) {
      this.#start(slot, next.runId, next.trigger, next.chain);
    }
  }

  /**
   * One run: the checks, then the actions, then the row.
   *
   * @param record - The automation as it was when the run started.
   * @param runId - The run's id.
   * @param trigger - What woke it.
   * @param chain - The automations that led to it.
   * @param signal - Aborts the run.
   * @param startedAt - When it started.
   */
  async #execute(
    record: AutomationRecord,
    runId: string,
    trigger: AutomationRunTrigger,
    chain: readonly string[],
    signal: AbortSignal,
    startedAt: Date,
  ): Promise<void> {
    const trace = new TraceRecorder();
    const traceId = this.#options.newTraceId();

    trace.add({
      path: trigger.path ?? 'triggers',
      kind: 'trigger',
      type: trigger.kind,
      at: startedAt,
      durationMs: 0,
      result: 'ok',
      ...(trigger.entityId === undefined ? {} : { entityId: trigger.entityId }),
      detail: triggerDetail(trigger),
    });

    let ending: RunEnding = { result: 'success', error: null };

    try {
      await this.#prefetchOccupancy(record);

      if (record.definition.if !== undefined) {
        const outcome = evaluateConditions(record.definition.if, 'if', this.#conditionContext());
        const at = this.#now();

        for (const step of outcome.steps) {
          trace.add({ ...step, kind: 'condition', at, durationMs: 0 });
        }

        if (!outcome.value) {
          ending = { result: 'condition_not_met', error: null };
        }
      }

      if (ending.result === 'success') {
        const ports = this.#ports(record, runId, chain, traceId, startedAt);

        await new Executor(ports, trace).run(record.definition.then, 'then', signal);
      }
    } catch (error: unknown) {
      ending = this.#endingOf(error);
    }

    this.#finish(record, runId, trigger, startedAt, trace.steps(this.#now()), ending);
  }

  /**
   * How a run ended, from what its actions threw.
   *
   * @param error - What was thrown.
   * @returns The result and the error to record.
   */
  #endingOf(error: unknown): RunEnding {
    if (error instanceof StopRun) {
      return { result: 'success', error: null };
    }

    if (error instanceof RunAborted) {
      return { result: error.reason, error: error.message };
    }

    if (error instanceof ActionFailed) {
      return { result: 'failed', error: error.message };
    }

    return { result: 'failed', error: messageOf(error) };
  }

  /**
   * Writes a run's row and says it ended.
   *
   * @param record - The automation.
   * @param runId - The run's id.
   * @param trigger - What woke it.
   * @param startedAt - When it started.
   * @param trace - Its steps.
   * @param ending - How it ended.
   */
  #finish(
    record: AutomationRecord,
    runId: string,
    trigger: AutomationRunTrigger,
    startedAt: Date,
    trace: readonly TraceStep[],
    ending: RunEnding,
  ): void {
    const finishedAt = this.#now();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

    this.#announce(record.id, {
      kind: 'finished',
      runId,
      time: startedAt,
      result: ending.result,
      finishedAt,
      durationMs,
      ...(ending.error === null ? {} : { error: ending.error }),
    });

    this.#options.logger.info(
      { automation: record.key, runId, result: ending.result, durationMs },
      'An automation run ended',
    );

    insertRun(this.#options.db, {
      id: runId,
      automationId: record.id,
      time: startedAt,
      trigger,
      result: ending.result,
      finishedAt,
      durationMs,
      trace,
      error: ending.error,
    }).catch((error: unknown) => {
      this.#options.logger.error(
        { err: error, automation: record.key, runId },
        'Could not record a run',
      );
    });
  }

  /**
   * Publishes what happened to a run.
   *
   * @param automationId - The automation.
   * @param event - What happened.
   */
  #announce(automationId: string, event: AutomationEvent): void {
    this.#options.client.publish(busSubjects.automationEvent(automationId), event);
  }

  // --- what a run reaches ----------------------------------------------------------------

  /**
   * What checks see of the house now.
   *
   * @returns The context.
   */
  #conditionContext(): ConditionContext {
    return {
      stateOf: this.#stateOf,
      now: this.#now(),
      timeZone: this.#house.timeZone,
      /**
       * Whether somebody is in an area, by the sensors read before the run.
       *
       * @param areaKey - The area.
       * @returns True, false, or null when it has no sensors.
       */
      occupancy: (areaKey) => {
        const sensors = this.#occupancy.get(areaKey)?.sensors;

        return sensors === undefined ? null : isOccupied(sensors, this.#stateOf);
      },
    };
  }

  /**
   * Reads the sensors of every area a run may ask about, unless they were read recently.
   *
   * @param record - The automation.
   */
  async #prefetchOccupancy(record: AutomationRecord): Promise<void> {
    const now = this.#now().getTime();

    await Promise.all(
      areasOfDefinition(record.definition).map(async (areaKey) => {
        const cached = this.#occupancy.get(areaKey);

        if (cached !== undefined && cached.until > now) {
          return;
        }

        const sensors = await loadOccupancySensors(this.#options.db, areaKey);

        this.#occupancy.set(areaKey, { sensors, until: now + OCCUPANCY_TTL_MS });
      }),
    );
  }

  /**
   * The ports a run's blocks reach the world through.
   *
   * @param record - The automation.
   * @param runId - The run.
   * @param chain - The automations that led to it.
   * @param traceId - The run's unit of work.
   * @param startedAt - When it started, for a scene's deadline.
   * @returns The ports.
   */
  #ports(
    record: AutomationRecord,
    runId: string,
    chain: readonly string[],
    traceId: string,
    startedAt: Date,
  ): ExecutorPorts {
    const context: ChangeContext = { type: 'automation', id: runId };
    const logger = this.#options.logger;

    return {
      now: this.#now,
      sleep,
      /**
       * Lets the rest of the process run.
       *
       * @returns A promise of the next turn.
       */
      yieldTurn: () =>
        new Promise((resolve) => {
          setImmediate(resolve);
        }),
      /**
       * Evaluates checks against the house now.
       *
       * @param tree - The checks.
       * @param path - Where they are.
       * @returns What they said.
       */
      evaluate: (tree, path) => evaluateConditions(tree, path, this.#conditionContext()),
      /**
       * Waits until checks hold.
       *
       * @param tree - The checks.
       * @param timeoutMs - How long at most.
       * @param signal - The run's signal.
       * @returns Whether they held in time.
       */
      waitForCondition: (tree, timeoutMs, signal) =>
        this.#waitForCondition(tree, timeoutMs, signal),
      /**
       * Waits until a trigger fires.
       *
       * @param trigger - The trigger.
       * @param timeoutMs - How long at most.
       * @param signal - The run's signal.
       * @returns Whether it fired in time.
       */
      waitForTrigger: (trigger, timeoutMs, signal) =>
        this.#waitForTrigger(trigger, timeoutMs, signal),
      /**
       * Sends a command carrying the run as its cause.
       *
       * @param entityId - The entity.
       * @param capability - Which of its capabilities.
       * @param params - The command body.
       */
      command: async (entityId, capability, params) => {
        await this.#options.dispatcher.dispatch({
          entityId: entityId as EntityId,
          capability,
          command: params,
          context,
          traceId,
          logger,
        });
      },
      /**
       * Applies a scene carrying the run as its cause, within what is left of the run's time.
       *
       * @param sceneKey - The scene.
       * @param signal - The run's signal.
       * @returns How it went.
       */
      applyScene: async (sceneKey, signal) => {
        try {
          const reply = await this.#options.scenes.apply(
            { key: sceneKey },
            {
              context,
              traceId,
              deadlineMs: Math.max(
                1_000,
                record.maxRuntimeMs - (this.#now().getTime() - startedAt.getTime()),
              ),
              signal,
            },
          );
          const firstError = reply.members.find((member) => member.error !== null)?.error ?? null;

          return { found: true, applied: reply.applied, failed: reply.failed, firstError };
        } catch (error: unknown) {
          if (isNebulaError(error) && error.code === 'NOT_FOUND') {
            return { found: false };
          }

          throw error;
        }
      },
      /**
       * Starts another automation, with this run in its chain.
       *
       * @param automationKey - The other automation.
       * @returns What became of it.
       */
      startAutomation: async (automationKey) => {
        const automationId = this.#byKey.get(automationKey);
        const target = automationId === undefined ? undefined : this.#slots.get(automationId);

        if (target === undefined) {
          const exists = await this.#keyExists(automationKey);

          return exists
            ? { found: true, outcome: 'ignored', reason: 'it is turned off' }
            : { found: false };
        }

        const reply = this.#wake(target, { kind: 'automation', automationId: record.id, runId }, [
          ...chain,
          record.id,
        ]);

        return { found: true, outcome: reply.outcome, reason: reply.reason };
      },
      /**
       * Calls a service of a package.
       *
       * @param packageId - The package.
       * @param service - The service.
       * @param params - What it is given.
       */
      callPackageService: async (packageId, service, params) => {
        await this.#options.client.request(
          busSubjects.service(packageId, service),
          params,
          z.unknown(),
          {
            traceId,
            timeoutMs: PACKAGE_SERVICE_TIMEOUT_MS,
          },
        );
      },
      /**
       * An entity's state as one word.
       *
       * @param entityId - The entity.
       * @returns The token, or undefined when it never reported.
       */
      stateTokenOf: (entityId) => {
        const state = this.#stateOf(entityId);

        return state === undefined ? undefined : stateTokenOf(state.state, state.isAvailable);
      },
    };
  }

  /**
   * Whether an automation with a key exists, loaded or not.
   *
   * @param automationKey - The key.
   * @returns True when there is a row.
   */
  async #keyExists(automationKey: string): Promise<boolean> {
    return (await automationIdByKey(this.#options.db, automationKey)) !== undefined;
  }

  /**
   * Waits until a tree of checks holds.
   *
   * @param tree - The checks.
   * @param timeoutMs - How long to wait at most.
   * @param signal - The run's signal.
   * @returns True once it holds; false when the time ran out or the run was aborted.
   */
  #waitForCondition(tree: BooleanTree, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    /**
     * Whether the checks hold now.
     *
     * @returns True when they do.
     */
    const holds = (): boolean => evaluateConditions(tree, 'wait', this.#conditionContext()).value;

    if (holds()) {
      return Promise.resolve(true);
    }

    const entities = new Set(entitiesOfConditions(tree));

    return new Promise((resolve) => {
      const timers: NodeJS.Timeout[] = [];

      /**
       * Ends the wait.
       *
       * @param value - Whether the checks held.
       */
      const finish = (value: boolean): void => {
        this.#waiters.delete(waiter);
        timers.forEach(clearTimeout);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      /** Ends the wait when the run is aborted. */
      const onAbort = (): void => {
        finish(false);
      };
      /**
       * Looks again when an entity the checks read changes.
       *
       * @param result - The change.
       */
      const waiter: Waiter = (result) => {
        if (entities.has(result.entityId) && holds()) {
          finish(true);
        }
      };

      this.#waiters.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      timers.push(
        setTimeout(() => {
          finish(false);
        }, timeoutMs),
      );

      if (dependsOnClock(tree)) {
        /** Looks again as time passes. */
        const tick = (): void => {
          if (holds()) {
            finish(true);
          } else {
            timers.push(setTimeout(tick, CLOCK_RECHECK_MS));
          }
        };

        timers.push(setTimeout(tick, CLOCK_RECHECK_MS));
      }
    });
  }

  /**
   * Waits until a trigger fires.
   *
   * @param trigger - The trigger.
   * @param timeoutMs - How long to wait at most.
   * @param signal - The run's signal.
   * @returns True once it fires; false when the time ran out or the run was aborted.
   */
  #waitForTrigger(
    trigger: AutomationTrigger,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const tree: TriggerTree = trigger;

    return new Promise((resolve) => {
      const timers = new Map<string, NodeJS.Timeout>();

      /**
       * Ends the wait.
       *
       * @param value - Whether it fired.
       */
      const finish = (value: boolean): void => {
        this.#waiters.delete(waiter);

        for (const timer of timers.values()) {
          clearTimeout(timer);
        }

        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      /** Ends the wait when the run is aborted. */
      const onAbort = (): void => {
        finish(false);
      };
      /**
       * Hands an event to the trigger.
       *
       * @param event - What happened.
       */
      const react = (event: TriggerEvent): void => {
        const reaction = reactTriggers(tree, event, {
          stateOf: this.#stateOf,
          now: this.#now(),
        });

        for (const path of reaction.cancels) {
          clearTimeout(timers.get(`hold:${path}`));
          timers.delete(`hold:${path}`);
        }

        for (const hold of reaction.holds) {
          timers.set(
            `hold:${hold.path}`,
            setTimeout(() => {
              react({ kind: 'hold', path: hold.path, expectToken: hold.expectToken });
            }, hold.ms),
          );
        }

        if (reaction.fired !== null) {
          finish(true);
        }
      };
      /**
       * Hands a change to the trigger.
       *
       * @param result - The change.
       */
      const waiter: Waiter = (result) => {
        react({
          kind: 'state',
          entityId: result.entityId,
          previous: result.previous,
          current: result.current,
        });
      };

      this.#waiters.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      timers.set(
        'timeout',
        setTimeout(() => {
          finish(false);
        }, timeoutMs),
      );

      for (const leaf of flattenTriggers(tree)) {
        if (leaf.type === 'time') {
          const next = nextFire(leaf.at, this.#house, this.#now());

          if ('at' in next && next.at.getTime() - this.#now().getTime() < timeoutMs) {
            timers.set(
              'time',
              setTimeout(() => {
                react({ kind: 'time', path: 'triggers' });
              }, next.at.getTime() - this.#now().getTime()),
            );
          }
        }
      }
    });
  }
}

/**
 * Resolves after a while, or rejects as soon as the signal aborts.
 *
 * @param ms - How long.
 * @param signal - The run's signal.
 * @returns A promise of the wait.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('The run was aborted'));

      return;
    }

    /** Ends the wait early. */
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('The run was aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
