/**
 * What the automation and activity cards read: the automations, the house's place and zone for
 * when one next runs, and the latest changes of the house, an area or a few entities.
 *
 * Under a sample source (the Add card catalogue, the lab) they read the samples instead and ask
 * the hub nothing, as every other card does.
 */
import { useQuery } from '@tanstack/react-query';

import {
  automationTriggerSchema,
  clockAtToCron,
  nextSunEvent,
  type ActivityEntry,
  type ActivityScope,
  type AutomationView,
  type GeoPosition,
} from '@nebulahome/contracts';

import { nextCronRuns } from '@/lib/cron-words';
import { signalled } from '@/lib/signalled';
import {
  fetchActivity,
  fetchAutomationHouse,
  fetchAutomations,
  LIBRARY_QUERY_KEYS,
} from '@/library/api';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';

/** How often the activity card reads again. */
const ACTIVITY_REFRESH_MS = 30_000;

/** Where the house is and its time zone, for when a schedule next comes round. */
export type HouseClock = {
  readonly position: GeoPosition | null;
  readonly timeZone: string;
};

/**
 * The automations this person may see.
 *
 * @returns The automations, empty until read.
 */
export function useAutomationList(): readonly AutomationView[] {
  const sample = useCardSample();
  const query = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    queryFn: signalled(fetchAutomations),
    enabled: sample === null,
  });

  return sample?.automations ?? query.data ?? [];
}

/**
 * Where the house is and its zone.
 *
 * @returns The house's clock; UTC with no position until read.
 */
export function useHouseClock(): HouseClock {
  const sample = useCardSample();
  const query = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automationHouse,
    queryFn: signalled(fetchAutomationHouse),
    enabled: sample === null,
    staleTime: 3_600_000,
  });

  return {
    position: query.data?.position ?? null,
    timeZone: query.data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * When an automation next runs on its own: the soonest of its time and sun triggers. One that
 * only answers to its entities has no next run to say.
 *
 * @param automation - The automation.
 * @param house - Where the house is and its zone.
 * @param now - The moment to look past.
 * @returns The next run, and whether it is the sun's; null when nothing schedules it.
 */
export function nextRunOf(
  automation: Pick<AutomationView, 'definition' | 'isEnabled'>,
  house: HouseClock,
  now: Date = new Date(),
): { readonly at: Date; readonly sun: string | null } | null {
  const listed = automation.definition['triggers'];

  if (!automation.isEnabled || !Array.isArray(listed)) {
    return null;
  }

  // Each trigger read on its own: one this card does not understand leaves the others' runs.
  const triggers = listed.flatMap((raw) => {
    const read = automationTriggerSchema.safeParse(raw);

    return read.success ? [read.data] : [];
  });
  const runs = triggers.flatMap((trigger): { readonly at: Date; readonly sun: string | null }[] => {
    if (trigger.isEnabled === false) {
      return [];
    }

    if (trigger.type === 'time' && trigger.at.kind !== 'entity') {
      const expression =
        trigger.at.kind === 'clock' ? clockAtToCron(trigger.at) : trigger.at.expression;
      const next = nextCronRuns(expression, house.timeZone, 1, now)?.[0];

      return next === undefined ? [] : [{ at: next, sun: null }];
    }

    if (trigger.type === 'sun' && house.position !== null) {
      const next = nextSunEvent(trigger, house.position, now);

      return next === null ? [] : [{ at: next, sun: trigger.event }];
    }

    return [];
  });

  return runs.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

/**
 * The latest changes of what an activity card follows, newest first.
 *
 * @param scope - The house, an area, or a few entities.
 * @param limit - How many changes.
 * @param isWanted - Whether this person may read them.
 * @returns The changes, once read.
 */
export function useActivityEntries(
  scope: ActivityScope,
  limit: number,
  isWanted: boolean,
): readonly ActivityEntry[] | undefined {
  const sample = useCardSample();
  const narrowed =
    scope.kind === 'area'
      ? { areaKey: scope.areaKey }
      : scope.kind === 'entities'
        ? { entityIds: scope.entityIds }
        : {};
  const query = useQuery({
    queryKey: ['dashboard', 'activity', narrowed, limit],
    /**
     * Reads the changes.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read when the card goes away.
     * @returns The changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchActivity(narrowed, limit, signal),
    enabled:
      isWanted && sample === null && !(scope.kind === 'entities' && scope.entityIds.length === 0),
    refetchInterval: ACTIVITY_REFRESH_MS,
  });

  return sample === null ? query.data : (sample.activity ?? []);
}
