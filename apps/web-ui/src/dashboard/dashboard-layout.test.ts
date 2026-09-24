import { describe, expect, it } from 'vitest';

import {
  dashboardLayoutSchema,
  parseEntityId,
  type DashboardCard,
  type DashboardContainerCard,
  type DashboardEntityCard,
  type DashboardLayout,
  type DashboardLeafCard,
} from '@nebula-home/contracts';

import { CARD_SIZES } from '@/dashboard/card-sizes';
import {
  addCard,
  containerRows,
  findCard,
  minimumContainerWidth,
  newCardId,
  placeCard,
  removeCard,
  resizeCard,
  updateCard,
  type SizesOf,
} from '@/dashboard/dashboard-layout';

/**
 * Every leaf is a light here, save the camera, which is never narrower than two columns.
 *
 * @param card - The card.
 * @returns The sizes it may take.
 */
const sizesOf: SizesOf = (card) =>
  card.type === 'entity' && card.entityId.startsWith('camera.')
    ? CARD_SIZES.camera.sizes
    : CARD_SIZES.light.sizes;

/**
 * A light card.
 *
 * @param id - Its identifier.
 * @param x - Its column.
 * @param y - Its row.
 * @param w - How many columns it spans.
 * @param h - How many rows it spans.
 * @returns The card.
 */
function light(id: string, x: number, y: number, w = 1, h = 2): DashboardEntityCard {
  return {
    id,
    type: 'entity',
    x,
    y,
    w,
    h,
    entityId: parseEntityId('light.kitchen_ceiling'),
    title: null,
    icon: null,
    range: null,
  };
}

/**
 * A camera card, which is never narrower than two columns.
 *
 * @param id - Its identifier.
 * @param x - Its column.
 * @param y - Its row.
 * @returns The card.
 */
function camera(id: string, x: number, y: number): DashboardEntityCard {
  return { ...light(id, x, y, 2, 2), entityId: parseEntityId('camera.door') };
}

/**
 * A container.
 *
 * @param id - Its identifier.
 * @param x - Its column.
 * @param y - Its row.
 * @param w - How many columns it spans.
 * @param cards - What it holds.
 * @returns The card, as tall as what it holds.
 */
function box(
  id: string,
  x: number,
  y: number,
  w: number,
  cards: DashboardLeafCard[],
): DashboardContainerCard {
  return {
    id,
    type: 'container',
    x,
    y,
    w,
    h: containerRows(cards),
    title: 'Box',
    icon: null,
    cards,
  };
}

/**
 * Where every card ended up, containers' cards under `parent/child`.
 *
 * @param layout - The layout.
 * @returns `id → "x,y wxh"`.
 */
function where(layout: DashboardLayout): Record<string, string> {
  const place = (card: DashboardCard): string =>
    `${String(card.x)},${String(card.y)} ${String(card.w)}x${String(card.h)}`;

  const entries = layout.cards.flatMap((card): [string, string][] => [
    [card.id, place(card)],
    ...(card.type === 'container'
      ? card.cards.map((child): [string, string] => [`${card.id}/${child.id}`, place(child)])
      : []),
  ]);

  return Object.fromEntries(entries);
}

/**
 * Asserts the layout is one the API would store, once the short ids these tests use are padded to
 * the length a real card id has.
 *
 * @param layout - The layout.
 * @returns The same layout.
 */
function valid(layout: DashboardLayout): DashboardLayout {
  const padded: unknown = JSON.parse(
    JSON.stringify(layout),
    (key: string, value: unknown): unknown =>
      key === 'id' && typeof value === 'string' ? value.padEnd(8, '0') : value,
  );
  const result = dashboardLayoutSchema.safeParse(padded);

  expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([]);

  return layout;
}

describe('containerRows', () => {
  it('is its heading plus the rows its cards reach, and never less than two', () => {
    expect(containerRows([])).toBe(2);
    expect(containerRows([light('a', 0, 0), light('b', 0, 2)])).toBe(5);
  });
});

