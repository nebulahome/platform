/**
 * The editor's clipboard: the one card that was copied, with its size and its settings, ready to
 * be pasted into an empty space - on this dashboard, in a group, or in another dashboard's editor
 * in the same tab.
 *
 * It is the editor's own, not the system's: a card is not text another program could take. It
 * lives in `sessionStorage` so it survives going from one dashboard's editor to another's, and is
 * gone with the tab. One card at a time: a new Copy replaces it.
 */
import { create } from 'zustand';

import { dashboardCardSchema, type DashboardCard } from '@nebulahome/contracts';

import { newCardId } from '@/dashboard/dashboard-layout';

/** Where the copied card is kept. */
const STORAGE_KEY = 'nebula.dashboard.clipboard';

/** What was copied: the card, and the name it was copied under. */
export type CopiedCard = { readonly card: DashboardCard; readonly name: string };

/** The clipboard. */
type ClipboardState = {
  /** The card copied, or null. */
  readonly copied: CopiedCard | null;

  /** Keeps a card, replacing the one before. */
  readonly copy: (card: DashboardCard, name: string) => void;
};

/**
 * Reads the card kept in this tab, if it still reads as a card.
 *
 * @returns The card, or null.
 */
function readKept(): CopiedCard | null {
  try {
    const raw = globalThis.sessionStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || !('card' in parsed)) {
      return null;
    }

    const card = dashboardCardSchema.safeParse(parsed.card);
    const name = 'name' in parsed && typeof parsed.name === 'string' ? parsed.name : '';

    return card.success ? { card: card.data, name } : null;
  } catch {
    // Storage refused or unreadable: the clipboard starts empty.
    return null;
  }
}

/** The editor's clipboard. */
export const useDashboardClipboard = create<ClipboardState>()((set) => ({
  copied: readKept(),

  /**
   * Keeps a card.
   *
   * @param card - The card, as the layout has it.
   * @param name - What it is called, for "Paste Island lights".
   */
  copy: (card, name) => {
    try {
      globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ card, name }));
    } catch {
      // Storage refused: the card is still kept for this page.
    }

    set({ copied: { card, name } });
  },
}));

/**
 * A copy of a card to paste: the same card under new ids, the cards of a group included.
 *
 * @param card - The card copied.
 * @returns The copy.
 */
export function cardCopy(card: DashboardCard): DashboardCard {
  if (card.type === 'container') {
    return {
      ...card,
      id: newCardId(),
      cards: card.cards.map((inner) => ({ ...inner, id: newCardId() })),
    };
  }

  return { ...card, id: newCardId() };
}
