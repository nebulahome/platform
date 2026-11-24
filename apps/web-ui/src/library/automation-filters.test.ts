/**
 * Whether an automation belongs under a filter.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AutomationView } from '@nebulahome/contracts';

import {
  AUTOMATION_FILTER_CODEC,
  automationChoices,
  automationFacetCount,
  countAutomationStandings,
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
  missingEntities: [],
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
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, statuses: ['off'] }),
    ).toBe(false);
    expect(
      matchesAutomationFilter(AUTOMATION, { ...OPEN_AUTOMATION_FILTER, statuses: ['enabled'] }),
    ).toBe(true);
    expect(
      matchesAutomationFilter(
        { ...AUTOMATION, isEnabled: false },
        { ...OPEN_AUTOMATION_FILTER, statuses: ['off'] },
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

describe('the standings', () => {
  /**
   * The automation with a run on record.
   *
   * @param result - How the run ended.
   * @returns The automation.
   */
  const ran = (result: 'success' | 'failed' | 'timeout'): AutomationView => ({
    ...AUTOMATION,
    lastTriggeredAt: new Date('2026-11-20T18:00:00Z'),
    lastRun: {
      id: '00000000-0000-4000-8000-0000000000a1',
      time: new Date('2026-11-20T18:00:00Z'),
      finishedAt: new Date('2026-11-20T18:00:01Z'),
      result,
    },
  });

  it('reads Never run from the run on record, not from when it last fired', () => {
    const fired = { ...AUTOMATION, lastTriggeredAt: new Date('2026-11-20T18:00:00Z') };
    const never = { ...OPEN_AUTOMATION_FILTER, statuses: ['never' as const] };

    expect(matchesAutomationFilter(fired, never)).toBe(true);
    expect(matchesAutomationFilter(ran('success'), never)).toBe(false);
  });

  it('counts a failed or timed-out last run as failed', () => {
    const failed = { ...OPEN_AUTOMATION_FILTER, statuses: ['failed' as const] };

    expect(matchesAutomationFilter(ran('failed'), failed)).toBe(true);
    expect(matchesAutomationFilter(ran('timeout'), failed)).toBe(true);
    expect(matchesAutomationFilter(ran('success'), failed)).toBe(false);
    expect(matchesAutomationFilter(AUTOMATION, failed)).toBe(false);
  });

  it('lets through a rule standing any of the ticked ways', () => {
    const offOrFailed = {
      ...OPEN_AUTOMATION_FILTER,
      statuses: ['off' as const, 'failed' as const],
    };

    expect(matchesAutomationFilter(ran('failed'), offOrFailed)).toBe(true);
    expect(matchesAutomationFilter(AUTOMATION, offOrFailed)).toBe(false);
  });

  it('counts each standing, a rule in more than one', () => {
    expect(
      countAutomationStandings([AUTOMATION, ran('timeout'), { ...AUTOMATION, isEnabled: false }]),
    ).toEqual({ enabled: 2, off: 1, never: 2, failed: 1 });
  });
});

describe('Missing entities', () => {
  it('shows only the rules naming an entity the house does not have', () => {
    const missing = { ...OPEN_AUTOMATION_FILTER, isMissing: true };

    expect(matchesAutomationFilter(AUTOMATION, missing)).toBe(false);
    expect(
      matchesAutomationFilter({ ...AUTOMATION, missingEntities: [entity('light.porch')] }, missing),
    ).toBe(true);
  });
});

describe('automationChoices', () => {
  it('offers only the modes and trigger kinds in use, in the schema order', () => {
    const manual: AutomationView = {
      ...AUTOMATION,
      mode: 'queued',
      definition: { triggers: [{ type: 'manual' }], then: [{ type: 'stop' }] },
    };

    expect(automationChoices([manual, AUTOMATION])).toEqual({
      modes: ['single', 'queued'],
      triggers: ['sun', 'manual'],
    });
  });
});

describe('AUTOMATION_FILTER_CODEC', () => {
  it('keeps every facet in the address and reads it back', () => {
    const filter = {
      search: 'porch',
      statuses: ['enabled' as const, 'failed' as const],
      mode: 'queued' as const,
      triggerType: 'calendar' as const,
      isMissing: true,
    };
    const params = new URLSearchParams(AUTOMATION_FILTER_CODEC.write(filter));

    expect(params.get('status')).toBe('enabled,failed');
    expect(AUTOMATION_FILTER_CODEC.read(params)).toEqual(filter);
    expect(automationFacetCount(filter)).toBe(4);
  });

  it('writes nothing for the open filter and reads an old or unknown value as any', () => {
    expect(AUTOMATION_FILTER_CODEC.write(OPEN_AUTOMATION_FILTER)).toEqual({});
    expect(
      AUTOMATION_FILTER_CODEC.read(new URLSearchParams('status=any&mode=any&trigger=nonsense')),
    ).toEqual(OPEN_AUTOMATION_FILTER);
  });
});

describe('triggerTypesOf', () => {
  it('returns nothing for a document it cannot read', () => {
    expect(triggerTypesOf({ nonsense: true })).toEqual([]);
    expect(triggerTypesOf(null)).toEqual([]);
  });
});
