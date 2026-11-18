/**
 * The parts the cards of what is told rather than switched share - a robot, a choice, a number, a
 * button, a firmware update - measure for measure as the boards draw them (`K-All`): the 30 px
 * pill buttons, the round icon buttons, the 24 px figure, the status line of a robot's tile, and
 * the question a press that cannot be taken back asks first.
 *
 * Everything else comes from `card-kit.tsx`; these are only the pieces it does not have.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn, Modal, type UiIconId } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { cardTime } from '@/routes/dashboard/cards/entity-model';

/** How a button of these cards is drawn: quiet on the raised face, or filled in the accent. */
export type ControlTone = 'plain' | 'primary';

/** The face of each tone. */
const TONES: Readonly<Record<ControlTone, string>> = {
  plain:
    'border border-border-strong bg-surface-raised text-foreground hover:enabled:bg-surface-high',
  primary: 'bg-primary text-primary-foreground hover:enabled:bg-primary/90',
};

/** What a pill button needs. */
export type PillButtonProps = {
  /** What it says. */
  readonly label: string;

  /** The glyph before the words. */
  readonly icon?: UiIconId | undefined;

  /** Quiet or filled. */
  readonly tone?: ControlTone;

  /** Whether it takes the whole width of its row. */
  readonly isWide?: boolean;

  readonly disabled?: boolean;

  /** When pressed. */
  readonly onPress: () => void;
};

/**
 * Renders the 30 px pill a card's actions are: Start, Install, Press.
 *
 * @param props - See {@link PillButtonProps}.
 * @returns The button.
 */
export function PillButton(props: PillButtonProps) {
  const { label, icon, tone = 'plain', isWide = false, disabled = false, onPress } = props;

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'press-scale inline-flex h-7.5 shrink-0 items-center gap-2 rounded-pill px-3.5 text-ui-sm font-medium whitespace-nowrap',
        'transition-colors duration-200 disabled:cursor-default disabled:opacity-40',
        isWide && 'w-full min-w-0 shrink justify-center',
        TONES[tone],
      )}
      onClick={onPress}
    >
      {icon === undefined ? null : <AppIcon id={icon} size={14} />}
      {label}
    </button>
  );
}

/** The sizes a round button is drawn at, and its glyph in each. */
const ROUND = {
  24: { box: 'size-6', glyph: 12 },
  30: { box: 'size-7.5', glyph: 14 },
  32: { box: 'size-8', glyph: 15 },
} as const;

/** What a round button needs. */
export type RoundButtonProps = {
  /** What it does, for a screen reader and its tooltip. */
  readonly label: string;

  readonly icon: UiIconId;

  /** How large. */
  readonly size?: keyof typeof ROUND;

  /** Quiet or filled. */
  readonly tone?: ControlTone;

  readonly disabled?: boolean;

  /** When pressed. */
  readonly onPress: () => void;
};

/**
 * Renders a round button that is only its glyph: a robot's Pause, a stepper's minus, Open.
 *
 * @param props - See {@link RoundButtonProps}.
 * @returns The button.
 */
export function RoundButton(props: RoundButtonProps) {
  const { label, icon, size = 30, tone = 'plain', disabled = false, onPress } = props;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'press-scale inline-flex shrink-0 items-center justify-center rounded-pill',
        'transition-colors duration-200 disabled:cursor-default disabled:opacity-40',
        ROUND[size].box,
        TONES[tone],
      )}
      onClick={onPress}
    >
      <AppIcon id={icon} size={ROUND[size].glyph} />
    </button>
  );
}

/**
 * Renders the 24 px figure between a tile's and a card's: a mower's state, a number's value.
 *
 * @param props - The figure.
 * @param props.value - The figure or the word.
 * @param props.unit - Its unit, small beside it.
 * @param props.className - A colour class, when not the plain one.
 * @returns The figure.
 */
export function MidValue(props: {
  readonly value: string;
  readonly unit?: string | null | undefined;
  readonly className?: string | undefined;
}) {
  const { value, unit, className } = props;

  return (
    <span
      className={cn(
        'text-[24px] leading-none font-medium tracking-[-0.03em] whitespace-nowrap tabular-nums transition-colors duration-200',
        className ?? 'text-foreground',
      )}
    >
      {value}
      {unit === undefined || unit === null || unit === '' ? null : (
        <span className="ml-[3px] text-ui-sm font-normal tracking-normal text-foreground-subtle">
          {unit}
        </span>
      )}
    </span>
  );
}

/**
 * Renders the status a robot's tile ends on: a dot in its colour, the word, and a quiet detail.
 *
 * @param props - The status.
 * @param props.dot - The dot's colour class: `bg-success` cleaning, `bg-foreground-subtle` docked.
 * @param props.word - What it is doing.
 * @param props.detail - A word after it, quieter.
 * @param props.className - The word's colour class, when not the plain one.
 * @returns The line.
 */
export function StatusLine(props: {
  readonly dot: string;
  readonly word: string;
  readonly detail?: string | null;
  readonly className?: string | undefined;
}) {
  const { dot, word, detail, className } = props;

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-2 text-subhead font-medium whitespace-nowrap transition-colors duration-200',
        className,
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full transition-colors duration-200', dot)} />
      <span className="truncate">{word}</span>
      {detail === undefined || detail === null ? null : (
        <span className="truncate text-ui-sm font-normal text-foreground-subtle">{detail}</span>
      )}
    </span>
  );
}

/** What the question before a press needs. */
export type AskFirstProps = {
  readonly isOpen: boolean;

  /** "Install the firmware update?" */
  readonly title: string;

  /** What the press will do that cannot be taken back. */
  readonly description: string;

  /** The confirming button's words. */
  readonly confirm: string;

  readonly onClose: () => void;
  readonly onConfirm: () => void;
};

/**
 * Renders the question a press asks first when it cannot be taken back - a restart, an install -
 * as the entity dialog's own controls ask it.
 *
 * @param props - See {@link AskFirstProps}.
 * @returns The dialog.
 */
export function AskFirst(props: AskFirstProps) {
  const { t } = useTranslation();

  const { isOpen, title, description, confirm, onClose, onConfirm } = props;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={onConfirm}>{confirm}</Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

/**
 * Writes when something happened, saying "today" for today: "today 09:30", "Mon 08:12".
 *
 * @param when - The moment.
 * @returns It, in words.
 */
export function whenText(when: Date): string {
  return when.toDateString() === new Date().toDateString()
    ? translate('dashboard.cards.controls.today', 'today {{time}}', { time: cardTime(when) })
    : cardTime(when);
}

/**
 * Renders a label and its figure, one cell of a grid of them: a package entity's fields, a
 * robot's last clean.
 *
 * @param props - The cell.
 * @param props.label - What it is.
 * @param props.children - Its value.
 * @returns The cell.
 */
export function StatCell(props: { readonly label: string; readonly children: ReactNode }) {
  const { label, children } = props;

  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <span className="truncate text-label tracking-normal whitespace-nowrap text-foreground-subtle">
        {label}
      </span>
      <span className="truncate text-title font-medium tracking-normal text-foreground tabular-nums">
        {children}
      </span>
    </div>
  );
}
