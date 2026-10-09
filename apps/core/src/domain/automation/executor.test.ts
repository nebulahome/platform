import { describe, expect, it } from 'vitest';

import {
  parseEntityId,
  type AutomationAction,
  type BooleanTree,
  type JsonObject,
} from '@nebulahome/contracts';

import { entityState, statesOf } from '@/testing/entity-states.js';

import { evaluateConditions } from './conditions.js';
import {
  ActionFailed,
  durationWords,
  Executor,
  RunAborted,
  StopRun,
  type ExecutorPorts,
  type SceneOutcome,
  type StartOutcome,
} from './executor.js';
import { TraceRecorder } from './trace.js';

const ceiling = parseEntityId('light.living_room');
const lux = parseEntityId('sensor.living_room_lux');
const washer = parseEntityId('select.washer_state');

/** What the fake world saw. */
type World = {
  readonly commands: { entityId: string; params: JsonObject }[];
  readonly slept: number[];
  readonly calls: string[];
};

/**
 * Ports over a small fake house.
 *
 * @param overrides - Ports to replace.
 * @returns The ports and what they saw.
 */
function fakePorts(overrides: Partial<ExecutorPorts> = {}): { ports: ExecutorPorts; world: World } {
  const world: World = { commands: [], slept: [], calls: [] };
  const stateOf = statesOf(
    entityState(lux, { sensor_numeric: { value: 30 } }),
    entityState(washer, { select: { option: 'done' } }),
  );
  let clock = new Date('2026-10-09T18:00:00Z').getTime();

  const ports: ExecutorPorts = {
    now: () => new Date(clock),
    sleep: async (ms, signal) => {
      world.slept.push(ms);
      clock += ms;
      await Promise.resolve();

      if (signal.aborted) {
        throw new Error('aborted');
      }
    },
    yieldTurn: () => Promise.resolve(),
    evaluate: (tree, path) =>
      evaluateConditions(tree, path, {
        stateOf,
        now: new Date(clock),
        timeZone: 'Europe/Rome',
        occupancy: () => null,
      }),
    waitForCondition: () => Promise.resolve(true),
    waitForTrigger: () => Promise.resolve(false),
    command: (entityId, capability, params) => {
      world.commands.push({ entityId, params: { ...params, capability } });

      return Promise.resolve();
    },
    applyScene: (): Promise<SceneOutcome> =>
      Promise.resolve({ found: true, applied: 3, failed: 0, firstError: null }),
    startAutomation: (): Promise<StartOutcome> =>
      Promise.resolve({ found: true, outcome: 'started' }),
    callPackageService: (packageId, service) => {
      world.calls.push(`${packageId}.${service}`);

      return Promise.resolve();
    },
    stateTokenOf: (entityId) => (entityId === washer ? 'done' : undefined),
    ...overrides,
  };

  return { ports, world };
}

/**
 * Runs some blocks.
 *
 * @param actions - The blocks.
 * @param overrides - Ports to replace.
 * @param signal - The run's signal.
 * @returns What happened: the error if any, the trace and the world.
 */
