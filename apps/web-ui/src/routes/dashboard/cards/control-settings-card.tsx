/**
 * A setting of a device, as a card: a choice from a list, a number, a button, a firmware update.
 *
 * Each is one tile - the name, and under it the one control it is - and a choice, a number and an
 * update also a strip, the name at the left and the control taking the rest: a choice's every
 * option in sight, a number's bar between its limits, an install's progress.
 *
 * A press that cannot be taken back asks first, as the entity dialog does: a button that restarts
 * the device or stops what it is doing, and a firmware install, which restarts it.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isUpdateOffered } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { paramsOf } from '@/library/entity-control';
import {
  BarSlider,
  Caption,
  CardHead,
  CommandNote,
  NoAnswer,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  AskFirst,
  MidValue,
  PillButton,
  RoundButton,
} from '@/routes/dashboard/cards/control-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';
import { asksBeforePress } from '@/routes/library/entity/controls/button-control';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** Past this many choices a strip draws a dropdown rather than every choice in a row. */
const SEGMENTED_OPTIONS = 5;

/** Units a number counts time in: its bar is a duration. */
const TIME_UNITS: ReadonlySet<string> = new Set(['s', 'min', 'h', 'd', 'ms']);

/**
 * Renders a strip's two halves: the head at the left, 200 px wide, and the control filling the rest.
 *
 * @param props - The two halves.
 * @param props.head - The card's head.
 * @param props.gap - The space between them: 16 px for a choice, 20 px for an update.
 * @param props.children - The control.
 * @returns The row.
 */
function StripRow(props: {
  readonly head: ReactNode;
  readonly gap: 'gap-4' | 'gap-5';
  readonly children: ReactNode;
}) {
  const { head, gap, children } = props;

  return (
    <div className={cn('flex h-full min-w-0 items-center', gap)}>
      <div className="w-[200px] shrink-0">{head}</div>
      {children}
    </div>
  );
}

/**
 * Renders a choice from a list: a dropdown on the tile, every choice in a row on the strip.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function SelectCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, command, reportedAt } = model;
  const options = paramsOf(entity, 'select')?.options ?? [];
  const option = usePendingValue(state.select?.option ?? '', reportedAt);
  const known = options.find((each) => each.value === option.shown);
  const shown = option.shown === '' ? '—' : (known?.label ?? option.shown);
  const canPick = canUse(model, 'select') && options.length > 0;
  const head = <CardHead model={model} isActive={null} tail={null} />;

  /**
   * Picks one of the choices.
   *
   * @param next - Its value.
   */
  const pick = (next: string): void => {
    option.sent(next);
    command.send('select', { command: 'select_option', option: next });
  };

  const value = (
    <span
      className={cn(
        'truncate text-title font-medium transition-colors duration-200',
        model.isOffline || option.shown === '' ? 'text-foreground-subtle' : 'text-foreground',
      )}
    >
      {shown}
    </span>
  );
  const dropdown = (
    <div
      className={cn(
        'relative flex h-8 w-full shrink-0 items-center justify-between gap-2 rounded-field border border-border-strong bg-surface-raised px-3 text-ui',
        'transition-opacity duration-200 has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-primary',
        !canPick && 'opacity-40',
      )}
    >
      <span
        className={cn(
          'truncate whitespace-nowrap',
          option.shown === '' ? 'text-foreground-subtle' : 'text-foreground',
        )}
      >
        {shown}
      </span>
      {command.sending === 'select' ? (
        <span className="inline-flex shrink-0 animate-spin text-cyan">
          <AppIcon id="loader-circle" size={14} />
        </span>
      ) : (
        <AppIcon id="chevron-down" size={14} className="shrink-0 text-foreground-subtle" />
      )}
      {/* The browser's own list over the drawing: the pointer, the keyboard and a screen reader. */}
      <select
        aria-label={title}
        value={option.shown}
        disabled={!canPick}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
        onChange={(event) => {
          if (options.some((each) => each.value === event.target.value)) {
            pick(event.target.value);
          }
        }}
      >
        {known === undefined ? <option value={option.shown}>{shown}</option> : null}
        {options.map((each) => (
          <option key={each.value} value={each.value}>
            {each.label}
          </option>
        ))}
      </select>
    </div>
  );

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        {command.hasFailed ? <NoAnswer command={command} /> : model.canControl ? dropdown : value}
      </CardFrame>
    );
  }

  const isRow = options.length > 0 && options.length <= SEGMENTED_OPTIONS;

  return (
    <CardFrame label={title}>
      <StripRow head={head} gap="gap-4">
        <div className="flex min-w-0 grow justify-end">
          {command.hasFailed ? (
            <div className="min-w-0 grow">
              <NoAnswer command={command} />
            </div>
          ) : !model.canControl ? (
            value
          ) : isRow ? (
            <div
              role="radiogroup"
              aria-label={title}
              className={cn(
                'flex grow gap-1 rounded-pill border border-border-strong bg-surface p-1 transition-opacity duration-200',
                !canPick && 'opacity-40',
              )}
            >
              {options.map((each) => {
                const isChosen = each.value === option.shown;

                return (
                  <button
                    key={each.value}
                    type="button"
                    role="radio"
                    aria-checked={isChosen}
                    disabled={!canPick}
                    className={cn(
                      'flex h-7 min-w-0 flex-1 items-center justify-center rounded-pill px-1.5 text-ui-sm whitespace-nowrap',
                      'transition-colors duration-200 disabled:cursor-default',
                      isChosen
                        ? 'bg-surface-high font-medium text-foreground'
                        : 'text-foreground-muted hover:enabled:text-foreground',
                    )}
                    onClick={() => {
                      if (!isChosen) {
                        pick(each.value);
                      }
                    }}
                  >
                    {each.label}
                  </button>
                );
              })}
            </div>
          ) : (
            dropdown
          )}
        </div>
      </StripRow>
    </CardFrame>
  );
}

