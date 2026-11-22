/**
 * One card for many entities of a kind - every light of the Kitchen - with one state and controls
 * that act on all of them at once (`K-Aggregate`).
 *
 * The members are worked out here every time the card draws (`together-members.ts`), each read the
 * way an entity card reads its entity. The card counts them ("4 of 6 on"), shows the average of
 * their main value and sends each command to every member that can take it. Members that cannot be
 * reached are left out of the count and named apart ("1 offline"). A control stays while at least
 * one member has it, and says how many when not all do ("Brightness · 3 of 4"); when no member can
 * dim, the card is drawn as a light that only switches.
 *
 * The lights and the switches are drawn here; covers, locks and thermostats in
 * `together-kinds.tsx`. The card's face has no tap of its own: its members are on it.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { DashboardTogetherCard, EntityView, IconView } from '@nebulahome/contracts';
import { Switch } from '@nebulahome/ui';

import { kindName } from '@/dashboard/card-options';
import { CARD_SIZES, snapSize } from '@/dashboard/card-sizes';
import { translate } from '@/i18n/messages';
import { signalled } from '@/lib/signalled';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  capabilityStateOf,
  hasCapability,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
  powerCommand,
  warmthGradient,
} from '@/library/entity-control';
import { readingOf } from '@/library/entity-reading';
import {
  BarSlider,
  BigValue,
  Caption,
  CommandNote,
  DayBlocks,
  NoAnswer,
  PowerButton,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';
import { cardTime, sizeKey } from '@/routes/dashboard/cards/entity-model';
import { hoursAndMinutes } from '@/routes/dashboard/cards/on-off-day';
import { useTogetherCommand } from '@/routes/dashboard/cards/together-command';
import { useTogetherDay } from '@/routes/dashboard/cards/together-day';
import {
  TogetherClimate,
  TogetherCovers,
  TogetherLocks,
} from '@/routes/dashboard/cards/together-kinds';
import {
  spreadOf,
  togetherMembers,
  type TogetherMember,
} from '@/routes/dashboard/cards/together-members';
import {
  MemberList,
  MemberMarks,
  MemberRow,
  MembersBeside,
  membersCount,
  OfflineNote,
  someOf,
  TogetherHead,
  togetherKind,
  usableIn,
  type TogetherView,
} from '@/routes/dashboard/cards/together-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { usePendingValue, type PendingValue } from '@/routes/library/entity/use-pending-value';

/** What the card needs. */
export type TogetherCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardTogetherCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/** A lamp's own warmth: what lit lights are drawn in. */
const LAMP = 'var(--color-lamp)';

/** What a switch that is on is lit in. */
const ON = 'var(--color-primary)';

/** How far one step of the white bar moves, in kelvin. */
const STEP_KELVIN = 50;

/**
 * One member, read the way an entity card reads its entity: the live channel's state when it has
 * spoken, the page's otherwise.
 *
 * @param entity - The entity.
 * @param data - What the page read.
 * @returns The member.
 */
function memberOf(entity: EntityView, data: DashboardData): TogetherMember {
  const live = data.readings[entity.entityId];

  return {
    entity,
    state: capabilityStateOf(entity, live),
    isAvailable: readingOf(entity, live).isAvailable,
    canControl: data.canControl(entity),
    reportedAt: live?.receivedAt ?? entity.lastUpdated?.getTime() ?? null,
    changedAt: live?.changedAt ?? entity.lastChanged,
  };
}

/**
 * The latest of some moments.
 *
 * @param moments - The moments; nulls are passed over.
 * @returns The latest, or null for none.
 */
function latestOf(moments: readonly (Date | null)[]): Date | null {
  return moments.reduce<Date | null>(
    (latest, moment) => (moment !== null && (latest === null || moment > latest) ? moment : latest),
    null,
  );
}

/**
 * Renders the card.
 *
 * @param props - See {@link TogetherCardProps}.
 * @returns The card.
 */
