/**
 * A cover, as the canvas draws it (`N-Entity-Modal-Cover`, `N-Entity-Cover-More`): a picture of
 * what it covers - a window with its blind, a garage door, curtains drawn from the sides - beside
 * its controls. The picture follows the device class; the controls follow what the cover can do:
 *
 * - open and close only: three wide buttons, and a line saying it knows no more than that;
 * - a position: a vertical bar beside the picture, the percentage, round buttons, and quick
 *   positions under it (a curtain's bar runs sideways, as it opens);
 * - a tilt: the slat angle, as a row of slats; alone, it is the whole control.
 *
 * While it moves, Stop comes first.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { RoundAction, useSinceLine } from '@/routes/library/entity/sheet/parts/sheet-controls';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The device classes drawn as a door rather than a window. */
const DOORS = new Set(['garage', 'gate', 'door']);

/** What the picture needs. */
type PictureProps = {
  /** How open it is, 0 to 100. */
  readonly position: number;

  /** The slats' angle in degrees, when it tilts. */
  readonly tilt: number | null;

  /** Its device class. */
  readonly deviceClass: string | null;

  /** Whether it tilts only, with no position. */
  readonly isTiltOnly: boolean;
};

/**
 * The picture of what the cover covers.
 *
 * @param props - See {@link PictureProps}.
 * @returns The picture.
 */
