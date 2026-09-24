/**
 * The past a card draws: a sensor's readings, or when a binary sensor fired.
 *
 * The same reads, under the same keys and in the same shape, as the history panel on the entity's
 * own page - so opening a sensor from its card draws its chart at once, and a card drawn after the
 * page reads nothing twice. Read only when the card is large enough to draw it and the person may
 * read history; a card without either never asks.
 */
import { useQuery } from '@tanstack/react-query';

import type { StateHistoryPoint, TelemetryPoint } from '@nebula-home/contracts';

import { fetchStateHistory, fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  telemetryResolutionFor,
  windowOf,
  type HistoryRange,
  type TimeWindow,
} from '@/library/history-series';

/** How often a card reads its history again. */
const REFRESH_MS = 60_000;

/** A window and what happened in it. */
export type CardHistory<TPoint> = {
  readonly window: TimeWindow;
  readonly points: readonly TPoint[];
};

/**
 * Reads a sensor's readings over a range, when wanted.
 *
 * @param entityId - The sensor.
 * @param range - How far back.
 * @param isWanted - Whether the card draws them, and may.
 * @returns The window and its readings, once read.
 */
export function useTelemetry(
  entityId: string,
  range: HistoryRange,
  isWanted: boolean,
): CardHistory<TelemetryPoint> | undefined {
  const query = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entityId, 'telemetry', range],
    /**
     * Reads the window's readings.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the reads when the card goes away.
     * @returns The window and its readings.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOf(range, Date.now());
      const points = await fetchTelemetry(
        { entityId, from: new Date(window.from), to: new Date(window.to) },
        telemetryResolutionFor(window),
        signal,
      );

      return { window, points };
    },
    enabled: isWanted,
    refetchInterval: REFRESH_MS,
  });

  return query.data;
}

/**
 * Reads an entity's changes of state over a range, when wanted.
 *
 * @param entityId - The entity.
 * @param range - How far back.
 * @param isWanted - Whether the card draws them, and may.
 * @returns The window and its changes, once read.
 */
export function useStateChanges(
  entityId: string,
  range: HistoryRange,
  isWanted: boolean,
): CardHistory<StateHistoryPoint> | undefined {
  const query = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entityId, 'state', range],
    /**
     * Reads the window's changes.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the reads when the card goes away.
     * @returns The window and its changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOf(range, Date.now());
      const points = await fetchStateHistory(
        { entityId, from: new Date(window.from), to: new Date(window.to) },
        signal,
      );

      return { window, points };
    },
    enabled: isWanted,
    refetchInterval: REFRESH_MS,
  });

  return query.data;
}
