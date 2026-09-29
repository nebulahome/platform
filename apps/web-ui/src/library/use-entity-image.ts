/**
 * An image entity's picture - a robot's map, drawn by its integration - as an address an `<img>`
 * can show.
 *
 * The entity's state says only which picture it is (`revision`); the bytes come from its image
 * endpoint, fetched with the session's credentials - an `<img>` cannot send them - and handed over
 * as an object URL, let go of once a newer one replaces it. A new revision is a new query, so the
 * picture follows the entity's live state without being asked on a timer.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { apiBlob } from '@/lib/api-client';

/**
 * Fetches one revision of an image entity's picture.
 *
 * @param entityId - The entity.
 * @param revision - Which picture; null before the entity has one.
 * @param contentType - What it is, which the request accepts.
 * @returns The picture's address, or null before there is one.
 */
export function useEntityImage(
  entityId: string,
  revision: string | null,
  contentType: string,
): string | null {
  const picture = useQuery({
    queryKey: ['entity-image', entityId, revision],
    enabled: revision !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,

    /**
     * Fetches the picture.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The picture.
     */
    queryFn: async ({ signal }) =>
      apiBlob(
        `/entities/${encodeURIComponent(entityId)}/image?revision=${encodeURIComponent(revision ?? '')}`,
        { signal, accept: contentType },
      ),

    /**
     * Keeps the last picture on screen while the next one loads, so a map redrawn every few
     * seconds does not blink.
     *
     * @param previous - The picture shown before.
     * @returns It, until the next one arrives.
     */
    placeholderData: (previous) => previous,
  });
  const address = useMemo(
    () => (picture.data === undefined ? null : URL.createObjectURL(picture.data)),
    [picture.data],
  );

  useEffect(
    () => (): void => {
      if (address !== null) {
        URL.revokeObjectURL(address);
      }
    },
    [address],
  );

  return address;
}
