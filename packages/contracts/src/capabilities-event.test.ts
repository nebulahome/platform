import { describe, expect, it } from 'vitest';

import { automationRunTriggerSchema } from './api-history.js';
import { automationTriggerSchema } from './automation-triggers.js';
import { commandSchemaFor, eventParamsSchema, eventStateSchema } from './capabilities.js';
import { DOMAIN_CAPABILITIES, PLATFORM_ENTITY_DOMAINS } from './entity-id.js';
import { STATE_TOKEN_UNAVAILABLE, stateTokenChoices, stateTokenOf } from './entity-state-token.js';

describe('the event domain', () => {
  it('is an entity integrations report, which takes no commands', () => {
    expect(DOMAIN_CAPABILITIES.event).toEqual({ oneOf: ['event'], may: [] });
    expect(PLATFORM_ENTITY_DOMAINS).not.toContain('event');
    expect(commandSchemaFor('event')).toBeNull();
  });

  it('holds nothing before the first event, then its type and the moment it came', () => {
    expect(eventStateSchema.parse({})).toEqual({ eventType: null, at: null });
    expect(
      eventStateSchema.safeParse({ eventType: 'double_press', at: '2026-11-23T18:42:07.120Z' })
        .success,
    ).toBe(true);
    // A moment with no offset is not one.
    expect(
      eventStateSchema.safeParse({ eventType: 'ring', at: '2026-11-23T18:42:07' }).success,
    ).toBe(false);
  });

  it('lists its types, bounded', () => {
    expect(eventParamsSchema.parse({})).toEqual({ eventTypes: [] });
    expect(eventParamsSchema.safeParse({ eventTypes: ['x'.repeat(65)] }).success).toBe(false);
    expect(
      eventParamsSchema.safeParse({ eventTypes: Array.from({ length: 65 }, () => 'press') })
        .success,
    ).toBe(false);
  });

  it('reads as its last type, and offers its types for a dropdown', () => {
    expect(stateTokenOf({ event: { eventType: 'ring', at: '2026-11-23T18:42:07Z' } })).toBe('ring');
    expect(stateTokenOf({ event: { eventType: null, at: null } })).toBeUndefined();
    expect(stateTokenChoices(['event'], ['single', 'double'])).toEqual([
      'single',
      'double',
      STATE_TOKEN_UNAVAILABLE,
    ]);
  });

  it('bounds the type a trigger waits for and a run records', () => {
    const long = 'x'.repeat(65);

    expect(automationTriggerSchema.safeParse({ type: 'event', event: 'ring' }).success).toBe(true);
    expect(automationTriggerSchema.safeParse({ type: 'event', event: long }).success).toBe(false);
    expect(
      automationRunTriggerSchema.safeParse({ kind: 'event', event: 'long_double_press' }).success,
    ).toBe(true);
    expect(automationRunTriggerSchema.safeParse({ kind: 'event', event: long }).success).toBe(
      false,
    );
  });
});
