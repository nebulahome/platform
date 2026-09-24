/**
 * The dashboard's cards as a tree: the page, and the containers on it holding cards of their own.
 *
 * The grid engine knows one flat grid; this is where two of them meet. A card dragged into a
 * container leaves the page's grid and joins the container's, taking the nearest size it is drawn
 * for that fits there; a container grows to hold what it is given and shrinks behind what leaves it,
 * and the page makes room for it or closes up behind it. A container is never put inside another.
 *
 * Every function answers a new layout, and hands the same one back when asked for something that
 * cannot be done - so a caller can tell a refused drop by comparing the two.
 */
import {
  DASHBOARD_COLUMNS,
  type DashboardCard,
  type DashboardContainerCard,
  type DashboardLayout,
  type DashboardLeafCard,
} from '@nebula-home/contracts';

import { sameSize, snapSize, type CardSize } from '@/dashboard/card-sizes';
import {
  insertItem,
  moveItem,
  reflow,
  removeItem,
  resizeItem,
  settle,
  type GridItem,
  type GridPoint,
} from '@/dashboard/grid-engine';

/** The sizes a card that is not a container may take. */
export type SizesOf = (card: DashboardLeafCard) => readonly CardSize[];

/** Where a card is put: on the page (`parentId` null) or in a container, at a cell of that grid. */
export type CardPlace = GridPoint & { readonly parentId: string | null };

/** A card found in a layout, and the container it is in. */
export type FoundCard = { readonly card: DashboardCard; readonly parentId: string | null };

/** The fewest rows a container has: its heading and one row to drop a card in. */
const CONTAINER_MINIMUM_ROWS = 2;

/**
 * How tall a container is: its heading row and the rows its cards reach.
 *
 * @param cards - What it holds.
 * @returns Its height in rows.
 */
export function containerRows(cards: readonly GridItem[]): number {
  return Math.max(CONTAINER_MINIMUM_ROWS, 1 + Math.max(0, ...cards.map((card) => card.y + card.h)));
}

/**
 * Finds a card wherever it is.
 *
 * @param layout - The layout.
 * @param id - The card.
 * @returns The card and the container it is in, or null when there is no such card.
 */
export function findCard(layout: DashboardLayout, id: string): FoundCard | null {
  for (const card of layout.cards) {
    if (card.id === id) {
      return { card, parentId: null };
    }

    if (card.type === 'container') {
      const child = card.cards.find((one) => one.id === id);

      if (child !== undefined) {
        return { card: child, parentId: card.id };
      }
    }
  }

  return null;
}

/**
 * The container with an id.
 *
 * @param layout - The layout.
 * @param id - The container.
 * @returns It, or undefined when no container has that id.
 */
function containerOf(layout: DashboardLayout, id: string): DashboardContainerCard | undefined {
  return layout.cards.find(
    (card): card is DashboardContainerCard => card.type === 'container' && card.id === id,
  );
}

/**
 * The size a card takes on a grid of a given width: its own when it fits, else the nearest one
 * it is drawn for that does.
 *
 * @param card - The card.
 * @param columns - How wide the grid is.
 * @param sizesOf - What sizes it may take.
 * @returns Its size there, or null when none of its sizes is narrow enough.
 */
function fitLeaf(card: DashboardLeafCard, columns: number, sizesOf: SizesOf): CardSize | null {
  const fitting = sizesOf(card).filter((size) => size.w <= columns);

  if (fitting.some((size) => sameSize(size, card))) {
    return { w: card.w, h: card.h };
  }

  return fitting.length === 0 ? null : snapSize(fitting, card.w, card.h, columns);
}

/**
 * How narrow a container may be made: as wide as the narrowest size of its widest card.
 *
 * @param container - The container.
 * @param sizesOf - What sizes its cards may take.
 * @returns Its narrowest width, in columns.
 */
export function minimumContainerWidth(container: DashboardContainerCard, sizesOf: SizesOf): number {
  return Math.max(
    1,
    ...container.cards.map((card) => Math.min(card.w, ...sizesOf(card).map((size) => size.w))),
  );
}

