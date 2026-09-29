import { describe, expect, it } from 'vitest';

import { LogRing } from './log-ring.js';
import { RestartPolicy } from './restart-policy.js';

describe("a package's log", () => {
  it('keeps the last lines, split at line ends, and reads after a cursor', () => {
    const ring = new LogRing(3);
    const out = ring.writer('stdout');

    out.write('one\ntw');
    out.write('o\nthree\nfour');
    out.flush();

    const all = ring.read(10);

    expect(all.lines.map((line) => line.text)).toEqual(['two', 'three', 'four']);

    ring.push('stderr', 'Could not bind 1883');

    const after = ring.read(10, all.cursor ?? undefined);

    expect(after.lines.map((line) => line.text)).toEqual(['Could not bind 1883']);
    expect(ring.read(10, after.cursor ?? undefined).lines).toEqual([]);
    expect(ring.lastError()).toBe('Could not bind 1883');
  });

  it('gives lines of one millisecond cursors of their own, in order', () => {
    const ring = new LogRing();
    const at = new Date('2026-09-29T08:00:00.000Z');

    ring.push('stdout', 'a', at);
    ring.push('stdout', 'b', at);

    const first = ring.read(1, undefined);

    expect(first.lines.map((line) => line.text)).toEqual(['b']);
    expect(ring.read(10, '1790668799.999999999').lines.map((line) => line.text)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('restarting a package', () => {
  it('waits longer each time, and gives up after five exits in ten minutes', () => {
    let nowMs = 1_000_000;
    const policy = new RestartPolicy(undefined, () => nowMs);
    const delays: number[] = [];

    for (let exit = 0; exit < 4; exit += 1) {
      const decision = policy.exited(nowMs - 500);

      if (decision.kind === 'restart') {
        delays.push(decision.delayMs);
      }

      nowMs += 1000;
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    expect(policy.exited(nowMs - 500)).toEqual({ kind: 'give-up', exits: 5 });
  });

  it('starts from a second again after a run that lasted', () => {
    let nowMs = 1_000_000;
    const policy = new RestartPolicy(undefined, () => nowMs);

    policy.exited(nowMs - 500);
    nowMs += 1000;
    policy.exited(nowMs - 500);
    nowMs += 700_000;

    expect(policy.exited(nowMs - 300_000)).toEqual({ kind: 'restart', delayMs: 1000 });
  });
});
