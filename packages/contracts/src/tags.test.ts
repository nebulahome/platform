import { describe, expect, it } from 'vitest';

import {
  TAG_COLORS,
  tagColorSchema,
  tagCreateSchema,
  tagUpdateSchema,
  tagViewSchema,
  toTagKey,
} from './tags.js';

describe('the palette', () => {
  it('offers twelve colours, each a key the interface has a token for', () => {
    expect(TAG_COLORS).toHaveLength(12);
    expect(new Set(TAG_COLORS).size).toBe(12);

    for (const color of TAG_COLORS) {
      expect(color).toMatch(/^[a-z]+$/);
      expect(tagColorSchema.safeParse(color).success).toBe(true);
    }
  });

  it('refuses a colour that is not in it, hex included', () => {
    // A hex would be one colour in both themes, and wrong in one of them.
    expect(tagColorSchema.safeParse('#ff0000').success).toBe(false);
    expect(tagColorSchema.safeParse('crimson').success).toBe(false);
  });
});

describe('toTagKey', () => {
  it('turns a name into the key alphabet: lower case, words joined by underscores', () => {
    expect(toTagKey('Energy monitored')).toBe('energy_monitored');
    expect(toTagKey('  Exterior  ')).toBe('exterior');
    expect(toTagKey('Living-room / lights')).toBe('living_room_lights');
  });

  it('strips accents rather than dropping the letters under them', () => {
    expect(toTagKey('Éclairage extérieur')).toBe('eclairage_exterieur');
  });

  it('starts the key with a letter, as the scope alphabet requires', () => {
    expect(toTagKey('3D printers')).toBe('tag_3d_printers');
    expect(toTagKey('_hidden')).toBe('hidden');
  });

  it('gives an empty key for a name with nothing usable in it, for the caller to fall back on', () => {
    expect(toTagKey('***')).toBe('');
    expect(toTagKey('')).toBe('');
  });

  it('keeps a key within the sixty-four characters the column allows', () => {
    const key = toTagKey('x'.repeat(80));

    expect(key).toHaveLength(64);
    expect(key).toBe('x'.repeat(64));
  });
});

describe('tagCreateSchema', () => {
  it('takes a name and a colour, and trims the name', () => {
    expect(tagCreateSchema.parse({ name: '  Exterior ', color: 'teal' })).toEqual({
      name: 'Exterior',
      color: 'teal',
    });
  });

  it('refuses a blank name and a missing colour', () => {
    expect(tagCreateSchema.safeParse({ name: '   ', color: 'teal' }).success).toBe(false);
    expect(tagCreateSchema.safeParse({ name: 'Exterior' }).success).toBe(false);
  });

  it('takes an icon by its catalogue id, and refuses one that is not an id', () => {
    expect(tagCreateSchema.parse({ name: 'Exterior', color: 'teal', icon: 'sun' })).toEqual({
      name: 'Exterior',
      color: 'teal',
      icon: 'sun',
    });
    expect(
      tagCreateSchema.safeParse({ name: 'Exterior', color: 'teal', icon: 'Sun!' }).success,
    ).toBe(false);
  });
});

describe('tagUpdateSchema', () => {
  it('changes the name or the colour, but refuses an empty change', () => {
    expect(tagUpdateSchema.safeParse({ color: 'pink' }).success).toBe(true);
    expect(tagUpdateSchema.safeParse({ name: 'Outside' }).success).toBe(true);
    expect(tagUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('sets the icon, or takes it away with null', () => {
    expect(tagUpdateSchema.safeParse({ icon: 'sun' }).success).toBe(true);
    expect(tagUpdateSchema.safeParse({ icon: null }).success).toBe(true);
  });

  it('never takes a key: the key is fixed at creation', () => {
    expect(tagUpdateSchema.safeParse({ key: 'outside' }).success).toBe(false);
  });
});

describe('tagViewSchema', () => {
  it('counts the devices and the entities a tag is on, separately', () => {
    const view = tagViewSchema.parse({
      id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
      key: 'exterior',
      name: 'Exterior',
      color: 'green',
      icon: null,
      deviceCount: 2,
      entityCount: 5,
    });

    expect([view.deviceCount, view.entityCount]).toEqual([2, 5]);
  });

  it('always says which icon a tag has, so a chip can draw it or fall back', () => {
    expect(
      tagViewSchema.safeParse({
        id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
        key: 'exterior',
        name: 'Exterior',
        color: 'green',
        deviceCount: 0,
        entityCount: 0,
      }).success,
    ).toBe(false);
  });
});
