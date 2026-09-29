import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEntityId, type StateReport } from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import type { ReportedState } from '@nebula-home/package-runtime';

import { ImageStore } from './images.js';

const MAP = parseEntityId('image.goat_map');

/**
 * A report of the map, with its picture.
 *
 * @param revision - Which picture.
 * @param minIntervalMs - How often at most it is announced.
 * @returns The report.
 */
function map(revision: string, minIntervalMs = 2000): ReportedState {
  return {
    entityId: MAP,
    state: { image: { contentType: 'image/svg+xml', revision } },
    attributes: {},
    isAvailable: true,
    blob: { contentType: 'image/svg+xml', data: `<svg id="${revision}"/>`, minIntervalMs },
  };
}

/**
 * A store on a clock the test moves.
 *
 * @returns The store, what it published later, and how to move the clock.
 */
function harness() {
  let now = 1_000_000;
  const store = new ImageStore({
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    now: () => now,
  });
  const later: StateReport[] = [];

  return {
    store,
    later,
    publish: (report: StateReport): void => {
      later.push(report);
    },
    advance: (ms: number): void => {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ImageStore', () => {
  it('keeps the picture and publishes the report without it', () => {
    const { store, publish } = harness();
    const [published] = store.take([map('r1')], publish);

    expect(published).toEqual({
      entityId: MAP,
      state: { image: { contentType: 'image/svg+xml', revision: 'r1' } },
      attributes: {},
      isAvailable: true,
    });
    expect(store.get(MAP)?.data.toString()).toBe('<svg id="r1"/>');
  });

  it('announces at most once an interval, the latest picture at the end of it', () => {
    vi.useFakeTimers();
    const { store, publish, later, advance } = harness();

    expect(store.take([map('r1')], publish)).toHaveLength(1);
    advance(500);
    expect(store.take([map('r2')], publish)).toEqual([]);
    advance(500);
    expect(store.take([map('r3')], publish)).toEqual([]);
    expect(store.get(MAP)?.revision).toBe('r3');

    advance(1000);

    expect(later.map((report) => report.state.image?.revision)).toEqual(['r3']);
  });

  it('does not announce a picture drawn again the same', () => {
    const { store, publish } = harness();

    store.take([map('r1')], publish);

    expect(store.take([map('r1', 0)], publish)).toEqual([]);
  });

  it('passes a report of any other entity through untouched', () => {
    const { store, publish } = harness();
    const report: StateReport = {
      entityId: parseEntityId('sensor.goat_battery'),
      state: { sensor_numeric: { value: 80 } },
    };

    expect(store.take([report], publish)).toEqual([report]);
  });

  it('keeps nothing of a picture too large to carry, and says nothing of it', () => {
    const { store, publish } = harness();
    const huge: ReportedState = {
      ...map('big'),
      blob: { contentType: 'image/png', data: Buffer.alloc(800_000) },
    };

    expect(store.take([huge], publish)).toEqual([]);
    expect(store.get(MAP)).toBeUndefined();
  });
});
