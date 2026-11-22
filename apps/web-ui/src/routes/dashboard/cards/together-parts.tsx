/**
 * The parts a together card is drawn with, beside the kit's: its head, the members' marks, a
 * member's row, "and 2 more", the stepper that moves every target, and the notes for members out
 * of reach and for members that did not answer.
 *
 * The head is the kit's `CardHead` for a group: the same chip, name, place and tail, the Offline
 * pill when no member can be reached, the eye when none may be commanded.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardTogetherCard, IconView, TogetherDomain } from '@nebulahome/contracts';
import { AppIcon, cn, IconButton, type UiIconId } from '@nebulahome/ui';

import { kindIcon, kindName } from '@/dashboard/card-options';
import { translate } from '@/i18n/messages';
import type { EntityKind, EntityTone } from '@/library/entity-kind';
import { NoAnswer } from '@/routes/dashboard/cards/card-kit';
import type { SizeKey } from '@/routes/dashboard/cards/entity-model';
import type { TogetherCommand } from '@/routes/dashboard/cards/together-command';
import { rowsOf, type TogetherMember } from '@/routes/dashboard/cards/together-members';
import { EntityTile } from '@/routes/library/entity-tile';

/** The family each kind's chip is drawn in: the boards draw covers cyan, as the cover card does. */
const TONES: Readonly<Record<TogetherDomain, EntityTone>> = {
  light: 'light',
  switch: 'power',
  cover: 'sensor',
  lock: 'secure',
  thermostat: 'climate',
};

/**
 * The chip of a together card: its kind's glyph and family.
 *
 * @param domain - The kind.
 * @returns What the chip draws.
 */
export function togetherKind(domain: TogetherDomain): EntityKind {
  return {
    label: kindName(`together-${domain}`),
    icon: kindIcon(`together-${domain}`),
    tone: TONES[domain],
  };
}

/**
 * How many members of a kind, in words.
 *
 * @param domain - The kind.
 * @param count - How many.
 * @returns "6 lights".
 */
export function membersCount(domain: TogetherDomain, count: number): string {
  switch (domain) {
    case 'light':
      return translate('dashboard.cards.togetherCard.lights', {
        count,
        defaultValue_one: '{{count}} light',
        defaultValue_other: '{{count}} lights',
      });
    case 'switch':
      return translate('dashboard.cards.togetherCard.switches', {
        count,
        defaultValue_one: '{{count}} switch',
        defaultValue_other: '{{count}} switches',
      });
    case 'cover':
      return translate('dashboard.cards.togetherCard.covers', {
        count,
        defaultValue_one: '{{count}} cover',
        defaultValue_other: '{{count}} covers',
      });
    case 'lock':
      return translate('dashboard.cards.togetherCard.locks', {
        count,
        defaultValue_one: '{{count}} lock',
        defaultValue_other: '{{count}} locks',
      });
    case 'thermostat':
      return translate('dashboard.cards.togetherCard.thermostats', {
        count,
        defaultValue_one: '{{count}} thermostat',
        defaultValue_other: '{{count}} thermostats',
      });
  }
}

/**
 * A control's label, with how many members have it when not all do: "Brightness · 3 of 4".
 *
 * @param label - The control.
 * @param count - How many have it.
 * @param total - How many members there are.
 * @returns The label.
 */
export function someOf(label: string, count: number, total: number): string {
  return count === total
    ? label
    : translate('dashboard.cards.togetherCard.someOf', '{{label}} · {{count}} of {{total}}', {
        label,
        count,
        total,
      });
}

