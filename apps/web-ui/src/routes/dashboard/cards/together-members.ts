/**
 * Who a together card stands for, and what they say as one.
 *
 * By rule the members are worked out in the browser from the entity list every time the card
 * draws: every entity of the card's kind in its area - a floor takes its rooms, a house its floors -
 * or in the whole house, but the ones left out. So a new light in the Kitchen joins by itself and a
 * removed one leaves. By hand the list is the person's and never changes alone; a member that is no
 * longer there, or no longer enabled, is dropped without a word and the count goes down.
 */
import type {
  AreaView,
  CapabilityState,
  DashboardTogetherCard,
  EntityView,
  JsonObject,
  StateHistoryPoint,
} from '@nebulahome/contracts';

import { activityShares } from '@/dashboard/activity';
import { cardKindOf } from '@/dashboard/card-sizes';
import { stateSegments } from '@/library/history-series';
import type { OnOffDay } from '@/routes/dashboard/cards/on-off-day';
import type { CardHistory } from '@/routes/dashboard/cards/use-card-history';

/** One member, as the card reads it. */
export type TogetherMember = {
  /** The entity. */
  readonly entity: EntityView;

  /** Its state now, capability by capability. */
  readonly state: CapabilityState;

  /** Whether it can be reached: one that cannot is left out of the count and named apart. */
  readonly isAvailable: boolean;

  /** Whether this person may command it, and it takes commands at all. */
  readonly canControl: boolean;

  /** When its state last arrived: a new report is its answer to a command. */
  readonly reportedAt: number | null;

  /** When its state last changed. */
  readonly changedAt: Date | null;
};

/** An area as far as the rule needs it: its key, and where it hangs in the house. */
export type AreaLink = Pick<AreaView, 'id' | 'key' | 'parentId'>;

/**
 * The keys of an area and of every area inside it: a floor's rooms, a house's floors and rooms.
 *
 * @param areaKey - The area.
 * @param areas - Every area, to walk down from it; empty when not read, and then only the area.
 * @returns The keys.
 */
export function areaKeysWithin(areaKey: string, areas: readonly AreaLink[]): ReadonlySet<string> {
  const keys = new Set([areaKey]);
  const ids = new Set(areas.filter((area) => area.key === areaKey).map((area) => area.id));
  let hasGrown = ids.size > 0;

  while (hasGrown) {
    hasGrown = false;

    for (const area of areas) {
      if (area.parentId !== null && ids.has(area.parentId) && !ids.has(area.id)) {
        ids.add(area.id);
        keys.add(area.key);
        hasGrown = true;
      }
    }
  }

  return keys;
}

/**
 * The entities a together card stands for, in the order the entity list has them (by rule) or the
 * order they were picked in (by hand).
 *
 * @param card - Its kind and how its members are chosen.
 * @param entities - Every entity this person may see.
 * @param areas - Every area, so a floor's card takes its rooms' entities; empty when not read.
 * @returns The members.
 */
export function togetherMembers(
  card: Pick<DashboardTogetherCard, 'domain' | 'members'>,
  entities: readonly EntityView[],
  areas: readonly AreaLink[] = [],
): EntityView[] {
  const { members } = card;

  /**
   * Whether an entity can be a member at all: enabled, and drawn as the card's kind.
   *
   * @param entity - The entity.
   * @returns True when it can.
   */
  const fits = (entity: EntityView): boolean =>
    entity.isEnabled && cardKindOf(entity) === card.domain;

  if (members.mode === 'hand') {
    const byId = new Map(entities.map((entity) => [entity.entityId, entity]));

    return members.entityIds.flatMap((entityId) => {
      const entity = byId.get(entityId);

      return entity !== undefined && fits(entity) ? [entity] : [];
    });
  }

  const within = members.areaKey === null ? null : areaKeysWithin(members.areaKey, areas);
  const left = new Set<string>(members.exclude);

  return entities.filter(
    (entity) =>
      fits(entity) &&
      !entity.isHidden &&
      !left.has(entity.entityId) &&
      (within === null || (entity.areaKey !== null && within.has(entity.areaKey))),
  );
}

/** The lowest, the highest and the average of some values. */
export type Spread = { readonly min: number; readonly max: number; readonly average: number };

/**
 * The lowest, the highest and the average of some values.
 *
 * @param values - The values.
 * @returns Them, or null for none.
 */
export function spreadOf(values: readonly number[]): Spread | null {
  if (values.length === 0) {
    return null;
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

/** One member's day, to put together with the others'. */
export type MemberDay = {
  /** Its changes over the day. */
  readonly history: CardHistory<StateHistoryPoint>;

  /** Its state now, for a day with no change. */
  readonly state: JsonObject | null;

  /** Whether it can be reached now. */
  readonly isAvailable: boolean;
};

/** How many blocks a day is drawn as. */
const HOURS = 24;

/**
 * The members' day as one: an hour is lit when any member was on in it, and the time on is the
 * time at least one was on - two lamps on together count once.
 *
 * @param days - Each member's day.
 * @returns The day, or undefined for no member.
 */
export function groupDay(days: readonly MemberDay[]): OnOffDay | undefined {
  const window = days[0]?.history.window;

  if (window === undefined) {
    return undefined;
  }

  const spans = days
    .flatMap(({ history, state, isAvailable }) =>
      stateSegments(history.points, history.window, { state, isAvailable }, () => ''),
    )
    .filter((segment) => segment.isActive)
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number; isActive: true }[] = [];

  for (const span of spans) {
    const last = merged.at(-1);

    if (last !== undefined && span.from <= last.to) {
      last.to = Math.max(last.to, span.to);
    } else {
      merged.push({ from: span.from, to: span.to, isActive: true });
    }
  }

  return {
    hours: activityShares(merged, window, HOURS).map((share) => share > 0),
    onMs: merged.reduce((sum, span) => sum + (span.to - span.from), 0),
  };
}

/**
 * Splits the members a list has room for: all of them, or one row fewer and "and 2 more" in the
 * last row.
 *
 * @param members - The members, in the order they are listed.
 * @param rows - How many rows there are.
 * @returns The ones listed, and how many are left over.
 */
export function rowsOf<TMember>(
  members: readonly TMember[],
  rows: number,
): { readonly shown: readonly TMember[]; readonly more: number } {
  if (members.length <= rows) {
    return { shown: members, more: 0 };
  }

  return { shown: members.slice(0, rows - 1), more: members.length - (rows - 1) };
}
