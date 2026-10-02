import { describe, expect, it } from 'vitest';

import type { IconNode } from '@nebulahome/contracts';

import { loadBuiltinIcons } from './builtin.js';
import { IconCatalogue, type IconRow } from './catalogue.js';

const builtin = loadBuiltinIcons();
const FRAME = { x: 0, y: 0, size: 24 };
const BOILER: IconNode = [['path', { d: 'M4 4h16v16H4z' }]];

/**
 * A row as the API keeps it, for tests that vary one field.
 *
 * @param fields - What to change.
 * @returns The row.
 */
function row(fields: Partial<IconRow>): IconRow {
  return {
    id: 'boiler',
    kind: 'custom',
    name: 'Boiler',
    keywords: ['condensing'],
    node: BOILER,
    frame: FRAME,
    ...fields,
  };
}

describe('IconCatalogue', () => {
  it('serves a built-in icon as its own original', () => {
    const catalogue = new IconCatalogue(builtin, []);

    expect(catalogue.get('lightbulb')).toMatchObject({
      id: 'lightbulb',
      origin: 'builtin',
      isOverridden: false,
      frame: FRAME,
    });
    expect(catalogue.has('lightbulb')).toBe(true);
    expect(catalogue.has('no-such-icon')).toBe(false);
  });

  it('lets an override row replace a built-in drawing everywhere the id is used', () => {
    // The row keeps the built-in name and origin: the owner drew the lightbulb differently,
    // they did not make a new icon. `isOverridden` is what lets the settings page offer the
    // original back.
    const catalogue = new IconCatalogue(builtin, [
      row({ id: 'lightbulb', kind: 'override', name: 'ignored', keywords: ['mine'] }),
    ]);

    expect(catalogue.get('lightbulb')).toMatchObject({
      name: 'Lightbulb',
      origin: 'builtin',
      isOverridden: true,
      keywords: ['mine'],
      node: BOILER,
    });
  });

  it('adds a custom row as an icon of its own', () => {
    const catalogue = new IconCatalogue(builtin, [row({})]);

    expect(catalogue.get('boiler')).toMatchObject({
      id: 'boiler',
      name: 'Boiler',
      origin: 'custom',
      isOverridden: false,
    });
  });

  it('keeps an override whose original is no longer built in, as a custom icon', () => {
    // A lucide upgrade that drops an icon must not drop the owner's drawing with it, nor the
    // devices that point at the id.
    const catalogue = new IconCatalogue(builtin, [
      row({ id: 'gone-from-lucide', kind: 'override' }),
    ]);

    expect(catalogue.get('gone-from-lucide')?.origin).toBe('custom');
  });

  it('finds icons by id, name and keyword, the closest match first', () => {
    const catalogue = new IconCatalogue(builtin, [row({})]);

    expect(catalogue.search('lightbulb', 5)[0]?.id).toBe('lightbulb');
    expect(catalogue.search('condensing', 5)[0]?.id).toBe('boiler');
    expect(catalogue.search('Triangle al', 5)[0]?.id).toBe('triangle-alert');
    expect(catalogue.search('idea', 20).map((icon) => icon.id)).toContain('lightbulb');
  });

  it('puts the curated icons first when nothing is searched', () => {
    const catalogue = new IconCatalogue(builtin, []);
    const first = catalogue.search('', 3).map((icon) => icon.id);

    expect(first).toEqual(builtin.slice(0, 3).map((icon) => icon.id));
  });

  it('bounds a page', () => {
    expect(new IconCatalogue(builtin, []).search('', 7)).toHaveLength(7);
  });

  it('answers a list of ids in the order asked, skipping what it does not have', () => {
    const catalogue = new IconCatalogue(builtin, [row({})]);

    expect(catalogue.byIds(['boiler', 'no-such-icon', 'lightbulb']).map((icon) => icon.id)).toEqual(
      ['boiler', 'lightbulb'],
    );
  });

  it('says which ids are built in, override or not', () => {
    const catalogue = new IconCatalogue(builtin, [row({ id: 'lightbulb', kind: 'override' })]);

    expect(catalogue.isBuiltin('lightbulb')).toBe(true);
    expect(catalogue.isBuiltin('boiler')).toBe(false);
  });
});