export function TogetherCard(props: TogetherCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const sample = useCardSample();
  const areaKey = card.members.mode === 'rule' ? card.members.areaKey : null;
  // The areas say which rooms a floor holds; a sample card asks no hub.
  const areas = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,
    queryFn: signalled(fetchAreas),
    enabled: sample === null && areaKey !== null,
  });
  const entities = togetherMembers(card, [...data.entityById.values()], areas.data ?? []);
  const members = entities.map((entity) => memberOf(entity, data));
  const command = useTogetherCommand(members);

  const reachable = members.filter((member) => member.isAvailable);
  const isOffline = reachable.length === 0 && members.length > 0;
  const counted = isOffline ? members : reachable;
  const areaName =
    areaKey === null
      ? null
      : (areas.data?.find((area) => area.key === areaKey)?.name ??
        entities.find((entity) => entity.areaKey === areaKey)?.areaName ??
        null);
  const title = card.title ?? areaName ?? kindName(`together-${card.domain}`);
  const count = membersCount(card.domain, members.length);
  const icon: IconView | undefined = card.icon === null ? undefined : data.icons.get(card.icon);
  const reports = members.flatMap((member) =>
    member.reportedAt === null ? [] : [member.reportedAt],
  );
  const view: TogetherView = {
    card,
    title,
    // A title that does not name the place says it under it: "Blinds · Ground floor · 5".
    subtitle:
      areaName !== null && !title.toLocaleLowerCase().includes(areaName.toLocaleLowerCase())
        ? t('dashboard.cards.togetherCard.inArea', '{{area}} · {{count}}', {
            area: areaName,
            count: members.length,
          })
        : count,
    icon,
    members,
    counted,
    offline: isOffline ? 0 : members.length - reachable.length,
    isOffline,
    canControl: members.some((member) => member.canControl),
    canReadHistory: members.some((member) => data.canReadHistory(member.entity)),
    reportedAt: reports.length === 0 ? null : Math.max(...reports),
    changedAt: latestOf(counted.map((member) => member.changedAt)),
    size: sizeKey(snapSize(CARD_SIZES.together.sizes, card.w, card.h, card.w)),
    command,
  };

  if (members.length === 0) {
    return (
      <CardFrame label={title}>
        <TogetherHead view={view} kind={togetherKind(card.domain)} isActive={false} />
        <div className="grow" />
        <Caption>{t('dashboard.cards.togetherCard.noneYet', 'None here yet')}</Caption>
      </CardFrame>
    );
  }

  switch (card.domain) {
    case 'light':
    case 'switch':
      return <TogetherSwitches view={view} />;
    case 'cover':
      return <TogetherCovers view={view} />;
    case 'lock':
      return <TogetherLocks view={view} />;
    case 'thermostat':
      return <TogetherClimate view={view} />;
  }
}

/**
 * Whether a light or a switch is on.
 *
 * @param member - The member.
 * @returns True when it is.
 */
function isOnOf(member: TogetherMember): boolean {
  return member.state.on_off?.isOn ?? (member.state.level?.level ?? 0) > 0;
}

/**
 * Renders lights or switches together: how many are on, the switch for all, the brightness and
 * the white for the lamps that have them, the day for those that only switch, and the members.
 *
 * @param props - The card, ready to draw.
 * @param props.view - See {@link TogetherView}.
 * @returns The card.
 */
