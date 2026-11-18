/**
 * The members' last day as one, for a together card that draws it: an hour lit when any of them
 * was on in it, and how long at least one was on.
 *
 * Each member's day is read the way a switch card reads its own - same key, same shape - so a
 * card for one plug and a card for the garden's sockets share what they read. A sample card takes
 * its days from the sample source and asks no hub.
 */
import { useQueries } from '@tanstack/react-query';

import { fetchStateHistory, LIBRARY_QUERY_KEYS } from '@/library/api';
import { windowOf } from '@/library/history-series';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';
import type { OnOffDay } from '@/routes/dashboard/cards/on-off-day';
import { groupDay, type TogetherMember } from '@/routes/dashboard/cards/together-members';

/** How often the days are read again. */
const REFRESH_MS = 60_000;

/**
 * Reads the members' last day, when wanted.
 *
 * @param members - The members.
 * @param isWanted - Whether the card draws the day, and may read history.
 * @returns The day, once every member's is read.
 */
export function useTogetherDay(
  members: readonly TogetherMember[],
  isWanted: boolean,
): OnOffDay | undefined {
  const sample = useCardSample();
  const reads = useQueries({
    queries: members.map(({ entity }) => ({
      queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'state', '24h'],
      /**
       * Reads the member's changes over the day.
       *
       * @param context - What TanStack Query provides, including the cancellation signal.
       * @param context.signal - Cancels the read when the card goes away.
       * @returns The window and its changes.
       */
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const window = windowOf('24h', Date.now());
        const points = await fetchStateHistory(
          { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
          signal,
        );

        return { window, points };
      },
      enabled: isWanted && sample === null,
      refetchInterval: REFRESH_MS,
    })),
  });

  if (!isWanted) {
    return undefined;
  }

  const days = members.flatMap((member, index) => {
    const history =
      sample === null ? reads[index]?.data : sample.stateChanges(member.entity.entityId);

    return history === undefined
      ? []
      : [{ history, state: member.entity.state, isAvailable: member.isAvailable }];
  });

  return days.length === members.length ? groupDay(days) : undefined;
}
