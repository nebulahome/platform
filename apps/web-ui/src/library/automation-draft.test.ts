/**
 * Turning a half-filled form into something the server will take, and a stored automation back
 * into a form.
 *
 * The case worth guarding hardest is the one where somebody edits an automation written in an
 * older shape. It has to come back out of the form as the same rule: an editor that silently
 * dropped what it could not render would destroy work at the moment its author was most confident
 * it was safe. The other is a block's own name and switch, which a field rebuilding the block must
 * not lose.
 */
import { describe, expect, it } from 'vitest';

import type { AutomationView, JsonObject } from '@nebulahome/contracts';

import {
  blankAction,
  blankCondition,
  blankTrigger,
  describePath,
  draftFrom,
  emptyDraft,
  keepMeta,
  partialEntityId,
  replaceAt,
  toCreate,
  toKey,
  without,
  withoutKey,
  type AutomationDraft,
} from './automation-draft';

/**
 * A draft that would save.
 *
 * @returns The smallest draft the server would take.
 */
function usable(): AutomationDraft {
  return {
    ...emptyDraft(),
    name: 'Evening lights',
    key: 'evening_lights',
    triggers: [{ type: 'time', at: { kind: 'clock', time: '18:00' } }],
    then: [{ type: 'scene', sceneKey: 'good_night' }],
  };
}

/**
 * A stored automation around a definition.
 *
 * @param definition - The document.
 * @returns The view the API would send.
 */
function viewOf(definition: JsonObject): AutomationView {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'stored',
    name: 'Stored',
    description: '',
    definition,
    definitionVersion: 1,
    mode: 'single',
    maxRuntimeMs: 300_000,
    isEnabled: true,
    lastTriggeredAt: null,
    lastRun: null,
    missingEntities: [],
  };
}

describe('toKey', () => {
  it('turns a name into something the API will take', () => {
    expect(toKey('Evening lights')).toBe('evening_lights');
  });

  it('strips accents rather than dropping the letters under them', () => {
    expect(toKey('Luci del portico è già')).toBe('luci_del_portico_e_gia');
  });

  it('does not leave an underscore hanging off either end', () => {
    expect(toKey('  Hallway!  ')).toBe('hallway');
  });

  it('gives back nothing when there is nothing usable', () => {
    expect(toKey('!!!')).toBe('');
  });
});

describe('toCreate', () => {
  it('takes a draft that says something', () => {
    expect(toCreate(usable()).ok).toBe(true);
  });

  it('refuses a rule that can never fire, or that would do nothing', () => {
    expect(toCreate({ ...usable(), triggers: [] }).ok).toBe(false);
    expect(toCreate({ ...usable(), then: [] }).ok).toBe(false);
  });

  it('names the block on screen, not the path in the document', () => {
    // A trigger somebody added and did not finish: the entity was never chosen.
    const result = toCreate({ ...usable(), triggers: [blankTrigger('entity')] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems[0]).toContain('When › trigger 1 › entityId');
    }
  });

  it('asks for a key that the API would accept', () => {
    const result = toCreate({ ...usable(), key: 'Evening Lights' });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems.join(' ')).toContain('key');
    }
  });

  it('sends the runtime as the field holds it, in milliseconds', () => {
    const result = toCreate({ ...usable(), maxRuntimeMs: 90_000 });

    expect(result.ok && result.body.maxRuntimeMs).toBe(90_000);
  });

  it('writes the { triggers, if, then } document, leaving out an empty If', () => {
    const condition = {
      type: 'entity' as const,
      entityId: partialEntityId('person.mattia'),
      match: { kind: 'state' as const, states: ['home'] },
    };
    const withIf = toCreate({ ...usable(), if: [condition] });
    const withoutIf = toCreate(usable());

    expect(withIf.ok && withIf.body.definition).toEqual({
      triggers: [{ type: 'time', at: { kind: 'clock', time: '18:00' } }],
      if: [condition],
      then: [{ type: 'scene', sceneKey: 'good_night' }],
    });
    expect(withoutIf.ok && 'if' in withoutIf.body.definition).toBe(false);
  });

  it('keeps a block that is turned off and the name it was given', () => {
    const result = toCreate({
      ...usable(),
      then: [
        { type: 'scene', sceneKey: 'good_night', name: 'Lights down', isEnabled: false },
        { type: 'stop' },
      ],
    });

    expect(result.ok && result.body.definition.then[0]).toEqual({
      type: 'scene',
      sceneKey: 'good_night',
      name: 'Lights down',
      isEnabled: false,
    });
  });
});

