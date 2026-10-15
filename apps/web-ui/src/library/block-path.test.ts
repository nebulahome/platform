/**
 * Moving a block anywhere a block of its kind can go - into an If's else, out of a loop, into an
 * OR group - as a pure rewrite of the draft. The traps are the ones an index makes: a block moved
 * down its own list, a block moved into a later sibling (whose index shifts when it leaves), and a
 * block dropped into itself.
 */
import { describe, expect, it } from 'vitest';

import type { AutomationAction, ConditionNode } from '@nebulahome/contracts';

import { blockIdOf } from '@/lib/block-ids';

import { emptyDraft, type AutomationDraft } from './automation-draft';
import {
  containersOf,
  dropSlots,
  familyOfList,
  getBlock,
  getList,
  isInside,
  moveBlock,
  setList,
  stepBlock,
} from './block-path';

const SCENE: AutomationAction = { type: 'scene', sceneKey: 'evening' };
const WAIT: AutomationAction = { type: 'wait_duration', durationMs: 1_000 };
const STOP: AutomationAction = { type: 'stop' };
const MORNING: ConditionNode = { type: 'time', from: '06:00', to: '12:00' };
const WEEKEND: ConditionNode = { type: 'time', days: ['saturday', 'sunday'] };

/**
 * A draft with these blocks under Then and If.
 *
 * @param then - The Then lane.
 * @param conditions - The If lane.
 * @returns The draft.
 */
function draftWith(
  then: readonly AutomationAction[],
  conditions: readonly ConditionNode[] = [],
): AutomationDraft {
  return { ...emptyDraft(), triggers: [{ type: 'manual' }], if: conditions, then };
}

describe('reading paths', () => {
  const draft = draftWith([
    { type: 'if', conditions: [MORNING], then: [SCENE], else: [WAIT] },
    {
      type: 'switch',
      entityId: '',
      cases: [{ value: 'away', actions: [STOP] }],
    },
    { type: 'parallel', branches: [[SCENE], [WAIT]] },
  ]);

  it('finds every list by the path the trace uses', () => {
    expect(getList(draft, 'then.0.then')).toEqual([SCENE]);
    expect(getList(draft, 'then.0.else')).toEqual([WAIT]);
    expect(getList(draft, 'then.0.conditions')).toEqual([MORNING]);
    expect(getList(draft, 'then.1.cases.0')).toEqual([STOP]);
    expect(getList(draft, 'then.2.branches.1')).toEqual([WAIT]);
    expect(getBlock(draft, 'then.2.branches.0.0')).toEqual(SCENE);
  });

  it('says which family a list holds', () => {
    expect(familyOfList('triggers')).toBe('trigger');
    expect(familyOfList('if')).toBe('condition');
    expect(familyOfList('if.0.conditions')).toBe('condition');
    expect(familyOfList('then.0.conditions')).toBe('condition');
    expect(familyOfList('then.0.else')).toBe('action');
    expect(familyOfList('then.1.cases.0')).toBe('action');
  });

  it('names the blocks a list sits inside, outermost first', () => {
    expect(containersOf('then.0.then.2.else')).toEqual(['then.0', 'then.0.then.2']);
    expect(containersOf('then.1.cases.0')).toEqual(['then.1']);
    expect(containersOf('then')).toEqual([]);
  });

  it('knows what lies inside a block', () => {
    expect(isInside('then.0.else', 'then.0')).toBe(true);
    expect(isInside('then.0', 'then.0')).toBe(true);
    expect(isInside('then.01', 'then.0')).toBe(false);
  });

  it('creates an Otherwise that was not there, and keeps the switch the same block', () => {
    const before = getBlock(draft, 'then.1');
    const next = setList(draft, 'then.1.default', [WAIT]);
    const after = getBlock(next, 'then.1');

    expect(getList(next, 'then.1.default')).toEqual([WAIT]);
    expect(before && after && blockIdOf(after)).toBe(before && blockIdOf(before));
  });
});