async function run(
  actions: AutomationAction[],
  overrides: Partial<ExecutorPorts> = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<{ error: unknown; trace: TraceRecorder; world: World }> {
  const { ports, world } = fakePorts(overrides);
  const trace = new TraceRecorder();
  let error: unknown;

  try {
    await new Executor(ports, trace, { maxIterations: 5, maxActions: 40 }).run(
      actions,
      'then',
      signal,
    );
  } catch (caught: unknown) {
    error = caught;
  }

  return { error, trace, world };
}

const turnOn: AutomationAction = {
  type: 'command',
  entityId: ceiling,
  capability: 'on_off',
  params: { command: 'turn_on' },
};
const isDark: BooleanTree = { type: 'numeric', entityId: lux, operator: 'lt', value: 50 };
const isBright: BooleanTree = { type: 'numeric', entityId: lux, operator: 'gt', value: 50 };

describe('Executor', () => {
  it('runs blocks in order and records each', async () => {
    const { error, trace, world } = await run([
      turnOn,
      { type: 'wait_duration', durationMs: 600_000 },
      { type: 'scene', sceneKey: 'evening' },
    ]);
    const steps = trace.steps(new Date());

    expect(error).toBeUndefined();
    expect(world.commands).toEqual([
      { entityId: ceiling, params: { command: 'turn_on', capability: 'on_off' } },
    ]);
    expect(world.slept).toEqual([600_000]);
    expect(steps.map((step) => [step.path, step.result, step.detail])).toEqual([
      ['then.0', 'ok', 'sent turn_on'],
      ['then.1', 'ok', 'waited 10 min'],
      ['then.2', 'ok', 'evening: 3 set'],
    ]);
    expect(steps[1]?.durationMs).toBe(600_000);
  });

  it('fails the run with a refused command, and stops there', async () => {
    const { error, trace, world } = await run([turnOn, { type: 'scene', sceneKey: 'evening' }], {
      command: () => Promise.reject(new Error('light.living_room did not answer')),
    });

    expect(error).toBeInstanceOf(ActionFailed);
    expect(trace.steps(new Date())).toEqual([
      expect.objectContaining({
        path: 'then.0',
        result: 'failed',
        entityId: ceiling,
        error: 'light.living_room did not answer',
      }),
    ]);
    expect(world.commands).toEqual([]);
  });

  it('carries on past a scene that reached only some of its members', async () => {
    const { error, trace } = await run([{ type: 'scene', sceneKey: 'good_night' }, turnOn], {
      applyScene: () =>
        Promise.resolve({ found: true, applied: 4, failed: 1, firstError: 'Lamp did not answer' }),
    });

    expect(error).toBeUndefined();
    expect(trace.steps(new Date())[0]).toMatchObject({
      result: 'partial',
      detail: 'good_night: 4 set, 1 did not',
      error: 'Lamp did not answer',
    });
  });

  it('fails on a scene or an automation that does not exist', async () => {
    const scene = await run([{ type: 'scene', sceneKey: 'gone' }], {
      applyScene: () => Promise.resolve({ found: false }),
    });
    const automation = await run([{ type: 'automation', automationKey: 'gone' }], {
      startAutomation: () => Promise.resolve({ found: false }),
    });

    expect(scene.error).toBeInstanceOf(ActionFailed);
    expect(automation.error).toBeInstanceOf(ActionFailed);
  });

  it('records another automation that would not start as skipped', async () => {
    const { error, trace } = await run([{ type: 'automation', automationKey: 'porch' }], {
      startAutomation: () =>
        Promise.resolve({ found: true, outcome: 'ignored', reason: 'it is already running' }),
    });

    expect(error).toBeUndefined();
    expect(trace.steps(new Date())[0]).toMatchObject({
      result: 'skipped',
      detail: 'porch did not start: it is already running',
    });
  });

  it('ends the run as a success on End this run, running nothing after it', async () => {
    const { error, world } = await run([{ type: 'stop' }, turnOn]);

    expect(error).toBeInstanceOf(StopRun);
    expect(world.commands).toEqual([]);
  });

  it('takes the branch the condition says, and records why', async () => {
    const { trace, world } = await run([
      {
        type: 'if',
        condition: isDark,
        then: [turnOn],
        else: [{ type: 'wait_duration', durationMs: 1 }],
      },
    ]);
    const steps = trace.steps(new Date());

    expect(world.commands).toHaveLength(1);
    expect(steps.map((step) => [step.path, step.kind, step.result])).toEqual([
      ['then.0.condition', 'condition', 'true'],
      ['then.0', 'action', 'true'],
      ['then.0.then.0', 'action', 'ok'],
    ]);
  });

  it('runs else, or nothing when there is none', async () => {
    const withElse = await run([{ type: 'if', condition: isBright, then: [], else: [turnOn] }]);
    const without = await run([{ type: 'if', condition: isBright, then: [turnOn] }]);

    expect(withElse.world.commands).toHaveLength(1);
    expect(withElse.trace.steps(new Date())[1]).toMatchObject({ result: 'false', detail: 'else' });
    expect(without.world.commands).toHaveLength(0);
    expect(without.trace.steps(new Date())[1]).toMatchObject({ detail: 'no else' });
  });

  it('picks the switch case the entity is in, or otherwise', async () => {
    const { trace, world } = await run([
      {
        type: 'switch',
        entityId: washer,
        cases: [
          { value: 'error', actions: [] },
          { value: 'done', actions: [turnOn] },
        ],
      },
      {
        type: 'switch',
        entityId: ceiling,
        cases: [{ value: 'on', actions: [] }],
        default: [{ type: 'wait_duration', durationMs: 5 }],
      },
    ]);
    const steps = trace.steps(new Date());

    expect(world.commands).toHaveLength(1);
    expect(steps[0]?.detail).toBe('is done: when "done"');
    expect(steps.at(-2)?.detail).toBe('is unknown: otherwise');
    expect(steps.at(-1)?.path).toBe('then.1.default.0');
  });

  it('loops while the condition holds, and stops a loop that never ends', async () => {
    let rounds = 0;
    const counting = await run([{ type: 'while', condition: isDark, actions: [turnOn] }], {
      command: () => {
        rounds += 1;

        return Promise.resolve();
      },
      evaluate: (tree, path) => ({
        value: rounds < 3,
        steps: [{ path, type: 'numeric', result: rounds < 3 ? 'true' : 'false' }],
      }),
    });

    expect(counting.error).toBeUndefined();
    expect(rounds).toBe(3);

    const forever = await run([{ type: 'while', condition: isDark, actions: [turnOn] }]);

    expect(forever.error).toBeInstanceOf(ActionFailed);
    expect((forever.error as Error).message).toBe('Stopped after 5 times round');
  });

  it('runs a do-while once before it checks', async () => {
    const { world } = await run([{ type: 'do_while', condition: isBright, actions: [turnOn] }]);

    expect(world.commands).toHaveLength(1);
  });

  it('repeats a count, and refuses one past the cap or for each', async () => {
    const thrice = await run([
      { type: 'for', over: { kind: 'count', count: 3 }, actions: [turnOn] },
    ]);
    const tooMany = await run([
      { type: 'for', over: { kind: 'count', count: 6 }, actions: [turnOn] },
    ]);
    const each = await run([
      { type: 'for', over: { kind: 'each', items: 'light.a, light.b' }, actions: [turnOn] },
    ]);

    expect(thrice.world.commands).toHaveLength(3);
    expect(tooMany.error).toBeInstanceOf(ActionFailed);
    expect((each.error as Error).message).toBe('For each is not available yet');
  });

  it('stops a run that executes too many blocks', async () => {
    const { error } = await run([
      {
        type: 'for',
        over: { kind: 'count', count: 5 },
        actions: Array.from({ length: 10 }, () => turnOn),
      },
    ]);

    expect((error as Error).message).toBe('Stopped after 40 blocks in one run');
  });

  it('fails a notification and a wait for a device event, which are not built yet', async () => {
    const notify = await run([{ type: 'notify', channel: 'telegram', message: 'Hi' }]);
    const event = await run([
      {
        type: 'wait_for_trigger',
        trigger: { type: 'event', event: 'button.pressed', match: {} },
        timeoutMs: 1_000,
      },
    ]);

    expect((notify.error as Error).message).toBe('Notifications are not available yet');
    expect((event.error as Error).message).toBe('Waiting for a device event is not available yet');
  });

  it('records a wait that gave up, and carries on', async () => {
    const { error, trace, world } = await run(
      [
        { type: 'wait_for', condition: isDark, timeoutMs: 60_000 },
        {
          type: 'wait_for_trigger',
          trigger: { type: 'state', entityId: ceiling, to: 'off' },
          timeoutMs: 120_000,
        },
        turnOn,
      ],
      { waitForCondition: () => Promise.resolve(false) },
    );

    expect(error).toBeUndefined();
    expect(trace.steps(new Date()).map((step) => [step.result, step.detail])).toEqual([
      ['timeout', 'gave up after 1 min'],
      ['timeout', 'gave up after 2 min'],
      ['ok', 'sent turn_on'],
    ]);
    expect(world.commands).toHaveLength(1);
  });

  it('calls a package service, and fails when it refuses', async () => {
    const call: AutomationAction = {
      type: 'package_service',
      packageId: 'nvr',
      service: 'record',
      params: {},
    };
    const ok = await run([call]);
    const refused = await run([call], {
      callPackageService: () => Promise.reject(new Error('No such service')),
    });

    expect(ok.world.calls).toEqual(['nvr.record']);
    expect((refused.error as Error).message).toBe('No such service');
  });

  it('runs a sequence and parallel branches', async () => {
    const { error, world } = await run([
      { type: 'sequence', actions: [turnOn, turnOn] },
      { type: 'parallel', actions: [turnOn, { type: 'wait_duration', durationMs: 1 }] },
    ]);

    expect(error).toBeUndefined();
    expect(world.commands).toHaveLength(3);
  });

  it('stops the other branches when one fails', async () => {
    const { error, world } = await run([
      {
        type: 'parallel',
        actions: [
          { type: 'notify', channel: 'push', message: 'x' },
          { type: 'sequence', actions: [{ type: 'wait_duration', durationMs: 10 }, turnOn] },
        ],
      },
    ]);

    expect(error).toBeInstanceOf(ActionFailed);
    expect(world.commands).toEqual([]);
  });

  it('ends with the reason the signal gives, mid-wait', async () => {
    const controller = new AbortController();
    const { error, world } = await run(
      [{ type: 'wait_duration', durationMs: 1_000 }, turnOn],
      {
        sleep: () => {
          controller.abort('timeout');

          return Promise.reject(new Error('aborted'));
        },
      },
      controller.signal,
    );

    expect(error).toBeInstanceOf(RunAborted);
    expect((error as RunAborted).reason).toBe('timeout');
    expect(world.commands).toEqual([]);
  });

  it('reads a cancellation as cancelled', async () => {
    const controller = new AbortController();

    controller.abort('cancelled');

    const { error } = await run([turnOn], {}, controller.signal);

    expect((error as RunAborted).reason).toBe('cancelled');
  });
});

describe('durationWords', () => {
  it('writes a duration the way a person reads it', () => {
    expect(durationWords(500)).toBe('500 ms');
    expect(durationWords(12_000)).toBe('12 s');
    expect(durationWords(600_000)).toBe('10 min');
    expect(durationWords(5_400_000)).toBe('1.5 h');
  });
});