/**
 * Rounds away what adding a step in floating point leaves behind: 0.1 + 0.2 is 0.3.
 *
 * @param value - The sum.
 * @returns It, to a millionth.
 */
function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Renders a number within limits: a stepper on the tile, a bar between its limits on the strip.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function NumberCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command, reportedAt } = model;
  const params = paramsOf(entity, 'number');
  const reported = state.number?.value ?? null;
  const value = usePendingValue(reported ?? params?.min ?? 0, reportedAt);
  const unit = entity.unitOfMeasurement;
  const canSet = canUse(model, 'number') && params !== null;
  const head = <CardHead model={model} isActive={null} tail={null} />;

  /**
   * Writes a figure in the reader's way.
   *
   * @param amount - The number.
   * @returns "15", "0.5".
   */
  const figure = (amount: number): string =>
    numberFormat({ maximumFractionDigits: 2 }).format(amount);

  /**
   * Writes a figure with the entity's unit.
   *
   * @param amount - The number.
   * @returns "30 min", "90°".
   */
  const withUnit = (amount: number): string =>
    unit === null || unit === ''
      ? figure(amount)
      : unit === '°' || unit === '%'
        ? `${figure(amount)}${unit}`
        : `${figure(amount)} ${unit}`;

  /**
   * Sends a new value, kept within the limits.
   *
   * @param next - It.
   */
  const set = (next: number): void => {
    if (params === null) {
      return;
    }

    const kept = tidy(Math.min(params.max, Math.max(params.min, next)));

    value.sent(kept);
    command.send('number', { command: 'set_value', value: kept });
  };

  if (sizeKey(model.size) === '1x1') {
    const reading = (
      <span
        className={cn(
          'truncate text-title font-medium tracking-[-0.02em] tabular-nums transition-colors duration-200',
          model.isOffline || reported === null ? 'text-foreground-subtle' : 'text-foreground',
        )}
      >
        {reported === null ? '—' : withUnit(value.shown)}
      </span>
    );

    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : (
          <div
            className={cn(
              'flex h-8 shrink-0 items-center gap-2 rounded-tile bg-surface-raised px-1',
              model.canControl && params !== null ? 'justify-between' : 'justify-center',
            )}
          >
            {model.canControl && params !== null ? (
              <>
                <RoundButton
                  size={24}
                  icon="minus"
                  label={t('dashboard.cards.number.lower', 'Lower')}
                  disabled={!canSet || value.shown <= params.min}
                  onPress={() => {
                    set(value.shown - params.step);
                  }}
                />
                {reading}
                <RoundButton
                  size={24}
                  icon="plus"
                  label={t('dashboard.cards.number.raise', 'Raise')}
                  disabled={!canSet || value.shown >= params.max}
                  onPress={() => {
                    set(value.shown + params.step);
                  }}
                />
              </>
            ) : (
              reading
            )}
          </div>
        )}
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      <div className="flex h-full min-w-0 gap-5">
        <div className="flex w-[200px] shrink-0 flex-col justify-between">
          {head}
          <MidValue
            value={reported === null ? '—' : figure(value.shown)}
            unit={reported === null || unit === '°' || unit === '%' ? null : unit}
            className={model.isOffline || reported === null ? 'text-foreground-subtle' : undefined}
          />
        </div>
        <div className="flex min-w-0 grow flex-col justify-end gap-1.5">
          {command.hasFailed ? (
            <NoAnswer command={command} />
          ) : model.canControl && params !== null ? (
            <>
              <BarSlider
                label={
                  unit !== null && TIME_UNITS.has(unit)
                    ? t('dashboard.cards.number.duration', 'Duration')
                    : t('dashboard.cards.number.value', 'Value')
                }
                value={value.shown}
                min={params.min}
                max={params.max}
                step={params.step}
                look={{ fill: 'var(--color-primary)' }}
                disabled={!canSet}
                onChange={value.hold}
                onCommit={set}
              />
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <CommandNote
                  command={command}
                  sending={t('dashboard.cards.number.setting', 'Setting…')}
                >
                  <Caption>{withUnit(params.min)}</Caption>
                </CommandNote>
                <Caption>{withUnit(params.max)}</Caption>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * Renders a button: its name, and Press.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function ButtonCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, title, command } = model;
  const [isAsking, setAsking] = useState(false);
  const asksFirst = asksBeforePress(entity);

  /** Sends the press. */
  const press = (): void => {
    setAsking(false);
    command.send('button', { command: 'press' });
  };

  // A button holds no state, so no report answers a press: the card never says "Did not answer"
  // for one. A refused press is said in a toast by the command path.
  return (
    <CardFrame label={title}>
      <CardHead model={model} isActive={null} tail={null} />
      <div className="grow" />
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        <CommandNote command={command} sending={t('dashboard.cards.button.pressing', 'Pressing…')}>
          <Caption>
            {model.isOffline && model.changedAt !== null
              ? t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
                  time: cardTime(model.changedAt),
                })
              : ''}
          </Caption>
        </CommandNote>
        {model.canControl ? (
          <PillButton
            label={t('entity.controls.buttonControl.press', 'Press')}
            disabled={!canUse(model, 'button')}
            onPress={() => {
              if (asksFirst) {
                setAsking(true);
              } else {
                press();
              }
            }}
          />
        ) : null}
      </div>
      {asksFirst ? (
        <AskFirst
          isOpen={isAsking}
          title={t('entity.controls.buttonControl.pressName', 'Press {{name}}?', { name: title })}
          description={
            entity.deviceClass === 'restart'
              ? t(
                  'entity.controls.buttonControl.deviceRestartsAndIs',
                  'The device restarts, and is offline until it is back.',
                )
              : t(
                  'entity.controls.buttonControl.whatTheDeviceIs',
                  'What the device is doing stops, and cannot be picked up again.',
                )
          }
          confirm={t('entity.controls.buttonControl.press', 'Press')}
          onClose={() => {
            setAsking(false);
          }}
          onConfirm={press}
        />
      ) : null}
    </CardFrame>
  );
}