describe('draftFrom', () => {
  /** A rule with a group, a NOT and a parallel block. */
  const COMPOSED = viewOf({
    triggers: [{ type: 'manual' }],
    if: [
      {
        type: 'or',
        conditions: [
          { type: 'time', from: '22:00', to: '06:00' },
          { type: 'expression', expression: 'away', isNot: true },
        ],
      },
    ],
    then: [
      {
        type: 'parallel',
        branches: [
          [{ type: 'scene', sceneKey: 'good_night' }],
          [{ type: 'notify', channel: 'push', message: 'done' }],
        ],
      },
    ],
  });

  it('gives back what it was given, unchanged', () => {
    const result = toCreate(draftFrom(COMPOSED));

    expect(result.ok && result.body.definition).toEqual(COMPOSED.definition);
  });

  it('opens a document in the old shape as the same rule', () => {
    const draft = draftFrom(
      viewOf({
        triggers: { op: 'or', items: [{ type: 'manual' }] },
        if: {
          op: 'and',
          items: [
            {
              op: 'or',
              items: [
                { type: 'time_window', from: '22:00', to: '06:00' },
                { op: 'not', item: { type: 'expression', expression: 'away' } },
              ],
            },
          ],
        },
        then: [
          {
            type: 'parallel',
            actions: [
              { type: 'scene', sceneKey: 'good_night' },
              { type: 'notify', channel: 'push', message: 'done' },
            ],
          },
        ],
      }),
    );
    const result = toCreate(draft);

    expect(result.ok && result.body.definition).toEqual(COMPOSED.definition);
  });

  it('opens a check that is gone as a card, and refuses to save it', () => {
    const draft = draftFrom(
      viewOf({
        triggers: [{ type: 'manual' }],
        if: [{ type: 'area_occupancy', areaKey: 'living_room', isOccupied: true }],
        then: [{ type: 'stop' }],
      }),
    );

    expect(draft.if).toHaveLength(1);
    expect(toCreate({ ...draft, name: 'Old', key: 'old' }).ok).toBe(false);
  });

  it('opens rather than throwing on a definition written before the schema existed', () => {
    const draft = draftFrom(viewOf({ nonsense: true }));

    expect(draft.triggers).toEqual([]);
    expect(draft.then).toEqual([]);
  });

  it('copies the document, so no block is shared with the cache', () => {
    const draft = draftFrom(COMPOSED);

    expect(draft.then[0]).not.toBe((COMPOSED.definition['then'] as unknown[])[0]);
  });
});

