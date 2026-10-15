/**
 * Whether an automation belongs under a filter.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AutomationView } from '@nebulahome/contracts';

import {
  matchesAutomationFilter,
  OPEN_AUTOMATION_FILTER,
  triggerTypesOf,
} from './automation-filters';

/**
 * An entity address, as the type system insists on having one.
 *
 * @param value - The address.
 * @returns The same address, as an address.
 */
const entity = (value: string) => entityIdSchema.parse(value);

/** A rule that says something. */
const AUTOMATION: AutomationView = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'evening_lights',
  name: 'Evening lights',
  description: 'Hallway at dusk',
  definition: {
    triggers: [{ type: 'time', at: { kind: 'solar', event: 'sunset', offsetMinutes: -15 } }],
    conditions: [{ type: 'state', entityId: entity('person.mattia'), state: 'home' }],
    actions: [
      {
        type: 'command',
        entityId: entity('light.hallway_ceiling'),
        capability: 'on_off',
        params: {},
      },
    ],
  },
  definitionVersion: 1,
  mode: 'single',
  maxRuntimeMs: 300_000,
  isEnabled: true,
  lastTriggeredAt: null,
  lastRun: null,
};

describe('matchesAutomationFilter', () => {
  it('admits everything under the open filter', () => {
    expect(matchesAutomationFilter(AUTOMATION, OPEN_AUTOMATION_FILTER)).toBe(true);
  });

  it('matches the name, the key and the description', () => {
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, search: 'evening' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, search: 'evening_lights' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, search: 'hallway at' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, search: 'porch' }),
    ).toBe(false);
  });

  it('narrows by standing and by mode', () => {
    expect(matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, status: 'off' })).toBe(
      false,
    );
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, status: 'enabled' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(
        { ...AUTOMATION, isEnabled: false },
        { ...OPEN_AUTOMATION_FILTER, status: 'off' },
      ),
    ).toBe(true);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, mode: 'restart' }),
    ).toBe(false);
    expect(matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, mode: 'single' })).toBe(
      true,
    );
  });

  it('narrows by a trigger kind present in the definition, read as a save would lift it', () => {
    // Stored as a solar time, which is a Sun trigger now.
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, triggerType: 'sun' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, triggerType: 'time' }),
    ).toBe(false);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, triggerType: 'entity' }),
    ).toBe(false);
  });

  it('reads trigger kinds from a tree-shaped definition', () => {
    const treeShaped: AutomationView = {
      ...AUTOMATION,
      definition: {
        triggers: {
          op: 'or',
          items: [
            { type: 'state', entityId: entity('binary_sensor.hallway_motion'), to: 'on' },
            { type: 'manual' },
          ],
        },
        then: [{ type: 'stop' }],
      },
    };

    expect(
      matchesAutomationFilter(treeShaped, { ...OPEN_AUTOMATION_FILTER, triggerType: 'manual' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(treeShaped, { ...OPEN_AUTOMATION_FILTER, triggerType: 'entity' }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(treeShaped, { ...OPEN_AUTOMATION_FILTER, triggerType: 'event' }),
    ).toBe(false);
  });
});

describe('triggerTypesOf', () => {
  it('returns nothing for a document it cannot read', () => {
    expect(triggerTypesOf({ nonsense: true })).toEqual([]);
    expect(triggerTypesOf(null)).toEqual([]);
  });
});
