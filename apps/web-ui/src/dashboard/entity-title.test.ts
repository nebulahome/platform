import { describe, expect, it } from 'vitest';

import { entityTitle } from './entity-title';

describe('entityTitle', () => {
  it('puts the device before the entity', () => {
    expect(entityTitle('Power', 'Kitchen plug')).toBe('Kitchen plug · Power');
  });

  it('is the entity alone without a device', () => {
    expect(entityTitle('Outdoor average', null)).toBe('Outdoor average');
    expect(entityTitle('Outdoor average', undefined)).toBe('Outdoor average');
    expect(entityTitle('Outdoor average', '  ')).toBe('Outdoor average');
  });

  it('does not say the device twice when the entity is already named after it', () => {
    expect(entityTitle('Kitchen plug power', 'Kitchen plug')).toBe('Kitchen plug power');
    expect(entityTitle('kitchen PLUG energy', 'Kitchen plug')).toBe('kitchen PLUG energy');
  });
});
