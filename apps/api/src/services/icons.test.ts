import { describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '@nebulahome/contracts';
import { loadBuiltinIcons, type IconRow } from '@nebulahome/icons';
import { createLogger } from '@nebulahome/logging';

import { IconService, type IconStore, type IconUses } from './icons.js';

const builtin = loadBuiltinIcons();
const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });

/** A drawing an owner might upload: one square, in a 24 box. */
const SVG =
  '<svg viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>';

/** A drawing in a big box, as an export from a drawing tool comes. */
const BIG_SVG = '<svg viewBox="0 0 512 512"><path d="M64 64h384v384H64z"/></svg>';

/**
 * A store that keeps rows in memory and remembers what points at which icon.
 *
 * @param rows - What it starts with.
 * @param uses - How many devices and entities use each icon id.
 * @returns The store, and what it holds for the assertions.
 */
function fakeStore(
  rows: IconRow[] = [],
  uses = new Map<string, IconUses>(),
): { store: IconStore; rows: IconRow[]; uses: Map<string, IconUses> } {
  const store: IconStore = {
    list: () => Promise.resolve([...rows]),
    insert: (row) => {
      rows.push(row);

      return Promise.resolve();
    },
    update: (id, row) => {
      const index = rows.findIndex((each) => each.id === id);

      rows[index] = row;

      if (row.id !== id) {
        uses.set(row.id, uses.get(id) ?? { devices: 0, entities: 0, tags: 0 });
        uses.delete(id);
      }

      return Promise.resolve();
    },
    remove: (id) => {
      rows.splice(
        rows.findIndex((each) => each.id === id),
        1,
      );

      return Promise.resolve();
    },
    countUses: (id) => Promise.resolve(uses.get(id) ?? { devices: 0, entities: 0, tags: 0 }),
  };

  return { store, rows, uses };
}

/**
 * A service over a fake store.
 *
 * @param rows - What the store starts with.
 * @param uses - How many devices and entities use each icon id.
 * @returns The service and the store's contents.
 */
async function service(
  rows: IconRow[] = [],
  uses: Record<string, IconUses> = {},
): Promise<{ icons: IconService; rows: IconRow[]; uses: Map<string, IconUses> }> {
  const fake = fakeStore(rows, new Map(Object.entries(uses)));
  const icons = await IconService.load({ store: fake.store, builtin, logger });

  return { icons, rows: fake.rows, uses: fake.uses };
}

