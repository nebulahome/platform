/**
 * How a package's floating window moves: the four corners it rests in, the corner a throw sends it
 * to, and the spring that carries it there.
 *
 * Plain numbers, no DOM: positions are in pixels from the top-left of the layer, velocities in
 * pixels a second, times in seconds. The spring is a little under-damped - it goes slightly past
 * its corner and comes back once, the "almost bounce" - and the window is held inside the layer
 * while it does, so the overshoot eats into the margin and never off the page.
 */

/** A corner of the layer a window rests in. */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** A point, or a velocity. */
export type Vector = { readonly x: number; readonly y: number };

/** The size of something: the layer, or the window. */
export type Size = { readonly width: number; readonly height: number };

/** Where the window is and how fast it is going. */
export type SpringState = { readonly position: Vector; readonly velocity: Vector };

/** One reading of the pointer during a drag. */
export type PointerSample = {
  /** When, in milliseconds, as the event's `timeStamp`. */
  readonly time: number;
  readonly x: number;
  readonly y: number;
};

/** How far a window at rest sits from the edges of the layer. */
export const CORNER_INSET_PX = 24;

/** How hard the spring pulls. */
export const SPRING_STIFFNESS = 380;

/** How much it holds back: with the stiffness, a damping ratio of about 0.67. */
export const SPRING_DAMPING = 26;

/** What it moves. */
export const SPRING_MASS = 1;

/** How far ahead a throw is read: the window goes to the corner nearest where it would be then. */
export const THROW_SECONDS = 0.2;

/** How much of the drag the throw's speed is read from. */
export const THROW_WINDOW_MS = 80;

/** The longest step the spring takes at once: a frame that came late does not fling it. */
export const MAX_STEP_SECONDS = 0.032;

/** Slower than this, and close enough, the window has arrived. */
export const REST_SPEED = 5;

/** Closer than this, and slow enough, the window has arrived. */
export const REST_DISTANCE = 0.5;

/** The order corners are handed out in, when the one a window prefers is taken. */
export const CORNER_ORDER: readonly Corner[] = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
];

/** A step inside one frame, so the spring is the same at 30 and at 144 frames a second. */
const SUBSTEP_SECONDS = 1 / 240;

/** Still. */
export const AT_REST: Vector = { x: 0, y: 0 };

/**
 * Where a window rests in a corner.
 *
 * @param corner - The corner.
 * @param bounds - The layer.
 * @param size - The window.
 * @returns Its top-left, inside the margin even for a window too big for it.
 */
export function cornerPosition(corner: Corner, bounds: Size, size: Size): Vector {
  const right = Math.max(CORNER_INSET_PX, bounds.width - size.width - CORNER_INSET_PX);
  const bottom = Math.max(CORNER_INSET_PX, bounds.height - size.height - CORNER_INSET_PX);

  return {
    x: corner.endsWith('left') ? CORNER_INSET_PX : right,
    y: corner.startsWith('top') ? CORNER_INSET_PX : bottom,
  };
}

/**
 * Holds a window inside the layer: the overshoot may use the margin, never more.
 *
 * @param position - Where it would be.
 * @param bounds - The layer.
 * @param size - The window.
 * @returns Where it is drawn.
 */
export function clampPosition(position: Vector, bounds: Size, size: Size): Vector {
  return {
    x: Math.min(Math.max(position.x, 0), Math.max(0, bounds.width - size.width)),
    y: Math.min(Math.max(position.y, 0), Math.max(0, bounds.height - size.height)),
  };
}

/**
 * The corner a window let go of goes to: the one nearest where it would be a moment later at the
 * speed it was thrown, so a flick crosses the page and a window put down stays near.
 *
 * @param position - Where it was let go.
 * @param velocity - How fast it was going.
 * @param bounds - The layer.
 * @param size - The window.
 * @returns The corner.
 */
export function pickCorner(position: Vector, velocity: Vector, bounds: Size, size: Size): Corner {
  const aim = {
    x: position.x + velocity.x * THROW_SECONDS,
    y: position.y + velocity.y * THROW_SECONDS,
  };
  let best: Corner = CORNER_ORDER[0] ?? 'bottom-right';
  let bestDistance = Infinity;

  for (const corner of CORNER_ORDER) {
    const at = cornerPosition(corner, bounds, size);
    const distance = Math.hypot(at.x - aim.x, at.y - aim.y);

    if (distance < bestDistance) {
      best = corner;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * The corner beside one, the way an arrow key points.
 *
 * @param corner - Where the window is.
 * @param key - The key's name: `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`.
 * @returns The corner that way - the same one at the edge - or null for any other key.
 */
export function cornerToward(corner: Corner, key: string): Corner | null {
  const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];

  switch (key) {
    case 'ArrowLeft':
      return `${vertical}-left`;
    case 'ArrowRight':
      return `${vertical}-right`;
    case 'ArrowUp':
      return `top-${horizontal}`;
    case 'ArrowDown':
      return `bottom-${horizontal}`;
    default:
      return null;
  }
}

/**
 * How fast the pointer was going when it let go, from its last readings.
 *
 * @param samples - The drag's readings, oldest first, the last where it let go.
 * @returns The velocity; still when the pointer had stopped before letting go.
 */
export function throwVelocity(samples: readonly PointerSample[]): Vector {
  const last = samples.at(-1);
  const first = samples.find(
    (sample) => last !== undefined && last.time - sample.time <= THROW_WINDOW_MS,
  );

  if (last === undefined || first === undefined || last.time - first.time <= 0) {
    return AT_REST;
  }

  const seconds = (last.time - first.time) / 1000;

  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}

/**
 * Moves the spring on by one frame.
 *
 * @param state - Where the window is and how fast it is going.
 * @param target - Where the spring pulls it.
 * @param seconds - The time since the last frame; more than {@link MAX_STEP_SECONDS} counts as that.
 * @returns Where it is now and how fast it is going.
 */
export function stepSpring(state: SpringState, target: Vector, seconds: number): SpringState {
  let { position, velocity } = state;
  let left = Math.min(Math.max(seconds, 0), MAX_STEP_SECONDS);

  while (left > 0) {
    const step = Math.min(left, SUBSTEP_SECONDS);
    const pullX = -SPRING_STIFFNESS * (position.x - target.x) - SPRING_DAMPING * velocity.x;
    const pullY = -SPRING_STIFFNESS * (position.y - target.y) - SPRING_DAMPING * velocity.y;

    // Speed first, then place: the order that keeps a stiff spring from gaining energy.
    velocity = {
      x: velocity.x + (pullX / SPRING_MASS) * step,
      y: velocity.y + (pullY / SPRING_MASS) * step,
    };
    position = { x: position.x + velocity.x * step, y: position.y + velocity.y * step };
    left -= step;
  }

  return { position, velocity };
}

/**
 * Whether the window has arrived.
 *
 * @param state - Where it is and how fast it is going.
 * @param target - Where it is going.
 * @returns True once it is both slow and close.
 */
export function isSettled(state: SpringState, target: Vector): boolean {
  return (
    Math.hypot(state.velocity.x, state.velocity.y) < REST_SPEED &&
    Math.hypot(state.position.x - target.x, state.position.y - target.y) < REST_DISTANCE
  );
}
