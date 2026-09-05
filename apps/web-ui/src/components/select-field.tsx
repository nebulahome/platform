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
 * The list opens upward when there is not room below it. That is measured rather than assumed,
 * because these sit in a scrolling panel and the same control is near the top of it on one page
 * and at the bottom on another.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@nebula-home/ui';

import { CaretIcon } from '@/components/icons';

/** One option. */
export type SelectOption = {
  /** What it is worth. */
  readonly value: string;

  /** What it is called. */
  readonly label: string;
};

/** What the field needs. */
export type SelectFieldProps = {
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

  /** Anything extra for the control itself. */
  readonly className?: string;
};

/** How long two keystrokes can be apart and still count as one typeahead search. */
const TYPEAHEAD_WINDOW_MS = 500;

/** How much room the list needs below the button before it stops opening upward. */
const ROOM_NEEDED = 240;

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
    disabled = false,
    error,
    className,
  } = props;

  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const errorId = `${id}-error`;

  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const [isOpen, setOpen] = useState(false);
  const [isAbove, setAbove] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // `block: 'nearest'` rather than `center`: a list that re-centres on every arrow press moves
    // under the reader instead of scrolling with them.
    list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  /**
   * Opens the list, starting from whatever is currently chosen.
   *
   * @param from - Which option to make active. Defaults to the selected one.
   */
  const open = (from: number = selectedIndex < 0 ? 0 : selectedIndex): void => {
    const rect = button.current?.getBoundingClientRect();

    setAbove(rect !== undefined && globalThis.innerHeight - rect.bottom < ROOM_NEEDED);
    setActiveIndex(from);
    setOpen(true);
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

    setOpen(false);
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

      setOpen(false);

      return;
    }

    if (event.key === 'Tab') {
      // Not prevented: Tab is how somebody leaves, and a dropdown that swallows it is a trap.
      setOpen(false);

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
    // `relative` is what positions the list, and it does one more thing worth knowing about: a
    // hidden label is `position: absolute`, and without a positioned ancestor its containing
    // block is the whole document - so it escapes the clipping of whatever panel it sits in and
    // stretches the page. Fifteen of those on one screen gave the settings section a second
    // scrollbar that nothing appeared to own.
    <div
      className="relative flex flex-col gap-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <span
        id={labelId}
        className={cn(
          'text-xs font-medium text-foreground-muted',
          isLabelHidden ? 'sr-only' : undefined,
        )}
      >
        {label}
      </span>

      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${id}-value`}
        aria-activedescendant={isOpen ? `${id}-option-${String(activeIndex)}` : undefined}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (isOpen) {
            setOpen(false);
          } else {
            open();
          }
        }}
        className={cn(
          'flex h-9 items-center justify-between gap-2 rounded-field border bg-surface-raised px-3',
          'text-left text-[13.5px] text-foreground transition-colors',
          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error === undefined
            ? 'border-border focus-visible:border-primary'
            : 'border-danger focus-visible:ring-danger/25',
          className,
        )}
      >
        <span id={`${id}-value`} className="truncate">
          {chosen?.label ?? ''}
        </span>
        <CaretIcon isOpen={isOpen} className="shrink-0 text-foreground-subtle" />
      </button>

      {isOpen ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className={cn(
            'absolute z-20 max-h-60 w-full overflow-y-auto rounded-field border border-border',
            'bg-surface-raised p-1 shadow-lg shadow-black/40',
            isAbove ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.map((option, index) => (
            /* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- an option in an
               `aria-activedescendant` listbox is not a focus target and takes no keys of its own.
               Every key is handled on the combobox above, which is where this pattern puts them;
               a handler here would be dead code that only a linter could reach. */
            <li
              key={option.value}
              id={`${id}-option-${String(index)}`}
              role="option"
              aria-selected={option.value === value}
              // The button must keep focus: losing it would close the list through `onBlur`
              // before the click ever landed.
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
                'flex h-8 cursor-pointer items-center rounded-lg px-2.5 text-[13.5px]',
                index === activeIndex ? 'bg-surface text-foreground' : 'text-foreground-muted',
                option.value === value ? 'font-medium text-foreground' : undefined,
              )}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}

      {error === undefined ? null : (
        <span id={errorId} role="alert" className="text-[11.5px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
