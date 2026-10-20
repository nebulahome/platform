/**
 * Linking two readings on a device's page by dragging one onto the other.
 *
 * A reading read one way can be taken up and dropped on one of the same kind read the other way.
 * Taken up, the row lifts and tilts under the pointer and leaves a dashed slot where it was; the
 * row it would join lights up with "Release to link" and a pulsing chain between the two, and
 * every other row dims. Letting go over it asks to link them - the dialog says what that does -
 * and Escape, or letting go anywhere else, puts it back.
 *
 * **On the keyboard:** Space on a row's name takes it up, the arrow keys go through the rows it
 * can join, Enter asks to link them and Escape puts it back; each step is said aloud.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { AppIcon } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import type { EntityLine } from '@/routes/library/entity-row';

/** How far the pointer moves before a press becomes a drag, in pixels: less is a click. */
const DRAG_FROM_PX = 6;

/** How wide a row is held, against the list: narrower, as a card picked up off it. */
const HELD_SCALE = 0.7;

/** How a row takes part. */
export type LinkLook = 'rest' | 'target' | 'dimmed';

/** A row taken up. */
type Held = {
  readonly source: EntityLine;
  readonly target: string | null;

  /** Where the pointer is, and where in the row it took hold; null when taken up by keyboard. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  readonly grip: { readonly x: number; readonly y: number; readonly width: number };
};

/** What the page draws a drag with. */
export type LinkDrag = {
  /** How a row looks while something is held; `rest` when nothing is. */
  readonly lookOf: (entityId: string) => LinkLook;

  /** Whether this row is the one held, which leaves a slot in its place. */
  readonly isHeld: (entityId: string) => boolean;

  /** What takes a row up, for a row that can be linked to another. */
  readonly handleOf: (line: EntityLine) => HTMLAttributes<HTMLLIElement> | undefined;

  /** The row under the pointer, drawn over the page. */
  readonly ghost: ReactNode;

  /** What is said aloud. */
  readonly announcement: string;
};

/** What the drag needs. */
export type LinkDragOptions = {
  readonly lines: readonly EntityLine[];

  /** Whether one reading can be linked to the other. */
  readonly canJoin: (source: EntityLine, target: EntityLine) => boolean;

  /** Asks to link the two. */
  readonly onDrop: (source: EntityLine, target: EntityLine) => void;

  /** Draws a row as it is held. */
  readonly renderHeld: (line: EntityLine) => ReactNode;
};

/**
 * Drags readings onto each other.
 *
 * @param options - See {@link LinkDragOptions}.
 * @returns See {@link LinkDrag}.
 */
export function useLinkDrag(options: LinkDragOptions): LinkDrag {
  const { lines, canJoin, onDrop, renderHeld } = options;
  const [held, setHeld] = useState<Held | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // What is held, for the handlers that outlive a render.
  const current = useRef<Held | null>(null);

  useEffect(() => {
    current.current = held;
  });

  // A drag ends in a click on whatever is under the pointer, which is not a click on it.
  const isClickEaten = useRef(false);

  const press = useRef<{
    readonly line: EntityLine;
    readonly x: number;
    readonly y: number;
    readonly rect: DOMRect;
  } | null>(null);

  const targetsOf = useCallback(
    (source: EntityLine): EntityLine[] => lines.filter((line) => canJoin(source, line)),
    [lines, canJoin],
  );

  /** Lets go of what is held: over a row it can join, that asks to link them. */
  const drop = useCallback(
    (isLinked: boolean) => {
      const now = current.current;
      const targetId = now?.target ?? null;
      const target =
        targetId === null ? undefined : lines.find((line) => line.entity.entityId === targetId);

      setHeld(null);

      if (now !== null && isLinked && target !== undefined) {
        onDrop(now.source, target);
      }
    },
    [lines, onDrop],
  );

  useEffect(() => {
    /**
     * Eats the click a drag ends in.
     *
     * @param event - The click.
     */
    const onClick = (event: MouseEvent): void => {
      if (isClickEaten.current) {
        isClickEaten.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    };

    globalThis.addEventListener('click', onClick, { capture: true });

    return () => {
      globalThis.removeEventListener('click', onClick, { capture: true });
    };
  }, []);

  // While held by the pointer: follow it, find what is under it, and let go.
  const isPointing = held?.pointer != null;
  const sourceId = held?.source.entity.entityId ?? null;

  useEffect(() => {
    if (!isPointing || sourceId === null) {
      return undefined;
    }

    /**
     * Follows the pointer, and finds the row it is over.
     *
     * @param event - The move.
     */
    const onMove = (event: PointerEvent): void => {
      const under = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>('[data-link-row]')?.dataset['linkRow'])
        .find((id) => id !== undefined && id !== sourceId);

      setHeld((now) =>
        now === null
          ? null
          : {
              ...now,
              pointer: { x: event.clientX, y: event.clientY },
              target:
                under !== undefined &&
                targetsOf(now.source).some((line) => line.entity.entityId === under)
                  ? under
                  : null,
            },
      );
    };

    /** Lets go. */
    const onUp = (): void => {
      isClickEaten.current = true;
      // The click comes right after, if at all: one that does not must not eat the next real one.
      setTimeout(() => {
        isClickEaten.current = false;
      }, 0);
      drop(true);
    };

    /**
     * Puts it back on Escape.
     *
     * @param event - The key.
     */
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        drop(false);
      }
    };

    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onUp, { once: true });
    globalThis.addEventListener('keydown', onKey);
    document.body.classList.add('select-none');

    return () => {
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      globalThis.removeEventListener('keydown', onKey);
      document.body.classList.remove('select-none');
    };
  }, [isPointing, sourceId, targetsOf, drop]);

  // A press becomes a drag once it has moved far enough.
  useEffect(() => {
    /**
     * Takes the row up once the press has moved far enough.
     *
     * @param event - The move.
     */
    const onMove = (event: PointerEvent): void => {
      const pressed = press.current;

      if (pressed === null) {
        return;
      }

      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_FROM_PX) {
        return;
      }

      press.current = null;
      setHeld({
        source: pressed.line,
        target: null,
        pointer: { x: event.clientX, y: event.clientY },
        grip: {
          x: pressed.x - pressed.rect.left,
          y: pressed.y - pressed.rect.top,
          width: pressed.rect.width,
        },
      });
      setAnnouncement(
        translate(
          'device.link.takenUp',
          'Took up {{name}}. Drop it on a reading of the same kind.',
          {
            name: pressed.line.entity.name,
          },
        ),
      );
    };

    /** Forgets a press that never moved: it was a click. */
    const onUp = (): void => {
      press.current = null;
    };

    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onUp);

    return () => {
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
    };
  }, []);

  /**
   * What takes a row up, for a row that can join another.
   *
   * @param line - The row's reading.
   * @returns Its handlers, or none.
   */
  const handleOf = (line: EntityLine): HTMLAttributes<HTMLLIElement> | undefined => {
    const targets = targetsOf(line);

    if (targets.length === 0) {
      return undefined;
    }

    return {
      /**
       * Keeps the browser from dragging the row's link: its own drag would swallow the pointer.
       *
       * @param event - The browser's drag.
       */
      onDragStart: (event) => {
        event.preventDefault();
      },

      /**
       * Notes a press, which becomes a drag if it moves.
       *
       * @param event - The press.
       */
      onPointerDown: (event: ReactPointerEvent<HTMLLIElement>) => {
        // shortcut: the pointer only - a touch scrolls the page instead; the keyboard is the other way in.
        if (event.button !== 0 || event.pointerType === 'touch') {
          return;
        }

        if ((event.target as Element).closest('button, input, [role="switch"]') !== null) {
          return;
        }

        press.current = {
          line,
          x: event.clientX,
          y: event.clientY,
          rect: event.currentTarget.getBoundingClientRect(),
        };
      },

      /**
       * Takes it up, chooses where, links or puts it back, from the keyboard.
       *
       * @param event - The key.
       */
      onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
        const isHeldHere = held !== null && held.pointer === null;

        if (!isHeldHere && event.key === ' ') {
          event.preventDefault();

          const [first] = targets;

          setHeld({
            source: line,
            target: first?.entity.entityId ?? null,
            pointer: null,
            grip: { x: 0, y: 0, width: 0 },
          });
          setAnnouncement(
            translate(
              'device.link.pickedUp',
              'Took up {{name}}. Over {{target}}. Arrow keys choose, Enter links, Escape puts it back.',
              { name: line.entity.name, target: first?.entity.name ?? '' },
            ),
          );

          return;
        }

        if (!isHeldHere) {
          return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();

          const choices = targetsOf(held.source);
          const at = choices.findIndex((choice) => choice.entity.entityId === held.target);
          const next =
            choices[(at + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length];

          setHeld({ ...held, target: next?.entity.entityId ?? null });
          setAnnouncement(
            translate('device.link.over', 'Over {{target}}.', { target: next?.entity.name ?? '' }),
          );
        } else if (event.key === 'Enter') {
          event.preventDefault();
          drop(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          drop(false);
          setAnnouncement(translate('device.link.putBack', 'Put back.'));
        }
      },
    };
  };

  /**
   * How a row looks while something is held.
   *
   * @param entityId - The row's reading.
   * @returns Its look.
   */
  const lookOf = (entityId: string): LinkLook =>
    held === null || held.source.entity.entityId === entityId
      ? 'rest'
      : held.target === entityId
        ? 'target'
        : 'dimmed';

  const ghost =
    held?.pointer == null
      ? null
      : createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50"
            /* eslint-disable-next-line react/forbid-dom-props -- where the pointer is. */
            style={{
              left: held.pointer.x - held.grip.x * HELD_SCALE,
              top: held.pointer.y - held.grip.y,
              width: held.grip.width * HELD_SCALE,
            }}
          >
            <ul className="list-none">{renderHeld(held.source)}</ul>
            {held.target === null ? null : (
              <span className="link-glow link-pulse absolute -top-4.25 left-1/2 flex size-8.5 -translate-x-1/2 items-center justify-center rounded-full border border-primary/60 bg-surface text-primary">
                <AppIcon id="link-2" size={16} />
              </span>
            )}
          </div>,
          document.body,
        );

  return {
    lookOf,
    /**
     * Whether a row is the one held by the pointer.
     *
     * @param entityId - The row's reading.
     * @returns True for it.
     */
    isHeld: (entityId) =>
      held !== null && held.pointer !== null && held.source.entity.entityId === entityId,
    handleOf,
    ghost,
    announcement,
  };
}
