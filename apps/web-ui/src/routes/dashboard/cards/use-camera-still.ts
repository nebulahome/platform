/**
 * A camera's latest still, as an address an `<img>` can show.
 *
 * Fetched with the session's credentials - an `<img>` cannot send them - and handed over as an
 * object URL, let go of when a newer one replaces it or the component goes away. Asked again
 * every so often while wanted: a still is a moment, and the card should not show an hour-old one.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { apiBlob } from '@/lib/api-client';

/** How often a still is fetched again while it is shown. */
const REFRESH_MS = 15_000;

/**
 * Fetches a camera's still while wanted.
 *
 * @param entityId - The camera.
 * @param isWanted - Whether to fetch it now.
 * @returns The still's address, or null before there is one.
 */
export function useCameraStill(entityId: string, isWanted: boolean): string | null {
  const still = useQuery({
    queryKey: ['camera-still', entityId],
    enabled: isWanted,
    refetchInterval: REFRESH_MS,
    retry: false,

    /**
     * Fetches the still.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The picture.
     */
    queryFn: async ({ signal }) =>
      apiBlob(`/entities/${encodeURIComponent(entityId)}/camera/snapshot`, {
        signal,
        accept: 'image/jpeg',
      }),
  });
  const address = useMemo(
    () => (still.data === undefined ? null : URL.createObjectURL(still.data)),
    [still.data],
  );

  // Each address lets go of its picture once a newer one replaces it, or the card goes away.
  useEffect(
    () => (): void => {
      if (address !== null) {
        URL.revokeObjectURL(address);
      }
    },
    [address],
  );

  return isWanted ? address : null;
}
