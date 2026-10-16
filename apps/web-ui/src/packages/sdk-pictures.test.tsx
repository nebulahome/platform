/**
 * A package's pictures: a camera's still and an image entity's picture fetched with the session,
 * and nothing fetched for an entity that has neither.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type * as ApiClient from '@/lib/api-client';
import { apiBlob } from '@/lib/api-client';
import { usePictureOf } from '@/packages/sdk-pictures';

vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof ApiClient>()),
  apiBlob: vi.fn(),
}));

/**
 * A fresh query cache around what is rendered.
 *
 * @param props - What is rendered.
 * @param props.children - It.
 * @returns It, with the cache.
 */
function Cache(props: { readonly children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>;
}

describe('usePictureOf', () => {
  it("fetches a camera's still and an image's picture, each from its own address", async () => {
    vi.mocked(apiBlob).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));

    const camera = renderHook(() => usePictureOf('camera.porch', null), { wrapper: Cache });
    const image = renderHook(() => usePictureOf('image.hall_map', 'r2'), { wrapper: Cache });

    await waitFor(() => {
      expect(camera.result.current.url).not.toBeNull();
      expect(image.result.current.url).not.toBeNull();
    });

    expect(
      vi
        .mocked(apiBlob)
        .mock.calls.map((call) => call[0])
        .sort(),
    ).toEqual(['/entities/camera.porch/camera/snapshot', '/entities/image.hall_map/image']);
  });

  it('fetches nothing for an entity that is neither', () => {
    vi.mocked(apiBlob).mockClear();

    const { result } = renderHook(() => usePictureOf('light.hall', null), { wrapper: Cache });

    expect(result.current.url).toBeNull();
    expect(vi.mocked(apiBlob)).not.toHaveBeenCalled();
  });
});
