/**
 * Covers, locks and thermostats together (`K-Aggregate`).
 *
 * Covers read the average position - "from 20 to 100%" when they are not alike, "3 of 5 open" on
 * the tile or when they say no position - and Open, Stop, Close and the position bar go to all.
 * Locks say "All locked" only when every lock is; the card offers Lock all and never unlocks the
 * group: unlocking stays on each lock, with its hold. Thermostats read the average and the spread,
 * and how many are heating; the stepper moves every target by the same step, so the rooms keep
 * their differences, and shows the range when the targets differ.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, IconButton, Pill } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { defineMessage, text, translate } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import {
  BarSlider,
  BigValue,
  Caption,
  CommandNote,
  forHowLong,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { cardTime } from '@/routes/dashboard/cards/entity-model';
import { hoursAndMinutes } from '@/routes/dashboard/cards/on-off-day';
import { spreadOf, type TogetherMember } from '@/routes/dashboard/cards/together-members';
import {
  GroupStepper,
  MemberList,
  MemberRow,
  MembersBeside,
  OfflineNote,
  someOf,
  TogetherHead,
  togetherKind,
  Unanswered,
  usableIn,
  type RowHeight,
  type TogetherView,
} from '@/routes/dashboard/cards/together-parts';
import { TONE_CHOSEN } from '@/routes/library/entity/sheet/tones';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The three movements, with their glyphs, said for all. */
const MOVES = [
  {
    command: 'open',
    label: defineMessage('dashboard.cards.togetherCard.openAll', 'Open all'),
    icon: 'chevron-up',
  },
  {
    command: 'stop',
    label: defineMessage('dashboard.cards.togetherCard.stopAll', 'Stop all'),
    icon: 'square',
  },
  {
    command: 'close',
    label: defineMessage('dashboard.cards.togetherCard.closeAll', 'Close all'),
    icon: 'chevron-down',
  },
] as const;

/** What was last asked of the covers. */
type Sent = (typeof MOVES)[number]['command'] | 'position';

/** The pill a lock's button is drawn as, as the lock card draws it. */
const BUTTON =
  'press-scale relative z-10 inline-flex shrink-0 items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium whitespace-nowrap text-foreground transition-colors duration-200 hover:enabled:bg-surface-high disabled:opacity-40';

/**
 * How tall the rows beside a count are: three fill the side, more share it.
 *
 * @param count - How many members.
 * @returns The height.
 */
function besideHeight(count: number): RowHeight {
  return count <= 3 ? 'h-9.5' : 'h-7.5';
}

/**
 * The line a card says when none of its members can be reached.
 *
 * @param view - The card.
 * @returns "last seen 13:20".
 */
function lastSeenOf(view: TogetherView): string {
  return view.changedAt === null
    ? translate('dashboard.cards.kit.unreachable', 'Not reachable')
    : translate('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
        time: cardTime(view.changedAt),
      });
}

/**
 * Whether a cover says how far it is open.
 *
 * @param member - The cover.
 * @returns True when it does.
 */
function hasPositionOf(member: TogetherMember): boolean {
  return paramsOf(member.entity, 'cover')?.hasPosition !== false;
}

/**
 * Renders covers together.
 *
 * @param props - The card, ready to draw.
 * @param props.view - See {@link TogetherView}.
 * @returns The card.
 */