/**
 * Makes every container as tall as what it holds, and makes room on the page for any that grew.
 *
 * @param cards - The page's cards.
 * @returns The page with its containers measured, in the order given.
 */
function measureContainers(cards: readonly DashboardCard[]): DashboardCard[] {
  const measured = cards.map((card): DashboardCard => {
    if (card.type !== 'container') {
      return card;
    }

    const h = containerRows(card.cards);

    return h === card.h ? card : { ...card, h };
  });

  if (measured.every((card, index) => card === cards[index])) {
    return measured;
  }

  // What is higher on the page keeps its place; a container that grew pushes what is below it.
  const settled = new Map(
    settle([...measured].sort((a, b) => a.y - b.y || a.x - b.x)).map((card) => [card.id, card]),
  );

  return measured.map((card) => settled.get(card.id) ?? card);
}

/**
 * Replaces one container's cards.
 *
 * @param cards - The page's cards.
 * @param id - The container.
 * @param inner - Its new cards.
 * @returns The page with the container changed and measured.
 */
function withInner(
  cards: readonly DashboardCard[],
  id: string,
  inner: readonly DashboardLeafCard[],
): DashboardCard[] {
  return measureContainers(
    cards.map((card) =>
      card.type === 'container' && card.id === id ? { ...card, cards: [...inner] } : card,
    ),
  );
}

/**
 * Moves a card to a cell, on the page or in a container, from wherever it is.
 *
 * @param layout - The layout as it was when the drag began.
 * @param id - The card.
 * @param place - Where it is dropped.
 * @param sizesOf - What sizes a card may take.
 * @returns The new layout; the same one when the drop cannot be done.
 */
export function placeCard(
  layout: DashboardLayout,
  id: string,
  place: CardPlace,
  sizesOf: SizesOf,
): DashboardLayout {
  const found = findCard(layout, id);
  const target = place.parentId === null ? undefined : containerOf(layout, place.parentId);

  if (found === null || (place.parentId !== null && target === undefined)) {
    return layout;
  }

  const { card, parentId } = found;
  const cell: GridPoint = { x: place.x, y: place.y };

  // Within one grid: the engine moves it.
  if (parentId === place.parentId) {
    if (target === undefined) {
      return { cards: measureContainers(moveItem(layout.cards, id, cell, DASHBOARD_COLUMNS)) };
    }

    return {
      cards: withInner(layout.cards, target.id, moveItem(target.cards, id, cell, target.w)),
    };
  }

  // Into a container: never a container, and only at a size that fits it.
  if (target !== undefined) {
    if (card.type === 'container') {
      return layout;
    }

    const size = fitLeaf(card, target.w, sizesOf);

    if (size === null) {
      return layout;
    }

    const left = removeCard(layout, id);
    const into = containerOf(left, target.id) ?? target;
    const moved: DashboardLeafCard = { ...card, ...size, ...cell };

    return {
      cards: withInner(left.cards, into.id, moveItem([...into.cards, moved], id, cell, into.w)),
    };
  }

  // Out of a container, onto the page.
  const left = removeCard(layout, id);
  const moved: DashboardCard = { ...card, ...cell };

  return {
    cards: measureContainers(moveItem([...left.cards, moved], id, cell, DASHBOARD_COLUMNS)),
  };
}

/**
 * Changes a card's size where it is.
 *
 * A container takes only the width: its height follows what it holds, and making it narrower lays
 * its cards out again, never narrower than the widest of them can go.
 *
 * @param layout - The layout.
 * @param id - The card.
 * @param size - Its new size, already one it is drawn for.
 * @param sizesOf - What sizes a card may take.
 * @returns The new layout; the same one when the size does not fit where the card is.
 */
