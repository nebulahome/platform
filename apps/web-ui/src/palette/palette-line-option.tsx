/**
 * A short row of the command palette that is not a result: a group's "Show all", or searching the
 * Hub after nothing was found. 40px, a glyph where a result has its chip.
 */
import type { ReactNode } from 'react';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

/** What the row needs. */
export type PaletteLineOptionProps = {
  /** Its id in the list. */
  readonly optionId: string;
  readonly icon: UiIconId;
  readonly isActive: boolean;
  readonly children: ReactNode;
  readonly onPoint: () => void;
  readonly onChoose: () => void;
};

/**
 * Renders the row.
 *
 * @param props - See {@link PaletteLineOptionProps}.
 * @returns The row.
 */
export function PaletteLineOption(props: PaletteLineOptionProps) {
  const { optionId, icon, isActive, children } = props;

  return (
    // The field drives the list (combobox): the keys are its, the pointer is this.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- see above
    <div
      id={optionId}
      role="option"
      aria-selected={isActive}
      tabIndex={-1}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onPointerMove={isActive ? undefined : props.onPoint}
      onClick={props.onChoose}
      className={cn(
        'relative flex h-10 shrink-0 cursor-pointer items-center gap-3.5 rounded-inner pr-3.5 pl-2.5 text-ui-sm transition-colors duration-100',
        isActive ? 'text-foreground' : 'text-foreground/60',
      )}
    >
      <span
        className={cn('flex w-8 shrink-0 justify-center', isActive ? 'text-primary' : undefined)}
      >
        <AppIcon id={icon} size={15} />
      </span>
      <span className="min-w-0 grow truncate">{children}</span>
      <AppIcon
        id="corner-down-left"
        size={15}
        aria-hidden="true"
        className={cn(
          'shrink-0 text-primary transition-opacity duration-100',
          isActive ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
