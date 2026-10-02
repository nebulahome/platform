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

  /** The card open in the inspector. */
  readonly selectedId: string | null;

  /** Starts editing a dashboard. */
  readonly begin: (dashboardId: string, layout: DashboardLayout) => void;

  /** Replaces the layout in the editor. */
  readonly change: (layout: DashboardLayout) => void;

  /** Opens a card in the inspector, or closes it. */
  readonly select: (cardId: string | null) => void;

  /** Stops editing, keeping nothing. */
  readonly end: () => void;
};

/** The draft store. */
export const useDashboardDraft = create<DashboardDraftState>((set) => ({
  dashboardId: null,
  layout: null,
  original: null,
  selectedId: null,

  /**
   * Starts editing.
   *
   * @param dashboardId - Which dashboard.
   * @param layout - Its layout as saved.
   */
  begin: (dashboardId, layout) => {
    set({ dashboardId, layout, original: layout, selectedId: null });
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

  /** Stops editing. */
  end: () => {
    set({ dashboardId: null, layout: null, original: null, selectedId: null });
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