/** A together card, ready to draw. */
export type TogetherView = {
  /** The card as the layout stores it. */
  readonly card: DashboardTogetherCard;

  /** What it is headed: the person's title, or its area, or its kind. */
  readonly title: string;

  /** The line under the title: "6 lights", or "Ground floor · 5" when the title names no place. */
  readonly subtitle: string;

  /** The icon chosen for the card, if any. */
  readonly icon: IconView | undefined;

  /** Every member. */
  readonly members: readonly TogetherMember[];

  /**
   * The members counted: those that can be reached, or - when none can - all of them, their last
   * values drawn dimmed.
   */
  readonly counted: readonly TogetherMember[];

  /** How many cannot be reached, while others can: named apart ("1 offline"). */
  readonly offline: number;

  /** Whether no member can be reached. */
  readonly isOffline: boolean;

  /** Whether this person may command at least one member. */
  readonly canControl: boolean;

  /** Whether this person may read the members' history. */
  readonly canReadHistory: boolean;

  /** When a member last reported. */
  readonly reportedAt: number | null;

  /** When a counted member last changed. */
  readonly changedAt: Date | null;

  /** The size it is drawn at. */
  readonly size: SizeKey;

  /** The card's command path. */
  readonly command: TogetherCommand;
};

/**
 * Whether a control of the card takes input now: someone may command a member, one can be
 * reached, and no other command of the card is waiting for its answers.
 *
 * @param view - The card.
 * @param capability - The control's own capability, which stays usable while it is the one out.
 * @returns True when it does.
 */
export function usableIn(view: TogetherView, capability?: string): boolean {
  const { sending } = view.command;

  return view.canControl && !view.isOffline && (sending === null || sending === capability);
}

/** What the head needs. */
export type TogetherHeadProps = {
  /** The card. */
  readonly view: TogetherView;

  /** What kind of thing the members are, for the chip's glyph and tint. */
  readonly kind: EntityKind;

  /** Whether any member is on or open: the chip takes its colour; null to keep it tinted. */
  readonly isActive: boolean | null;

  /** The chip's colour when the state calls for its own: a lock left open, one jammed. */
  readonly tone?: 'warning' | 'danger' | undefined;

  /** The line under the title, when it says something else than the view's: "4 of 6 on". */
  readonly subtitle?: ReactNode;

  /** What sits at the right: the switch for all, a badge. Left out when none can be reached. */
  readonly tail?: ReactNode;
};

/**
 * Renders the head of a together card.
 *
 * @param props - See {@link TogetherHeadProps}.
 * @returns The head.
 */
export function TogetherHead(props: TogetherHeadProps) {
  const { t } = useTranslation();

  const { view, kind, isActive, tone, subtitle = view.subtitle, tail } = props;
  const end = view.isOffline ? (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-border-strong px-2.5 text-caption font-medium text-foreground-muted">
      <AppIcon id="wifi-off" size={12} />
      {t('dashboard.cards.kit.offline', 'Offline')}
    </span>
  ) : view.canControl || tail === undefined ? (
    tail
  ) : (
    <span
      className="inline-flex text-foreground-subtle"
      title={t('dashboard.cards.kit.viewOnly', 'View only')}
    >
      <AppIcon id="eye" size={14} />
    </span>
  );

  return (
    <div className="flex h-8 shrink-0 items-center gap-2.5">
      <EntityTile
        icon={view.icon}
        kind={kind}
        isActive={isActive}
        isAvailable={!view.isOffline}
        className={
          view.isOffline || tone === undefined
            ? ''
            : tone === 'warning'
              ? 'bg-warning/14 text-warning'
              : 'bg-danger/14 text-danger'
        }
        size="medium"
      />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium text-foreground">
          {view.title}
        </span>
        <span className="truncate text-caption leading-4 text-foreground-subtle tabular-nums">
          {subtitle}
        </span>
      </div>
      {end === undefined || end === null ? null : (
        <div className="flex shrink-0 items-center gap-2">{end}</div>
      )}
    </div>
  );
}

/** One member's mark: its glyph, lit when it is on. */
export type Mark = { readonly id: string; readonly icon: UiIconId; readonly isOn: boolean };

/** How many marks are drawn before the rest are counted in the last one. */
const MARKS = 10;

