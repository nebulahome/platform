/**
 * The second action of the active row, as a real button: its words and the Tab key that runs it
 * (docs: command palette, 6.4). The focus never moves to it - the field keeps it - so a pointer or
 * a finger reaches the action, and the keyboard reaches it with Tab.
 */
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '@nebulahome/ui';

import { PaletteKey } from '@/palette/palette-key';

/** What the button needs. */
export type PaletteActionButtonProps = {
  /** What it does: "Turn off", "Open". */
  readonly label: string;

  /** Whether an answer has been awaited for a while: the key becomes a spinner. */
  readonly isWaiting?: boolean;

  /** The button, for Tab to press. */
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onPress: () => void;
};

/**
 * Renders the button.
 *
 * @param props - See {@link PaletteActionButtonProps}.
 * @returns The button.
 */
export function PaletteActionButton(props: PaletteActionButtonProps) {
  const { t } = useTranslation();
  const { label, isWaiting = false, buttonRef, onPress } = props;

  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={-1}
      aria-busy={isWaiting}
      onPointerDown={(event) => {
        // The field keeps the focus.
        event.preventDefault();
      }}
      onClick={(event) => {
        // The row's own click is Enter, not this.
        event.stopPropagation();
        onPress();
      }}
      className="palette-action press-scale inline-flex h-6.5 shrink-0 items-center gap-2 rounded-pill border border-foreground/12 bg-foreground/7 pr-px pl-2.5 text-caption font-medium whitespace-nowrap text-foreground"
    >
      <span className="animate-fade-in" key={label}>
        {label}
      </span>
      {isWaiting ? (
        <span className="flex h-5.5 w-9.5 items-center justify-center text-foreground-muted">
          <AppIcon
            id="loader-circle"
            size={13}
            className="animate-orbit"
            aria-label={t('palette.waiting', 'Waiting for the device')}
          />
        </span>
      ) : (
        <PaletteKey>{t('palette.keys.tab', 'Tab')}</PaletteKey>
      )}
    </button>
  );
}
