/**
 * The list a menu button opens: the ⋯ of a detail page, the ▾ of an Install button.
 *
 * A `surface` panel with `shadow-float` under its button, one row per choice - a glyph, the
 * choice, a line saying what it does - a destructive one in `danger`. Opening it moves the focus
 * to the first choice; the arrow keys move along, Escape closes it and gives the focus back to the
 * button, and focus leaving it closes it, which is what a click elsewhere means for a keyboard as
 * well as a mouse.
 *
 * Shared by {@link OverflowMenu} and {@link MenuButton}, which differ only in their button.
 */
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import type { UiIconId } from '../icons/ui-set.js';
import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** One choice of a menu. */
export type MenuItem = {
  /** What it does, in words. */
  readonly label: string;

  /** A line under it: what choosing it means. */
  readonly description?: string;

  /** A glyph before it. */
  readonly icon?: UiIconId;

  /** A choice that destroys something: drawn in `danger`. */
  readonly tone?: 'danger';

  /** Whether it can be chosen now. */
  readonly disabled?: boolean;

  /** Why it cannot, shown on hover. */
  readonly disabledReason?: string;

  /** Called when it is chosen; the menu closes first. */
  readonly onSelect: () => void;
};

/** What the menu's state hands its button. */
export type MenuState = {
  /** Whether the list is open. */
  readonly isOpen: boolean;

  /** Opens or closes it. */
  readonly toggle: () => void;

  /** The button, for the focus to come back to. */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
};

/** What the menu needs. */
export type MenuProps = {
  /** The choices, in order. */
  readonly items: readonly MenuItem[];

  /** The button that opens it, given the menu's state. */
  readonly trigger: (state: MenuState) => ReactNode;

  /** Which edge of the button the list lines up with. */
  readonly align?: 'start' | 'end';

  /** How wide the list is: room for a line under each choice, or just the choices. */
  readonly width?: 'narrow' | 'wide';

  /** Anything extra for the outer element. */
  readonly className?: string | undefined;
};

/**
 * Renders a button and the list it opens.
 *
 * @param props - See {@link MenuProps}.
 * @returns The menu.
 */
export function Menu(props: MenuProps) {
  const { items, trigger, align = 'end', width = 'narrow', className } = props;
  const [isOpen, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      listRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    }
  }, [isOpen]);

  /** Closes the list and gives the focus back to the button. */
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  /**
   * Moves along the choices, or closes the list.
   *
   * @param event - The key pressed inside the list.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    const choices = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
    const at = choices.findIndex((choice) => choice === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    choices[(at + step + choices.length) % choices.length]?.focus();
  };

  /**
   * Closes the list when the focus leaves the button and the list both.
   *
   * @param event - The focus leaving an element inside.
   */
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  };

  return (
    <div className={cn('relative', className)} onBlur={onBlur}>
      {trigger({
        isOpen,
        buttonRef,

        /** Opens or closes the list. */
        toggle: () => {
          setOpen(!isOpen);
        },
      })}

      {isOpen ? (
        <div
          ref={listRef}
          role="menu"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute top-full z-30 mt-1.5 flex animate-rise flex-col rounded-tile border border-border-strong bg-surface p-1 shadow-float',
            align === 'end' ? 'right-0' : 'left-0',
            width === 'wide' ? 'w-72' : 'min-w-48',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled === true ? item.disabledReason : undefined}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-field px-3 py-2 text-left transition-colors',
                'focus-visible:bg-surface-raised focus-visible:outline-none enabled:hover:bg-surface-raised',
                'disabled:cursor-not-allowed disabled:opacity-50',
                item.tone === 'danger' ? 'text-danger' : 'text-foreground',
              )}
            >
              {item.icon === undefined ? null : (
                <AppIcon
                  id={item.icon}
                  size={16}
                  className={cn(
                    'mt-0.5 shrink-0',
                    item.tone === 'danger' ? 'text-danger' : 'text-primary',
                  )}
                />
              )}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium">{item.label}</span>
                {item.description === undefined ? null : (
                  <span className="text-ui-sm text-foreground-subtle">{item.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
