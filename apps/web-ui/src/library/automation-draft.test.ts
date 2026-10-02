/**
 * Turning a half-filled form into something the server will take.
 *
 * The case worth guarding hardest is the one where somebody edits an automation this editor
 * cannot fully draw. A composed condition or a parallel block has to come back out of the form
 * exactly as it went in: an editor that silently dropped what it could not render would destroy
 * work at the moment its author was most confident it was safe.
 */
import { describe, expect, it } from 'vitest';

import type { AutomationView } from '@nebulahome/contracts';

import {
  blankAction,
  blankTrigger,
  draftFrom,
  emptyDraft,
  isCardExpressible,
  isKeepingTriggers,
  partialEntityId,
  replaceAt,
  toCreate,
  toKey,
  without,
} from './automation-draft';

/**
 * A draft that would save.
 *
 * @returns The smallest draft the server would take.
 */
function usable() {
  return {
    ...emptyDraft(),
    name: 'Evening lights',
    key: 'evening_lights',
    triggers: [{ type: 'time' as const, at: { kind: 'clock' as const, time: '18:00' } }],
    actions: [{ type: 'scene' as const, sceneKey: 'good_night' }],
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
    const result = toCreate(usable());

    expect(result.ok).toBe(true);
  });

  it('refuses a rule that can never fire', () => {
    const result = toCreate({ ...usable(), triggers: [] });

    expect(result.ok).toBe(false);
  });

  it('refuses a rule that would do nothing', () => {
    const result = toCreate({ ...usable(), actions: [] });

    expect(result.ok).toBe(false);
  });

  it('names the block on screen, not the path in the document', () => {
    // A trigger somebody added and did not finish: the entity was never chosen.
    const result = toCreate({ ...usable(), triggers: [blankTrigger('state')] });

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

  it('sends the runtime in milliseconds, having asked for seconds', () => {
    const result = toCreate({ ...usable(), maxRuntimeSeconds: 90 });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body.maxRuntimeMs).toBe(90_000);
    }
  });

  it('writes the new { triggers, if, then } document', () => {
    const result = toCreate({
      ...usable(),
      conditions: [{ type: 'state', entityId: 'person.mattia', state: 'home' }],
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body.definition).toEqual({
        triggers: { type: 'time', at: { kind: 'clock', time: '18:00' } },
        if: { type: 'state', entityId: 'person.mattia', state: 'home' },
        then: [{ type: 'scene', sceneKey: 'good_night' }],
      });
    }
  });
});

describe('draftFrom', () => {
  /** An automation using the two things this editor cannot draw. */
  const COMPOSED: AutomationView = {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'complicated',
    name: 'Complicated',
    description: '',
    definition: {
      triggers: { type: 'manual' },
      if: {
        op: 'and',
        items: [
          { type: 'time_window', from: '22:00', to: '06:00' },
          { type: 'expression', expression: 'away' },
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
    },
    definitionVersion: 1,
    mode: 'single',
    maxRuntimeMs: 300_000,
    isEnabled: true,
    lastTriggeredAt: null,
  };

  it('keeps what it cannot draw, and gives it back unchanged', () => {
    const result = toCreate(draftFrom(COMPOSED));

    expect(result.ok).toBe(true);

    if (result.ok) {
      // Byte for byte what came in. This is the whole point of the test.
      expect(result.body.definition).toEqual(COMPOSED.definition);
    }
  });

  it('opens a legacy { triggers, conditions, actions } document', () => {
    const draft = draftFrom({
      ...COMPOSED,
      definition: {
        triggers: [{ type: 'manual' }],
        conditions: [
          {
            type: 'and',
            conditions: [
              { type: 'time_window', from: '22:00', to: '06:00' },
              { type: 'expression', expression: 'away' },
            ],
          },
        ],
        actions: [
          {
            type: 'parallel',
            actions: [
              { type: 'scene', sceneKey: 'good_night' },
              { type: 'notify', channel: 'push', message: 'done' },
            ],
          },
        ],
      },
    });

    const result = toCreate(draft);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body.definition).toEqual(COMPOSED.definition);
    }
  });

  it('opens rather than throwing on a definition written before the schema existed', () => {
    const draft = draftFrom({ ...COMPOSED, definition: { nonsense: true } });

    expect(draft.triggers).toEqual([]);
    expect(draft.actions).toEqual([]);
  });

  it('reads the runtime back into seconds', () => {
    expect(draftFrom(COMPOSED).maxRuntimeSeconds).toBe(300);
  });
});

