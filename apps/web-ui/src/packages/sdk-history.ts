/**
 * The interface's implementation of `useStateHistory` and `useTelemetry` (package SDK 1.2): the
 * past of some entities, as a package's page, card or view reads it.
 *
 * The same reads the entity pages make - the API's history endpoints, with the viewer's session,
 * so an entity the viewer may not read has no points - one query per entity, each following the
 * pages of its window up to the cap a chart has use for. A window of "the last hour" is resolved
 * when it is read, so its key stays the same as it moves and a refetch reads the hour that ends
 * now.
 */
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  capabilityStateSchema,
  MAX_PAGE_LIMIT,
  telemetryResolutionForSpan,
  type StateHistoryPoint as ApiStatePoint,
  type TelemetryPoint as ApiTelemetryPoint,
} from '@nebulahome/contracts';
import type { CapabilityState } from '@nebulahome/package-sdk';
import type {
  History,
  HistoryQuery,
  HistoryWindow,
  StateHistoryPoint,
  Telemetry,
  TelemetryPoint,
  TelemetryQuery,
  TelemetryResolution,
} from '@nebulahome/package-sdk/ui';

import { fetchStateHistory, fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';

/** The most entities one read takes, as the SDK says. */
const MAX_ENTITIES = 64;

/** How many points one entity's read brings back at most: four pages, as the charts read. */
const MAX_POINTS = 4 * MAX_PAGE_LIMIT;

/** A window, in milliseconds since the epoch. */
type Span = { readonly from: number; readonly to: number };

/** One entity's read: its window and its points. */
type EntityRead<TPoint> = {
  readonly entityId: string;
  readonly window: Span;
  readonly points: readonly TPoint[];
};

/**
 * The window a query names, as it stands now.
 *
 * @param window - Two moments, or the last so many milliseconds.
 * @param now - The present.
 * @returns The window.
 */
function spanOf(window: HistoryWindow, now: number): Span {
  return 'lastMs' in window
    ? { from: now - window.lastMs, to: now }
    : { from: Date.parse(window.from), to: Date.parse(window.to) };
}

/**
 * What names a window in a query key: the same while a relative one moves.
 *
 * @param window - The window.
 * @returns Its key.
 */
function keyOf(window: HistoryWindow): string {
  return 'lastMs' in window ? `last:${String(window.lastMs)}` : `${window.from}/${window.to}`;
}

/**
 * The entities a read takes: each once, at most {@link MAX_ENTITIES} - the SDK says so, and the
 * rest are left out.
 *
 * @param entityIds - What the package named.
 * @returns Them.
 */
function entitiesOf(entityIds: readonly string[]): readonly string[] {
  return [...new Set(entityIds)].slice(0, MAX_ENTITIES);
}

/**
 * A recorded state, as the SDK types it: the capabilities it holds, none left undefined.
 *
 * @param recorded - As history stored it.
 * @returns The state, or empty when it does not read.
 */
function stateOf(recorded: unknown): CapabilityState {
  const parsed = capabilityStateSchema.safeParse(recorded);
  const held = parsed.success
    ? Object.fromEntries(Object.entries(parsed.data).filter((entry) => entry[1] !== undefined))
    : {};

  /**
   * Says whether what is held is a state: capabilities, each with its fields.
   *
   * @param value - What is held.
   * @returns True for a record.
   */
  const isState = (value: unknown): value is CapabilityState =>
    typeof value === 'object' && value !== null;

  return isState(held) ? held : {};
}

/**
 * A change of state, as the SDK hands it to a package.
 *
 * @param point - As the API answered it.
 * @returns The point.
 */
function statePointOf(point: ApiStatePoint): StateHistoryPoint {
  return {
    time: point.time.toISOString(),
    state: stateOf(point.state),
    previousState: point.previousState === null ? null : stateOf(point.previousState),
    attributes: point.attributes,
    isAvailable: point.isAvailable,
    source: point.source,
    ...(point.context === undefined
      ? {}
      : {
          cause: {
            type: point.context.type,
            ...(point.context.id === undefined ? {} : { id: point.context.id }),
          },
        }),
  };
}

/**
 * A reading, as the SDK hands it to a package.
 *
 * @param point - As the API answered it.
 * @returns The point.
 */
function telemetryPointOf(point: ApiTelemetryPoint): TelemetryPoint {
  return {
    time: point.time.toISOString(),
    value: point.value,
    ...(point.min === undefined ? {} : { min: point.min }),
    ...(point.max === undefined ? {} : { max: point.max }),
    ...(point.count === undefined ? {} : { count: point.count }),
  };
}

/**
 * Gathers the reads of every entity into one answer.
 *
 * An entity the viewer may not read, or that is gone, fails alone and is left out: the read fails
 * only when every entity's did.
 *
 * @param results - Each entity's read.
 * @returns The answer.
 */
function gather<TPoint>(results: readonly UseQueryResult<EntityRead<TPoint>>[]): History<TPoint> {
  const series: Record<string, readonly TPoint[]> = {};
  const truncated: string[] = [];
  let window: Span | undefined;

  for (const result of results) {
    if (result.data !== undefined) {
      series[result.data.entityId] = result.data.points;
      window ??= result.data.window;

      if (result.data.points.length >= MAX_POINTS) {
        truncated.push(result.data.entityId);
      }
    }
  }

  const errors = results.flatMap((result) => (result.error === null ? [] : [result.error]));

  return {
    series,
    window,
    truncated,
    isLoading: results.some((result) => result.isLoading),
    error: errors.length > 0 && errors.length === results.length ? (errors[0] ?? null) : null,

    /** Reads every entity again. */
    refetch: () => {
      for (const result of results) {
        void result.refetch();
      }
    },
  };
}

/**
 * The recorded changes of some entities over a window.
 *
 * @param query - Which entities, which window, how often.
 * @returns Each entity's changes, oldest first.
 */
export function useStateHistory(query: HistoryQuery): History<StateHistoryPoint> {
  const combine = useCallback(
    (results: UseQueryResult<EntityRead<StateHistoryPoint>>[]) => gather(results),
    [],
  );

  return useQueries({
    queries: entitiesOf(query.entityIds).map((entityId) => ({
      queryKey: [...LIBRARY_QUERY_KEYS.history, entityId, 'package-state', keyOf(query.window)],
      enabled: query.isEnabled ?? true,
      refetchInterval: query.refetchIntervalMs ?? false,
      retry: false,

      /**
       * Reads one entity's changes.
       *
       * @param context - The query's abort signal.
       * @param context.signal - Cancels the reads.
       * @returns Its window and changes.
       */
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const window = spanOf(query.window, Date.now());
        const points = await fetchStateHistory(
          { entityId, from: new Date(window.from), to: new Date(window.to) },
          signal,
        );

        return { entityId, window, points: points.map((point) => statePointOf(point)) };
      },
    })),
    combine,
  });
}