/**
 * Renders a device's firmware: the versions and Install on the tile, the install's progress on the
 * strip.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function UpdateCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command } = model;
  const [isAsking, setAsking] = useState(false);
  const firmware = state.update;
  const canInstall = paramsOf(entity, 'update')?.canInstall ?? true;
  const isInstalling = firmware?.isInstalling === true;
  const isOffered = firmware !== undefined && isUpdateOffered(firmware);
  const progress = firmware?.progress ?? null;
  const latest = firmware?.latestVersion ?? '';
  const head = <CardHead model={model} isActive={null} tail={null} />;

  /** Sends the install. */
  const install = (): void => {
    setAsking(false);
    command.send('update', { command: 'install' });
  };

  const versions = (
    <span
      className={cn(
        'truncate font-mono text-ui-sm whitespace-nowrap',
        model.isOffline ? 'text-foreground-subtle' : 'text-foreground-muted',
      )}
    >
      {firmware?.installedVersion ?? '—'}
      {isOffered ? (
        <>
          {' '}
          <span className="text-foreground-subtle">→</span>{' '}
          <span className="text-cyan">{latest}</span>
        </>
      ) : null}
    </span>
  );
  const installButton =
    model.canControl && canInstall && isOffered && !isInstalling ? (
      <PillButton
        label={t('entity.controls.updateControl.install', 'Install')}
        tone="primary"
        disabled={!canUse(model, 'update')}
        onPress={() => {
          setAsking(true);
        }}
      />
    ) : null;
  const percent = progress === null ? '…' : `${String(Math.round(progress))}%`;
  const bar = (
    <div
      role="progressbar"
      aria-label={t('entity.controls.updateControl.firmwareUpdate', 'Firmware update')}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(progress === null ? {} : { 'aria-valuenow': Math.round(progress) })}
      className="h-1.5 shrink-0 overflow-hidden rounded-pill bg-surface-high"
    >
      <div
        className={
          progress === null
            ? 'h-full w-1/3 animate-pulse rounded-pill bg-cyan'
            : 'h-full rounded-pill bg-cyan transition-[width] duration-500'
        }
        /* eslint-disable-next-line react/forbid-dom-props -- how far the install got is a live
        value, not a token (RULES.md 15.3). */
        style={progress === null ? undefined : { width: `${String(progress)}%` }}
      />
    </div>
  );
  const sending = t('dashboard.cards.update.starting', 'Starting the install…');
  const question = (
    <AskFirst
      isOpen={isAsking}
      title={t(
        'entity.controls.updateControl.installTheFirmwareUpdate',
        'Install the firmware update?',
      )}
      description={t(
        'entity.controls.updateControl.deviceDownloadsTheUpdate',
        'The device downloads the update and restarts to install it. It is offline for a minute or two, and whatever it switches may turn off meanwhile.',
      )}
      confirm={t('entity.controls.updateControl.install', 'Install')}
      onClose={() => {
        setAsking(false);
      }}
      onConfirm={install}
    />
  );
  const upToDate = t('dashboard.cards.update.upToDate', 'Up to date');

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : isInstalling ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-0 grow">{bar}</div>
            <Caption className="text-foreground">{percent}</Caption>
          </div>
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            <CommandNote command={command} sending={sending}>
              {versions}
            </CommandNote>
            {installButton ??
              (isOffered || firmware === undefined ? null : <Caption>{upToDate}</Caption>)}
          </div>
        )}
        {question}
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      <StripRow head={head} gap="gap-5">
        <div className="flex min-w-0 grow flex-col gap-2">
          {command.hasFailed ? (
            <NoAnswer command={command} />
          ) : isInstalling ? (
            <>
              <div className="flex min-w-0 items-baseline justify-between gap-2.5">
                <span className="truncate text-ui font-medium">
                  {t('dashboard.cards.update.installing', 'Installing {{version}}', {
                    version: latest,
                  })}
                </span>
                <Caption className="text-foreground">{percent}</Caption>
              </div>
              {bar}
              <Caption>{t('dashboard.cards.update.keepItPowered', 'Keep it powered')}</Caption>
            </>
          ) : (
            <div className="flex min-w-0 items-center justify-between gap-2.5">
              <div className="flex min-w-0 flex-col gap-1">
                <CommandNote command={command} sending={sending}>
                  <span className="truncate text-ui font-medium">
                    {isOffered
                      ? t('dashboard.cards.update.available', '{{version}} available', {
                          version: latest,
                        })
                      : firmware === undefined
                        ? '—'
                        : upToDate}
                  </span>
                </CommandNote>
                {versions}
              </div>
              {installButton}
            </div>
          )}
        </div>
      </StripRow>
      {question}
    </CardFrame>
  );
}
