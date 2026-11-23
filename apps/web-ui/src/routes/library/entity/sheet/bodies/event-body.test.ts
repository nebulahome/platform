/**
 * An event entity's history is its events: each change with a new moment, never one where only
 * whether the device answers changed.
 */
import { describe, expect, it } from 'vitest';

import { parseEntityId, type StateHistoryPoint } from '@nebulahome/contracts';

import { eventGlyphOf, eventsOf } from '@/routes/library/entity/sheet/bodies/event-body';

const remote = parseEntityId('event.hallway_remote');

/** The remote's last event. */
type Last = { eventType: string | null; at: string | null };

/**
 * A change of the remote.
 *
 * @param minute - When it was recorded, in minutes after noon.
 * @param state - Its event after.
 * @param before - Its event before.
 * @returns The point.
 */
function point(minute: number, state: Last, before: Last | null): StateHistoryPoint {
  return {
    time: new Date(Date.parse('2026-11-23T12:00:00Z') + minute * 60_000),
    entityId: remote,
    state: { event: state },
    previousState: before === null ? null : { event: before },
    attributes: {},
    isAvailable: true,
    source: 'pkg-test',
    context: { type: 'device' },
  };
}

describe('an event entity’s history', () => {
  it('counts each new moment, the same type twice too, and not a state repeated', () => {
    const single = { eventType: 'single_press', at: '2026-11-23T12:01:00Z' };
    const again = { eventType: 'single_press', at: '2026-11-23T12:02:00Z' };

    expect(
      eventsOf([
        point(1, single, { eventType: null, at: null }),
        point(2, again, single),
        point(3, again, again),
      ]).map((event) => event.type),
    ).toEqual(['single_press', 'single_press']);
  });

  it('draws a doorbell with a bell, a button with a press', () => {
    expect(eventGlyphOf('doorbell')).toBe('bell-ring');
    expect(eventGlyphOf('button')).toBe('mouse-pointer-click');
    expect(eventGlyphOf(null)).toBe('zap');
  });
});