function CoverPicture(props: PictureProps) {
  const { position, tilt, deviceClass, isTiltOnly } = props;
  const closed = 100 - position;

  if (DOORS.has(deviceClass ?? '')) {
    return (
      <div
        aria-hidden="true"
        className="relative h-58 w-42 shrink-0 overflow-hidden rounded-card border-3 border-[#2d3352] bg-linear-to-b from-[#151a30] to-[#10142a] shadow-[0_24px_60px_-16px_color-mix(in_oklab,var(--color-lamp)_20%,transparent)]"
      >
        <span className="absolute inset-x-3.5 top-6.5 bottom-0 bg-linear-to-b from-[#0a0c16] via-[#2a2210] via-78% to-[#4a3814]" />
        <span className="absolute inset-x-8.5 bottom-2.5 h-6.5 rounded-t-[10px] rounded-b-[4px] bg-[#1b2038]" />
        <span
          className="absolute inset-x-3.5 top-6.5 bg-[repeating-linear-gradient(180deg,#4a5287_0_2px,#3a4170_2px_22px,#262b45_22px_24px)] shadow-[0_8px_16px_rgb(0_0_0/0.5)] transition-[height] duration-500"
          // eslint-disable-next-line react/forbid-dom-props -- the door comes down as far as it is closed
          style={{ height: `calc(${String(closed)}% - ${String((closed / 100) * 26)}px)` }}
        />
        <span className="absolute inset-x-2 top-4 h-2.5 rounded-[4px] bg-[#2d3352]" />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="relative h-58 w-42 shrink-0 overflow-hidden rounded-card border-3 border-[#2d3352] bg-linear-to-b from-[#24306b] via-[#5a4aa8] via-48% to-[#ffb36b] shadow-[0_24px_60px_-14px_rgb(255_150_110/0.32),inset_0_0_0_1px_rgb(255_255_255/0.05)]"
    >
      <span className="absolute top-[70%] left-[58%] size-11.5 rounded-full bg-[radial-gradient(circle,#ffe0a8_0%,rgb(255_179_107/0.6)_45%,rgb(255_179_107/0)_72%)]" />
      <span className="absolute inset-x-[-10%] -bottom-4 h-11 rounded-t-[50%] bg-[#1a1d3a]" />
      {deviceClass === 'curtain' ? (
        <>
          {(['left-0', 'right-0'] as const).map((side) => (
            <span
              key={side}
              className={cn(
                'absolute inset-y-0 bg-[repeating-linear-gradient(90deg,#6b4a8f_0_8px,#563a78_8px_16px)] transition-[width] duration-500',
                side,
                side === 'left-0'
                  ? 'shadow-[6px_0_12px_rgb(0_0_0/0.4)]'
                  : 'shadow-[-6px_0_12px_rgb(0_0_0/0.4)]',
              )}
              // eslint-disable-next-line react/forbid-dom-props -- each half covers half of what is closed
              style={{ width: `${String(closed / 2)}%` }}
            />
          ))}
          <span className="absolute inset-x-0 top-0 h-1.5 bg-[#2d3352]" />
        </>
      ) : isTiltOnly ? (
        [...Array.from({ length: 12 }).keys()].map((index) => (
          <span
            key={index}
            className="absolute inset-x-1.5 h-2.25 rounded-[2px] bg-linear-to-b from-[#5a63a0] to-[#343b6a] shadow-[0_3px_4px_rgb(0_0_0/0.35)] transition-transform duration-500"
            // eslint-disable-next-line react/forbid-dom-props -- the slats turn to the cover's angle
            style={{
              top: `${String(8 + index * 18)}px`,
              transform: `perspective(200px) rotateX(${String(tilt ?? 0)}deg)`,
            }}
          />
        ))
      ) : (
        <>
          <span className="absolute inset-y-0 left-1/2 -ml-px w-0.5 bg-[rgb(12_14_25/0.5)]" />
          <span className="absolute inset-x-0 top-1/2 -mt-px h-0.5 bg-[rgb(12_14_25/0.5)]" />
          <div
            className={cn(
              'absolute inset-x-0 top-0 transition-[height] duration-500',
              tilt === null
                ? 'bg-[repeating-linear-gradient(180deg,#4a5287_0_2px,#343b6a_2px_10px,#1b1f35_10px_12px)] shadow-[0_6px_14px_rgb(0_0_0/0.45)]'
                : 'bg-[repeating-linear-gradient(180deg,#4a5287_0_2px,#343b6a_2px_6px,transparent_6px_12px)] shadow-[0_6px_14px_rgb(0_0_0/0.35)]',
            )}
            // eslint-disable-next-line react/forbid-dom-props -- the blind comes down as far as it is closed
            style={{ height: `${String(closed)}%` }}
          />
          <div
            className="absolute -inset-x-0.5 h-2 rounded-[3px] bg-linear-to-b from-[#6b74b0] to-[#3a4170] shadow-[0_3px_8px_rgb(0_0_0/0.5)] transition-[top] duration-500"
            // eslint-disable-next-line react/forbid-dom-props -- the bar at the foot of the blind
            style={{ top: `calc(${String(closed)}% - 4px)` }}
          />
        </>
      )}
    </div>
  );
}

/** What the slat row needs. */
type SlatsProps = {
  readonly degrees: number;
  readonly range: 90 | 180;
  readonly onChange: (degrees: number) => void;
  readonly onCommit: (degrees: number) => void;
  readonly disabled: boolean;
  readonly label: string;
};

/**
 * The slat angle, as a row of slats turned to it.
 *
 * @param props - See {@link SlatsProps}.
 * @returns The control.
 */
function SlatAngle(props: SlatsProps) {
  const { t } = useTranslation();
  const { degrees, range, onChange, onCommit, disabled, label } = props;
  const count = 11;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-ui">{label}</span>
        <span className="font-mono text-mono-caption text-foreground-muted">
          {t('entity.sheet.cover.degrees', '{{value}}°', { value: Math.round(degrees) })}
        </span>
      </div>
      <div className="relative h-11 overflow-hidden rounded-inner border border-border-strong bg-surface-raised">
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-around px-3.5"
        >
          {[...Array.from({ length: count }).keys()].map((index) => {
            const angle = range === 90 ? -60 + index * 12 : index * 18;
            const isLit =
              range === 90
                ? index <= Math.round((degrees / 90) * (count - 1))
                : index === Math.round((degrees / 180) * (count - 1));

            return (
              <span
                key={index}
                className={cn('h-6.5 w-0.75 rounded-[2px]', isLit ? 'bg-primary' : 'bg-[#2d3352]')}
                // eslint-disable-next-line react/forbid-dom-props -- each slat at its own angle
                style={{ transform: `rotate(${String(angle)}deg)` }}
              />
            );
          })}
        </div>
        <input
          type="range"
          min={0}
          max={range}
          value={degrees}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
          onPointerUp={(event) => {
            onCommit(Number(event.currentTarget.value));
          }}
          className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-foreground-subtle">
        <span>{t('entity.sheet.cover.closed', 'Closed')}</span>
        <span>{t('entity.sheet.cover.open', 'Open')}</span>
        {range === 180 ? <span>{t('entity.sheet.cover.closed', 'Closed')}</span> : null}
      </div>
    </div>
  );
}