export function resizeCard(
  layout: DashboardLayout,
  id: string,
  size: CardSize,
  sizesOf: SizesOf,
): DashboardLayout {
  const found = findCard(layout, id);

  if (found === null) {
    return layout;
  }

  const { card, parentId } = found;

  if (card.type === 'container') {
    const w = Math.min(DASHBOARD_COLUMNS, Math.max(size.w, minimumContainerWidth(card, sizesOf)));
    const inner =
      w >= card.w
        ? card.cards
        : reflow(card.cards, w, (child, columns) => fitLeaf(child, columns, sizesOf) ?? child);
    const resized = layout.cards.map((one) => (one.id === id ? { ...card, cards: inner } : one));

    return {
      cards: resizeItem(resized, id, { w, h: containerRows(inner) }, DASHBOARD_COLUMNS),
    };
  }

  if (parentId === null) {
    return { cards: measureContainers(resizeItem(layout.cards, id, size, DASHBOARD_COLUMNS)) };
  }

  const container = containerOf(layout, parentId);

  if (container === undefined || size.w > container.w) {
    return layout;
  }

  return {
    cards: withInner(
      layout.cards,
      container.id,
      resizeItem(container.cards, id, size, container.w),
    ),
  };
}

/**
 * Adds a card in the first place it fits, on the page or in a container.
 *
 * @param layout - The layout.
 * @param card - The new card; where it says it sits is ignored.
 * @param parentId - The container to put it in, or null for the page.
 * @param sizesOf - What sizes a card may take.
 * @returns The new layout; the same one when it cannot go there.
 */
export function addCard(
  layout: DashboardLayout,
  card: DashboardCard,
  parentId: string | null,
  sizesOf: SizesOf,
): DashboardLayout {
  if (parentId === null) {
    return { cards: measureContainers(insertItem(layout.cards, card, DASHBOARD_COLUMNS)) };
  }

  const container = containerOf(layout, parentId);

  if (container === undefined || card.type === 'container') {
    return layout;
  }

  const size = fitLeaf(card, container.w, sizesOf);

  if (size === null) {
    return layout;
  }

  return {
    cards: withInner(
      layout.cards,
      container.id,
      insertItem(container.cards, { ...card, ...size }, container.w),
    ),
  };
}

/**
 * Takes a card off, wherever it is, closing the gap. A container goes with what it holds.
 *
 * @param layout - The layout.
 * @param id - The card.
 * @returns The new layout.
 */
export function removeCard(layout: DashboardLayout, id: string): DashboardLayout {
  const found = findCard(layout, id);

  if (found === null) {
    return layout;
  }

  if (found.parentId === null) {
    return { cards: removeItem(layout.cards, id) };
  }

  const container = containerOf(layout, found.parentId);

  return container === undefined
    ? layout
    : { cards: withInner(layout.cards, container.id, removeItem(container.cards, id)) };
}

/**
 * Changes one card's settings - its title, its entity, its options - leaving where it sits alone.
 *
 * @param layout - The layout.
 * @param id - The card.
 * @param update - What to make of it.
 * @returns The new layout.
 */
export function updateCard(
  layout: DashboardLayout,
  id: string,
  update: (card: DashboardCard) => DashboardCard,
): DashboardLayout {
  return {
    cards: layout.cards.map((card): DashboardCard => {
      if (card.id === id) {
        return update(card);
      }

      if (card.type !== 'container' || !card.cards.some((child) => child.id === id)) {
        return card;
      }

      return {
        ...card,
        cards: card.cards.map((child): DashboardLeafCard => {
          if (child.id !== id) {
            return child;
          }

          const changed = update(child);

          return changed.type === 'container' ? child : changed;
        }),
      };
    }),
  };
}

/**
 * Every card, the ones inside containers after their container.
 *
 * @param layout - The layout.
 * @returns The cards, flat.
 */
export function allCards(layout: DashboardLayout): DashboardCard[] {
  return layout.cards.flatMap((card) =>
    card.type === 'container' ? [card, ...card.cards] : [card],
  );
}

/** The characters a card id is made of. */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A new card id, the shape the API accepts: twelve lower case letters and digits.
 *
 * @returns The id.
 */
export function newCardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));

  return Array.from(bytes, (byte) => ID_ALPHABET.charAt(byte % ID_ALPHABET.length)).join('');
}
