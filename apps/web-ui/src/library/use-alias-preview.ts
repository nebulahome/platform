/**
 * The dashed line of a number part being edited: its new source worked out over the same last
 * day as the saved line, from its inputs' readings.
 *
 * The readings are read once per input and reused while the source is edited, so typing a
 * formula costs no request per key once its entities are known.
 */
import { useQueries } from '@tanstack/react-query';

import {
  aliasExpressionNames,
  ENTITY_ID_PATTERN,
  type AliasPartConfig,
} from '@nebulahome/contracts';

import {
  combinedSeries,
  formulaSeries,
  type PreviewInput,
  type PreviewPoint,
} from '@/library/alias-preview';
import { fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import { telemetryResolutionFor } from '@/library/history-series';

/** How far back the preview reaches. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an input's readings are reused before they are read again. */
const STALE_MS = 5 * 60 * 1000;

/**
 * The entities a source reads, for its preview.
 *
 * @param config - The source.
 * @returns Their ids; none for a source with no line to draw.
 */
export function previewInputs(config: AliasPartConfig): string[] {
  switch (config.from) {
    case 'entity':
      return [config.entity];
    case 'entities':
      return [...config.entities];
    case 'formula': {
      try {
        return [...new Set(aliasExpressionNames(config.formula))].filter((name) =>
          ENTITY_ID_PATTERN.test(name),
        );
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}

/**
 * Works a number part's edited source out over the last day.
 *
 * @param config - The edited source, or undefined when nothing is edited.
 * @returns The series, or undefined while there is none to draw.
 */
export function useEditPreview(config: AliasPartConfig | undefined): PreviewPoint[] | undefined {
  const ids = config === undefined ? [] : previewInputs(config);
  const histories = useQueries({
    queries: ids.map((entityId) => ({
      queryKey: [...LIBRARY_QUERY_KEYS.history, entityId, 'alias-preview'],
      staleTime: STALE_MS,

      /**
       * Reads the input's last day.
       *
       * @param context - What TanStack Query provides.
       * @param context.signal - Cancels the read.
       * @returns Its readings.
       */
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const to = Date.now();
        const window = { from: to - DAY_MS, to };

        return fetchTelemetry(
          { entityId, from: new Date(window.from), to: new Date(window.to) },
          telemetryResolutionFor(window),
          signal,
        );
      },
    })),
  });

  if (
    config === undefined ||
    ids.length === 0 ||
    histories.some((history) => history.data === undefined)
  ) {
    return undefined;
  }

  const inputs: PreviewInput[] = ids.map((entityId, index) => ({
    entityId,
    points: histories[index]?.data ?? [],
  }));

  switch (config.from) {
    case 'formula':
      return formulaSeries(config.formula, inputs);
    case 'entities':
      return combinedSeries(config.rule, inputs);
    default:
      return inputs[0]?.points.map((point) => ({ at: point.time.getTime(), value: point.value }));
  }
}
