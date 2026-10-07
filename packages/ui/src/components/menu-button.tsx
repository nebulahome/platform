/**
 * A button whose choices come in a menu: "Install ▾" - an image, or a compose project.
 *
 * One button rather than two side by side, because the two choices are one action - adding a
 * container - and the header holds one primary. The chevron sits behind a hairline so the button
 * reads as opening something. The choices carry a line each, so the list is the wide one.
 */
import type { UiIconId } from '../icons/ui-set.js';

import { AppIcon } from './app-icon.js';
import { Button } from './button.js';
import { Menu, type MenuItem } from './menu.js';

/** What the button needs. */
export type MenuButtonProps = {
  /** What it says. */
  readonly label: string;

  /** A glyph before it. */
  readonly icon?: UiIconId;

  /** The choices. */
  readonly items: readonly MenuItem[];

  /** How it looks: the page's primary, or a ghost one. */
  readonly variant?: 'primary' | 'ghost';

  /** Whether it can be pressed. */
  readonly disabled?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the button and its menu.
 *
 * @param props - See {@link MenuButtonProps}.
 * @returns The button.
 */
export function MenuButton(props: MenuButtonProps) {
  const { label, icon, items, variant = 'primary', disabled, className } = props;

  return (
    <Menu
      items={items}
      width="wide"
      className={className}
      trigger={({ isOpen, toggle, buttonRef }) => (
        <Button
          ref={buttonRef}
          variant={variant}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={toggle}
        >
          {icon === undefined ? null : <AppIcon id={icon} size={16} />}
          {label}
          <span aria-hidden="true" className="ml-0.5 h-4 w-px bg-current opacity-30" />
          <AppIcon id="chevron-down" size={14} />
        </Button>
      )}
    />
  );
}
