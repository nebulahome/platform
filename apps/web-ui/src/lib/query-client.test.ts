/**
 * The cache forgets every answer when the session ends.
 */
import { describe, expect, it } from 'vitest';

import { useSession } from '@/auth/session-store';

import { KEPT_FRESH_STALE_MS, queryClient } from './query-client';

describe('queryClient', () => {
  it('empties itself when the person is signed out', () => {
    useSession.setState({ status: 'signed-in' });
    queryClient.setQueryData(['library', 'devices'], ['the last person’s devices']);

    useSession.setState({ status: 'signed-out' });

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('keeps the answers the live channel announces every change of, and only those', () => {
    expect(queryClient.getQueryDefaults(['dashboards', 'manage']).staleTime).toBe(
      KEPT_FRESH_STALE_MS,
    );
    expect(queryClient.getQueryDefaults(['library', 'icons', 'interface']).staleTime).toBe(
      KEPT_FRESH_STALE_MS,
    );
    expect(queryClient.getQueryDefaults(['library', 'entities']).staleTime).toBeUndefined();
    expect(queryClient.getQueryDefaults(['library', 'activity']).staleTime).toBeUndefined();
  });
});
