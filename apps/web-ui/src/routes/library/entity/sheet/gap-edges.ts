/**
 * Where a quiet stretch of a reading really began and ended.
 *
 * Over a day or a week the chart is drawn from rolled-up buckets - a minute's, an hour's - each
 * at its start, so a gap found between them begins and ends on the bucket: "03:00 – 12:00" when
 * the last reading came at 03:47. The edges are read again here, from the readings themselves:
 * the last one in the bucket before the gap, the first in the bucket after it. An hour is first
 * narrowed to its minute, so no read is more than a minute of readings.
 */
import type { TelemetryResolution } from '@nebulahome/contracts';

import { fetchTelemetry } from '@/library/api';
import type { Gap } from '@/routes/library/entity/sheet/charts';

/** How long each resolution's bucket is: nothing for the readings themselves. */
const BUCKET_MS: Record<TelemetryResolution, number> = {
  raw: 0,
  '1m': 60_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
};

/**
 * Reads the exact edges of a gap found in a reading's buckets.
 *
 * @param entityId - The reading.
 * @param gap - The gap, from the start of the bucket before it to the start of the one after.
 * @param resolution - The buckets it was found in.
 * @param signal - Cancels the reads.
 * @returns The gap from the last reading before it to the first after; an edge whose readings
 *   are no longer kept stays where its bucket put it.
 */
export async function exactGap(
  entityId: string,
  gap: Gap,
  resolution: TelemetryResolution,
  signal: AbortSignal,
): Promise<Gap> {
  const bucket = BUCKET_MS[resolution];

  if (bucket === 0) {
    return gap;
  }

  /**
   * Reads one edge: the last reading of the bucket before the gap, or the first of the one after.
   *
   * @param start - The bucket's start.
   * @param which - Which end of it.
   * @returns The reading's time, or undefined when the bucket has none left.
   */
  const edgeOf = async (start: number, which: 'last' | 'first'): Promise<number | undefined> => {
    /**
     * Picks the edge's reading from a read.
     *
     * @param points - The readings, oldest first.
     * @returns Its time, if there is any.
     */
    const pick = (points: readonly { time: Date }[]): number | undefined =>
      (which === 'last' ? points.at(-1) : points[0])?.time.getTime();
    /**
     * Reads a stretch of the reading.
     *
     * @param from - Where it starts.
     * @param span - How long it is.
     * @param at - At which resolution.
     * @returns Its points, oldest first.
     */
    const read = async (from: number, span: number, at: TelemetryResolution) =>
      fetchTelemetry({ entityId, from: new Date(from), to: new Date(from + span) }, at, signal);
    const minute = bucket > BUCKET_MS['1m'] ? pick(await read(start, bucket, '1m')) : start;

    return minute === undefined
      ? undefined
      : (pick(await read(minute, BUCKET_MS['1m'], 'raw')) ?? minute);
  };

  const [from, to] = await Promise.all([edgeOf(gap.from, 'last'), edgeOf(gap.to, 'first')]);

  return { from: from ?? gap.from, to: to ?? gap.to };
}
