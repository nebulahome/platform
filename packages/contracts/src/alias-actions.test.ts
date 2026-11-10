import { describe, expect, it } from 'vitest';

import {
  aliasCommandMatches,
  aliasStepReads,
  aliasStepTargets,
  type AliasAction,
} from './alias-actions.js';
import { partCommands } from './alias-commands.js';
import { replaceAliasEntity, type AliasFileEntry } from './alias-file.js';
import { aliasPartIssues, aliasPartsSchema, type AliasParts } from './alias-parts.js';
import { aliasType, aliasTypeParts } from './alias-types.js';
import { aliasStepSchema, automationActionSchema } from './automation-actions.js';

const LIGHT = aliasType('light');
const setLevel = (level: unknown) => ({
  type: 'command',
  entityId: 'light.kitchen_island',
  capability: 'level',
  params: { command: 'set_level', level },
});
const action = (over: Partial<AliasAction> = {}): AliasAction => ({
  id: 'a1',
  when: { kind: 'command', command: 'set_level' },
  then: [aliasStepSchema.parse(setLevel({ formula: 'command.level * 0.6' }))],
  ...over,
});
const lightParts = (brightness: Partial<AliasParts[string]> = {}): AliasParts =>
  aliasPartsSchema.parse({
    on: { from: 'entities', entities: ['light.hall', 'light.stairs'], rule: 'any' },
    brightness: { from: 'entity', entity: 'light.living_pendant', ...brightness },
  });

describe('alias actions', () => {
  it('takes a formula in a command param only in an alias step', () => {
    expect(aliasStepSchema.safeParse(setLevel({ formula: 'command.level * 0.6' })).success).toBe(
      true,
    );
    expect(
      automationActionSchema.safeParse(setLevel({ formula: 'command.level * 0.6' })).success,
    ).toBe(false);
    expect(automationActionSchema.safeParse(setLevel(60)).success).toBe(true);
    // The rest of the body still has to be a command the capability takes.
    expect(
      aliasStepSchema.safeParse({
        ...setLevel({ formula: '1' }),
        params: { command: 'nope', level: { formula: '1' } },
      }).success,
    ).toBe(false);
  });

  it('offers a part the commands that reach it', () => {
    const defs = aliasTypeParts(LIGHT);
    const parts = lightParts();

    expect(partCommands(defs, parts, 'on')).toEqual(['turn_on', 'turn_off', 'toggle']);
    expect(partCommands(defs, parts, 'brightness')).toEqual(['set_level']);
    expect(partCommands(defs, parts, 'color_temp')).toEqual([]);
  });

  it('checks the actions of a part against what it takes', () => {
    const issues = (actions: AliasAction[]) =>
      aliasPartIssues(LIGHT, lightParts({ actions })).map((issue) => issue.message);

    expect(issues([action()])).toEqual([]);
    expect(issues([action({ when: { kind: 'command', command: 'turn_on' } })])).toEqual([
      'Brightness takes no turn_on',
    ]);
    expect(issues([action({ then: [] })])).toEqual(['Brightness: an action has nothing to do']);
    expect(
      issues([action({ when: { kind: 'change', change: { kind: 'state', to: 'on' } } })]),
    ).toEqual(['Brightness: command values are read only by an action on a command']);
    expect(
      aliasPartIssues(
        LIGHT,
        aliasPartsSchema.parse({
          on: {
            from: 'stored',
            actions: [
              action({
                when: { kind: 'change', change: { kind: 'numeric', operator: 'gt', value: 1 } },
                then: [aliasStepSchema.parse(setLevel(10))],
              }),
            ],
          },
        }),
      ).map((issue) => issue.message),
    ).toEqual(['On / off is not a number to compare']);
  });

  it('matches a command by name and by its match', () => {
    const when = {
      kind: 'command',
      command: 'set_level',
      match: { field: 'level', operator: 'gt', value: 60 },
    } as const;

    expect(aliasCommandMatches(when, { command: 'set_level', level: 72 })).toBe(true);
    expect(aliasCommandMatches(when, { command: 'set_level', level: 40 })).toBe(false);
    expect(aliasCommandMatches(when, { command: 'turn_on' })).toBe(false);
  });

  it('lists what the steps act on and the entities their formulas read', () => {
    const steps = [
      aliasStepSchema.parse(setLevel({ formula: 'sensor.lux / 10 + command.level' })),
      aliasStepSchema.parse({ type: 'scene', sceneKey: 'evening_downstairs' }),
      aliasStepSchema.parse({
        type: 'if',
        conditions: [],
        then: [aliasStepSchema.parse({ type: 'automation', automationKey: 'night' })],
      }),
    ];

    expect(aliasStepTargets(steps)).toEqual({
      entities: ['light.kitchen_island'],
      scenes: ['evening_downstairs'],
      automations: ['night'],
    });
    expect(aliasStepReads(steps)).toEqual(['sensor.lux']);
  });

  it('replaces an entity inside the actions on import', () => {
    const entry = {
      key: 'downstairs',
      name: 'Downstairs',
      behavesAs: 'light',
      parts: lightParts({
        actions: [
          action({ then: [aliasStepSchema.parse(setLevel({ formula: 'light.kitchen_island' }))] }),
        ],
      }),
      code: [],
    } as unknown as AliasFileEntry;

    const replaced = replaceAliasEntity(entry, 'light.kitchen_island', 'light.island');

    expect(replaced.parts['brightness']?.actions?.[0]?.then[0]).toMatchObject({
      entityId: 'light.island',
      params: { level: { formula: 'light.island' } },
    });
  });
});
