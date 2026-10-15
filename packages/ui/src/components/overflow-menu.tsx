/**
 * The ⋮ at the end of a detail page's actions: what is done rarely, and what destroys - Remove,
 * Restart, Update - so the header keeps one primary action and a few ghost ones.
 *
 * A 36px round button on `surface-raised` with a `border-strong` edge, named "More", opening a
 * {@link Menu}.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { Menu, type MenuItem } from './menu.js';

/** What the menu needs. */
export type OverflowMenuProps = {
  /** The choices, in order; a destructive one last. */
  readonly items: readonly MenuItem[];

  /** What the button is called: "More". */
  readonly label?: string;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the ⋮ and its menu.
 *
 * @param props - See {@link OverflowMenuProps}.
 * @returns The menu, or nothing when there is nothing in it.
 */
export function OverflowMenu(props: OverflowMenuProps) {
  const { t } = useTranslation();
  const { items, className } = props;
  const label = props.label ?? t('ui.overflowMenu.more', 'More');

  if (items.length === 0) {
    return null;
  }

  return (
    <Menu
      items={items}
      className={className}
      trigger={({ isOpen, toggle, buttonRef }) => (
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={toggle}
          className={cn(
            'press inline-flex size-control shrink-0 items-center justify-center rounded-pill border border-border-strong',
            'bg-surface-raised text-foreground-muted transition-colors hover:bg-surface-high hover:text-foreground',
          )}
        >
          <AppIcon id="ellipsis-vertical" size={16} />
        </button>
      )}
    />
  );
}
