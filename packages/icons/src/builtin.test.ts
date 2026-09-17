import { describe, expect, it } from 'vitest';

import { iconViewSchema } from '@nebula-home/contracts';

import { loadBuiltinIcons } from './builtin.js';
import { IconCatalogue } from './catalogue.js';

const icons = loadBuiltinIcons();
const byId = new Map(icons.map((icon) => [icon.id, icon]));

describe('loadBuiltinIcons', () => {
  it('ships every lucide icon under its own id, drawn in the 24 box', () => {
    const lightbulb = byId.get('lightbulb');

    expect(icons.length).toBeGreaterThan(1000);
    expect(lightbulb?.node.length).toBeGreaterThan(0);
    expect(lightbulb?.frame).toEqual({ x: 0, y: 0, size: 24 });
  });

  it('serves every built-in icon in the shape the contract promises a client', () => {
    // Lucide tags some icons with dozens of words, more than an owner may write for one of
    // their own. What is served must still parse on the other side, or the picker shows an
    // error in place of the catalogue.
    const catalogue = new IconCatalogue(icons, []);
    const refused = catalogue
      .search('', icons.length)
      .filter((view) => !iconViewSchema.safeParse(view).success)
      .map((view) => view.id);

    expect(catalogue.size).toBe(icons.length);
    expect(refused).toEqual([]);
    expect(byId.get('activity')?.keywords.length).toBeGreaterThan(20);
  });

  it('names an icon from its id, the way a person would read it', () => {
    expect(byId.get('triangle-alert')?.name).toBe('Triangle alert');
    expect(byId.get('lightbulb')?.name).toBe('Lightbulb');
  });

  it('finds an icon by the words lucide tags it with', () => {
    expect(byId.get('lightbulb')?.keywords).toContain('idea');
  });

  it("adds the platform's own ids over lucide drawings, listed first", () => {
    // `light` is what a bundle or an owner means; `lightbulb` is how lucide drew it. The alias
    // is an icon of its own, so re-pointing it later changes every device that uses it.
    const light = byId.get('light');

    expect(light?.node).toEqual(byId.get('lightbulb')?.node);
    expect(light?.name).toBe('Light');
    expect(light?.isCurated).toBe(true);
    expect(icons[0]?.isCurated).toBe(true);
    expect(byId.get('lightbulb')?.isCurated).toBe(false);
  });

  it('refuses a catalogue entry that names a drawing lucide does not have', () => {
    expect(() =>
      loadBuiltinIcons({
        catalogue: [{ id: 'boiler', name: 'Boiler', keywords: [], lucide: 'no-such-icon' }],
      }),
    ).toThrow(/no-such-icon/u);
  });

  it('accepts a catalogue entry that ships its own drawing', () => {
    const [own] = loadBuiltinIcons({
      catalogue: [
        {
          id: 'mqtt',
          name: 'MQTT',
          keywords: ['broker'],
          node: [['path', { d: 'M4 4h16' }]],
          frame: { x: 0, y: 0, size: 24 },
        },
      ],
    });

    expect(own?.node).toEqual([['path', { d: 'M4 4h16' }]]);
  });
});
