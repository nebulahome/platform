/**
 * Reads a device's activity, page by page, and reads it again when one of its entities changes.
 *
 * The newest page comes first and older ones follow on request. The live channel says when an
 * entity of the device changed; the activity is read again shortly after rather than at once, so a
 * power meter's burst of readings - which are not in the activity - or a relay and its reading
 * changing together cost one read, not a dozen.
 */
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { ActivityEntry } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDeviceActivity, LIBRARY_QUERY_KEYS, type ActivityPage } from '@/library/api';
import { useLive } from '@/live/live-store';

/** How long after a live change the activity is read again, in milliseconds. */
const REREAD_AFTER_MS = 1500;

/** What the panel gets. */
export type DeviceActivity = {
  /** Every entry read so far, newest first; undefined until the first page is in. */
  readonly entries: readonly ActivityEntry[] | undefined;

  /** Why the read failed, when it did. */
  readonly error: unknown;

  /** Whether there are older entries to read. */
  readonly hasMore: boolean;

  /** Whether older entries are being read. */
  readonly isLoadingMore: boolean;

  /** Reads the next, older page. */
  readonly loadMore: () => void;

  /** Whether the person may read the device's past at all. */
  readonly canRead: boolean;
};

/**
 * Reads a device's activity.
 *
 * @param deviceId - The device.
 * @param entityIds - Its entities, whose live changes are what makes the activity read again.
 * @returns See {@link DeviceActivity}.
 */
export function useDeviceActivity(deviceId: string, entityIds: readonly string[]): DeviceActivity {
  const canRead = useSession((state) => state.can('history:read'));
  const queryClient = useQueryClient();
  const queryKey = [...LIBRARY_QUERY_KEYS.activity, deviceId];

  const activity = useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage>,
    readonly unknown[],
    string | undefined
  >({
    queryKey,
    enabled: canRead && deviceId !== '',
    initialPageParam: undefined,

    /**
     * Reads one page.
     *
     * @param context - The page's cursor and the abort signal.
     * @param context.pageParam - Where the page starts; undefined for the newest.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The page.
     */
    queryFn: async ({ pageParam, signal }) => fetchDeviceActivity(deviceId, pageParam, signal),

    /**
     * Says where the next page starts.
     *
     * @param last - The page just read.
     * @returns Its cursor, or undefined on the last page.
     */
    getNextPageParam: (last) => last.nextCursor,
  });

  // A fingerprint of when each of the device's entities last changed, as the channel has it.
  const changedAt = useLive((state) =>
    entityIds.map((entityId) => state.readings[entityId]?.changedAt.getTime() ?? 0).join(','),
  );

  // What the fingerprint was when the activity was first read: a change is a difference from it.
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = changedAt;

      return undefined;
    }

    if (!canRead || seen.current === changedAt) {
      return undefined;
    }

    seen.current = changedAt;

    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: [...LIBRARY_QUERY_KEYS.activity, deviceId] });
    }, REREAD_AFTER_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [canRead, changedAt, deviceId, queryClient]);

  return {
    entries: activity.data?.pages.flatMap((page) => page.items),
    error: activity.error,
    hasMore: activity.hasNextPage,
    isLoadingMore: activity.isFetchingNextPage,
    /** Reads the next, older page. */
    loadMore: () => {
      void activity.fetchNextPage();
    },
    canRead,
  };
}
