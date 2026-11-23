import { describe, expect, it } from 'vitest';

import { partCommands } from './alias-commands.js';
import { aliasPartsSchema } from './alias-parts.js';
import { aliasType, aliasTypeParts } from './alias-types.js';
import {
  sensorTextCommandSchema,
  sensorTextParamsSchema,
  sensorTextStateSchema,
  textProblemOf,
} from './capabilities.js';
import { DOMAIN_CAPABILITIES } from './entity-id.js';

describe('a text the house may write', () => {
  it('stays a sensor: no domain of its own', () => {
    expect(DOMAIN_CAPABILITIES.sensor.oneOf).toContain('sensor_text');
  });

  it('is read only unless it says the house may set it, and keeps what was stored valid', () => {
    expect(sensorTextParamsSchema.parse({})).toEqual({ options: [], canSet: false });
    expect(sensorTextParamsSchema.parse({ options: ['wash', 'rinse'] })).toEqual({
      options: ['wash', 'rinse'],
      canSet: false,
    });
    expect(sensorTextParamsSchema.parse({ canSet: true, maxLength: 64, isPassword: true })).toEqual(
      { options: [], canSet: true, maxLength: 64, isPassword: true },
    );
  });

  it('refuses limits out of order and a pattern that does not compile', () => {
    expect(sensorTextParamsSchema.safeParse({ minLength: 8, maxLength: 4 }).success).toBe(false);
    expect(sensorTextParamsSchema.safeParse({ minLength: 4, maxLength: 4 }).success).toBe(true);
    expect(sensorTextParamsSchema.safeParse({ pattern: '^[a-z0-9-]+$' }).success).toBe(true);
    expect(sensorTextParamsSchema.safeParse({ pattern: '([a-z' }).success).toBe(false);
  });

  it('takes the whole text in set_value, as long as its state may be', () => {
    expect(sensorTextCommandSchema.safeParse({ command: 'set_value', value: '' }).success).toBe(
      true,
    );
    expect(
      sensorTextCommandSchema.safeParse({ command: 'set_value', value: 'x'.repeat(513) }).success,
    ).toBe(false);
    expect(sensorTextStateSchema.safeParse({ value: 'x'.repeat(512) }).success).toBe(true);
  });

  it('says why a text does not fit: too short, too long, off the whole pattern', () => {
    const params = { minLength: 2, maxLength: 24, pattern: '[a-z0-9-]+' };

    expect(textProblemOf(params, 'garage-door')).toBeUndefined();
    expect(textProblemOf(params, 'g')).toBe('short');
    expect(textProblemOf(params, 'x'.repeat(25))).toBe('long');
    expect(textProblemOf(params, 'garage door')).toBe('pattern');
    // A match inside the text is not enough: the pattern holds for all of it.
    expect(textProblemOf({ pattern: 'a|b' }, 'ab')).toBe('pattern');
    expect(textProblemOf({}, '')).toBeUndefined();
  });

  it("lets a stored text alias's actions answer set_value", () => {
    const parts = aliasPartsSchema.parse({ value: { from: 'stored' } });

    expect(partCommands(aliasTypeParts(aliasType('text')), parts, 'value')).toEqual(['set_value']);
  });
});
