/**
 * The cache forgets every answer when the session ends.
 */
import { describe, expect, it } from 'vitest';

import { useSession } from '@/auth/session-store';

import { queryClient } from './query-client';

describe('queryClient', () => {
  it('empties itself when the person is signed out', () => {
    useSession.setState({ status: 'signed-in' });
    queryClient.setQueryData(['library', 'devices'], ['the last person’s devices']);

    useSession.setState({ status: 'signed-out' });

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