function TogetherSwitches(props: { readonly view: TogetherView }) {
  const { t } = useTranslation();

  const { view } = props;
  const { command, counted, members, size } = view;
  const isLight = view.card.domain === 'light';
  const color = isLight ? LAMP : ON;
  const lit = isLight ? 'text-lamp' : 'text-primary';
  const glyph = isLight ? 'lightbulb' : 'power';
  const on = counted.filter(isOnOf);
  const hasValue = counted.some(
    (member) => member.state.on_off !== undefined || member.state.level !== undefined,
  );
  const dimmers = isLight ? members.filter((member) => hasCapability(member.entity, 'level')) : [];
  const whites = isLight
    ? members.filter((member) => paramsOf(member.entity, 'color_temp') !== null)
    : [];
  const canDim = dimmers.length > 0;
  const brightness = spreadOf(
    on.flatMap((member) => (member.state.level === undefined ? [] : [member.state.level.level])),
  );
  const white = spreadOf(
    on.flatMap((member) =>
      member.state.color_temp === undefined ? [] : [miredsToKelvin(member.state.color_temp.mireds)],
    ),
  );
  const power = usePendingValue(on.length > 0, view.reportedAt, command.sending === 'on_off');
  const level = usePendingValue(
    Math.round(brightness?.average ?? 0),
    view.reportedAt,
    command.sending === 'level',
  );
  const kelvin = usePendingValue(
    white === null ? 0 : Math.round(white.average / 10) * 10,
    view.reportedAt,
    command.sending === 'color_temp',
  );
  // What only switches draws its day: every size but the tile, where the lamps' bar would be.
  const today = useTogetherDay(members, !canDim && view.canReadHistory && size !== '1x1');
  // A command no member answered leaves them where they were: the switch says so.
  const isOn = command.hasFailed ? on.length > 0 : power.shown;
  const glow = on.length > 0 && !view.isOffline ? color : undefined;
  // On first, then off, then the ones out of reach: the board lists them so.
  const sorted = [...members].sort((a, b) => rankOf(a) - rankOf(b));

  /**
   * Switches every member on or off.
   *
   * @param next - On or off.
   */
  const toggle = (next: boolean): void => {
    power.sent(next);
    command.send('on_off', powerCommand(next));
  };

  /**
   * The line beside the count: the average brightness, since when, or why there is nothing to say.
   *
   * @param withWarmth - Whether to name the white too, where there is room: "72% average · warm".
   * @returns The line.
   */
  const caption = (withWarmth: boolean): string => {
    if (view.isOffline) {
      return view.changedAt === null
        ? t('dashboard.cards.kit.unreachable', 'Not reachable')
        : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
            time: cardTime(view.changedAt),
          });
    }

    if (!hasValue) {
      return t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device');
    }

    if (on.length === 0) {
      return view.changedAt === null
        ? t('dashboard.cards.togetherCard.allOff', 'all {{count}} off', { count: counted.length })
        : t('dashboard.cards.togetherCard.allOffSince', 'all {{count}} since {{time}}', {
            count: counted.length,
            time: cardTime(view.changedAt),
          });
    }

    if (canDim && brightness !== null) {
      const average = t('dashboard.cards.togetherCard.average', '{{value}}% average', {
        value: level.shown,
      });

      return withWarmth && white !== null ? `${average} · ${warmthOf(kelvin.shown)}` : average;
    }

    return view.changedAt === null
      ? ''
      : t('dashboard.cards.togetherCard.since', 'since {{time}}', {
          time: cardTime(view.changedAt),
        });
  };

  /**
   * The note beside the count: the caption, or - while some members cannot be reached - how many,
   * and "Turning on…" while a command is out.
   *
   * @param withWarmth - Whether the caption names the white.
   * @returns The note.
   */
  const note = (withWarmth = false) => (
    <CommandNote
      command={command}
      sending={
        command.sending === 'on_off'
          ? power.shown
            ? t('dashboard.cards.lightCard.turningOn', 'Turning on…')
            : t('dashboard.cards.lightCard.turningOff', 'Turning off…')
          : t('dashboard.cards.thermostatCard.setting', 'Setting…')
      }
    >
      {view.offline > 0 ? (
        <OfflineNote count={view.offline} />
      ) : (
        <Caption>{caption(withWarmth)}</Caption>
      )}
    </CommandNote>
  );

  /**
   * The count: how many are on of those that can be reached, Off when none is, a dash before any
   * has said.
   *
   * @param figureSize - How large the count is.
   * @param wordSize - How large Off is.
   * @returns The figure.
   */
  const figure = (figureSize: 26 | 30 | 36 | 40, wordSize: 22 | 30) =>
    !hasValue ? (
      <BigValue value="—" size={22} className="text-foreground-subtle" />
    ) : on.length === 0 ? (
      <BigValue
        value={t('dashboard.cards.lightCard.off', 'Off')}
        size={wordSize}
        className="text-foreground-subtle"
      />
    ) : (
      <BigValue
        value={String(on.length)}
        unit={t('dashboard.cards.togetherCard.ofOn', 'of {{count}} on', { count: counted.length })}
        size={figureSize}
        className={view.isOffline ? 'text-foreground-subtle' : undefined}
      />
    );
  const groupSwitch = (
    <span className="relative z-10 inline-flex items-center">
      <Switch
        label={view.title}
        size="medium"
        isOn={isOn}
        isBusy={command.sending === 'on_off'}
        disabled={!usableIn(view, 'on_off')}
        onChange={toggle}
      />
    </span>
  );
  const head = (
    <TogetherHead
      view={view}
      kind={togetherKind(view.card.domain)}
      isActive={on.length > 0}
      tail={groupSwitch}
    />
  );
  const marks = (
    <MemberMarks
      marks={sorted.map((member) => ({
        id: member.entity.entityId,
        icon: glyph,
        isOn: member.isAvailable && isOnOf(member),
      }))}
      lit={lit}
    />
  );
  const brightnessLabel = someOf(
    t('dashboard.cards.lightCard.brightness', 'Brightness'),
    dimmers.length,
    members.length,
  );

  /**
   * The brightness of every lamp that dims, as a bar.
   *
   * @param withValue - Whether the bar writes its value at its end, where there is room.
   * @returns The bar, or nothing when no member dims or none may be commanded.
   */
  const brightnessBar = (withValue: boolean) =>
    canDim && view.canControl ? (
      <BarSlider
        label={brightnessLabel}
        icon="sun"
        value={level.shown}
        display={withValue ? `${String(level.shown)}%` : undefined}
        look={{ fill: LAMP }}
        disabled={!usableIn(view, 'level')}
        onChange={level.hold}
        onCommit={(next) => {
          level.sent(next);
          command.send('level', { command: 'set_level', level: next });
        }}
      />
    ) : null;

  /**
   * One member's own small switch: it sends to that member only.
   *
   * @param member - The member.
   * @returns The switch, or nothing for someone who may only look.
   */
  const memberSwitch = (member: TogetherMember) =>
    view.canControl ? (
      <Switch
        label={member.entity.name}
        size="small"
        isOn={isOnOf(member)}
        disabled={!usableIn(view, 'on_off') || !member.isAvailable || !member.canControl}
        onChange={(next) => {
          command.sendEach('on_off', new Map([[member.entity.entityId, powerCommand(next)]]));
        }}
      />
    ) : undefined;

  /**
   * One member's row: its glyph lit when on, its name, its brightness when it is a lamp, its switch.
   *
   * @param member - The member.
   * @param height - How tall.
   * @returns The row.
   */
  const row = (member: TogetherMember, height: 'h-7.5' | 'h-8.5') => {
    const isMemberOn = member.isAvailable && isOnOf(member);

    return (
      <MemberRow
        key={member.entity.entityId}
        icon={glyph}
        iconClass={isMemberOn ? lit : 'text-foreground-subtle'}
        name={member.entity.name}
        isDim={!isMemberOn}
        value={isLight ? valueOf(member) : undefined}
        tail={memberSwitch(member)}
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
          <NoAnswer command={command} />
        ) : (
          <div className="flex min-w-0 items-end justify-between gap-2.5">
            {figure(26, 22)}
            {note()}
          </div>
        )}
      </CardFrame>
    );
  }

  if (size === '2x3') {
    const line = t('dashboard.cards.togetherCard.ofOnLine', '{{on}} of {{count}} on', {
      on: on.length,
      count: counted.length,
    });

    return (
      <CardFrame label={view.title} glow={glow}>
        <TogetherHead
          view={view}
          kind={togetherKind(view.card.domain)}
          isActive={on.length > 0}
          subtitle={
            <CommandNote
              command={command}
              sending={t('dashboard.cards.thermostatCard.setting', 'Setting…')}
            >
              {view.offline > 0
                ? `${line} · ${t('dashboard.cards.togetherCard.offline', '{{count}} offline', { count: view.offline })}`
                : line}
            </CommandNote>
          }
          tail={groupSwitch}
        />
        {canDim && view.canControl ? <div className="mt-3.5">{brightnessBar(true)}</div> : null}
        {today === undefined ? null : (
          <div className="mt-3.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2.5">
              <Caption>{t('dashboard.cards.switchCard.today', 'Today')}</Caption>
              <Caption className="text-foreground-muted">
                {t('dashboard.cards.switchCard.onFor', 'On {{time}}', {
                  time: hoursAndMinutes(today.onMs),
                })}
              </Caption>
            </div>
            <DayBlocks
              hours={today.hours}
              color={color}
              label={t('dashboard.cards.switchCard.lastDay', 'The last 24 hours')}
            />
          </div>
        )}
        <div className="mt-3.5 flex flex-col">
          <MemberList members={sorted} rows={6} height="h-8.5" command={command}>
            {(member) => row(member, 'h-8.5')}
          </MemberList>
        </div>
      </CardFrame>
    );
  }

  if (!canDim && size === '2x2') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head}
        <MembersBeside
          width="w-[170px]"
          left={
            <>
              {figure(36, 30)}
              {note()}
              {today === undefined ? null : (
                <div className="mt-auto flex flex-col gap-1.5">
                  <Caption>{t('dashboard.cards.switchCard.today', 'Today')}</Caption>
                  <DayBlocks
                    hours={today.hours}
                    color={color}
                    label={t('dashboard.cards.switchCard.lastDay', 'The last 24 hours')}
                  />
                </div>
              )}
            </>
          }
        >
          <MemberList members={sorted} rows={5} height="h-7.5" command={command}>
            {(member) => row(member, 'h-7.5')}
          </MemberList>
        </MembersBeside>
      </CardFrame>
    );
  }

  // What only switches, on the tall card: the round button for all, and the day.
  if (!canDim) {
    return (
      <CardFrame label={view.title} glow={glow}>
        <TogetherHead
          view={view}
          kind={togetherKind(view.card.domain)}
          isActive={on.length > 0}
          tail={view.canControl ? undefined : groupSwitch}
        />
        <div className="mt-3.5 flex min-w-0 items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            {figure(30, 30)}
            {note()}
          </div>
          {view.canControl ? (
            <PowerButton
              isOn={isOn}
              color={color}
              label={
                isOn
                  ? t('dashboard.cards.lightCard.turnOff', 'Turn off')
                  : t('dashboard.cards.lightCard.turnOn', 'Turn on')
              }
              disabled={!usableIn(view, 'on_off')}
              onPress={() => {
                toggle(!isOn);
              }}
            />
          ) : null}
        </div>
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : today === undefined ? null : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2.5">
              <Caption>{t('dashboard.cards.switchCard.today', 'Today')}</Caption>
              <Caption className="text-foreground-muted">
                {t('dashboard.cards.switchCard.onFor', 'On {{time}}', {
                  time: hoursAndMinutes(today.onMs),
                })}
              </Caption>
            </div>
            <DayBlocks
              hours={today.hours}
              color={color}
              label={t('dashboard.cards.switchCard.lastDay', 'The last 24 hours')}
            />
          </div>
        )}
      </CardFrame>
    );
  }

  if (size === '2x2') {
    return (
      <CardFrame label={view.title} glow={glow}>
        {head}
        <div className="mt-4 flex min-h-0 grow gap-5">
          <div className="flex w-[190px] shrink-0 flex-col gap-1.5">
            {figure(40, 30)}
            {note(true)}
            <div className="mt-auto">{marks}</div>
          </div>
          <div className="flex min-w-0 grow flex-col justify-end gap-2.5">
            {command.hasFailed ? (
              <NoAnswer command={command} />
            ) : (
              <>
                {brightnessBar(true)}
                <WhiteBar view={view} whites={whites} kelvin={kelvin} />
              </>
            )}
          </div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={view.title} glow={glow}>
      {head}
      <div className="mt-4 flex min-w-0 items-baseline justify-between gap-2.5">
        {figure(36, 30)}
        {note()}
      </div>
      <div className="mt-3.5">{marks}</div>
      <div className="grow" />
      {command.hasFailed ? <NoAnswer command={command} /> : brightnessBar(false)}
    </CardFrame>
  );
}

