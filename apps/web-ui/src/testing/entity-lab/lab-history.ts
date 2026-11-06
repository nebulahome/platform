/**
 * Made-up history for the entity lab, in the shapes the history endpoints return: state changes
 * across the window, ending at the state now, and a numeric reading's points as a smooth curve
 * ending at its value now.
 *
 * Each change moves the fields the schema describes - a boolean flips, a number wanders within
 * its bounds, an enum picks another value - so a capability added later has a history too. The
 * same row and window always give the same history, so the chart does not jump on every render.
 */
import type {
  CapabilityName,
  EntityView,
  JsonObject,
  StateHistoryPoint,
  TelemetryPoint,
} from '@nebulahome/contracts';

import type { TimeWindow } from '@/library/history-series';
import type { SheetRange } from '@/routes/library/entity/sheet/sheet-types';
import { capabilityFields } from '@/testing/entity-lab/schema-fields';

/** How long each window is, in milliseconds. */
const SPANS: Readonly<Record<SheetRange, number>> = {
  '6h': 6 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  day: 24 * 3_600_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/**
 * The window a range covers, ending now.
 *
 * @param range - The range.
 * @param now - The time now.
 * @returns The window.
 */
export function windowOfRange(range: SheetRange, now: number): TimeWindow {
  return { from: now - SPANS[range], to: now };
}

/**
 * A small repeatable random number source.
 *
 * @param seed - Where it starts.
 * @returns The next number in [0, 1), each call.
 */
function randomFrom(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A number from a string, to seed the random source with.
 *
 * @param text - The string.
 * @returns Its hash.
 */
function hashOf(text: string): number {
  let hash = 2_166_136_261;

  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619);
  }

  return hash >>> 0;
}

/**
 * Moves one capability's state a step, field by field, as its schema allows.
 *
 * @param capability - The capability.
 * @param values - Its state.
 * @param random - The random source.
 * @returns The state after the step.
 */
function wander(
  capability: CapabilityName,
  values: Record<string, unknown>,
  random: () => number,
): Record<string, unknown> {
  const next = { ...values };

  for (const field of capabilityFields(capability).state) {
    const value = values[field.key];

    if (value === undefined || value === null) {
      continue;
    }

    const kind = field.kind;

    if (kind.type === 'boolean' && random() < 0.6) {
      next[field.key] = !value;
    } else if (kind.type === 'number' && typeof value === 'number') {
      const low = kind.min ?? value - 3;
      const high = kind.max ?? value + 3;
      const span = high - low;
      // Levels jump between round values; readings drift.
      const moved =
        kind.max === 100
          ? Math.round((random() * span + low) / 10) * 10
          : value + (random() - 0.5) * span * 0.2;

      next[field.key] = kind.isInt ? Math.round(moved) : Math.min(high, Math.max(low, moved));
    } else if (kind.type === 'enum' && random() < 0.5) {
      next[field.key] = kind.values[Math.floor(random() * kind.values.length)];
    }
  }

  return next;
}

/**
 * State changes across a window that end at the entity's state now.
 *
 * @param entity - The entity, with its state now.
 * @param range - The window's range, for the seed.
 * @param window - The window.
 * @returns The changes, oldest first.
 */
export function labStateHistory(
  entity: EntityView,
  range: SheetRange,
  window: TimeWindow,
): StateHistoryPoint[] {
  const random = randomFrom(hashOf(`${entity.entityId}:${range}`));
  const current = (entity.state ?? {}) as Record<string, Record<string, unknown>>;
  const count = 7;
  const states: JsonObject[] = [];
  let walking = current;

  // Walked backwards from now, so the last change is the state the entity has now.
  for (let index = 0; index < count; index += 1) {
    states.unshift(walking as JsonObject);
    walking = Object.fromEntries(
      Object.entries(walking).map(([capability, values]) => [
        capability,
        wander(capability as CapabilityName, values, random),
      ]),
    );
  }

  const span = window.to - window.from;
  let previous: JsonObject = walking as JsonObject;

  return states.map((state, index) => {
    const at = window.from + span * ((index + 0.35 + random() * 0.5) / count);
    const point: StateHistoryPoint = {
      time: new Date(at),
      entityId: entity.entityId,
      state,
      previousState: previous,
      attributes: {},
      isAvailable: true,
      source: entity.source,
      context: { type: index % 3 === 0 ? 'automation' : 'user' },
    };

    previous = state;

    return point;
  });
}

/**
 * A numeric reading's points across a window: a smooth curve ending at its value now.
 *
 * @param entity - The entity.
 * @param range - The window's range.
 * @param window - The window.
 * @returns The points, oldest first; empty for an entity that reads no number.
 */
export function labTelemetry(
  entity: EntityView,
  range: SheetRange,
  window: TimeWindow,
): TelemetryPoint[] {
  const reading = (entity.state as { sensor_numeric?: { value?: unknown } } | null)?.sensor_numeric;

  if (typeof reading?.value !== 'number') {
    return [];
  }

  const now = reading.value;
  const count = 48;
  const turns = range === '6h' ? 1 : range === '24h' ? 2 : 7;
  const phase = range === '6h' ? 0.4 : range === '24h' ? 1.1 : 2.3;
  const swing = Math.max(0.5, Math.abs(now) * 0.05);
  const raw = [...Array.from({ length: count }).keys()].map((index) => {
    const t = index / (count - 1);

    return Math.sin(t * Math.PI * turns + phase) * swing + Math.sin(t * 23 + phase) * swing * 0.1;
  });
  const shift = now - (raw.at(-1) ?? 0);
  const span = window.to - window.from;

  return raw.map((value, index) => ({
    time: new Date(window.from + (span * index) / (count - 1)),
    value: value + shift,
    min: value + shift - swing * 0.05,
    max: value + shift + swing * 0.05,
    count: 1,
  }));
}