export function TogetherCovers(props: { readonly view: TogetherView }) {
  const { t } = useTranslation();

  const { view } = props;
  const { command, counted, members, size } = view;
  const [sent, setSent] = useState<Sent>('stop');
  const placed = members.filter(hasPositionOf);
  const hasPositions = placed.length > 0;
  const positions = counted
    .filter(hasPositionOf)
    .flatMap((member) => (member.state.cover === undefined ? [] : [member.state.cover.position]));
  const spread = spreadOf(positions);
  const open = counted.filter((member) => (member.state.cover?.position ?? 0) > 0);
  const hasValue = counted.some((member) => member.state.cover !== undefined);
  const isAlike =
    spread !== null && spread.min === spread.max && positions.length === counted.length;
  const isSending = command.sending === 'cover';
  const position = usePendingValue(Math.round(spread?.average ?? 0), view.reportedAt, isSending);
  const motion = counted.find(
    (member) => member.state.cover !== undefined && member.state.cover.motion !== 'stopped',
  )?.state.cover?.motion;
  const opening = `${t('dashboard.cards.coverCard.opening', 'Opening')}…`;
  const closing = `${t('dashboard.cards.coverCard.closing', 'Closing')}…`;
  const sending =
    sent === 'open'
      ? opening
      : sent === 'close'
        ? closing
        : sent === 'stop'
          ? t('dashboard.cards.coverCard.stopping', 'Stopping…')
          : t('dashboard.cards.thermostatCard.setting', 'Setting…');
  const head = (
    <TogetherHead
      view={view}
      kind={togetherKind('cover')}
      isActive={hasValue ? open.length > 0 : null}
      tail={null}
    />
  );

  /**
   * The line beside the figure: alike, the range, moving, or out of reach.
   *
   * @param isTile - Whether it is the tile, which has room for "all 5" only.
   * @returns The line.
   */
  const note = (isTile: boolean) => {
    const said = view.isOffline
      ? lastSeenOf(view)
      : !hasValue
        ? t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device')
        : !hasPositions
          ? view.changedAt === null
            ? ''
            : t('dashboard.cards.togetherCard.since', 'since {{time}}', {
                time: cardTime(view.changedAt),
              })
          : isAlike
            ? t('dashboard.cards.togetherCard.allOf', 'all {{count}}', { count: counted.length })
            : isTile || spread === null
              ? ''
              : t(
                  'dashboard.cards.togetherCard.averageRange',
                  'average · from {{min}} to {{max}}%',
                  {
                    min: Math.round(spread.min),
                    max: Math.round(spread.max),
                  },
                );

    return (
      <CommandNote command={command} sending={sending}>
        {view.offline > 0 ? (
          <OfflineNote count={view.offline} />
        ) : motion !== undefined && !view.isOffline ? (
          <Caption className="text-cyan">{motion === 'opening' ? opening : closing}</Caption>
        ) : said === '' ? null : (
          <Caption>{said}</Caption>
        )}
      </CommandNote>
    );
  };

  /**
   * The covers' figure: the average position when they say one - on the tile only when alike -
   * else how many are open.
   *
   * @param figureSize - How large.
   * @returns The figure.
   */
  const figure = (figureSize: 26 | 30 | 36) => {
    const colour = cn(
      figureSize === 26 && 'text-[24px]',
      view.isOffline ? 'text-foreground-subtle' : 'text-foreground',
    );

    if (!hasValue) {
      return <BigValue value="—" size={22} className="text-foreground-subtle" />;
    }

    return hasPositions && (figureSize !== 26 || isAlike) ? (
      <BigValue value={String(position.shown)} unit="%" size={figureSize} className={colour} />
    ) : (
      <BigValue
        value={String(open.length)}
        unit={t('dashboard.cards.togetherCard.ofOpen', 'of {{count}} open', {
          count: counted.length,
        })}
        size={figureSize}
        className={colour}
      />
    );
  };

  /**
   * The movements for all: Stop lit while any cover moves.
   *
   * @param look - Round at 30 px, or wide, sharing a row.
   * @returns The buttons.
   */
  const buttons = (look: 'small' | 'wide') =>
    MOVES.map((move) => {
      const isLit = move.command === 'stop' && motion !== undefined;

      return (
        <IconButton
          key={move.command}
          variant={isLit ? 'primary' : 'raised'}
          size={null}
          label={text(move.label)}
          className={cn(
            'transition-colors duration-200 disabled:opacity-40',
            !isLit && 'text-foreground',
            look === 'small' ? 'size-7.5' : 'h-8 flex-1',
          )}
          disabled={!usableIn(view, 'cover') || (isSending && move.command !== 'stop')}
          onClick={() => {
            setSent(move.command);
            command.send('cover', { command: move.command });
          }}
        >
          <AppIcon id={move.icon} size={look === 'small' ? 15 : 17} />
        </IconButton>
      );
    });

  /**
   * The position of every cover that says one, as a bar.
   *
   * @param withValue - Whether the bar writes its value at its end.
   * @returns The bar, or nothing when no cover says a position.
   */
  const positionBar = (withValue: boolean) =>
    hasPositions ? (
      <BarSlider
        label={someOf(
          t('dashboard.cards.togetherCard.position', 'Position'),
          placed.length,
          members.length,
        )}
        icon="blinds"
        value={position.shown}
        display={withValue ? `${String(position.shown)}%` : undefined}
        look={{ fill: 'var(--color-cyan)' }}
        disabled={!usableIn(view, 'cover')}
        onChange={position.hold}
        onCommit={(next) => {
          position.sent(next);
          setSent('position');
          command.send('cover', { command: 'set_position', position: next }, hasPositionOf);
        }}
      />
    ) : null;

  /**
   * One cover's row: how far it is open, or Open and Closed.
   *
   * @param member - The cover.
   * @param height - How tall.
   * @returns The row.
   */
  const row = (member: TogetherMember, height: RowHeight) => {
    const cover = member.state.cover;
    const isOpen = member.isAvailable && (cover?.position ?? 0) > 0;

    return (
      <MemberRow
        key={member.entity.entityId}
        icon="blinds"
        iconClass={isOpen ? 'text-cyan' : 'text-foreground-subtle'}
        name={member.entity.name}
        isDim={!member.isAvailable}
        value={
          !member.isAvailable
            ? t('dashboard.cards.kit.offline', 'Offline')
            : cover === undefined
              ? '—'
              : hasPositionOf(member)
                ? `${String(Math.round(cover.position))}%`
                : cover.position > 0
                  ? t('dashboard.cards.coverCard.isOpen', 'Open')
                  : t('dashboard.cards.coverCard.closed', 'Closed')
        }
        height={height}
      />
    );
  };

  if (size === '1x1') {
    return (
      <CardFrame label={view.title}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <Unanswered command={command} />
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            <span className="flex min-w-0 items-baseline gap-2">
              {figure(26)}
              {note(true)}
            </span>
            {view.canControl ? (
              <div className="flex shrink-0 gap-1.5">{buttons('small')}</div>
            ) : null}
          </div>
        )}
      </CardFrame>
    );
  }

  if (size === '2x2') {
    return (
      <CardFrame label={view.title}>
        {head}
        <MembersBeside
          width="w-[190px]"
          left={
            <>
              {figure(36)}
              {note(false)}
              {view.canControl ? (
                <div className="mt-auto flex gap-1.5">{buttons('small')}</div>
              ) : null}
            </>
          }
        >
          <MemberList
            members={members}
            rows={5}
            height={besideHeight(members.length)}
            command={command}
          >
            {(member) => row(member, besideHeight(members.length))}
          </MemberList>
        </MembersBeside>
      </CardFrame>
    );
  }

  if (size === '2x3') {
    return (
      <CardFrame label={view.title}>
        <TogetherHead
          view={view}
          kind={togetherKind('cover')}
          isActive={hasValue ? open.length > 0 : null}
          subtitle={
            <CommandNote command={command} sending={sending}>
              {view.subtitle}
            </CommandNote>
          }
          tail={null}
        />
        {view.canControl ? (
          <div className="mt-3.5 flex flex-col gap-2">
            {positionBar(true)}
            <div className="flex gap-1.5">{buttons('wide')}</div>
          </div>
        ) : null}
        <div className="mt-3.5 flex flex-col">
          <MemberList members={members} rows={5} height="h-8.5" command={command}>
            {(member) => row(member, 'h-8.5')}
          </MemberList>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={view.title}>
      {head}
      <div className="mt-3.5 flex flex-col gap-1.5">
        {figure(30)}
        {note(false)}
      </div>
      <div className="grow" />
      {command.hasFailed ? (
        <Unanswered command={command} />
      ) : view.canControl ? (
        <div className="flex flex-col gap-2">
          {positionBar(false)}
          <div className="flex gap-1.5">{buttons('wide')}</div>
        </div>
      ) : null}
    </CardFrame>
  );
}