describe('nested then blocks', () => {
  it('round-trips if/else, switch, while, and for through the draft', () => {
    const stateLeaf = {
      type: 'state' as const,
      entityId: partialEntityId('light.kitchen'),
      state: 'on',
    };

    const definition = {
      triggers: { type: 'manual' as const },
      then: [
        {
          type: 'if' as const,
          condition: stateLeaf,
          then: [{ type: 'scene' as const, sceneKey: 'bright' }],
          else: [{ type: 'stop' as const }],
        },
        {
          type: 'switch' as const,
          entityId: partialEntityId('input_select.mode'),
          cases: [
            {
              value: 'away',
              actions: [{ type: 'wait_duration' as const, durationMs: 1_000 }],
            },
          ],
          default: [{ type: 'notify' as const, channel: 'push', message: 'home' }],
        },
        {
          type: 'while' as const,
          condition: stateLeaf,
          actions: [{ type: 'wait_duration' as const, durationMs: 500 }],
        },
        {
          type: 'for' as const,
          over: { kind: 'count' as const, count: 2 },
          actions: [{ type: 'stop' as const }],
        },
        {
          type: 'do_while' as const,
          condition: stateLeaf,
          actions: [{ type: 'wait_duration' as const, durationMs: 100 }],
        },
        {
          type: 'parallel' as const,
          actions: [
            {
              type: 'sequence' as const,
              actions: [{ type: 'scene' as const, sceneKey: 'a' }],
            },
            { type: 'scene' as const, sceneKey: 'b' },
          ],
        },
      ],
    };

    const view: AutomationView = {
      id: '00000000-0000-4000-8000-000000000099',
      key: 'nested',
      name: 'Nested',
      description: '',
      definition: definition,
      definitionVersion: 1,
      mode: 'single',
      maxRuntimeMs: 60_000,
      isEnabled: true,
      lastTriggeredAt: null,
    };

    const result = toCreate(draftFrom(view));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body.definition).toEqual(definition);
    }
  });

  it('creates blanks for every nested template kind', () => {
    expect(blankAction('if').type).toBe('if');
    expect(blankAction('switch').type).toBe('switch');
    expect(blankAction('sequence').type).toBe('sequence');
    expect(blankAction('wait_for_trigger').type).toBe('wait_for_trigger');
  });
});

describe('list helpers', () => {
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
});

describe('what a problem reads like', () => {
  it('points at the block on screen, counting from one', () => {
    const result = toCreate({ ...usable(), actions: [blankAction('scene')] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      // Not `then › 0 › sceneKey`: the screen says Then, and its first block is block 1.
      expect(result.problems[0]).toBe('Then › action 1 › sceneKey: needs a value');
    }
  });

  it('says an empty list needs something rather than quoting the schema', () => {
    const result = toCreate({ ...usable(), triggers: [] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems[0]).toContain('needs at least one');
    }
  });
});

describe('a trigger tree the cards cannot say', () => {
  /** Manual, or a state change, and in either case also a time: an OR inside an AND. */
  const GROUPED: AutomationView = {
    id: '00000000-0000-4000-8000-000000000003',
    key: 'grouped',
    name: 'Grouped',
    description: '',
    definition: {
      triggers: {
        op: 'and',
        items: [
          { op: 'or', items: [{ type: 'manual' }, { type: 'state', entityId: 'switch.porch' }] },
          { type: 'time', at: { kind: 'clock', time: '18:00' } },
        ],
      },
      then: [{ type: 'scene', sceneKey: 'good_night' }],
    },
    definitionVersion: 1,
    mode: 'single',
    maxRuntimeMs: 300_000,
    isEnabled: true,
    lastTriggeredAt: null,
  };

  it('is saved back as it was when the triggers are not touched', () => {
    const draft = draftFrom(GROUPED);
    const result = toCreate(draft);

    expect(isKeepingTriggers(draft)).toBe(true);
    expect(result.ok && result.body.definition.triggers).toEqual(GROUPED.definition['triggers']);
  });

  it('gives way to the cards once a trigger is changed', () => {
    const draft = draftFrom(GROUPED);
    const changed = {
      ...draft,
      triggers: without(draft.triggers, 0),
      triggerJoins: ['or' as const],
    };
    const result = toCreate(changed);

    expect(isKeepingTriggers(changed)).toBe(false);
    expect(result.ok && result.body.definition.triggers).toEqual({
      op: 'or',
      items: [
        { type: 'state', entityId: 'switch.porch' },
        { type: 'time', at: { kind: 'clock', time: '18:00' } },
      ],
    });
  });

  it('is not kept when the cards say it exactly', () => {
    expect(
      isCardExpressible({
        op: 'or',
        items: [{ type: 'manual' }, { op: 'and', items: [{ type: 'manual' }, { type: 'manual' }] }],
      }),
    ).toBe(true);
    expect(
      isCardExpressible({
        op: 'and',
        items: [{ op: 'or', items: [{ type: 'manual' }, { type: 'manual' }] }, { type: 'manual' }],
      }),
    ).toBe(false);
  });
});
