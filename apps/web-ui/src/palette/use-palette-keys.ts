/**
 * What the keys and the pointer do in the command palette (docs: command palette, 5.3, 5.4, 6.3).
 * The arrows move the active row, wrapping at both ends; Enter does its first action, Tab its
 * second; Escape closes the palette - and only the palette, also over the entity dialog.
 *
 * Escape is caught on the document in the capture phase, before anything else hears it: every
 * open `Modal` listens for it on the document too, and over the entity dialog one press would
 * otherwise close both. Closing without a choice gives the focus back to where it was.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { useSession } from '@/auth/session-store';
import type { PaletteLayout, PaletteOption } from '@/palette/palette-layout';
import { rememberRecent } from '@/palette/palette-recents';
import { usePaletteStore } from '@/palette/palette-store';
import type { PaletteCommand, PaletteGroupId } from '@/palette/palette-types';
import { usePaletteRunner } from '@/palette/use-palette-runner';

/** Two presses closer than this: the second does not wait for the first slide to end. */
const SLIDE_MS = 110;

/** What the keys work on. */
export type PaletteKeysInput = {
  readonly layout: PaletteLayout;

  /** The active row. */
  readonly current: number;

  /** The query as typed, for the Hub. */
  readonly query: string;

  /** Set when the highlight should jump rather than slide. */
  readonly snapRef: RefObject<boolean>;

  /** The active row's second action, for Tab to press. */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  readonly setActive: (index: number) => void;
  readonly setExpanded: (group: PaletteGroupId) => void;
  readonly setAppliedKey: (key: string) => void;
};

/** What the palette hands its field and its rows. */
export type PaletteKeys = {
  /** Enter, or a click on a row. */
  readonly choose: (index: number) => void;

  /** Tab, or a press of a row's button. */
  readonly second: (index: number) => void;

  /** The field's keys. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/**
 * Wires the keys of the palette.
 *
 * @param input - See {@link PaletteKeysInput}.
 * @returns See {@link PaletteKeys}.
 */
export function usePaletteKeys(input: PaletteKeysInput): PaletteKeys {
  const { layout, current, query, snapRef, buttonRef } = input;
  const close = usePaletteStore((state) => state.close);
  const userId = useSession((state) => state.user?.id ?? '');
  const run = usePaletteRunner();
  // Where the focus was, to give it back when the palette closes without a choice.
  const [opener] = useState(() => globalThis.document.activeElement);
  const isChosen = useRef(false);
  const movedAt = useRef(0);

  useEffect(() => {
    /**
     * Closes the palette on Escape, and only the palette.
     *
     * @param event - The key press, anywhere.
     */
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };

    globalThis.document.addEventListener('keydown', onEscape, true);

    return () => {
      globalThis.document.removeEventListener('keydown', onEscape, true);
    };
  }, [close]);

  useLayoutEffect(
    () => () => {
      if (!isChosen.current && opener instanceof HTMLElement) {
        opener.focus();
      }
    },
    [opener],
  );

  /**
   * Remembers what was opened, for the empty field's Recent group.
   *
   * @param picked - The option.
   * @param command - What it does.
   */
  const remember = (picked: PaletteOption, command: PaletteCommand): void => {
    if (
      picked.kind === 'item' &&
      picked.item.group !== 'actions' &&
      (command.type === 'go' || command.type === 'apply-scene')
    ) {
      rememberRecent(userId, picked.item.id);
    }
  };

  /**
   * Does what Enter does on an option.
   *
   * @param index - Which.
   */
  const choose = (index: number): void => {
    const picked = layout.options[index];

    if (picked === undefined) {
      return;
    }

    if (picked.kind === 'more') {
      snapRef.current = true;
      input.setExpanded(picked.group);

      return;
    }

    const command: PaletteCommand =
      picked.kind === 'hub'
        ? { type: 'go', to: `/integrations?hub=${encodeURIComponent(query.trim())}` }
        : picked.item.primary.command;

    remember(picked, command);
    isChosen.current = command.type === 'go' || command.type === 'sign-out';

    if (command.type === 'apply-scene') {
      input.setAppliedKey(picked.key);
    }

    run(command);
  };

  /**
   * Does what Tab does on an option: what its button does.
   *
   * @param index - Which.
   */
  const second = (index: number): void => {
    const picked = layout.options[index];
    const command = picked?.kind === 'item' ? picked.item.secondaryAction?.command : undefined;

    if (picked === undefined || command === undefined) {
      return;
    }

    remember(picked, command);
    isChosen.current = command.type === 'go';
    run(command);
  };

  /**
   * Moves the active row, from the keyboard.
   *
   * @param step - One down, or one up.
   * @param isHeld - Whether the key is held down.
   */
  const move = (step: 1 | -1, isHeld: boolean): void => {
    const count = layout.options.length;

    if (count === 0) {
      return;
    }

    const next = current + step;
    const now = globalThis.performance.now();

    // The highlight jumps when held, past either end, and on a press before the last slide ended.
    snapRef.current = isHeld || next < 0 || next >= count || now - movedAt.current < SLIDE_MS;
    movedAt.current = now;
    input.setActive((next + count) % count);
  };

  /**
   * The keys of the field.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1, event.repeat);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(current);
    } else if (event.key === 'Tab') {
      // The focus stays in the field; Tab is the active row's second action, when it has one.
      event.preventDefault();
      buttonRef.current?.click();
    }
  };

  return { choose, second, onKeyDown };
}
