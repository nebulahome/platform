import { describe, expect, it } from 'vitest';

import { entityIdSchema, type EntityView, type StateHistoryPoint } from '@nebulahome/contracts';

import {
  groupDay,
  rowsOf,
  spreadOf,
  togetherMembers,
  type AreaLink,
} from '@/routes/dashboard/cards/together-members';
import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/**
 * A light in a room.
 *
 * @param entityId - Its address.
 * @param areaKey - Its room.
 * @param more - Anything else about it.
 * @returns The entity.
 */
function lightIn(
  entityId: string,
  areaKey: string | null,
  more: Partial<EntityView> = {},
): EntityView {
  return {
    ...sampleEntity(entityId, {
      name: entityId,
      area: areaKey,
      capabilities: [can('on_off'), can('level')],
      state: { on_off: { isOn: true }, level: { level: 50 } },
    }),
    areaKey,
    ...more,
  };
}

const ISLAND = lightIn('light.island', 'kitchen');
const PANTRY = lightIn('light.pantry', 'kitchen');
const FRIDGE = lightIn('light.fridge', 'kitchen');
const HALL = lightIn('light.hall', 'hallway');
const PLUG = {
  ...sampleEntity('switch.kettle', {
    name: 'Kettle',
    area: 'Kitchen',
    capabilities: [can('on_off')],
    state: { on_off: { isOn: false } },
  }),
  areaKey: 'kitchen',
};
const ENTITIES = [ISLAND, PANTRY, FRIDGE, HALL, PLUG];

/** A house with a ground floor holding the kitchen and the hallway. */
const AREAS: readonly AreaLink[] = [
  { id: '00000000-0000-4000-8000-000000000001', key: 'home', parentId: null },
  {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'ground_floor',
    parentId: '00000000-0000-4000-8000-000000000001',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    key: 'kitchen',
    parentId: '00000000-0000-4000-8000-000000000002',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    key: 'hallway',
    parentId: '00000000-0000-4000-8000-000000000002',
  },
];

/**
 * The addresses of the members a card stands for.
 *
 * @param members - How they are chosen.
 * @param entities - The entity list.
 * @returns Their addresses.
 */
function idsOf(
  members: Parameters<typeof togetherMembers>[0]['members'],
  entities: readonly EntityView[] = ENTITIES,
): string[] {
  return togetherMembers({ domain: 'light', members }, entities, AREAS).map(
    (entity) => entity.entityId,
  );
}

describe('togetherMembers', () => {
  it('takes every light of an area but the ones left out, and nothing of another kind', () => {
    expect(
      idsOf({ mode: 'rule', areaKey: 'kitchen', exclude: [entityIdSchema.parse('light.fridge')] }),
    ).toEqual(['light.island', 'light.pantry']);
  });

  it('takes a floor with its rooms, and the whole house without an area', () => {
    expect(idsOf({ mode: 'rule', areaKey: 'ground_floor', exclude: [] })).toEqual([
      'light.island',
      'light.pantry',
      'light.fridge',
      'light.hall',
    ]);
    expect(idsOf({ mode: 'rule', areaKey: null, exclude: [] })).toHaveLength(4);
  });

  it('lets a new light join by rule and a removed one leave', () => {
    const rule = { mode: 'rule' as const, areaKey: 'kitchen', exclude: [] };
    const added = lightIn('light.hood', 'kitchen');

    expect(idsOf(rule, [...ENTITIES, added])).toContain('light.hood');
    expect(idsOf(rule, [ISLAND, FRIDGE])).toEqual(['light.island', 'light.fridge']);
  });

  it('leaves out disabled and hidden lights by rule', () => {
    const entities = [ISLAND, { ...PANTRY, isEnabled: false }, { ...FRIDGE, isHidden: true }, HALL];

    expect(idsOf({ mode: 'rule', areaKey: 'kitchen', exclude: [] }, entities)).toEqual([
      'light.island',
    ]);
  });

  it('keeps a hand-picked list in its order and drops a removed member silently', () => {
    const hand = {
      mode: 'hand' as const,
      entityIds: ['light.hall', 'light.gone', 'light.island', 'switch.kettle'].map((id) =>
        entityIdSchema.parse(id),
      ),
    };

    expect(idsOf(hand)).toEqual(['light.hall', 'light.island']);
    // A new light in the kitchen does not join a list made by hand.
    expect(idsOf(hand, [...ENTITIES, lightIn('light.hood', 'kitchen')])).toEqual([
      'light.hall',
      'light.island',
    ]);
  });
});

describe('spreadOf', () => {
  it('gives the lowest, the highest and the average', () => {
    expect(spreadOf([20.1, 21.4, 20.9])).toEqual({ min: 20.1, max: 21.4, average: 20.8 });
    expect(spreadOf([])).toBeNull();
  });
});

describe('rowsOf', () => {
  it('turns the last row into the rest when there are more than rows', () => {
    expect(rowsOf([1, 2, 3], 5)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(rowsOf([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({ shown: [1, 2, 3, 4], more: 3 });
  });
});

describe('groupDay', () => {
  const NOW = new Date(2026, 10, 17, 14, 0).getTime();
  const HOUR = 3_600_000;

  /**
   * A day with the entity on between two times.
   *
   * @param from - Hours ago it went on.
   * @param to - Hours ago it went off.
   * @returns The member's day.
   */
  function onBetween(from: number, to: number) {
    const point = (hoursAgo: number, isOn: boolean): StateHistoryPoint => ({
      time: new Date(NOW - hoursAgo * HOUR),
      entityId: entityIdSchema.parse('light.island'),
      state: { on_off: { isOn } },
      previousState: { on_off: { isOn: !isOn } },
      attributes: {},
      isAvailable: true,
      source: 'sample',
    });

    return {
      history: {
        window: { from: NOW - 24 * HOUR, to: NOW },
        points: [point(from, true), point(to, false)],
      },
      state: { on_off: { isOn: false } },
      isAvailable: true,
    };
  }

  it('counts the time any member was on once, and lights the hours of either', () => {
    const day = groupDay([onBetween(5, 3), onBetween(4, 2), onBetween(10, 9)]);

    expect(day?.onMs).toBe(4 * HOUR);
    expect(day?.hours.filter(Boolean)).toHaveLength(4);
    expect(groupDay([])).toBeUndefined();
  });
});
