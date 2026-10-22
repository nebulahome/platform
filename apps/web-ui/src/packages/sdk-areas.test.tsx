/**
 * The areas as a package sees them: each names its parent by key, the way an entity names its
 * area, never by the API's ids.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type * as Api from '@/library/api';
import { createArea, fetchAreas, updateArea } from '@/library/api';
import { areaViewsOf, useAreaActions } from '@/packages/sdk-areas';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof Api>()),
  fetchAreas: vi.fn(),
  createArea: vi.fn(),
  updateArea: vi.fn(),
  deleteArea: vi.fn(),
}));

const HOUSE = '0199f0e0-0000-7000-8000-000000000001';
const GROUND = '0199f0e0-0000-7000-8000-000000000002';

describe('areaViewsOf', () => {
  it('names each parent by its key, and keeps the owner’s order', () => {
    const base = { icon: null, deviceCount: 0, entityCount: 0 };

    expect(
      areaViewsOf([
        {
          ...base,
          id: HOUSE,
          key: 'home',
          name: 'Home',
          kind: 'house',
          parentId: null,
          sortOrder: 0,
          level: null,
          latitude: 45.07,
          longitude: 7.69,
        },
        {
          ...base,
          id: GROUND,
          key: 'ground_floor',
          name: 'Ground floor',
          kind: 'floor',
          parentId: HOUSE,
          sortOrder: 0,
          level: 0,
          latitude: null,
          longitude: null,
        },
        {
          ...base,
          id: '0199f0e0-0000-7000-8000-000000000003',
          key: 'kitchen',
          name: 'Kitchen',
          kind: 'room',
          parentId: GROUND,
          sortOrder: 1,
          level: null,
          latitude: null,
          longitude: null,
        },
      ]),
    ).toEqual([
      {
        key: 'home',
        name: 'Home',
        kind: 'house',
        parentKey: null,
        icon: null,
        sortOrder: 0,
        level: null,
        latitude: 45.07,
        longitude: 7.69,
      },
      {
        key: 'ground_floor',
        name: 'Ground floor',
        kind: 'floor',
        parentKey: 'home',
        icon: null,
        sortOrder: 0,
        level: 0,
        latitude: null,
        longitude: null,
      },
      {
        key: 'kitchen',
        name: 'Kitchen',
        kind: 'room',
        parentKey: 'ground_floor',
        icon: null,
        sortOrder: 1,
        level: null,
        latitude: null,
        longitude: null,
      },
    ]);
  });
});

describe('useAreaActions', () => {
  const base = {
    icon: null,
    deviceCount: 0,
    entityCount: 0,
    sortOrder: 0,
    latitude: null,
    longitude: null,
  };
  const house = {
    ...base,
    id: HOUSE,
    key: 'home',
    name: 'Home',
    kind: 'house' as const,
    parentId: null,
    level: null,
  };
  const ground = {
    ...base,
    id: GROUND,
    key: 'ground_floor',
    name: 'Ground floor',
    kind: 'floor' as const,
    parentId: HOUSE,
    level: 0,
  };

  /**
   * A fresh query cache around the hook.
   *
   * @param props - What it wraps.
   * @param props.children - The hook's host.
   * @returns The provider.
   */
  function Cache(props: { readonly children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}>{props.children}</QueryClientProvider>;
  }

  it('names areas by key to the API, and a new one by its parent’s key', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([house, ground]);
    vi.mocked(createArea).mockResolvedValue({
      ...ground,
      id: '0199f0e0-0000-7000-8000-000000000009',
      key: 'first_floor',
      name: 'First floor',
      level: 1,
    });
    vi.mocked(updateArea).mockResolvedValue(ground);

    const { result } = renderHook(() => useAreaActions(), { wrapper: Cache });

    await waitFor(() => {
      expect(vi.mocked(fetchAreas)).toHaveBeenCalled();
    });

    const created = await result.current.create({
      kind: 'floor',
      name: 'First floor',
      parentKey: 'home',
      level: 1,
    });

    expect(vi.mocked(createArea)).toHaveBeenCalledWith({
      kind: 'floor',
      name: 'First floor',
      parentId: HOUSE,
      level: 1,
    });
    expect(created).toMatchObject({ key: 'first_floor', parentKey: 'home', level: 1 });

    await result.current.rename('ground_floor', 'Ground');

    expect(vi.mocked(updateArea)).toHaveBeenCalledWith(GROUND, { name: 'Ground' });
    await expect(result.current.remove('attic')).rejects.toThrow('There is no area attic');
  });
});