describe('nested blocks', () => {
  it('round-trips if/else, switch, while, do-while, for and parallel through the draft', () => {
    const stateLeaf = {
      type: 'entity' as const,
      entityId: partialEntityId('light.kitchen'),
      match: { kind: 'state' as const, states: ['on'] },
    };
    const definition = {
      triggers: [{ type: 'manual' as const }],
      then: [
        {
          type: 'if' as const,
          conditions: [stateLeaf],
          then: [{ type: 'scene' as const, sceneKey: 'bright' }],
          else: [{ type: 'stop' as const }],
        },
        {
          type: 'switch' as const,
          entityId: partialEntityId('input_select.mode'),
          cases: [
            { value: 'away', actions: [{ type: 'wait_duration' as const, durationMs: 1_000 }] },
          ],
          default: [{ type: 'notify' as const, channel: 'push', message: 'home' }],
        },
        {
          type: 'while' as const,
          conditions: [stateLeaf],
          actions: [{ type: 'wait_duration' as const, durationMs: 500 }],
        },
        {
          type: 'for' as const,
          over: { kind: 'count' as const, count: 2 },
          actions: [{ type: 'stop' as const }],
        },
        {
          type: 'do_while' as const,
          conditions: [stateLeaf],
          actions: [{ type: 'wait_duration' as const, durationMs: 100 }],
        },
        {
          type: 'parallel' as const,
          branches: [
            [{ type: 'scene' as const, sceneKey: 'a' }],
            [{ type: 'scene' as const, sceneKey: 'b' }],
          ],
        },
      ],
    };
    const result = toCreate(draftFrom(viewOf(definition)));

    expect(result.ok && result.body.definition).toEqual(definition);
  });

  it('starts an If, a loop and a wait with no conditions, chosen by nobody', () => {
    expect(blankAction('if')).toMatchObject({ type: 'if', conditions: [] });
    expect(blankAction('while')).toMatchObject({ type: 'while', conditions: [] });
    expect(blankAction('do_while')).toMatchObject({ type: 'do_while', conditions: [] });
    expect(blankAction('wait_for')).toMatchObject({ type: 'wait_for', conditions: [] });
  });

  it('starts a group empty and a condition as one entity', () => {
    expect(blankCondition('or')).toEqual({ type: 'or', conditions: [] });
    expect(blankCondition('entity')).toMatchObject({ type: 'entity', entityId: '' });
  });

  it('asks a While for a condition, in block words', () => {
    const result = toCreate({
      ...usable(),
      then: [{ type: 'while', conditions: [], actions: [{ type: 'stop' }] }],
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems).toContain('Then › block 1 › Conditions: add a condition');
    }
  });
});

describe('describePath', () => {
  it('reads a path the way the screen is laid out', () => {
    expect(describePath(['then', 2, 'else', 0, 'entityId'])).toBe(
      'Then › block 3 › Else › block 1 › entityId',
    );
    expect(describePath(['if', 1, 'conditions', 0])).toBe(
      'If › condition 2 › Conditions › condition 1',
    );
    expect(describePath(['then', 0, 'branches', 1, 0])).toBe(
      'Then › block 1 › Branch › 2 › block 1',
    );
    expect(describePath(['triggers', 0])).toBe('When › trigger 1');
  });
});

describe('block helpers', () => {
  it('removes by position, not by value', () => {
    const blocks = [blankAction('scene'), blankAction('scene'), blankAction('notify')];

    // Two identical blocks: removing the first must leave the second, which an equality-based
    // filter would get wrong.
    expect(without(blocks, 0)).toEqual([blocks[1], blocks[2]]);
  });

  it('replaces by position', () => {
    const blocks = [blankAction('scene'), blankAction('notify')];
    const replaced = replaceAt(blocks, 1, blankAction('wait_duration'));

    expect(replaced[0]).toEqual(blocks[0]);
    expect(replaced[1]?.type).toBe('wait_duration');
  });

  it('keeps a block’s name, switch and NOT when a field rebuilds it', () => {
    const before = {
      type: 'time' as const,
      from: '08:00',
      name: 'Mornings',
      isEnabled: false,
      isNot: true,
    };
    const rebuilt = keepMeta(before, { type: 'time' as const, from: '09:00' });

    expect(rebuilt).toEqual({ ...before, from: '09:00' });
  });

  it('drops a field rather than writing it as undefined', () => {
    const block = { type: 'time' as const, from: '08:00', to: '10:00' };

    expect('to' in withoutKey(block, 'to')).toBe(false);
  });
});

describe('what a problem reads like', () => {
  it('points at the block on screen, counting from one', () => {
    const result = toCreate({ ...usable(), then: [blankAction('scene')] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      // Not `then › 0 › sceneKey`: the screen says Then, and its first block is block 1.
      expect(result.problems[0]).toBe('Then › block 1 › sceneKey: needs a value');
    }
  });

  it('says an empty list needs something rather than quoting the schema', () => {
    const result = toCreate({ ...usable(), triggers: [] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems).toContain('When: add a trigger');
    }
  });
});
