/**
 * What a calculated alias would have read over the last day, worked out in the browser from its
 * sources' history: the board's Preview.
 *
 * The server keeps no history of a formula that has not been saved, so the preview is the formula
 * run again over what its sources recorded. Each source's readings come in hourly buckets; at
 * every bucket any source reported, the formula is worked out with the latest value of each source
 * so far, the way the alias engine works it out whenever one source changes. Until every source
 * has said something there is nothing to work out, and a result that is not a number - a formula
 * that compares - has no line to draw.
 *
 * It is an approximation and says so on the card: bucket averages, not the readings themselves,
 * and no debounce or fallback.
 */
import {
  evaluateAliasExpression,
  type AliasScalar,
  type TelemetryPoint,
} from '@nebulahome/contracts';

/** One source's history, under the variable the formula names it by. */
export type PreviewSource = {
  readonly variableName: string;

  /** Its readings, oldest first. */
  readonly points: readonly TelemetryPoint[];
};

/** One point of the preview. */
export type PreviewPoint = {
  /** Milliseconds since the epoch. */
  readonly at: number;
  readonly value: number;
};

/**
 * Runs a formula over its sources' history.
 *
 * @param expression - The formula.
 * @param sources - Each source's readings.
 * @returns What the formula worked out to at every moment one of the sources reported, oldest
 * first; empty when a source never reported or the formula never gave a number.
 */
export function previewSeries(
  expression: string,
  sources: readonly PreviewSource[],
): PreviewPoint[] {
  const names = new Set(sources.map((source) => source.variableName));
  const times = [
    ...new Set(sources.flatMap((source) => source.points.map((point) => point.time.getTime()))),
  ].sort((left, right) => left - right);
  const cursors = sources.map(() => 0);
  const latest = new Map<string, AliasScalar>();
  const series: PreviewPoint[] = [];

  for (const at of times) {
    sources.forEach((source, index) => {
      let cursor = cursors[index] ?? 0;
      let point = source.points[cursor];

      while (point !== undefined && point.time.getTime() <= at) {
        latest.set(source.variableName, point.value);
        cursor += 1;
        point = source.points[cursor];
      }

      cursors[index] = cursor;
    });

    if (latest.size < names.size) {
      continue;
    }

    const evaluated = evaluateAliasExpression(expression, latest);

    if (evaluated.ok && typeof evaluated.value === 'number') {
      series.push({ at, value: evaluated.value });
    }
  }

  return series;
}

/**
 * The lowest and the highest point of a preview.
 *
 * @param series - The preview.
 * @returns Both, or null for an empty preview.
 */
export function previewRange(
  series: readonly PreviewPoint[],
): { readonly min: number; readonly max: number } | null {
  if (series.length === 0) {
    return null;
  }

  const values = series.map((point) => point.value);

  return { min: Math.min(...values), max: Math.max(...values) };
}
