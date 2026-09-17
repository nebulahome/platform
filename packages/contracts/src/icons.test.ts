import { describe, expect, it } from 'vitest';

import {
  iconCreateSchema,
  iconIdSchema,
  iconNodeSchema,
  iconsQuerySchema,
  iconUpdateSchema,
  iconViewSchema,
} from './icons.js';

/**
 * An icon as the API serves it, for tests that vary one field.
 *
 * @returns The view.
 */
function view(): Record<string, unknown> {
  return {
    id: 'lightbulb',
    name: 'Lightbulb',
    keywords: ['idea', 'bulb'],
    origin: 'builtin',
    isOverridden: false,
    node: [['path', { d: 'M15 14c.2-1 .7-1.7 1.5-2.5' }]],
    frame: { x: 0, y: 0, size: 24 },
  };
}

describe('iconIdSchema', () => {
  it('takes the lucide shape: lower case, digits and dashes, digit allowed first', () => {
    for (const value of ['lightbulb', 'triangle-alert', '3d-printer', 'a']) {
      expect(iconIdSchema.safeParse(value).success).toBe(true);
    }
  });

  it('refuses what a person would type by mistake', () => {
    for (const value of ['Lightbulb', 'light bulb', 'light_bulb', '-light', '']) {
      expect(iconIdSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('iconNodeSchema', () => {
  it('keeps only the elements a line icon is drawn with', () => {
    // A `script` or an `image` inside a node is a way to run something in every browser that
    // renders the icon. The whitelist is the whole defence, so it is checked at the boundary.
    expect(iconNodeSchema.safeParse([['script', { src: 'x' }]]).success).toBe(false);
    expect(iconNodeSchema.safeParse([['circle', { cx: '12', cy: '12', r: '4' }]]).success).toBe(
      true,
    );
  });
});

describe('iconViewSchema', () => {
  it('serves a built-in icon with its drawing and the frame to draw it in', () => {
    const parsed = iconViewSchema.parse(view());

    expect(parsed.frame).toEqual({ x: 0, y: 0, size: 24 });
    expect(parsed.origin).toBe('builtin');
  });

  it('refuses a frame with no size', () => {
    expect(iconViewSchema.safeParse({ ...view(), frame: { x: 0, y: 0, size: 0 } }).success).toBe(
      false,
    );
  });
});

describe('iconCreateSchema', () => {
  it('needs an id, a name, the drawing and the frame it was fitted in', () => {
    const parsed = iconCreateSchema.parse({
      id: 'boiler',
      name: 'Boiler',
      svg: '<svg viewBox="0 0 24 24"><path d="M4 4h16"/></svg>',
      frame: { x: 0, y: 0, size: 24 },
    });

    expect(parsed.keywords).toEqual([]);
  });

  it('refuses a drawing without the frame that centres it', () => {
    // The server cannot measure a path. The frame is what the editor computed from the drawing
    // on screen, and an icon saved without one would render at whatever the file said.
    expect(
      iconCreateSchema.safeParse({ id: 'boiler', name: 'Boiler', svg: '<svg/>' }).success,
    ).toBe(false);
  });
});

describe('iconUpdateSchema', () => {
  it('refuses an empty change', () => {
    expect(iconUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('takes a rename on its own', () => {
    expect(iconUpdateSchema.parse({ name: 'Bulb' })).toEqual({ name: 'Bulb' });
  });

  it('needs the frame whenever the drawing changes', () => {
    expect(iconUpdateSchema.safeParse({ svg: '<svg/>' }).success).toBe(false);
    expect(
      iconUpdateSchema.safeParse({ svg: '<svg/>', frame: { x: 0, y: 0, size: 24 } }).success,
    ).toBe(true);
  });
});

describe('iconsQuerySchema', () => {
  it('reads a comma-separated list of ids', () => {
    expect(iconsQuerySchema.parse({ ids: 'lightbulb,printer' }).ids).toEqual([
      'lightbulb',
      'printer',
    ]);
  });

  it('bounds the page even when the caller says nothing', () => {
    expect(iconsQuerySchema.parse({}).limit).toBe(60);
    expect(iconsQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
