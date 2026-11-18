/**
 * A together card's commands: one per member, "Sending" until every member has reported again,
 * and when some do not in time, how many - with Try again for those only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type EntityCommandResponse } from '@nebulahome/contracts';

import type * as Api from '@/library/api';
import { commandEntity } from '@/library/api';
import { useTogetherCommand } from '@/routes/dashboard/cards/together-command';
import type { TogetherMember } from '@/routes/dashboard/cards/together-members';
import { COMMAND_ANSWER_MS } from '@/routes/dashboard/cards/use-card-command';
import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof Api>()),
  commandEntity: vi.fn(),
}));

/**
 * A lamp of the group, as the card reads it.
 *
 * @param entityId - Its address.
 * @param reportedAt - When it last reported.
 * @param more - Anything else about it.
 * @returns The member.
 */
function lamp(
  entityId: string,
  reportedAt: number,
  more: Partial<TogetherMember> = {},
): TogetherMember {
  return {
    entity: sampleEntity(entityId, {
      name: entityId,
      area: 'Kitchen',
      capabilities: [can('on_off'), can('level')],
      state: { on_off: { isOn: false } },
    }),
    state: { on_off: { isOn: false } },
    isAvailable: true,
    canControl: true,
    reportedAt,
    changedAt: null,
    ...more,
  };
}

/**
 * Wraps the hook in the query cache it reads.
 *
 * @param props - The hook's tree.
 * @param props.children - The tree.
 * @returns The tree, in a cache.
 */
function Cache(props: { readonly children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{props.children}</QueryClientProvider>;
}

describe('useTogetherCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const accepted: EntityCommandResponse = {
      entityId: entityIdSchema.parse('light.island'),
      capability: 'on_off',
      acceptedAt: new Date(),
      idempotencyKey: null,
    };

    vi.mocked(commandEntity).mockResolvedValue(accepted);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(commandEntity).mockReset();
  });

  it('sends to each member that can take it and waits for all of them', async () => {
    const pantry = lamp('light.pantry', 1, { isAvailable: false });
    const start = [lamp('light.island', 1), lamp('light.ceiling', 1), pantry];
    const { result, rerender } = renderHook(
      (members: readonly TogetherMember[]) => useTogetherCommand(members),
      { initialProps: start, wrapper: Cache },
    );

    await act(async () => {
      result.current.send('on_off', { command: 'turn_on' });
      await Promise.resolve();
    });

    // The one out of reach is not commanded.
    expect(vi.mocked(commandEntity).mock.calls.map(([entityId]) => entityId)).toEqual([
      'light.island',
      'light.ceiling',
    ]);
    expect(result.current.sending).toBe('on_off');

    // One answers: still sending, until the other does too.
    rerender([lamp('light.island', 2), lamp('light.ceiling', 1), pantry]);
    expect(result.current.sending).toBe('on_off');

    act(() => {
      vi.advanceTimersByTime(COMMAND_ANSWER_MS);
    });

    expect(result.current.sending).toBeNull();
    expect(result.current.hasFailed).toBe(true);
    expect(result.current.unanswered).toBe(1);

    // Try again goes to the one that did not answer, only.
    vi.mocked(commandEntity).mockClear();
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    expect(vi.mocked(commandEntity).mock.calls.map(([entityId]) => entityId)).toEqual([
      'light.ceiling',
    ]);
    expect(result.current.sending).toBe('on_off');
  });
});
