/**
 * The system monitor, kept fresh while the page is open.
 *
 * Asked again every ten seconds - the pace `core` samples at, so each answer carries one new
 * sample and the charts move by one step. Not while the tab is hidden: nobody is looking, and a
 * page left open in the background all day would otherwise ask eight thousand times for charts
 * nobody sees. The window of samples is `core`'s, so the charts are full the moment the page
 * opens rather than filling up from empty.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { SystemMonitorSnapshot } from '@nebula-home/contracts';

import { fetchSystemMonitor, SYSTEM_QUERY_KEYS } from '@/system/api';

/** How often the page asks again. */
export const SYSTEM_MONITOR_REFRESH_MS = 10_000;

/**
 * Reads the system monitor and keeps reading it.
 *
 * @returns The query.
 */
export function useSystemMonitor(): UseQueryResult<SystemMonitorSnapshot> {
  return useQuery({
    queryKey: SYSTEM_QUERY_KEYS.monitor,

    /**
     * Reads the snapshot.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The snapshot.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchSystemMonitor(signal),
    refetchInterval: SYSTEM_MONITOR_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
