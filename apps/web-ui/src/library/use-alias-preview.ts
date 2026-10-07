/**
 * The last day of a calculated alias that may not be saved yet, for the editor's Preview.
 *
 * Reads each source's hourly history once - the same buckets the entity pages chart - and runs
 * the formula over them in the browser ({@link previewSeries}). The histories are cached for five
 * minutes by entity, so typing in the formula costs nothing but the arithmetic; choosing another
 * entity for a source reads that one.
 */
import { useQueries } from '@tanstack/react-query';

import { previewSeries, type PreviewPoint } from '@/library/alias-preview';
import type { SourceDraft } from '@/library/alias-sources';
import { fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';

/** How far back the preview reaches. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a source's history is reused before it is read again. */
const STALE_MS = 5 * 60 * 1000;

/** What the preview can show. */
export type AliasPreview =
  | { readonly status: 'waiting' }
  | { readonly status: 'reading' }
  | { readonly status: 'failed'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly points: readonly PreviewPoint[];
      readonly from: number;
      readonly to: number;
    };

/**
 * Reads the sources' history and works the formula out over it.
 *
 * @param expression - The formula as it is typed.
 * @param sources - The source rows.
 * @param isEnabled - False for an alias that is not calculated, or a formula that cannot run.
 * @returns Waiting until every source names an entity, then the preview.
 */
export function useAliasPreview(
  expression: string,
  sources: readonly SourceDraft[],
  isEnabled: boolean,
): AliasPreview {
  const chosen = sources.filter(
    (source) => source.entityId !== '' && source.variableName.trim() !== '',
  );
  const isComplete = isEnabled && chosen.length > 0 && chosen.length === sources.length;

  const histories = useQueries({
    queries: chosen.map((source) => ({
      queryKey: [...LIBRARY_QUERY_KEYS.history, source.entityId, 'alias-preview'],
      enabled: isComplete,
      staleTime: STALE_MS,

      /**
       * Reads the source's last day, by the hour.
       *
       * @param context - What TanStack Query provides.
       * @param context.signal - Cancels the read.
       * @returns The window and its readings.
       */
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const to = new Date();
        const from = new Date(to.getTime() - DAY_MS);
        const points = await fetchTelemetry({ entityId: source.entityId, from, to }, '1h', signal);

        return { from: from.getTime(), to: to.getTime(), points };
      },
    })),
  });

  if (!isComplete) {
    return { status: 'waiting' };
  }

  const failed = histories.find((history) => history.error !== null);

  if (failed !== undefined) {
    return { status: 'failed', error: failed.error };
  }

  const loaded = histories.flatMap((history) => (history.data === undefined ? [] : [history.data]));

  if (loaded.length < chosen.length) {
    return { status: 'reading' };
  }

  return {
    status: 'ready',
    points: previewSeries(
      expression,
      chosen.map((source, index) => ({
        variableName: source.variableName.trim(),
        points: loaded[index]?.points ?? [],
      })),
    ),
    from: Math.min(...loaded.map((history) => history.from)),
    to: Math.max(...loaded.map((history) => history.to)),
  };
}
