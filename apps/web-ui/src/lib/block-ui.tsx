/**
 * What the automation editor remembers about its blocks, besides the draft: which one is
 * selected, which are open, which is being renamed, and what testing each said.
 *
 * Held by block id (`block-ids.ts`), editor-wide, rather than in each block's component: a block
 * dragged into another list is drawn by a new component, and would otherwise forget that it was
 * open and selected - and what its test said - the moment it landed.
 *
 * One selection at a time. Escape clears it, unless a dialog is open and the Escape is the
 * dialog's; so does a click on the page outside every block.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { AutomationTestReply } from '@nebulahome/contracts';

/** What testing a block said, or is saying. */
export type BlockTestState =
  | { readonly status: 'running'; readonly testId: string }
  | {
      readonly status: 'done';
      readonly reply: AutomationTestReply;

      /** The block as it was tested, to tell when it has been changed since. */
      readonly fingerprint: string;
    }
  | { readonly status: 'error'; readonly message: string; readonly fingerprint: string };

/** The editor's memory of its blocks. */
export class BlockUiStore {
  #selected: string | null = null;
  #renaming: string | null = null;
  readonly #open = new Map<string, boolean>();
  readonly #tests = new Map<string, BlockTestState>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  /**
   * Listens for any change.
   *
   * @param listener - Called after each.
   * @returns Stops listening.
   */
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * A number that changes with every change, for React to compare.
   *
   * @returns The version.
   */
  public readonly version = (): number => this.#version;

  /**
   * The block selected, if any.
   *
   * @returns Its id, or null.
   */
  public get selected(): string | null {
    return this.#selected;
  }

  /**
   * The block being renamed, if any.
   *
   * @returns Its id, or null.
   */
  public get renaming(): string | null {
    return this.#renaming;
  }

  /**
   * Selects a block, letting any other go.
   *
   * @param id - The block.
   */
  public select(id: string | null): void {
    if (this.#selected !== id) {
      this.#selected = id;
      this.#changed();
    }
  }

  /**
   * Whether a block is open.
   *
   * @param id - The block.
   * @param fallback - What it is when nobody has opened or closed it yet.
   * @returns Whether its fields show.
   */
  public isOpen(id: string, fallback: boolean): boolean {
    return this.#open.get(id) ?? fallback;
  }

  /**
   * Opens or closes a block.
   *
   * @param id - The block.
   * @param isOpen - Whether it should be open.
   */
  public setOpen(id: string, isOpen: boolean): void {
    if (this.#open.get(id) !== isOpen) {
      this.#open.set(id, isOpen);
      this.#changed();
    }
  }

  /**
   * Starts or stops the renaming of a block.
   *
   * @param id - The block, or null to stop.
   */
  public rename(id: string | null): void {
    if (this.#renaming !== id) {
      this.#renaming = id;
      this.#changed();
    }
  }

  /**
   * What testing a block said.
   *
   * @param id - The block.
   * @returns Its test, or undefined when it was not tested.
   */
  public test(id: string): BlockTestState | undefined {
    return this.#tests.get(id);
  }

  /**
   * Records what testing a block said, or forgets it.
   *
   * @param id - The block.
   * @param state - What it said; undefined to forget.
   */
  public setTest(id: string, state: BlockTestState | undefined): void {
    if (state === undefined) {
      if (this.#tests.delete(id)) {
        this.#changed();
      }

      return;
    }

    this.#tests.set(id, state);
    this.#changed();
  }

  /** Tells the listeners. */
  #changed(): void {
    this.#version += 1;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/** The editor's store; a fresh one outside an editor, so a block drawn alone still works. */
const BlockUiContext = createContext<BlockUiStore | null>(null);

/**
 * Holds what the editor remembers about the blocks inside it.
 *
 * @param props - What it wraps.
 * @param props.children - The editor.
 * @returns The provider.
 */
export function BlockUiProvider(props: { readonly children: ReactNode }) {
  const { children } = props;
  const [store] = useState(() => new BlockUiStore());

  useEffect(() => {
    /**
     * Clears the selection on Escape, when no dialog is there to take it.
     *
     * @param event - The key press.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) {
        store.select(null);
      }
    };

    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [store]);

  return <BlockUiContext value={store}>{children}</BlockUiContext>;
}

/** A store for blocks drawn outside an editor: tests, the gallery. */
const LONE_STORE = new BlockUiStore();

/**
 * The editor's store, re-rendering the caller whenever it changes.
 *
 * @returns The store.
 */
export function useBlockUiStore(): BlockUiStore {
  const store = useContext(BlockUiContext) ?? LONE_STORE;

  useSyncExternalStore(store.subscribe, store.version, store.version);

  return store;
}

/** What one block knows of itself. */
export type BlockUi = {
  readonly isSelected: boolean;
  readonly select: () => void;
  readonly isOpen: boolean;
  readonly toggle: () => void;
  readonly setOpen: (isOpen: boolean) => void;
  readonly isRenaming: boolean;
  readonly startRename: () => void;
  readonly stopRename: () => void;
  readonly test: BlockTestState | undefined;
};

/**
 * What one block knows of itself: whether it is selected, open, being renamed, and its test.
 *
 * @param id - The block.
 * @param isOpenAtFirst - Whether it starts open: one that still needs something does.
 * @returns See {@link BlockUi}.
 */
export function useBlockUi(id: string, isOpenAtFirst: boolean): BlockUi {
  const store = useBlockUiStore();
  const isOpen = store.isOpen(id, isOpenAtFirst);
  const version = store.version();

  return useMemo(
    () => ({
      isSelected: store.selected === id,
      /** Selects this block. */
      select: () => {
        store.select(id);
      },
      isOpen,
      /** Opens it, or closes it. */
      toggle: () => {
        store.setOpen(id, !isOpen);
      },
      /**
       * Opens or closes it.
       *
       * @param open - Whether it should be open.
       */
      setOpen: (open: boolean) => {
        store.setOpen(id, open);
      },
      isRenaming: store.renaming === id,
      /** Starts typing its name. */
      startRename: () => {
        store.rename(id);
      },
      /** Stops typing its name. */
      stopRename: () => {
        store.rename(null);
      },
      test: store.test(id),
    }),
    // The store changes in place; its version is what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [id, isOpen, store, version],
  );
}

/**
 * Clears the selection, for a click outside every block.
 *
 * @returns The function that clears it.
 */
export function useClearBlockSelection(): () => void {
  const store = useContext(BlockUiContext) ?? LONE_STORE;

  return useMemo(
    () => () => {
      store.select(null);
    },
    [store],
  );
}

/**
 * The editor's store, without re-rendering the caller when it changes: for code that only writes
 * to it, or reads it in a handler.
 *
 * @returns The store.
 */
export function useBlockUiStoreHandle(): BlockUiStore {
  return useContext(BlockUiContext) ?? LONE_STORE;
}