/** How each bolt position is said and coloured in a lock's row. */
const BOLTS = {
  locked: {
    label: defineMessage('dashboard.cards.lockCard.locked', 'Locked'),
    icon: 'lock',
    glyph: 'text-success',
  },
  unlocked: {
    label: defineMessage('dashboard.cards.lockCard.unlocked', 'Unlocked'),
    icon: 'lock-open',
    glyph: 'text-warning',
  },
  jammed: {
    label: defineMessage('dashboard.cards.lockCard.jammed', 'Jammed'),
    icon: 'triangle-alert',
    glyph: 'text-danger',
  },
} as const;

/**
 * Renders locks together.
 *
 * @param props - The card, ready to draw.
 * @param props.view - See {@link TogetherView}.
 * @returns The card.
 */
export function TogetherLocks(props: { readonly view: TogetherView }) {
  const { t } = useTranslation();

  const { view } = props;
  const { command, counted, members, size } = view;
  const hasValue = counted.some((member) => member.state.lock !== undefined);
  const jammed = counted.filter((member) => member.state.lock?.lockState === 'jammed');
  const unlocked = counted.filter((member) => member.state.lock?.lockState === 'unlocked');
  const left = [...unlocked, ...jammed];
  const isAllLocked = hasValue && left.length === 0;
  /**
   * Whether Lock all goes to a lock: one left open that takes no code - a card cannot give one.
   *
   * @param member - The lock.
   * @returns True when it does.
   */
  const lockable = (member: TogetherMember): boolean =>
    member.state.lock?.lockState !== 'locked' && paramsOf(member.entity, 'lock')?.hasCode !== true;
  const canLock =
    view.canControl &&
    counted.some((member) => member.isAvailable && member.canControl && lockable(member));
  const word = !hasValue
    ? '—'
    : isAllLocked
      ? t('dashboard.cards.togetherCard.allLocked', 'All locked')
      : jammed.length > 0
        ? t('dashboard.cards.togetherCard.jammed', {
            count: jammed.length,
            defaultValue_one: '{{count}} jammed',
            defaultValue_other: '{{count}} jammed',
          })
        : t('dashboard.cards.togetherCard.unlocked', {
            count: unlocked.length,
            defaultValue_one: '{{count}} unlocked',
            defaultValue_other: '{{count}} unlocked',
          });
  const colour =
    view.isOffline || !hasValue
      ? 'text-foreground-subtle'
      : isAllLocked
        ? 'text-success'
        : jammed.length > 0
          ? 'text-danger'
          : 'text-warning';
  const tone = isAllLocked || !hasValue ? undefined : jammed.length > 0 ? 'danger' : 'warning';
  const glow =
    view.isOffline || tone === undefined
      ? undefined
      : tone === 'danger'
        ? 'var(--color-danger)'
        : 'var(--color-warning)';
  const first = left[0];
  const caption = view.isOffline
    ? lastSeenOf(view)
    : left.length > 1
      ? left.map((member) => member.entity.name).join(', ')
      : first !== undefined
        ? first.changedAt === null
          ? first.entity.name
          : t('dashboard.cards.togetherCard.nameFor', '{{name}} · {{time}}', {
              name: first.entity.name,
              time: forHowLong(first.changedAt),
            })
        : view.changedAt === null
          ? ''
          : t('dashboard.cards.togetherCard.since', 'since {{time}}', {
              time: cardTime(view.changedAt),
            });
  const head = (
    <TogetherHead
      view={view}
      kind={{ ...togetherKind('lock'), icon: unlocked.length > 0 ? 'lock-open' : 'lock' }}
      isActive={hasValue ? true : null}
      tone={tone}
      tail={null}
    />
  );
  const note =
    view.offline > 0 ? <OfflineNote count={view.offline} /> : <Caption>{caption}</Caption>;

  /**
   * Lock all: to every lock left open that a card may lock; "Locking…" while they move.
   *
   * @param look - Bare on the tile, with its glyph elsewhere, across the foot of the tall card.
   * @returns The button, or nothing when there is nothing to lock or none may be commanded.
   */
  const button = (look: 'tile' | 'pill' | 'wide') => {
    if (!canLock) {
      return null;
    }

    const height = look === 'wide' ? 'h-9 w-full' : 'h-7.5';

    if (command.sending === 'lock') {
      return (
        <span className={cn(BUTTON, height, 'text-foreground-muted')}>
          <span className="inline-flex shrink-0 animate-spin text-cyan">
            <AppIcon id="loader-circle" size={14} />
          </span>
          {t('dashboard.cards.lockCard.locking', 'Locking…')}
        </span>
      );
    }

    return (
      <button
        type="button"
        disabled={!usableIn(view, 'lock')}
        className={cn(BUTTON, height)}
        onClick={() => {
          command.send('lock', { command: 'lock' }, lockable);
        }}
      >
        {look === 'tile' ? null : <AppIcon id="lock" size={16} />}
        {look === 'tile'
          ? t('dashboard.cards.togetherCard.lockAllOnTile', 'Lock all')
          : t('dashboard.cards.togetherCard.lockAll', 'Lock all')}
      </button>
    );
  };

  /**
   * One lock's row: its bolt in a word and its colour, and for how long one has been open.
   *
   * @param member - The lock.
   * @param height - How tall.
   * @returns The row.
   */
  const row = (member: TogetherMember, height: RowHeight) => {
    const bolt = member.state.lock?.lockState;
    const look = bolt === undefined || !member.isAvailable ? null : BOLTS[bolt];

    return (
      <MemberRow
        key={member.entity.entityId}
        icon={look?.icon ?? 'lock'}
        iconClass={look?.glyph ?? 'text-foreground-subtle'}
        name={member.entity.name}
        isDim={!member.isAvailable}
        value={
          !member.isAvailable
            ? t('dashboard.cards.kit.offline', 'Offline')
            : look === null
              ? '—'
              : bolt === 'unlocked' && member.changedAt !== null
                ? `${text(look.label)} · ${hoursAndMinutes(Date.now() - member.changedAt.getTime())}`
                : text(look.label)
        }
        valueClass={bolt === 'locked' || look === null ? undefined : look.glyph}
        height={height}
      />
    );
  };

  if (size === '1x1') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <Unanswered command={command} />
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            <span
              className={cn(
                'flex min-w-0 items-center gap-2 text-[20px] font-medium whitespace-nowrap transition-colors duration-200',
                colour,
              )}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
              <span className="truncate">{word}</span>
            </span>
            {button('tile') ?? note}
          </div>
        )}
      </CardFrame>
    );
  }

  if (size === '2x2') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head}
        <MembersBeside
          width="w-[190px]"
          left={
            <>
              <BigValue value={word} size={26} className={colour} />
              {note}
              <div className="mt-auto flex">{button('pill')}</div>
            </>
          }
        >
          <MemberList
            members={members}
            rows={5}
            height={besideHeight(members.length)}
            command={command}
          >
            {(member) => row(member, besideHeight(members.length))}
          </MemberList>
        </MembersBeside>
      </CardFrame>
    );
  }

  if (size === '2x3') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head}
        <div className="mt-3.5 flex min-w-0 items-end justify-between gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <BigValue value={word} size={30} className={colour} />
            {note}
          </div>
          {button('pill')}
        </div>
        <div className="mt-3.5 flex flex-col">
          <MemberList members={members} rows={5} height="h-8.5" command={command}>
            {(member) => row(member, 'h-8.5')}
          </MemberList>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={view.title} glow={glow}>
      {head}
      <div className="mt-3.5 flex flex-col gap-1.5">
        <BigValue value={word} size={30} className={colour} />
        {note}
      </div>
      <div className="grow" />
      {command.hasFailed ? <Unanswered command={command} /> : button('wide')}
    </CardFrame>
  );
}