describe('placeCard', () => {
  it('moves a card on the page', () => {
    const layout = { cards: [light('a', 0, 0), light('b', 1, 0)] };
    const moved = valid(placeCard(layout, 'a', { parentId: null, x: 1, y: 0 }, sizesOf));

    expect(where(moved)).toEqual({ a: '1,0 1x2', b: '0,0 1x2' });
  });

  it('drops a card into a container, which grows to hold it and pushes the page down', () => {
    const layout = { cards: [box('box', 0, 0, 4, []), light('a', 0, 2), light('b', 1, 2)] };
    const moved = valid(placeCard(layout, 'a', { parentId: 'box', x: 2, y: 0 }, sizesOf));

    expect(where(moved)).toEqual({ box: '0,0 4x3', 'box/a': '2,0 1x2', b: '1,3 1x2' });
  });

  it('takes a card out of a container, which shrinks behind it', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0), light('c', 0, 2)])] };
    const moved = valid(placeCard(layout, 'a', { parentId: null, x: 0, y: 9 }, sizesOf));

    expect(where(moved)).toEqual({ box: '0,0 4x3', 'box/c': '0,0 1x2', a: '0,3 1x2' });
  });

  it('narrows a card to fit a narrower container', () => {
    const layout = { cards: [box('box', 0, 0, 1, []), light('wide', 1, 0, 2, 2)] };
    const moved = valid(placeCard(layout, 'wide', { parentId: 'box', x: 0, y: 0 }, sizesOf));

    expect(where(moved)).toEqual({ box: '0,0 1x3', 'box/wide': '0,0 1x2' });
  });

  it('refuses a card that has no size narrow enough', () => {
    const layout = { cards: [box('box', 0, 0, 1, []), camera('cam', 1, 0)] };

    expect(placeCard(layout, 'cam', { parentId: 'box', x: 0, y: 0 }, sizesOf)).toBe(layout);
  });

  it('refuses a container inside a container', () => {
    const layout = { cards: [box('outer', 0, 0, 4, []), box('inner', 0, 2, 4, [])] };

    expect(placeCard(layout, 'inner', { parentId: 'outer', x: 0, y: 0 }, sizesOf)).toBe(layout);
  });
});

describe('resizeCard', () => {
  it('resizes a card inside a container, and the container follows', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0)]), light('b', 0, 3)] };
    const resized = valid(resizeCard(layout, 'a', { w: 2, h: 2 }, sizesOf));

    expect(where(resized)).toEqual({ box: '0,0 4x3', 'box/a': '0,0 2x2', b: '0,3 1x2' });
  });

  it('narrows a container, laying its cards out again', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0), light('b', 1, 0)])] };
    const resized = valid(resizeCard(layout, 'box', { w: 1, h: 1 }, sizesOf));

    expect(where(resized)).toEqual({ box: '0,0 1x5', 'box/a': '0,0 1x2', 'box/b': '0,2 1x2' });
  });

  it('keeps a container as wide as the widest thing it cannot narrow', () => {
    const container = box('box', 0, 0, 4, [camera('cam', 0, 0)]);

    expect(minimumContainerWidth(container, sizesOf)).toBe(2);
    expect(where(resizeCard({ cards: [container] }, 'box', { w: 1, h: 1 }, sizesOf))['box']).toBe(
      '0,0 2x3',
    );
  });
});

describe('addCard and removeCard', () => {
  it('adds a card in the first place it fits, in a container too', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0)])] };
    const added = valid(addCard(layout, light('b', 0, 0), 'box', sizesOf));

    expect(where(added)['box/b']).toBe('1,0 1x2');
  });

  it('removes a card and closes the gap', () => {
    const layout = { cards: [light('a', 0, 0), light('b', 0, 2)] };

    expect(where(removeCard(layout, 'a'))).toEqual({ b: '0,0 1x2' });
  });

  it('removes a card from a container, which shrinks', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0), light('b', 0, 2)])] };

    expect(where(removeCard(layout, 'b'))).toEqual({ box: '0,0 4x3', 'box/a': '0,0 1x2' });
  });
});

describe('findCard and updateCard', () => {
  it('finds a card inside a container, with the container it is in', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0)])] };

    expect(findCard(layout, 'a')).toMatchObject({ card: { id: 'a' }, parentId: 'box' });
    expect(findCard(layout, 'nowhere')).toBeNull();
  });

  it('changes one card and nothing else', () => {
    const layout = { cards: [box('box', 0, 0, 4, [light('a', 0, 0)]), light('b', 0, 3)] };
    const changed = updateCard(layout, 'a', (card) => ({ ...card, title: 'Kitchen' }));

    expect(findCard(changed, 'a')?.card).toMatchObject({ title: 'Kitchen' });
    expect(findCard(changed, 'b')?.card).toMatchObject({ title: null });
  });
});

describe('newCardId', () => {
  it('makes ids the API accepts, and different ones', () => {
    const one = newCardId();

    expect(one).toMatch(/^[a-z0-9]{12}$/);
    expect(newCardId()).not.toBe(one);
  });
});
