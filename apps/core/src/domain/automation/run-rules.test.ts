import { describe, expect, it } from 'vitest';

import {
  decideMode,
  LoopGuard,
  MAX_PARALLEL_RUNS,
  MAX_QUEUED_RUNS,
  MAX_STARTS_PER_WINDOW,
} from './run-rules.js';
import { TraceRecorder, MAX_TRACE_STEPS } from './trace.js';

describe('decideMode', () => {
  it('starts when nothing is running, whatever the mode', () => {
    for (const mode of ['single', 'restart', 'queued', 'parallel'] as const) {
      expect(decideMode(mode, 0, 0)).toBe('start');
    }
  });

  it('does what each mode says when a run is going', () => {
    expect(decideMode('single', 1, 0)).toBe('drop');
    expect(decideMode('restart', 1, 0)).toBe('restart');
    expect(decideMode('queued', 1, 0)).toBe('queue');
    expect(decideMode('parallel', 1, 0)).toBe('start');
  });

  it('caps a queue and parallel runs', () => {
    expect(decideMode('queued', 1, MAX_QUEUED_RUNS)).toBe('drop');
    expect(decideMode('parallel', MAX_PARALLEL_RUNS, 0)).toBe('drop');
  });
});

describe('LoopGuard', () => {
  const a = 'automation-a';
  const b = 'automation-b';

  it('lets an automation woken by others start', () => {
    expect(new LoopGuard().admit(a, [b], 0)).toEqual({ ok: true });
  });

  it('refuses an automation that keeps waking itself', () => {
    const guard = new LoopGuard();

    expect(guard.admit(a, [a, a], 0)).toEqual({ ok: true });
    expect(guard.admit(a, [a, b, a, a], 0)).toMatchObject({ ok: false, reason: /waking itself/ });
  });

  it('refuses a long chain of automations waking each other', () => {
    expect(new LoopGuard().admit(a, ['1', '2', '3', '4', '5', '6', '7', '8'], 0)).toMatchObject({
      ok: false,
      reason: /each other/,
    });
  });

  it('refuses more than thirty starts a minute, and allows them again after', () => {
    const guard = new LoopGuard();

    for (let start = 0; start < MAX_STARTS_PER_WINDOW; start += 1) {
      expect(guard.admit(a, [], start * 100).ok).toBe(true);
    }

    expect(guard.admit(a, [], 5_000)).toMatchObject({ ok: false, reason: /thirty times/ });
    expect(guard.admit(b, [], 5_000).ok).toBe(true);
    expect(guard.admit(a, [], 70_000).ok).toBe(true);

    guard.forget(a);
    expect(guard.admit(a, [], 70_001).ok).toBe(true);
  });
});

describe('TraceRecorder', () => {
  it('keeps every step under the cap', () => {
    const trace = new TraceRecorder();
    const at = new Date('2026-10-09T12:00:00Z');

    trace.add({ path: 'then.0', kind: 'action', type: 'stop', at, durationMs: 0, result: 'ok' });

    expect(trace.steps(at)).toHaveLength(1);
  });

  it('says how many steps it did not record past the cap', () => {
    const trace = new TraceRecorder();
    const at = new Date('2026-10-09T12:00:00Z');

    for (let index = 0; index < MAX_TRACE_STEPS + 5; index += 1) {
      trace.add({
        path: 'then.0',
        kind: 'action',
        type: 'wait_duration',
        at,
        durationMs: 0,
        result: 'ok',
      });
    }

    const steps = trace.steps(at);

    expect(steps).toHaveLength(MAX_TRACE_STEPS + 1);
    expect(steps.at(-1)?.detail).toBe('5 more steps were not recorded');
  });
});