/**
 * Renders the members as a row of small round marks, overlapping, lit when on.
 *
 * @param props - The marks.
 * @param props.marks - See {@link Mark}.
 * @param props.lit - The colour class a lit glyph takes: `text-lamp`.
 * @returns The row.
 */
export function MemberMarks(props: { readonly marks: readonly Mark[]; readonly lit: string }) {
  const { marks, lit } = props;
  const more = marks.length > MARKS ? marks.length - (MARKS - 1) : 0;
  const shown = more === 0 ? marks : marks.slice(0, MARKS - 1);
  const ring =
    'flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-raised not-first:-ml-1.5';

  return (
    <div aria-hidden="true" className="flex">
      {shown.map((mark) => (
        <span
          key={mark.id}
          className={cn(
            ring,
            'transition-colors duration-200',
            mark.isOn ? lit : 'text-foreground-subtle',
          )}
        >
          <AppIcon id={mark.icon} size={12} />
        </span>
      ))}
      {more === 0 ? null : (
        <span className={cn(ring, 'w-auto px-1.5 text-[10px] text-foreground-muted tabular-nums')}>
          +{more}
        </span>
      )}
    </div>
  );
}

/** How tall a member's row is: 30 px beside the count, 34 px under it, 38 px for three. */
export type RowHeight = 'h-7.5' | 'h-8.5' | 'h-9.5';

/** What a member's row needs. */
export type MemberRowProps = {
  /** Its glyph. */
  readonly icon: UiIconId;

  /** The glyph's colour class: lit, or `text-foreground-subtle`. */
  readonly iconClass: string;

  /** Its name. */
  readonly name: string;

  /** Whether it is off: the name is muted. */
  readonly isDim: boolean;

  /** Its value, written. */
  readonly value?: string | undefined;

  /** The value's colour class, when not the quiet one. */
  readonly valueClass?: string | undefined;

  /** What sits at the end: its own small switch. */
  readonly tail?: ReactNode;

  /** How tall. */
  readonly height: RowHeight;
};

/**
 * Renders one member as a row: its glyph, its name, its value and its own switch.
 *
 * @param props - See {@link MemberRowProps}.
 * @returns The row.
 */
export function MemberRow(props: MemberRowProps) {
  const { icon, iconClass, name, isDim, value, valueClass, tail, height } = props;

  return (
    <div
      className={cn(
        // Rows give way when there is less room than they ask for, as the board's do.
        'flex min-h-0 min-w-0 items-center gap-2.5 border-border not-first:border-t',
        height,
      )}
    >
      <span className={cn('inline-flex shrink-0 transition-colors duration-200', iconClass)}>
        <AppIcon id={icon} size={14} />
      </span>
      <span
        className={cn(
          'min-w-0 grow truncate text-ui-sm transition-colors duration-200',
          isDim ? 'text-foreground-muted' : 'text-foreground',
        )}
      >
        {name}
      </span>
      {value === undefined ? null : (
        <span
          className={cn(
            'shrink-0 truncate text-caption tabular-nums',
            valueClass ?? 'text-foreground-subtle',
          )}
        >
          {value}
        </span>
      )}
      {tail === undefined ? null : (
        <span className="relative z-10 inline-flex shrink-0">{tail}</span>
      )}
    </div>
  );
}

/**
 * Renders the last row of a list that has more members than rows: "and 2 more".
 *
 * @param props - The row.
 * @param props.count - How many are not listed.
 * @param props.height - How tall, as the other rows.
 * @returns The row.
 */
export function MoreRow(props: { readonly count: number; readonly height: RowHeight }) {
  const { t } = useTranslation();

  const { count, height } = props;

  return (
    <div
      className={cn(
        'flex min-h-0 items-center border-t border-border pl-6 text-caption text-foreground-subtle',
        height,
      )}
    >
      {t('dashboard.cards.togetherCard.andMore', {
        count,
        defaultValue_one: 'and {{count}} more',
        defaultValue_other: 'and {{count}} more',
      })}
    </div>
  );
}

