/**
 * A part being edited, worked out over the last day from its inputs' readings: the dashed line
 * the Parts tab draws over the saved one, so a change is seen before it is saved.
 *
 * Only numbers have a line to draw: a formula over entity readings (names are entity ids, as the
 * formula writes them), one entity's readings, or several entities combined by a rule. Each
 * input's readings are stepped forward together; a time where an input has not reported yet is
 * left out rather than guessed.
 */
import {
  evaluateAliasExpression,
  type AliasRule,
  type TelemetryPoint,
} from '@nebulahome/contracts';

/** One input's readings, oldest first. */
export type PreviewInput = {
  readonly entityId: string;
  readonly points: readonly TelemetryPoint[];
};

/** One point of the preview. */
export type PreviewPoint = {
  /** Milliseconds since the epoch. */
  readonly at: number;
  readonly value: number;
};

/**
 * Steps every input forward together and works out a value at each time any of them reported.
 *
 * @param inputs - The inputs' readings.
 * @param valueAt - The value from every input's latest reading, or null for none.
 * @returns The series.
 */
function stepTogether(
  inputs: readonly PreviewInput[],
  valueAt: (latest: ReadonlyMap<string, number>) => number | null,
): PreviewPoint[] {
  const times = [
    ...new Set(inputs.flatMap((input) => input.points.map((point) => point.time.getTime()))),
  ].sort((left, right) => left - right);
  const cursors = inputs.map(() => 0);
  const latest = new Map<string, number>();
  const series: PreviewPoint[] = [];

  for (const at of times) {
    inputs.forEach((input, index) => {
      let cursor = cursors[index] ?? 0;
      let point = input.points[cursor];

      while (point !== undefined && point.time.getTime() <= at) {
        latest.set(input.entityId, point.value);
        cursor += 1;
        point = input.points[cursor];
      }

      cursors[index] = cursor;
    });

    if (latest.size < inputs.length) {
      continue;
    }

    const value = valueAt(latest);

    if (value !== null && Number.isFinite(value)) {
      series.push({ at, value });
    }
  }

  return series;
}

/**
 * A formula over its inputs' readings.
 *
 * @param formula - The formula, naming entities by id.
 * @param inputs - The readings of the entities it names.
 * @returns The series; empty when it never works out to a number.
 */
export function formulaSeries(formula: string, inputs: readonly PreviewInput[]): PreviewPoint[] {
  return stepTogether(inputs, (latest) => {
    const evaluated = evaluateAliasExpression(formula, latest);

    return evaluated.ok && typeof evaluated.value === 'number' ? evaluated.value : null;
  });
}

/**
 * Several entities' readings combined by a rule.
 *
 * @param rule - How they combine.
 * @param inputs - Their readings.
 * @returns The series; empty for a rule that makes no number.
 */
export function combinedSeries(rule: AliasRule, inputs: readonly PreviewInput[]): PreviewPoint[] {
  return stepTogether(inputs, (latest) => {
    const values = [...latest.values()];

    switch (rule) {
      case 'average':
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'sum':
        return values.reduce((sum, value) => sum + value, 0);
      case 'first':
        return values[0] ?? null;
      default:
        return null;
    }
  });
}
