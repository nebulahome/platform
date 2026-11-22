/**
 * The parts the cards that sum up share (`K-Overview`): their head, which stands for a place or a
 * list rather than one entity; the small round buttons of their rows; the face of a card still
 * waiting for what it shows; and the colour of an entity's glyph.
 */
import type { ReactNode } from 'react';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import type { EntityKind } from '@/library/entity-kind';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { TONE_CLASSES } from '@/routes/library/entity-tile';

/** What the head needs. */
export type OverviewHeadProps = {
  /** The chip's glyph. */
  readonly icon: UiIconId;

  /** The chip's ground and glyph colour: lit, or `bg-surface-raised text-foreground-subtle`. */
  readonly chip: string;

  /** The card's name. */
  readonly title: string;

  /** The line under it. */
  readonly subtitle: string;

  /** What sits at the right: a badge. */
  readonly tail?: ReactNode;
};

/**
 * Renders the head of a card that sums up: the 32 px chip, the name and a line, as an entity
 * card's head is drawn.
 *
 * @param props - See {@link OverviewHeadProps}.
 * @returns The head.
 */
export function OverviewHead(props: OverviewHeadProps) {
  const { icon, chip, title, subtitle, tail } = props;

  return (
    <div className="flex h-8 shrink-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-field transition-colors duration-200',
          chip,
        )}
      >
        <AppIcon id={icon} size={16} />
      </span>
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium text-foreground">{title}</span>
        <span className="truncate text-caption leading-4 text-foreground-subtle">{subtitle}</span>
      </div>
      {tail === undefined || tail === null ? null : (
        <div className="flex shrink-0 items-center gap-2">{tail}</div>
      )}
    </div>
  );
}

/**
 * Renders a 26 px round button of a row: up and down for blinds, minus and plus for heating.
 *
 * @param props - What it does.
 * @param props.label - What it does, for a screen reader.
 * @param props.icon - Its glyph.
 * @param props.disabled - Whether it can be pressed.
 * @param props.onPress - When pressed.
 * @returns The button.
 */
export function OverviewRoundButton(props: {
  readonly label: string;
  readonly icon: UiIconId;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { label, icon, disabled = false, onPress } = props;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="press-scale inline-flex size-6.5 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-surface-raised text-foreground transition-colors duration-200 hover:enabled:bg-surface-high disabled:opacity-40"
      onClick={onPress}
    >
      <AppIcon id={icon} size={13} />
    </button>
  );
}

/**
 * Renders the face of a card that waits for what it shows - a room not chosen yet, a list with
 * nothing on it - with a dashed edge, as a card with nothing to read is drawn.
 *
 * @param props - What it waits for.
 * @param props.label - What the card is, for a screen reader.
 * @param props.icon - The glyph of its type.
 * @param props.title - What is missing: "No room yet".
 * @param props.note - What to do about it.
 * @returns The card.
 */
export function WaitingFace(props: {
  readonly label: string;
  readonly icon: UiIconId;
  readonly title: string;
  readonly note: string;
}) {
  const { label, icon, title, note } = props;

  return (
    <CardFrame label={label} tone="faint">
      <div className="flex h-full min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-high text-foreground-subtle"
        >
          <AppIcon id={icon} size={16} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
          <span className="truncate text-caption leading-4 text-foreground-subtle">{note}</span>
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * The colour of a kind's glyph when it is lit: a lamp warm, a lock green.
 *
 * @param kind - What kind of thing it is.
 * @returns The text colour class.
 */
export function toneText(kind: EntityKind): string {
  return TONE_CLASSES[kind.tone].split(' ').find((name) => name.startsWith('text-')) ?? '';
}