/**
 * Where a member is listed: on first, then off, then out of reach.
 *
 * @param member - The member.
 * @returns Its rank.
 */
function rankOf(member: TogetherMember): number {
  if (!member.isAvailable) {
    return 2;
  }

  return isOnOf(member) ? 0 : 1;
}

/**
 * A lamp's value in its row: its brightness, On for one that does not dim, Off, or Offline.
 *
 * @param member - The member.
 * @returns The value.
 */
function valueOf(member: TogetherMember): string {
  if (!member.isAvailable) {
    return translate('dashboard.cards.kit.offline', 'Offline');
  }

  if (!isOnOf(member)) {
    return translate('dashboard.cards.lightCard.off', 'Off');
  }

  return member.state.level === undefined
    ? translate('dashboard.cards.lightCard.on', 'On')
    : `${String(Math.round(member.state.level.level))}%`;
}

/**
 * A white's warmth in a word, small: "warm".
 *
 * @param kelvin - The white.
 * @returns The word.
 */
function warmthOf(kelvin: number): string {
  const word =
    kelvin < 3300
      ? translate('dashboard.cards.lightCard.warm', 'Warm')
      : kelvin < 5000
        ? translate('dashboard.cards.lightCard.neutral', 'Neutral')
        : translate('dashboard.cards.lightCard.cool', 'Cool');

  return word.toLocaleLowerCase();
}