describe('moveBlock', () => {
  it('moves a block down its own list, counting the place as the list is now', () => {
    const moved = moveBlock(
      draftWith([SCENE, WAIT, STOP]),
      { list: 'then', index: 0 },
      {
        list: 'then',
        index: 2,
      },
    );

    expect(moved?.then).toEqual([WAIT, SCENE, STOP]);
  });

  it('moves a block into an If’s else, and back out', () => {
    const draft = draftWith([SCENE, { type: 'if', conditions: [], then: [], else: [WAIT] }]);
    const into = moveBlock(draft, { list: 'then', index: 0 }, { list: 'then.1.else', index: 1 });

    // The If moved up one when the scene left; the target followed it.
    expect(into?.then).toEqual([{ type: 'if', conditions: [], then: [], else: [WAIT, SCENE] }]);

    const out =
      into && moveBlock(into, { list: 'then.0.else', index: 0 }, { list: 'then', index: 1 });

    expect(out?.then).toEqual([{ type: 'if', conditions: [], then: [], else: [SCENE] }, WAIT]);
  });

  it('moves a condition into an OR group and between an If and its loop', () => {
    const draft = draftWith(
      [{ type: 'while', conditions: [], actions: [STOP] }],
      [MORNING, { type: 'or', conditions: [] }],
    );
    const grouped = moveBlock(
      draft,
      { list: 'if', index: 0 },
      { list: 'if.1.conditions', index: 0 },
    );

    expect(grouped?.if).toEqual([{ type: 'or', conditions: [MORNING] }]);

    const looped =
      grouped &&
      moveBlock(
        grouped,
        { list: 'if.0.conditions', index: 0 },
        { list: 'then.0.conditions', index: 0 },
      );

    expect(looped?.if).toEqual([{ type: 'or', conditions: [] }]);
    expect(looped?.then).toEqual([{ type: 'while', conditions: [MORNING], actions: [STOP] }]);
  });

  it('refuses a block of another family, and a block dropped into itself', () => {
    const draft = draftWith([{ type: 'if', conditions: [WEEKEND], then: [SCENE] }], [MORNING]);

    expect(moveBlock(draft, { list: 'then', index: 0 }, { list: 'if', index: 0 })).toBeNull();
    expect(
      moveBlock(draft, { list: 'then', index: 0 }, { list: 'then.0.then', index: 0 }),
    ).toBeNull();
    expect(moveBlock(draft, { list: 'then', index: 0 }, { list: 'then', index: 1 })).toBeNull();
  });

  it('keeps the id of the block moved and of the blocks around it', () => {
    const draft = draftWith([SCENE, { type: 'sequence', actions: [WAIT] }]);
    const sceneId = blockIdOf(draft.then[0] ?? {});
    const sequenceId = blockIdOf(draft.then[1] ?? {});
    const moved = moveBlock(
      draft,
      { list: 'then', index: 0 },
      { list: 'then.1.actions', index: 0 },
    );

    expect(blockIdOf(moved?.then[0] ?? {})).toBe(sequenceId);
    expect(blockIdOf(getBlock(moved ?? draft, 'then.0.actions.0') ?? {})).toBe(sceneId);
  });
});

describe('dropSlots and stepBlock', () => {
  const draft = draftWith([
    { type: 'if', conditions: [MORNING], then: [SCENE], else: [WAIT] },
    STOP,
  ]);

  it('lists every place an action can go, in reading order', () => {
    expect(dropSlots(draft, 'action')).toEqual([
      { list: 'then', index: 0 },
      { list: 'then.0.then', index: 0 },
      { list: 'then.0.then', index: 1 },
      { list: 'then.0.else', index: 0 },
      { list: 'then.0.else', index: 1 },
      { list: 'then', index: 1 },
      { list: 'then', index: 2 },
    ]);
    expect(dropSlots(draft, 'condition')).toEqual([
      { list: 'if', index: 0 },
      { list: 'then.0.conditions', index: 0 },
      { list: 'then.0.conditions', index: 1 },
    ]);
  });

  it('steps a block down into the next branch, and up out of the If', () => {
    const down = stepBlock(draft, { list: 'then.0.then', index: 0 }, 1);

    expect(down?.at).toEqual({ list: 'then.0.else', index: 0 });
    expect(down?.draft.then[0]).toMatchObject({ then: [], else: [SCENE, WAIT] });

    const up = stepBlock(draft, { list: 'then.0.then', index: 0 }, -1);

    expect(up?.at).toEqual({ list: 'then', index: 0 });
    expect(up?.draft.then.map((action) => action.type)).toEqual(['scene', 'if', 'stop']);
  });

  it('stops at either end', () => {
    expect(stepBlock(draft, { list: 'then', index: 1 }, 1)).toBeNull();
    expect(stepBlock(draftWith([STOP]), { list: 'then', index: 0 }, -1)).toBeNull();
  });
});
