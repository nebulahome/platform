/**
 * A dropdown, drawn by the application rather than by the operating system.
 *
 * The native `<select>` was here first, and for a good reason: a listbox built out of divs has to
 * reimplement keyboard navigation, typeahead, and the way a screen reader announces a closed
 * choice, and the reimplementation is usually worse. What it cannot do is look like the rest of
 * the interface - the popup is the operating system's, in the operating system's colours, and on
 * a dark page it arrives as a white rectangle in a different typeface. That is the trade this
 * file makes, which means everything the native control gave away for free has to be here:
 *
 * - **The roles a screen reader reads.** The button is a `combobox` that owns a `listbox`, each
 *   row is an `option`, and the one under the cursor is named by `aria-activedescendant`.
 * - **Focus stays on the button.** Moving it into the list is the other legal pattern and it is
 *   harder to get right; with `aria-activedescendant` every key is handled in one place and the
 *   focus ring never disappears.
 * - **Typeahead.** Typing `f` on a closed control jumps to Fahrenheit, because that is what the
 *   native one does and people who use dropdowns quickly rely on it.
 * - **Arrows, Home, End, Enter, Escape, and Tab.** Escape closes without choosing; Tab closes
 *   and moves on, which is what makes the control not a trap.
 *
 * **The list is not laid out inside the field.** It used to be `position: absolute` in the
 * field's own box, which meant the nearest scrolling ancestor had to grow to hold it: opening the
 * role dropdown in the invite dialog gave the whole dialog a scrollbar, because a 240px list had
 * appeared inside a box that was 300px tall. It is `position: fixed` now, measured against the
 * button and rendered through a portal, so it is laid out against the viewport and no ancestor
 * has to make room for it.
 *
 * The portal goes into the enclosing `<dialog>` when there is one, and only otherwise into the
 * body. A modal dialog makes the rest of the document inert, so a list portalled to the body
 * while a dialog is open would render in the right place and refuse every click.
 *
 * The list opens upward when there is not room below it, and it is re-measured while it is open:
 * these sit in a scrolling panel, and a list pinned to the viewport has to follow the button it
 * belongs to when that panel scrolls.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn.js';
import { controlFace, type ControlFaceVariants } from '../lib/control-face.js';

import { FieldShell } from './field-shell.js';

/** One option. */
export type SelectOption = {
  /** What it is worth. */
  readonly value: string;

  /** What it is called. */
  readonly label: string;
};

/** What the field needs. */
export type SelectFieldProps = Pick<ControlFaceVariants, 'size'> & {
  /** What the field is for. */
  readonly label: string;

  /** Whether the label is drawn, or only announced. */
  readonly isLabelHidden?: boolean;

  /** The options, in the order they should read. */
  readonly options: readonly SelectOption[];

  /** Which one is chosen. */
  readonly value: string;

  /** Called with the value of the option chosen. */
  readonly onChange: (value: string) => void;

  /** Whether the choice can be made at all. */
  readonly disabled?: boolean;

  /** What is wrong with the current value, when something is. */
  readonly error?: string | undefined;

  /** A line under the control, for what the label cannot say. */
  readonly hint?: ReactNode;

  /** Anything extra for the control itself. */
  readonly className?: string;
};

/** How long two keystrokes can be apart and still count as one typeahead search. */
const TYPEAHEAD_WINDOW_MS = 500;

/** The gap between the button and the list. */
const GAP = 4;

/** The tallest the list is allowed to get before it scrolls on its own. */
const MAX_LIST_HEIGHT = 240;

/** How little room below the button still counts as room, rather than opening upward. */
const ROOM_NEEDED = 140;

/** Where the list sits, in viewport coordinates. */
type Placement = {
  /** The left edge, matching the button's. */
  readonly left: number;

  /** The width, matching the button's. */
  readonly width: number;

  /** How tall it may grow before it scrolls. */
  readonly maxHeight: number;

  /** Distance from the top of the viewport, when the list hangs below the button. */
  readonly top?: number;

  /** Distance from the bottom of the viewport, when it opens upward instead. */
  readonly bottom?: number;
};

/**
 * Works out where the list should sit, given where the button is.
 *
 * @param element - The button the list belongs to.
 * @returns The placement, in viewport coordinates.
 */