/**
 * The body of a cover.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function CoverBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, reportedAt, history } = props;
  const since = useSinceLine(entity, history);
  const params = paramsOf(entity, 'cover');
  const position = usePendingValue(state.cover?.position ?? 0, reportedAt);
  const tilt = usePendingValue(state.cover?.tilt ?? 0, reportedAt);
  const cover = state.cover;

  if (cover === undefined || params === null) {
    return null;
  }

  const hasPosition = params.hasPosition;
  const hasTilt = params.hasTilt;
  const isTiltOnly = hasTilt && !hasPosition;
  const isMoving = cover.motion !== 'stopped';
  const isCurtain = entity.deviceClass === 'curtain';
  const shown = Math.round(position.shown);
  const degrees = Math.round((tilt.shown / 100) * 90);
  const word =
    cover.motion === 'opening'
      ? t('entity.sheet.cover.opening', 'Opening')
      : cover.motion === 'closing'
        ? t('entity.sheet.cover.closing', 'Closing')
        : cover.position === 0
          ? t('entity.sheet.cover.closed', 'Closed')
          : t('entity.sheet.cover.open', 'Open');

  /**
   * Sends one of the cover's commands.
   *
   * @param command - The command, with what it takes.
   */
  const send = (command: Record<string, string | number>): void => {
    commander.send('cover', command);
  };

  /**
   * Moves the cover to a position.
   *
   * @param next - The position.
   */
  const moveTo = (next: number): void => {
    position.sent(next);
    send({ command: 'set_position', position: next });
  };

  /**
   * Does what a round button says: open, stop or close - the slats, on a cover that only tilts.
   *
   * @param key - Which button.
   */
  const perform = (key: string): void => {
    if (key === 'stop' || !isTiltOnly) {
      send({ command: key });

      return;
    }

    const next = key === 'open' ? 100 : 0;

    tilt.sent(next);
    send({ command: 'set_tilt', tilt: next });
  };

  const actions: { key: string; icon: UiIconId; label: string }[] = [
    {
      key: 'open',
      icon: isCurtain ? 'chevrons-left-right' : 'chevron-up',
      label: isTiltOnly
        ? t('entity.sheet.cover.openSlats', 'Open slats')
        : t('entity.sheet.cover.openAction', 'Open'),
    },
    {
      key: 'stop',
      icon: 'square',
      label: t('entity.sheet.cover.stop', 'Stop'),
    },
    {
      key: 'close',
      icon: isCurtain ? 'chevrons-right-left' : 'chevron-down',
      label: isTiltOnly
        ? t('entity.sheet.cover.closeSlats', 'Close slats')
        : t('entity.sheet.cover.closeAction', 'Close'),
    },
  ];
  // While it moves, the way to stop it is the first thing under the finger.
  const ordered = isMoving
    ? [actions[1], actions[0], actions[2]].filter((action) => action !== undefined)
    : actions;
  const picture = (
    <CoverPicture
      position={isTiltOnly ? 100 : shown}
      tilt={hasTilt ? degrees : null}
      deviceClass={entity.deviceClass}
      isTiltOnly={isTiltOnly}
    />
  );

  if (!hasPosition && !hasTilt) {
    return (
      <div className="flex grow flex-col justify-center gap-4.5">
        <div className="flex items-stretch gap-5">
          {picture}
          <div className="flex min-w-0 grow flex-col justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[28px] font-medium tracking-[-0.02em]">{word}</span>
              <span className="text-ui-sm leading-[1.45] text-foreground-subtle">{since}</span>
            </div>
            <div className="flex flex-col gap-2">
              {ordered.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  aria-label={action.label}
                  disabled={disabled}
                  onClick={() => {
                    perform(action.key);
                  }}
                  className="inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-card border border-border-strong bg-surface-raised px-3.5 text-ui font-medium text-foreground disabled:cursor-not-allowed"
                >
                  <AppIcon id={action.icon} size={17} />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
          {t(
            'entity.sheet.cover.onlyOpenClosed',
            'This cover only knows open and closed, not how far.',
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex grow flex-col justify-center gap-4.5">
      <div className="flex items-stretch gap-4">
        {picture}
        {hasPosition && !isCurtain ? (
          <div className="relative w-11 shrink-0 overflow-hidden rounded-card border border-border-strong bg-surface-raised">
            <div
              className="absolute inset-x-0 top-0 bg-linear-to-b from-primary/25 to-primary/60"
              // eslint-disable-next-line react/forbid-dom-props -- the bar fills from the top as far as it is closed
              style={{ height: `${String(100 - shown)}%` }}
            />
            <span
              className="absolute inset-x-2.25 h-1.5 rounded-pill bg-knob shadow-[0_0_12px_color-mix(in_oklab,var(--color-primary)_80%,transparent)]"
              // eslint-disable-next-line react/forbid-dom-props -- the handle at the foot of the blind
              style={{ top: `calc(${String(100 - shown)}% - 3px)` }}
            />
            <input
              type="range"
              min={0}
              max={100}
              value={shown}
              disabled={disabled}
              aria-label={t('entity.sheet.cover.position', 'Position')}
              aria-orientation="vertical"
              onChange={(event) => {
                position.hold(Number(event.target.value));
              }}
              onPointerUp={(event) => {
                moveTo(Number(event.currentTarget.value));
              }}
              className="absolute inset-0 m-0 size-full cursor-pointer opacity-0 [direction:rtl] [writing-mode:vertical-lr]"
            />
          </div>
        ) : null}
        <div className="flex min-w-0 grow flex-col justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[40px] leading-none font-medium tracking-[-0.04em] tabular">
              {isTiltOnly
                ? t('entity.sheet.cover.degrees', '{{value}}°', { value: degrees })
                : hasPosition
                  ? t('entity.sheet.percent', '{{value}}%', { value: shown })
                  : word}
            </span>
            <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
              {isTiltOnly
                ? t('entity.sheet.cover.tiltOnly', 'Slats at {{value}}° · tilt only', {
                    value: degrees,
                  })
                : isMoving && !hasPosition
                  ? since
                  : [
                      word,
                      hasTilt
                        ? t('entity.sheet.cover.slatsAt', 'slats at {{value}}°', { value: degrees })
                        : isCurtain
                          ? t('entity.sheet.cover.curtain', 'curtain')
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {ordered.map((action) => (
              <RoundAction
                key={action.key}
                icon={action.icon}
                label={action.label}
                size="medium"
                disabled={disabled}
                onClick={() => {
                  perform(action.key);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {hasPosition && isCurtain ? (
        <div className="relative h-11 overflow-hidden rounded-inner border border-border-strong bg-surface-raised">
          <span
            className="absolute inset-y-0 left-0 bg-linear-to-r from-primary/20 to-primary/60"
            // eslint-disable-next-line react/forbid-dom-props -- the bar fills as far as it is open
            style={{ width: `${String(shown)}%` }}
          />
          <span
            className="absolute inset-y-2.5 w-1.5 rounded-pill bg-knob"
            // eslint-disable-next-line react/forbid-dom-props -- the handle at the curtain's edge
            style={{ left: `calc(${String(shown)}% - 3px)` }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={shown}
            disabled={disabled}
            aria-label={t('entity.sheet.cover.position', 'Position')}
            onChange={(event) => {
              position.hold(Number(event.target.value));
            }}
            onPointerUp={(event) => {
              moveTo(Number(event.currentTarget.value));
            }}
            className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
          />
        </div>
      ) : null}

      {hasTilt ? (
        <SlatAngle
          label={t('entity.sheet.cover.slatAngle', 'Slat angle')}
          degrees={isTiltOnly ? Math.round(tilt.shown * 1.8) : degrees}
          range={isTiltOnly ? 180 : 90}
          disabled={disabled}
          onChange={(next) => {
            tilt.hold(isTiltOnly ? next / 1.8 : next / 0.9);
          }}
          onCommit={(next) => {
            const value = Math.round(isTiltOnly ? next / 1.8 : next / 0.9);

            tilt.sent(value);
            send({ command: 'set_tilt', tilt: value });
          }}
        />
      ) : null}

      {hasPosition && !hasTilt ? (
        <div className="grid grid-cols-4 gap-2">
          {[0, 25, 50, 100].map((each) => (
            <button
              key={each}
              type="button"
              disabled={disabled}
              onClick={() => {
                moveTo(each);
              }}
              className={cn(
                'h-9 cursor-pointer rounded-tile border px-3 text-ui-sm font-medium tabular disabled:cursor-not-allowed',
                shown === each
                  ? 'border-primary/50 bg-primary/12 text-primary'
                  : 'border-border-strong bg-surface-raised text-foreground',
              )}
            >
              {each === 0
                ? t('entity.sheet.cover.closed', 'Closed')
                : each === 100
                  ? t('entity.sheet.cover.open', 'Open')
                  : t('entity.sheet.percent', '{{value}}%', { value: each })}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