/** What a list of members needs. */
export type MemberListProps<TMember> = {
  /** The members, in the order they are listed. */
  readonly members: readonly TMember[];

  /** How many rows there is room for. */
  readonly rows: number;

  /** How tall each row is. */
  readonly height: RowHeight;

  /** The card's command: when some members did not answer, the list ends on it. */
  readonly command: TogetherCommand;

  /** Draws one member's row, with its key. */
  readonly children: (member: TMember) => ReactNode;
};

/**
 * Renders the members as rows, a sixth one turning into "and 2 more" when there is no room for
 * all, and - when some did not answer - how many, with Try again, in the last row.
 *
 * @param props - See {@link MemberListProps}.
 * @returns The rows.
 */
export function MemberList<TMember>(props: MemberListProps<TMember>) {
  const { members, rows, height, command, children } = props;
  const { shown, more } = rowsOf(members, command.hasFailed ? rows - 1 : rows);

  return (
    <>
      {shown.map(children)}
      {more === 0 ? null : <MoreRow count={more} height={height} />}
      {command.hasFailed ? (
        <div className="shrink-0 pt-2">
          <NoAnswer command={command} />
        </div>
      ) : null}
    </>
  );
}

/**
 * Renders the square card's body that lists the members beside the count: the count on the left,
 * the rows on the right past a line.
 *
 * @param props - The two sides.
 * @param props.width - The left side's width class: 170 px beside switches, 190 px beside locks.
 * @param props.left - The count, its caption and what sits under them.
 * @param props.children - The rows.
 * @returns The body.
 */
export function MembersBeside(props: {
  readonly width: 'w-[170px]' | 'w-[190px]';
  readonly left: ReactNode;
  readonly children: ReactNode;
}) {
  const { width, left, children } = props;

  return (
    <div className="mt-3.5 flex min-h-0 grow">
      <div className={cn('flex shrink-0 flex-col gap-1.5 pr-5', width)}>{left}</div>
      <div className="flex min-w-0 grow flex-col justify-end border-l border-border pl-5">
        {children}
      </div>
    </div>
  );
}

/**
 * Says how many members cannot be reached: they are left out of the count.
 *
 * @param props - The count.
 * @param props.count - How many.
 * @returns The note.
 */
export function OfflineNote(props: { readonly count: number }) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex shrink-0 items-center gap-1.25 text-caption whitespace-nowrap text-warning tabular-nums">
      <AppIcon id="wifi-off" size={12} />
      {t('dashboard.cards.togetherCard.offline', '{{count}} offline', { count: props.count })}
    </span>
  );
}

/**
 * Renders the stepper that moves every target by the same step: lower, the target or the range,
 * raise.
 *
 * @param props - The stepper.
 * @param props.value - The target, or the range, written.
 * @param props.disabled - Whether it can be moved.
 * @param props.onStep - When a button is pressed, with its direction.
 * @returns The stepper.
 */
export function GroupStepper(props: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onStep: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();

  const { value, disabled, onStep } = props;
  const button = 'size-7 border border-border-strong text-foreground';

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-2 rounded-tile bg-surface-raised px-1 transition-opacity duration-200',
        disabled && 'opacity-40',
      )}
    >
      <IconButton
        variant="raised"
        label={t('dashboard.cards.togetherCard.lowerAll', 'Lower every target')}
        className={button}
        disabled={disabled}
        onClick={() => {
          onStep(-1);
        }}
      >
        <AppIcon id="minus" size={14} />
      </IconButton>
      <span className="text-[22px] font-medium tracking-[-0.02em] whitespace-nowrap tabular-nums">
        {value}
      </span>
      <IconButton
        variant="raised"
        label={t('dashboard.cards.togetherCard.raiseAll', 'Raise every target')}
        className={button}
        disabled={disabled}
        onClick={() => {
          onStep(1);
        }}
      >
        <AppIcon id="plus" size={14} />
      </IconButton>
    </div>
  );
}