function place(element: HTMLElement): Placement {
  const rect = element.getBoundingClientRect();
  const below = globalThis.innerHeight - rect.bottom - GAP;
  const above = rect.top - GAP;
  const opensUpward = below < ROOM_NEEDED && above > below;

  const room = opensUpward ? above : below;

  return {
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(0, Math.min(MAX_LIST_HEIGHT, room)),
    ...(opensUpward
      ? { bottom: globalThis.innerHeight - rect.top + GAP }
      : { top: rect.bottom + GAP }),
  };
}

/**
 * Renders a dropdown.
 *
 * @param props - See {@link SelectFieldProps}.
 * @returns The field.
 */
export function SelectField(props: SelectFieldProps) {
  const {
    label,
    isLabelHidden = false,
    options,
    value,
    onChange,
    size,
    disabled = false,
    error,
    hint,
    className,
  } = props;

  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const [placement, setPlacement] = useState<Placement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);

  const isOpen = placement !== null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // `block: 'nearest'` rather than `center`: a list that re-centres on every arrow press moves
    // under the reader instead of scrolling with them.
    list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /** Keeps the list against the button while anything under it moves. */
    const follow = (): void => {
      const element = button.current;

      if (element !== null) {
        setPlacement(place(element));
      }
    };

    // `capture` so a scroll in any ancestor is heard, not only one on the window: these sit in a
    // panel that scrolls, and that scroll event never reaches the window in the bubble phase.
    globalThis.addEventListener('scroll', follow, true);
    globalThis.addEventListener('resize', follow);

    return () => {
      globalThis.removeEventListener('scroll', follow, true);
      globalThis.removeEventListener('resize', follow);
    };
  }, [isOpen]);

  /**
   * Opens the list, starting from whatever is currently chosen.
   *
   * @param from - Which option to make active. Defaults to the selected one.
   */
  const open = (from: number = selectedIndex < 0 ? 0 : selectedIndex): void => {
    const element = button.current;

    if (element === null) {
      return;
    }

    setHost(element.closest('dialog') ?? globalThis.document.body);
    setPlacement(place(element));
    setActiveIndex(from);
  };

  /** Shuts the list. */
  const close = (): void => {
    setPlacement(null);
  };

  /**
   * Chooses an option and closes.
   *
   * @param index - Which one.
   */
  const choose = (index: number): void => {
    const option = options[index];

    if (option !== undefined) {
      onChange(option.value);
    }

    close();
    button.current?.focus();
  };

  /**
   * Moves the active option, wrapping at both ends.
   *
   * @param by - How far, and in which direction.
   */
  const move = (by: number): void => {
    if (options.length === 0) {
      return;
    }

    setActiveIndex((current) => (current + by + options.length) % options.length);
  };

  /**
   * Finds the option a run of typed letters names.
   *
   * @param key - The letter just typed.
   * @returns The index to make active, or -1 when nothing matches.
   */
  const typeahead = (key: string): number => {
    const now = Date.now();
    const text =
      now - search.current.at > TYPEAHEAD_WINDOW_MS ? key : `${search.current.text}${key}`;

    search.current = { text, at: now };

    return options.findIndex((option) => option.label.toLowerCase().startsWith(text.toLowerCase()));
  };

  /**
   * Handles every key the control responds to.
   *
   * One handler rather than one per element, because focus never leaves the button: the list is
   * navigated by `aria-activedescendant`, so there is nowhere else for a key to arrive.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return;
    }

    if (event.key === 'Escape') {
      // Kept from bubbling: a dialog listens for Escape on the document, and one press should
      // close the list somebody is looking at rather than the form underneath it.
      if (isOpen) {
        event.stopPropagation();
      }

      close();

      return;
    }

    if (event.key === 'Tab') {
      // Not prevented: Tab is how somebody leaves, and a dropdown that swallows it is a trap.
      close();

      return;
    }

    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        open();

        return;
      }

      if (event.key.length === 1) {
        const found = typeahead(event.key);

        if (found >= 0) {
          event.preventDefault();
          choose(found);
        }
      }

      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);

      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);

      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);

      return;
    }

    if (event.key.length === 1) {
      const found = typeahead(event.key);

      if (found >= 0) {
        event.preventDefault();
        setActiveIndex(found);
      }
    }
  };

  const chosen = options[selectedIndex];

  return (
    <FieldShell label={label} isLabelHidden={isLabelHidden} error={error} hint={hint}>
      {(ids) => {
        const listId = `${ids.id}-list`;

        return (
          <div
            onBlur={(event) => {
              // The list is portalled out of this subtree, but focus never enters it: choosing an
              // option cancels its own mousedown so the button keeps focus throughout. A blur
              // here is therefore always somebody leaving the control.
              if (!event.currentTarget.contains(event.relatedTarget)) {
                close();
              }
            }}
          >
            <button
              ref={button}
              id={ids.id}
              type="button"
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-labelledby={`${ids.labelId} ${ids.id}-value`}
              aria-activedescendant={isOpen ? `${ids.id}-option-${String(activeIndex)}` : undefined}
              aria-invalid={ids.isInvalid}
              aria-describedby={ids.describedBy}
              disabled={disabled}
              onKeyDown={onKeyDown}
              onClick={() => {
                if (isOpen) {
                  close();
                } else {
                  open();
                }
              }}
              className={cn(
                controlFace({ size, isInvalid: ids.isInvalid }),
                // The dropdown's button performs an action, unlike the fields it sits among, so
                // it acknowledges the press the way every other button does.
                'press flex items-center justify-between gap-2 text-left',
                className,
              )}
            >
              <span id={`${ids.id}-value`} className="truncate">
                {chosen?.label ?? ''}
              </span>
              <Caret isOpen={isOpen} />
            </button>

            {placement === null || host === null
              ? null
              : createPortal(
                  <ul
                    ref={list}
                    id={listId}
                    role="listbox"
                    aria-labelledby={ids.labelId}
                    /* eslint-disable-next-line react/forbid-dom-props -- a position measured from
                       the button at the moment the list opens, and re-measured whenever anything
                       under it scrolls. It is the case RULES.md 15.3 names as the exception: a
                       genuinely dynamic value, which no class can carry because the number is not
                       known until it is read off the layout. */
                    style={{
                      position: 'fixed',
                      left: placement.left,
                      width: placement.width,
                      maxHeight: placement.maxHeight,
                      ...(placement.top === undefined ? {} : { top: placement.top }),
                      ...(placement.bottom === undefined ? {} : { bottom: placement.bottom }),
                    }}
                    className={cn(
                      'z-50 overflow-y-auto rounded-field border border-border-strong',
                      'animate-rise face-card p-1 shadow-dialog',
                    )}
                  >
                    {options.map((option, index) => (
                      /* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- an
                         option in an `aria-activedescendant` listbox is not a focus target and
                         takes no keys of its own. Every key is handled on the combobox above,
                         which is where this pattern puts them; a handler here would be dead code
                         that only a linter could reach. */
                      <li
                        key={option.value}
                        id={`${ids.id}-option-${String(index)}`}
                        role="option"
                        aria-selected={option.value === value}
                        // The button must keep focus: losing it would close the list through
                        // `onBlur` before the click ever landed.
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onMouseEnter={() => {
                          setActiveIndex(index);
                        }}
                        onClick={() => {
                          choose(index);
                        }}
                        className={cn(
                          'flex h-8 cursor-pointer items-center rounded-chip px-2.5 text-ui',
                          index === activeIndex
                            ? 'bg-surface-raised text-foreground'
                            : 'text-foreground-muted',
                          option.value === value ? 'font-medium text-foreground' : undefined,
                        )}
                      >
                        {option.label}
                      </li>
                    ))}
                  </ul>,
                  host,
                )}
          </div>
        );
      }}
    </FieldShell>
  );
}

/** What the caret needs. */
type CaretProps = {
  /** Whether the list is open, which is the direction it points. */
  readonly isOpen: boolean;
};

/**
 * The chevron on the right of the button.
 *
 * Drawn here rather than imported from the application's icon set: the design system cannot
 * depend on the application that consumes it, and this is the only glyph it needs.
 *
 * @param props - See {@link CaretProps}.
 * @returns The chevron.
 */
function Caret(props: CaretProps) {
  const { isOpen } = props;

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'shrink-0 text-foreground-subtle transition-transform',
        isOpen ? 'rotate-180' : undefined,
      )}
    >
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}