describe('IconService', () => {
  it('serves the built-in catalogue when the owner has added nothing', async () => {
    const { icons } = await service();

    expect(icons.has('lightbulb')).toBe(true);
    expect(icons.list({ q: 'lightbulb', limit: 5 })[0]?.id).toBe('lightbulb');
  });

  it('lists the ids a page asks for, in its order', async () => {
    const { icons } = await service();

    expect(icons.list({ ids: ['printer', 'lightbulb'], limit: 60 }).map((icon) => icon.id)).toEqual(
      ['printer', 'lightbulb'],
    );
  });

  it('adds a custom icon from an uploaded drawing, in the frame the editor fitted it to', async () => {
    const { icons, rows } = await service();

    const created = await icons.create({
      id: 'boiler',
      name: 'Boiler',
      keywords: ['heating'],
      svg: BIG_SVG,
      frame: { x: 32, y: 32, size: 448 },
    });

    expect(created).toMatchObject({ id: 'boiler', origin: 'custom', frame: { size: 448 } });
    expect(created.node[0]?.[0]).toBe('path');
    expect(rows.map((row) => row.id)).toEqual(['boiler']);
    expect(icons.has('boiler')).toBe(true);
  });

  it('refuses a drawing it cannot read, naming the file field', async () => {
    const { icons } = await service();

    await expect(
      icons.create({
        id: 'boiler',
        name: 'Boiler',
        keywords: [],
        svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
        frame: { x: 0, y: 0, size: 24 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an id that is already an icon, built in or custom', async () => {
    const { icons } = await service();
    const body = {
      id: 'lightbulb',
      name: 'Bulb',
      keywords: [],
      svg: SVG,
      frame: { x: 0, y: 0, size: 24 },
    };

    await expect(icons.create(body)).rejects.toBeInstanceOf(ConflictError);
  });

  it('draws a built-in icon afresh as an override that keeps its name', async () => {
    // Changing what `lightbulb` looks like changes every device that uses it. The id and the
    // name stay: the owner redrew the lightbulb, they did not make a new icon.
    const { icons, rows } = await service();

    const updated = await icons.update('lightbulb', {
      svg: SVG,
      frame: { x: 0, y: 0, size: 24 },
      keywords: ['mine'],
    });

    expect(updated).toMatchObject({
      id: 'lightbulb',
      name: 'Lightbulb',
      origin: 'builtin',
      isOverridden: true,
      keywords: ['mine'],
    });
    expect(rows[0]).toMatchObject({ id: 'lightbulb', kind: 'override', name: 'Lightbulb' });
  });

  it('refuses to rename a built-in icon or change its id', async () => {
    const { icons } = await service();

    await expect(icons.update('lightbulb', { name: 'Bulb' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(icons.update('lightbulb', { id: 'bulb' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('lets a custom icon change its name, its keywords and its id, carrying the devices along', async () => {
    const { icons, rows, uses } = await service(
      [
        {
          id: 'boiler',
          kind: 'custom',
          name: 'Boiler',
          keywords: [],
          node: [['path', { d: 'M0 0h1' }]],
          frame: { x: 0, y: 0, size: 24 },
        },
      ],
      { boiler: { devices: 2, entities: 1, tags: 0 } },
    );

    const updated = await icons.update('boiler', { id: 'combi-boiler', name: 'Combi boiler' });

    expect(updated).toMatchObject({ id: 'combi-boiler', name: 'Combi boiler' });
    expect(icons.has('boiler')).toBe(false);
    expect(rows[0]?.id).toBe('combi-boiler');
    expect([...uses.entries()]).toEqual([['combi-boiler', { devices: 2, entities: 1, tags: 0 }]]);
  });

  it('says when there is no such icon to change', async () => {
    const { icons } = await service();

    await expect(icons.update('no-such-icon', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes a custom icon nobody uses, and refuses one a device still points at', async () => {
    const custom: IconRow = {
      id: 'boiler',
      kind: 'custom',
      name: 'Boiler',
      keywords: [],
      node: [['path', { d: 'M0 0h1' }]],
      frame: { x: 0, y: 0, size: 24 },
    };
    const { icons } = await service([custom], { boiler: { devices: 3, entities: 0, tags: 0 } });

    await expect(icons.remove('boiler')).rejects.toBeInstanceOf(ConflictError);

    const free = await service([{ ...custom, id: 'kettle' }]);

    await free.icons.remove('kettle');

    expect(free.icons.has('kettle')).toBe(false);
  });

  it('refuses to remove a custom icon an entity still points at, saying what uses it', async () => {
    // An entity's icon is the owner's pick as much as a device's; a removal that left it
    // pointing at nothing would blank a tile the owner chose.
    const { icons } = await service(
      [
        {
          id: 'boiler',
          kind: 'custom',
          name: 'Boiler',
          keywords: [],
          node: [['path', { d: 'M0 0h1' }]],
          frame: { x: 0, y: 0, size: 24 },
        },
      ],
      { boiler: { devices: 0, entities: 2, tags: 0 } },
    );

    await expect(icons.remove('boiler')).rejects.toThrow(/2 entities/u);
  });

  it('refuses to remove a custom icon a tag still points at, saying what uses it', async () => {
    // A tag is drawn by its icon alone in a chip; a removal that left it pointing at nothing
    // would turn the chip into the fallback glyph without anyone having chosen that.
    const { icons } = await service(
      [
        {
          id: 'boiler',
          kind: 'custom',
          name: 'Boiler',
          keywords: [],
          node: [['path', { d: 'M0 0h1' }]],
          frame: { x: 0, y: 0, size: 24 },
        },
      ],
      { boiler: { devices: 0, entities: 0, tags: 1 } },
    );

    await expect(icons.remove('boiler')).rejects.toThrow(/^1 tag still use/u);
  });

  it('puts the built-in drawing back when an override is removed', async () => {
    const { icons } = await service([
      {
        id: 'lightbulb',
        kind: 'override',
        name: 'Lightbulb',
        keywords: [],
        node: [['path', { d: 'M0 0h1' }]],
        frame: { x: 0, y: 0, size: 24 },
      },
    ]);

    await icons.remove('lightbulb');

    expect(icons.get('lightbulb')?.isOverridden).toBe(false);
    await expect(icons.remove('lightbulb')).rejects.toBeInstanceOf(ValidationError);
  });
});
