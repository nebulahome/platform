/**
 * The interface's implementation of `useEntityPicture` (package SDK 1.2): a camera's latest still,
 * or an image entity's picture, as an address a package's `<img>` shows.
 *
 * Fetched with the session's credentials - an `<img>` cannot send them, and a package never holds
 * them - and handed over as an object URL, let go of when a newer one replaces it or the
 * component goes away. A camera's still is asked for again every so often; an image entity's
 * picture when its revision changes.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { EntityPicture, PictureOptions } from '@nebulahome/package-sdk/ui';

import { apiBlob } from '@/lib/api-client';

/** How often a camera's still is fetched again when the package does not say. */
const DEFAULT_REFRESH_MS = 15_000;

/** The least time between two fetches of a still. */
const MINIMUM_REFRESH_MS = 2_000;

/**
 * Fetches an entity's picture while wanted.
 *
 * @param entityId - A `camera.*` or an `image.*` entity; anything else has none.
 * @param revision - An image entity's revision, which says when its picture changed.
 * @param options - How often a still is fetched again, and whether at all.
 * @returns The picture's address, once fetched.
 */
export function usePictureOf(
  entityId: string,
  revision: string | null,
  options?: PictureOptions,
): EntityPicture {
  const isCamera = entityId.startsWith('camera.');
  const isImage = entityId.startsWith('image.');
  const isWanted = (options?.isEnabled ?? true) && (isCamera || isImage);
  const path = `/entities/${encodeURIComponent(entityId)}/${isCamera ? 'camera/snapshot' : 'image'}`;
  const picture = useQuery({
    queryKey: isCamera ? ['camera-still', entityId] : ['entity-image', entityId, revision],
    enabled: isWanted,
    refetchInterval: isCamera
      ? Math.max(MINIMUM_REFRESH_MS, options?.refreshMs ?? DEFAULT_REFRESH_MS)
      : false,
    retry: false,

    /**
     * Fetches the picture.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The picture.
     */
    queryFn: async ({ signal }) =>
      apiBlob(path, { signal, accept: isCamera ? 'image/jpeg' : 'image/*' }),
  });
  const address = useMemo(
    () => (picture.data === undefined ? null : URL.createObjectURL(picture.data)),
    [picture.data],
  );

  // Each address lets go of its picture once a newer one replaces it, or the component goes away.
  useEffect(
    () => (): void => {
      if (address !== null) {
        URL.revokeObjectURL(address);
      }
    },
    [address],
  );

  return {
    url: isWanted ? address : null,
    isLoading: picture.isLoading,
    error: picture.error,
  };
}
