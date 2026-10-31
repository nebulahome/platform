import { describe, expect, it } from 'vitest';

import {
  AT_REST,
  clampPosition,
  CORNER_INSET_PX,
  cornerPosition,
  cornerToward,
  isSettled,
  pickCorner,
  stepSpring,
  throwVelocity,
  type SpringState,
  type Vector,
} from '@/packages/floating/spring';

const BOUNDS = { width: 1000, height: 700 };
const SIZE = { width: 300, height: 120 };

/**
 * Runs the spring at 60 frames a second until it settles.
 *
 * @param from - Where it starts.
 * @param target - Where it goes.
 * @param velocity - How fast it starts.
 * @returns The frames it took and how far past the target it went along x.
 */
function run(from: Vector, target: Vector, velocity: Vector = AT_REST) {
  let state: SpringState = { position: from, velocity };
  let frames = 0;
  let overshoot = 0;
  const direction = Math.sign(target.x - from.x);

  while (!isSettled(state, target) && frames < 600) {
    state = stepSpring(state, target, 1 / 60);
    overshoot = Math.max(overshoot, (state.position.x - target.x) * direction);
    frames += 1;
  }

  return { frames, overshoot, state };
}

describe('stepSpring', () => {
  it('converges on the target and settles within a second', () => {
    const { frames, state } = run({ x: 0, y: 0 }, { x: 500, y: 300 });

    expect(frames).toBeLessThan(60);
    expect(state.position.x).toBeCloseTo(500, 0);
    expect(state.position.y).toBeCloseTo(300, 0);
  });

  it('goes a little past the target, once', () => {
    const { overshoot } = run({ x: 0, y: 0 }, { x: 100, y: 0 });

    // A damping ratio of about 0.67: some 6% over, from rest.
    expect(overshoot).toBeGreaterThan(1);
    expect(overshoot).toBeLessThan(10);
  });

  it('treats a late frame as a short one', () => {
    const state = { position: { x: 0, y: 0 }, velocity: AT_REST };

    expect(stepSpring(state, { x: 100, y: 0 }, 2)).toEqual(
      stepSpring(state, { x: 100, y: 0 }, 0.032),
    );
  });
});

describe('pickCorner', () => {
  it('picks the nearest corner of a window put down', () => {
    expect(pickCorner({ x: 100, y: 80 }, AT_REST, BOUNDS, SIZE)).toBe('top-left');
    expect(pickCorner({ x: 600, y: 500 }, AT_REST, BOUNDS, SIZE)).toBe('bottom-right');
  });

  it('picks the corner a window is thrown at', () => {
    expect(pickCorner({ x: 100, y: 80 }, { x: 3000, y: 0 }, BOUNDS, SIZE)).toBe('top-right');
    expect(pickCorner({ x: 600, y: 500 }, { x: -2500, y: -2500 }, BOUNDS, SIZE)).toBe('top-left');
  });
});

describe('cornerPosition and clampPosition', () => {
  it('rests a window inside the margin', () => {
    expect(cornerPosition('bottom-right', BOUNDS, SIZE)).toEqual({
      x: BOUNDS.width - SIZE.width - CORNER_INSET_PX,
      y: BOUNDS.height - SIZE.height - CORNER_INSET_PX,
    });
  });

  it('keeps the window inside the layer', () => {
    expect(clampPosition({ x: -40, y: 900 }, BOUNDS, SIZE)).toEqual({
      x: 0,
      y: BOUNDS.height - SIZE.height,
    });
  });

  it('keeps a thrown window inside the layer while it overshoots', () => {
    const target = cornerPosition('bottom-right', BOUNDS, SIZE);
    let state: SpringState = { position: { x: 30, y: 30 }, velocity: { x: 6000, y: 6000 } };

    for (let frame = 0; frame < 120; frame += 1) {
      state = stepSpring(state, target, 1 / 60);
      const drawn = clampPosition(state.position, BOUNDS, SIZE);

      expect(drawn.x + SIZE.width).toBeLessThanOrEqual(BOUNDS.width);
      expect(drawn.y + SIZE.height).toBeLessThanOrEqual(BOUNDS.height);
    }
  });
});

describe('throwVelocity', () => {
  it('reads the speed of the last moment of the drag', () => {
    expect(
      throwVelocity([
        { time: 0, x: 0, y: 0 },
        { time: 100, x: 10, y: 0 },
        { time: 150, x: 60, y: 0 },
        { time: 180, x: 90, y: 30 },
      ]),
    ).toEqual({ x: 1000, y: 375 });
  });

  it('is still for a pointer that stopped', () => {
    expect(throwVelocity([{ time: 0, x: 0, y: 0 }])).toEqual(AT_REST);
  });
});

describe('cornerToward', () => {
  it('moves to the corner an arrow points at, and stays at the edge', () => {
    expect(cornerToward('bottom-right', 'ArrowLeft')).toBe('bottom-left');
    expect(cornerToward('bottom-right', 'ArrowUp')).toBe('top-right');
    expect(cornerToward('top-left', 'ArrowUp')).toBe('top-left');
    expect(cornerToward('top-left', 'Enter')).toBeNull();
  });
});