/**
 * How a temperature is written: one decimal.
 *
 * @returns The formatter, in the reader's language.
 */
const temperature = (): Intl.NumberFormat =>
  numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * How the ends of a range of targets are written: whole degrees bare, "20 – 22°".
 *
 * @returns The formatter, in the reader's language.
 */
const rangeEnd = (): Intl.NumberFormat =>
  numberFormat({ minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** What a thermostat that says nothing of its own steps moves by. */
const STEP = 0.5;

/**
 * Renders thermostats together.
 *
 * @param props - The card, ready to draw.
 * @param props.view - See {@link TogetherView}.
 * @returns The card.
 */
export function TogetherClimate(props: { readonly view: TogetherView }) {
  const { t } = useTranslation();

  const { view } = props;
  const { command, counted, members, size } = view;
  const settable = members.flatMap((member) => {
    const params = paramsOf(member.entity, 'thermostat');
    const min = params?.minTemperature ?? 5;
    const max = params?.maxTemperature ?? 35;

    return params === null || max <= min
      ? []
      : [{ member, min, max, step: params.temperatureStep }];
  });
  const now = spreadOf(
    counted.flatMap((member) => {
      const value = member.state.thermostat?.currentTemperature;

      return value === undefined ? [] : [value];
    }),
  );
  const targets = spreadOf(
    settable.flatMap(({ member }) => {
      const value = member.state.thermostat?.targetTemperature;

      return value === undefined || (!member.isAvailable && !view.isOffline) ? [] : [value];
    }),
  );
  const heating = counted.filter((member) => member.state.thermostat?.action === 'heating').length;
  const cooling = counted.filter((member) => member.state.thermostat?.action === 'cooling').length;
  const step = Math.max(STEP, ...settable.map((each) => each.step));
  // How far the targets were moved and not yet confirmed; a command left unanswered goes back.
  const shift = usePendingValue(0, view.reportedAt, command.sending === 'thermostat');
  const offset = command.hasFailed ? 0 : shift.shown;
  const unit = members[0]?.entity.unitOfMeasurement ?? '°C';
  const tone = heating > 0 ? 'heat' : cooling > 0 ? 'cyan' : null;
  const glow = view.isOffline || tone === null ? undefined : `var(--color-${tone})`;
  const target =
    targets === null
      ? '—'
      : targets.min === targets.max
        ? `${temperature().format(targets.min + offset)}°`
        : `${rangeEnd().format(targets.min + offset)} – ${rangeEnd().format(targets.max + offset)}°`;

  /**
   * Moves every target one step, each from its own and within its own limits.
   *
   * @param direction - Down or up.
   */
  const nudge = (direction: -1 | 1): void => {
    const next = offset + direction * step;

    shift.sent(next);
    command.sendEach(
      'thermostat',
      new Map(
        settable.flatMap(({ member, min, max, step: own }) => {
          const from = member.state.thermostat?.targetTemperature;

          return from === undefined || !member.isAvailable || !member.canControl
            ? []
            : [
                [
                  member.entity.entityId,
                  {
                    command: 'set_target',
                    temperature: Math.min(
                      max,
                      Math.max(min, Math.round((from + next) / own) * own),
                    ),
                  },
                ] as const,
              ];
        }),
      ),
    );
  };

  const pill =
    tone === null || view.isOffline ? undefined : (
      <Pill className={cn(TONE_CHOSEN[tone], 'border-border-strong *:bg-current')}>
        {tone === 'heat'
          ? t('dashboard.cards.togetherCard.heating', {
              count: heating,
              defaultValue_one: '{{count}} heating',
              defaultValue_other: '{{count}} heating',
            })
          : t('dashboard.cards.togetherCard.cooling', {
              count: cooling,
              defaultValue_one: '{{count}} cooling',
              defaultValue_other: '{{count}} cooling',
            })}
      </Pill>
    );
  const kind = togetherKind('thermostat');
  const isActive =
    counted.length === 0 ? null : counted.some((member) => member.state.thermostat?.mode !== 'off');

  /**
   * The head, with how many are heating at its right.
   *
   * @param subtitle - The line under the title, when it says something else than the place.
   * @returns The head.
   */
  const head = (subtitle?: string) => (
    <TogetherHead
      view={view}
      kind={tone === 'cyan' ? { ...kind, tone: 'sensor' } : kind}
      isActive={isActive}
      subtitle={subtitle}
      tail={pill ?? null}
    />
  );
  const range =
    now === null
      ? ''
      : now.min === now.max
        ? t('dashboard.cards.togetherCard.allOf', 'all {{count}}', { count: counted.length })
        : t('dashboard.cards.togetherCard.range', '{{min}} to {{max}}', {
            min: temperature().format(now.min),
            max: temperature().format(now.max),
          });

  /**
   * The line under the average: the spread, or out of reach.
   *
   * @param isTile - Whether it is the tile, which has no room for "average".
   * @returns The line.
   */
  const note = (isTile: boolean) =>
    view.offline > 0 ? (
      <OfflineNote count={view.offline} />
    ) : (
      <Caption>
        {view.isOffline
          ? lastSeenOf(view)
          : now === null
            ? t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device')
            : isTile
              ? range
              : t('dashboard.cards.togetherCard.averageOf', 'average · {{range}}', { range })}
      </Caption>
    );

  /**
   * The average temperature now.
   *
   * @param figureSize - How large.
   * @returns The figure.
   */
  const figure = (figureSize: 26 | 36 | 40) => (
    <BigValue
      value={now === null ? '—' : temperature().format(now.average)}
      unit={now === null ? undefined : unit}
      size={now === null ? 22 : figureSize}
      className={view.isOffline || now === null ? 'text-foreground-subtle' : undefined}
    />
  );
  // Beside the members the side is too narrow to say the step too.
  const targetLine = (
    <div className="flex min-w-0 items-center justify-between gap-2.5">
      <CommandNote
        command={command}
        sending={t('dashboard.cards.thermostatCard.setting', 'Setting…')}
      >
        <Caption>
          {settable.length === members.length
            ? t('dashboard.cards.togetherCard.targetAll', 'Target · all {{count}}', {
                count: members.length,
              })
            : t('dashboard.cards.togetherCard.targetSome', 'Target · {{count}} of {{total}}', {
                count: settable.length,
                total: members.length,
              })}
        </Caption>
      </CommandNote>
      {targets === null || targets.min === targets.max || size === '2x2' ? null : (
        <Caption>
          {step === STEP
            ? t('dashboard.cards.togetherCard.halfDegreeEach', 'half a degree each')
            : t('dashboard.cards.togetherCard.stepEach', '{{step}}° each', {
                step: rangeEnd().format(step),
              })}
        </Caption>
      )}
    </div>
  );
  const control =
    view.canControl && settable.length > 0 ? (
      <div className="flex flex-col gap-1.5">
        {command.hasFailed ? <Unanswered command={command} /> : targetLine}
        <GroupStepper value={target} disabled={!usableIn(view, 'thermostat')} onStep={nudge} />
      </div>
    ) : (
      <div className="flex min-w-0 items-center justify-between gap-2.5 border-t border-border py-1.25">
        <Caption className="text-foreground-muted">
          {t('dashboard.cards.thermostatCard.target', 'Target')}
        </Caption>
        <Caption className="text-foreground">{target}</Caption>
      </div>
    );

  /**
   * One thermostat's row: the temperature in its room, its glyph lit while it works.
   *
   * @param member - The thermostat.
   * @param height - How tall.
   * @returns The row.
   */
  const row = (member: TogetherMember, height: RowHeight) => {
    const thermostat = member.state.thermostat;
    const action = member.isAvailable ? thermostat?.action : undefined;

    return (
      <MemberRow
        key={member.entity.entityId}
        icon="thermometer"
        iconClass={
          action === 'heating'
            ? 'text-heat'
            : action === 'cooling'
              ? 'text-cyan'
              : 'text-foreground-subtle'
        }
        name={member.entity.name}
        isDim={!member.isAvailable || thermostat?.mode === 'off'}
        value={
          !member.isAvailable
            ? t('dashboard.cards.kit.offline', 'Offline')
            : thermostat?.currentTemperature === undefined
              ? '—'
              : `${temperature().format(thermostat.currentTemperature)}°`
        }
        height={height}
      />
    );
  };

  if (size === '1x1') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head()}
        <div className="grow" />
        {command.hasFailed ? (
          <Unanswered command={command} />
        ) : (
          <div className="flex min-w-0 items-baseline justify-between gap-2.5">
            {figure(26)}
            {note(true)}
          </div>
        )}
      </CardFrame>
    );
  }

  if (size === '2x2') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head()}
        <MembersBeside
          width="w-[190px]"
          left={
            <>
              {figure(36)}
              {note(false)}
              <div className="mt-auto">{control}</div>
            </>
          }
        >
          <MemberList
            members={members}
            rows={5}
            height={besideHeight(members.length)}
            // The stepper's line says who did not answer; the list does not say it twice.
            command={{ ...command, hasFailed: false }}
          >
            {(member) => row(member, besideHeight(members.length))}
          </MemberList>
        </MembersBeside>
      </CardFrame>
    );
  }

  if (size === '2x3') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head(
          now === null
            ? undefined
            : t('dashboard.cards.togetherCard.averageNow', '{{value}} average · {{range}}', {
                value: `${temperature().format(now.average)} ${unit}`,
                range,
              }),
        )}
        <div className="mt-3.5">{control}</div>
        <div className="mt-3.5 flex flex-col">
          <MemberList
            members={members}
            rows={5}
            height="h-8.5"
            // The stepper's line says who did not answer; the list does not say it twice.
            command={{ ...command, hasFailed: false }}
          >
            {(member) => row(member, 'h-8.5')}
          </MemberList>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={view.title} glow={glow}>
      {head()}
      <div className="mt-3.5 flex flex-col gap-1.5">
        {figure(36)}
        {note(false)}
      </div>
      <div className="grow" />
      {control}
    </CardFrame>
  );
}