/**
 * Renders the white of every lamp that takes one, as a bar from the warmest any takes to the
 * coolest; each is sent the white within its own range.
 *
 * @param props - The bar.
 * @param props.view - The card.
 * @param props.whites - The members that take a white.
 * @param props.kelvin - The white shown, and the hold while it is moved.
 * @returns The bar, or nothing when no member takes a white or none may be commanded.
 */
function WhiteBar(props: {
  readonly view: TogetherView;
  readonly whites: readonly TogetherMember[];
  readonly kelvin: PendingValue<number>;
}) {
  const { t } = useTranslation();

  const { view, whites, kelvin } = props;
  const ranges = whites.flatMap((member) => {
    const params = paramsOf(member.entity, 'color_temp');

    return params === null ? [] : [{ member, params }];
  });

  if (ranges.length === 0 || !view.canControl) {
    return null;
  }

  const warmest = Math.min(...ranges.map(({ params }) => miredsToKelvin(params.maxMireds)));
  const coolest = Math.max(...ranges.map(({ params }) => miredsToKelvin(params.minMireds)));
  const value = Math.min(coolest, Math.max(warmest, kelvin.shown === 0 ? warmest : kelvin.shown));

  return (
    <BarSlider
      label={someOf(
        t('dashboard.cards.lightCard.white', 'White'),
        ranges.length,
        view.members.length,
      )}
      value={value}
      min={warmest}
      max={coolest}
      step={STEP_KELVIN}
      display={kelvin.shown === 0 ? '—' : `${String(value)} K`}
      look={{ gradient: warmthGradient(warmest, coolest) }}
      disabled={!usableIn(view, 'color_temp')}
      onChange={kelvin.hold}
      onCommit={(next) => {
        kelvin.sent(next);
        view.command.sendEach(
          'color_temp',
          new Map(
            ranges
              .filter(({ member }) => member.isAvailable && member.canControl)
              .map(({ member, params }) => [
                member.entity.entityId,
                {
                  command: 'set_color_temp',
                  mireds: Math.min(
                    params.maxMireds,
                    Math.max(params.minMireds, kelvinToMireds(next)),
                  ),
                },
              ]),
          ),
        );
      }}
    />
  );
}