/**
 * The numeric readings of some entities over a window.
 *
 * @param query - Which entities, which window, which resolution, how often.
 * @returns Each entity's readings, oldest first, and the resolution read.
 */
export function useTelemetry(query: TelemetryQuery): Telemetry {
  const length =
    'lastMs' in query.window
      ? query.window.lastMs
      : Date.parse(query.window.to) - Date.parse(query.window.from);
  const resolution: TelemetryResolution =
    query.resolution === undefined || query.resolution === 'auto'
      ? telemetryResolutionForSpan(length)
      : query.resolution;
  const combine = useCallback(
    (results: UseQueryResult<EntityRead<TelemetryPoint>>[]) => gather(results),
    [],
  );
  const history = useQueries({
    queries: entitiesOf(query.entityIds).map((entityId) => ({
      queryKey: [
        ...LIBRARY_QUERY_KEYS.history,
        entityId,
        'package-telemetry',
        keyOf(query.window),
        resolution,
      ],
      enabled: query.isEnabled ?? true,
      refetchInterval: query.refetchIntervalMs ?? false,
      retry: false,

      /**
       * Reads one entity's readings.
       *
       * @param context - The query's abort signal.
       * @param context.signal - Cancels the reads.
       * @returns Its window and readings.
       */
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const window = spanOf(query.window, Date.now());
        const points = await fetchTelemetry(
          { entityId, from: new Date(window.from), to: new Date(window.to) },
          resolution,
          signal,
        );

        return { entityId, window, points: points.map((point) => telemetryPointOf(point)) };
      },
    })),
    combine,
  });

  return { ...history, resolution };
}
