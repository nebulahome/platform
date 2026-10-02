/**
 * What names an entity: automations by where they name it, scenes that set it, aliases from it.
 */
import { describe, expect, it } from 'vitest';

import {
  entityIdSchema,
  type AliasView,
  type JsonObject,
  type AutomationView,
  type SceneView,
} from '@nebulahome/contracts';

import { correlationsOf } from './entity-correlations';

const entity = (value: string) => entityIdSchema.parse(value);

/**
 * An automation with a document.
 *
 * @param name - What it is called.
 * @param definition - What it says.
 * @returns The automation.
 */
function automation(name: string, definition: JsonObject): AutomationView {
  return {
    id: `00000000-0000-4000-8000-00000000000${String(name.length % 10)}`,
    key: name.toLowerCase().replaceAll(' ', '_'),
    name,
    description: '',
    definition,
    definitionVersion: 1,
    mode: 'single',
    maxRuntimeMs: 300_000,
    isEnabled: true,
    lastTriggeredAt: null,
  };
}

const PORCH_AT_DUSK = automation('Porch at dusk', {
  triggers: { type: 'state', entityId: 'binary_sensor.porch_motion', to: 'on' },
  if: { type: 'state', entityId: 'switch.away', state: 'off' },
  then: [{ type: 'command', entityId: 'light.porch', capability: 'on_off', params: {} }],
});

const AWAY = automation('Away', {
  triggers: { type: 'manual' },
  then: [{ type: 'command', entityId: 'switch.away', capability: 'on_off', params: {} }],
});

const EVENING: SceneView = {
  id: '00000000-0000-4000-8000-0000000000aa',
  key: 'evening',
  name: 'Evening',
  icon: null,
  areaKey: null,
  transitionMs: 0,
  rollbackOnPartialFailure: false,
  members: [
    {
      entityId: entity('light.porch'),
      entityName: 'Porch',
      targetState: { on_off: { isOn: true } },
      transitionMs: null,
    },
  ],
};

const OUTSIDE: AliasView = {
  id: '00000000-0000-4000-8000-0000000000bb',
  entityId: entity('alias.outside_lights'),
  name: 'Outside lights',
  kind: 'calculated',
  domain: 'binary_sensor',
  capability: 'sensor_binary',
  capabilities: ['sensor_binary'],
  expression: 'l1',
  debounceMs: 0,
  fallbackPolicy: 'unavailable',
  isEnabled: true,
  lastError: null,
  lastEvaluatedAt: null,
  unitOfMeasurement: null,
  deviceClass: null,
  min: null,
  max: null,
  step: null,
  sources: [
    { variableName: 'l1', entityId: entity('light.porch'), entityName: 'Porch', areaName: null },
  ],
};

describe('correlationsOf', () => {
  it('finds the automations, scenes and aliases that name an entity, and where', () => {
    const found = correlationsOf('light.porch', {
      automations: [PORCH_AT_DUSK, AWAY],
      scenes: [EVENING],
      aliases: [OUTSIDE],
    });

    expect(found.automations).toEqual([
      expect.objectContaining({ name: 'Porch at dusk', roles: ['action'] }),
    ]);
    expect(found.scenes.map((scene) => scene.name)).toEqual(['Evening']);
    expect(found.aliases).toEqual([
      expect.objectContaining({ name: 'Outside lights', role: 'source' }),
    ]);
  });

  it('tells a condition from a command, and names both in the order the document reads', () => {
    const found = correlationsOf('switch.away', {
      automations: [PORCH_AT_DUSK, AWAY],
      scenes: [],
      aliases: [],
    });

    expect(found.automations.map((each) => [each.name, each.roles])).toEqual([
      ['Away', ['action']],
      ['Porch at dusk', ['condition']],
    ]);
  });

  it('says so when the entity is the alias itself', () => {
    const found = correlationsOf('alias.outside_lights', {
      automations: [],
      scenes: [],
      aliases: [OUTSIDE],
    });

    expect(found.aliases).toEqual([expect.objectContaining({ role: 'self' })]);
  });

  it('leaves out an automation whose document cannot be read, rather than guessing', () => {
    const found = correlationsOf('light.porch', {
      automations: [automation('Broken', { triggers: 'nonsense' })],
      scenes: [],
      aliases: [],
    });

    expect(found.automations).toEqual([]);
  });
});
