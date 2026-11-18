/**
 * The layout being edited, before it is saved.
 *
 * Editing works on a copy: nothing reaches the server until Done, and Cancel throws the copy away.
 * The copy lives here rather than in the page so that leaving the page mid-edit - to look up a
 * device, to check a scene - does not lose it: coming back to the dashboard finds it still being
 * edited, as it was left. Closing or reloading the tab is guarded by the page, which asks first.
 *
 * Zustand rather than the query cache: this is the client's own state, not a copy of the server's.
 */
import { create } from 'zustand';

import type { DashboardLayout } from '@nebulahome/contracts';

/** The edit in progress, if any. */
export type DashboardDraftState = {
  /** The dashboard being edited, or null when none is. */
  readonly dashboardId: string | null;

  /** The layout as it stands in the editor. */
  readonly layout: DashboardLayout | null;

  /** The layout as it was when editing began, to tell whether anything changed. */
  readonly original: DashboardLayout | null;

  /** The card whose settings are open. */
  readonly selectedId: string | null;

  /**
   * The cards added from the catalogue that still wait for their entity, by id, with the kind of
   * card each will be. They are drawn dashed while editing and left out when the layout is saved.
   */
  readonly pending: Readonly<Record<string, string>>;

  /** Starts editing a dashboard. */
  readonly begin: (dashboardId: string, layout: DashboardLayout) => void;

  /** Replaces the layout in the editor. */
  readonly change: (layout: DashboardLayout) => void;

  /** Opens a card's settings, or closes them. */
  readonly select: (cardId: string | null) => void;

  /** Marks a card as waiting for its entity, or - with null - as having one. */
  readonly setPending: (cardId: string, kind: string | null) => void;

  /** Stops editing, keeping nothing. */
  readonly end: () => void;
};

/** The draft store. */
export const useDashboardDraft = create<DashboardDraftState>((set) => ({
  dashboardId: null,
  layout: null,
  original: null,
  selectedId: null,
  pending: {},

  /**
   * Starts editing.
   *
   * @param dashboardId - Which dashboard.
   * @param layout - Its layout as saved.
   */
  begin: (dashboardId, layout) => {
    set({ dashboardId, layout, original: layout, selectedId: null, pending: {} });
  },

  /**
   * Replaces the layout.
   *
   * @param layout - The new one.
   */
  change: (layout) => {
    set({ layout });
  },

  /**
   * Opens a card in the inspector.
   *
   * @param cardId - The card, or null to close it.
   */
  select: (cardId) => {
    set({ selectedId: cardId });
  },

  /**
   * Marks a card as waiting for its entity, or as having one.
   *
   * @param cardId - The card.
   * @param kind - The kind of card it will be, or null once it has its entity.
   */
  setPending: (cardId, kind) => {
    set((state) => {
      const rest = Object.fromEntries(
        Object.entries(state.pending).filter(([id]) => id !== cardId),
      );

      return { pending: kind === null ? rest : { ...rest, [cardId]: kind } };
    });
  },

  /** Stops editing. */
  end: () => {
    set({ dashboardId: null, layout: null, original: null, selectedId: null, pending: {} });
  },
}));

/**
 * Whether the edit in progress changed anything.
 *
 * @param state - The draft.
 * @returns True when the layout is not the one editing began with.
 */
export function isDraftDirty(state: Pick<DashboardDraftState, 'layout' | 'original'>): boolean {
  return state.layout !== state.original;
}
