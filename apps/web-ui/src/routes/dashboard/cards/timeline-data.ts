/**
 * What the automation and activity cards read: the automations, the house's place and zone for
 * when one next runs, and the latest changes of the house, an area or a few entities.
 *
 * Under a sample source (the Add card catalogue, the lab) they read the samples instead and ask
 * the hub nothing, as every other card does.
 */
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  automationTriggerSchema,
  clockAtToCron,
  nextSunEvent,
  type ActivityEntry,
  type ActivityScope,
  type AutomationView,
  type EntityView,
  type GeoPosition,
} from '@nebulahome/contracts';

import { nextCronRuns } from '@/lib/cron-words';
import { signalled } from '@/lib/signalled';
import { BROWSER_ZONE } from '@/lib/time-zones';
import {
  fetchActivity,
  fetchAutomationHouse,
  fetchAutomations,
  LIBRARY_QUERY_KEYS,
} from '@/library/api';
import { useLive, type LiveReading } from '@/live/live-store';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';

/**
 * How often the activity card reads again on its own: the live channel says when what it follows
 * changed, and this is for a channel that is down.
 */
const ACTIVITY_REFRESH_MS = 5 * 60_000;

/** How long after a change the card reads again: the hub writes its history once a second. */
const ACTIVITY_SETTLE_MS = 2000;

/** How long the card waits after a read before the next, however much changes meanwhile. */
const ACTIVITY_THROTTLE_MS = 4000;

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
    timeZone: query.data?.timeZone ?? BROWSER_ZONE,
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
 * The capabilities whose changes the activity leaves out - a number measured, a button pressed -
 * as the API does (`QUIET_CAPABILITIES` in apps/api/src/services/activity.ts): an entity with only
 * these never shows in it, so its readings, however often they come, never call for a read.
 */
const QUIET_CAPABILITIES: ReadonlySet<string> = new Set(['sensor_numeric', 'button']);

/**
 * Whether the live channel said something new of an entity an activity card follows: a state
 * that changed or a reach that did, of an entity the activity shows.
 *
 * @param scope - What the card follows.
 * @param readings - The readings now.
 * @param before - The readings before.
 * @param queryClient - Where the entities are read: their capabilities, and their areas for a card
 *   that follows an area.
 * @returns True when one of them changed.
 */
export function hasActivityChanged(
  scope: ActivityScope,
  readings: Readonly<Record<string, LiveReading>>,
  before: Readonly<Record<string, LiveReading>>,
  queryClient: QueryClient,
): boolean {
  /**
   * Whether the channel said a new state or reach of one entity. A report that repeated them -
   * a sensor saying the same value again - says nothing, and neither does a forgotten reading.
   *
   * @param entityId - The entity.
   * @returns True when it did.
   */
  const isNew = (entityId: string): boolean => {
    const now = readings[entityId];
    const was = before[entityId];

    if (now === undefined || now === was) {
      return false;
    }

    // A first reading (none before) differs from nothing, and counts.
    return (
      now.changedAt.getTime() !== was?.changedAt.getTime() || now.isAvailable !== was.isAvailable
    );
  };

  const changed =
    scope.kind === 'entities' ? scope.entityIds.filter(isNew) : Object.keys(readings).filter(isNew);

  if (changed.length === 0) {
    return false;
  }

  // Which of them the activity shows, as the hub tells them apart: never the quiet ones, and for
  // an area only those in it.
  const entities = queryClient.getQueryData<readonly EntityView[]>(LIBRARY_QUERY_KEYS.entities);
  const byId = new Map<string, EntityView>(
    (entities ?? []).map((entity) => [entity.entityId, entity]),
  );

  return changed.some((entityId) => {
    const entity = byId.get(entityId);

    if (entity === undefined) {
      // Not read yet: it may well show - but not in an area, which it cannot be placed in.
      return scope.kind !== 'area';
    }

    if (entity.capabilities.every((entry) => QUIET_CAPABILITIES.has(entry.capability))) {
      return false;
    }

    return scope.kind !== 'area' || entity.areaKey === scope.areaKey;
  });
}

/**
 * Has an activity card read again when the live channel says what it follows changed: a while
 * after the change, so the hub has written it, and at most once every few seconds, the last change
 * of a burst included. The card is not drawn again for each message, only for what it reads.
 *
 * @param queryKey - The card's read.
 * @param scope - What it follows.
 * @param isFollowing - Whether it reads at all.
 */
function useActivityFollow(queryKey: QueryKey, scope: ActivityScope, isFollowing: boolean): void {
  const queryClient = useQueryClient();
  // The latest scope and read, which the layout hands over as new objects with each render: read
  // when a message comes, rather than following the channel afresh each time.
  const followed = useRef({ scope, queryKey });

  useEffect(() => {
    followed.current = { scope, queryKey };
  });

  useEffect(() => {
    if (!isFollowing) {
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let readAt = 0;
    let changedAt = 0;

    /**
     * Reads again in a while: once the latest change is written, and not sooner after the last
     * read than the throttle allows.
     */
    const readLater = (): void => {
      const now = Date.now();

      timer = setTimeout(
        () => {
          timer = undefined;
          readAt = Date.now();
          void queryClient.invalidateQueries({ queryKey: followed.current.queryKey, exact: true });

          // A change heard too late to be in that read has a read of its own.
          if (changedAt + ACTIVITY_SETTLE_MS > readAt) {
            readLater();
          }
        },
        Math.max(changedAt + ACTIVITY_SETTLE_MS, readAt + ACTIVITY_THROTTLE_MS) - now,
      );
    };

    const unsubscribe = useLive.subscribe((state, previous) => {
      if (
        state.readings === previous.readings ||
        !hasActivityChanged(followed.current.scope, state.readings, previous.readings, queryClient)
      ) {
        return;
      }

      changedAt = Date.now();

      if (timer === undefined) {
        readLater();
      }
    });

    return (): void => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [isFollowing, queryClient]);
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
  const queryKey = ['dashboard', 'activity', narrowed, limit];
  const isWantedNow =
    isWanted && sample === null && !(scope.kind === 'entities' && scope.entityIds.length === 0);
  const query = useQuery({
    queryKey,
    /**
     * Reads the changes.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read when the card goes away.
     * @returns The changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchActivity(narrowed, limit, signal),
    enabled: isWantedNow,
    refetchInterval: ACTIVITY_REFRESH_MS,
  });

  useActivityFollow(queryKey, scope, isWantedNow);

  return sample === null ? query.data : (sample.activity ?? []);
}
