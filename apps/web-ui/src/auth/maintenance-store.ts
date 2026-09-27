/**
 * Whether the installation is being restored, as this page knows it.
 *
 * Entered two ways: this page started a restore, or any request was answered 503 `MAINTENANCE`
 * - somebody else started one. While it holds, the maintenance screen covers everything and
 * follows the restore until it ends (maintenance-overlay.tsx).
 */
import { create } from 'zustand';

/** What the store holds. */
type MaintenanceStore = {
  /** Whether the maintenance screen is up. */
  readonly isActive: boolean;

  /** The restore this page started, when it did: the screen waits for its end. */
  readonly runId: string | null;

  /**
   * Puts the screen up.
   *
   * @param runId - The restore this page started, when it did.
   */
  readonly enter: (runId?: string) => void;

  /** Takes it down. */
  readonly leave: () => void;
};

/** The maintenance state of this page. */
export const useMaintenance = create<MaintenanceStore>((set) => ({
  isActive: false,
  runId: null,

  /**
   * Puts the screen up.
   *
   * @param runId - The restore this page started, when it did.
   */
  enter: (runId?: string): void => {
    set({ isActive: true, runId: runId ?? null });
  },

  /** Takes it down. */
  leave: (): void => {
    set({ isActive: false, runId: null });
  },
}));
