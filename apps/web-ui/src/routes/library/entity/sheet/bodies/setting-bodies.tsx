/**
 * The simple ones, as the canvas draws them: a select (`N-Entity-Select-List`, `-More`), a number
 * (`N-Entity-Number-Slider`, `-More`), a button (`N-Entity-Button-Basic`, `-More`) and a camera
 * (`N-Entity-Camera-Live`, `-More`). One value, one action, or one picture.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { hasCapability, paramsOf } from '@/library/entity-control';
import { useCameraStill } from '@/routes/dashboard/cards/use-camera-still';
import { clockText } from '@/routes/library/entity/sheet/history';
import { HoldAction } from '@/routes/library/entity/sheet/parts/hold-action';
import { OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import {
  RoundAction,
  ThinSlider,
  useSinceLine,
} from '@/routes/library/entity/sheet/parts/sheet-controls';
import {
  BigSwitch,
  MonoLabel,
  SendingSpinner,
} from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/**
 * A radio row: one option of a select, its ring filled when it is the one.
 *
 * @param props - The option, whether it is chosen, and what picking it does.
 * @param props.label - The option.
 * @param props.isChosen - Whether it is the one chosen.
 * @param props.onPick - Picks it.
 * @param props.isTall - Whether it is a row of a short list (52 px) or a long one (46 px).
 * @param props.disabled - Whether it cannot be picked now.
 * @returns The row.
 */
function RadioRow(props: {
  label: string;
  isChosen: boolean;
  onPick: () => void;
  isTall: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.isChosen}
      disabled={props.disabled}
      onClick={props.onPick}
      className={cn(
        'press flex shrink-0 cursor-pointer items-center gap-3 border px-3.5 text-left text-foreground',
        'transition-colors duration-200 disabled:cursor-not-allowed',
        props.isTall ? 'h-13 rounded-inner text-title' : 'h-12 rounded-tile text-ui',
        props.isChosen
          ? 'border-violet/45 bg-violet/8'
          : 'border-border bg-surface-raised/40 hover:border-border-strong hover:bg-surface-raised',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-4.5 shrink-0 rounded-full transition-[border-width,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
          props.isChosen
            ? 'border-[5px] border-violet'
            : 'border-[1.5px] border-foreground-disabled',
        )}
      />
      <span className="grow truncate">{props.label}</span>
    </button>
  );
}

/**
 * The body of a select: two or three as a segmented row under the choice in words, up to eight
 * as a list, more with a search, the one chosen pinned over all of them.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function SelectBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, history } = props;
  const since = useSinceLine(entity, history);
  const [search, setSearch] = useState('');
  const options = paramsOf(entity, 'select')?.options ?? [];
  const chosen = state.select?.option ?? null;
  const chosenLabel = options.find((option) => option.value === chosen)?.label ?? chosen;
  const isSending = commander.busy.has('select');

  /**
   * Picks an option.
   *
   * @param option - Its value.
   */
  const pick = (option: string): void => {
    commander.send('select', { command: 'select_option', option });
  };

  if (options.length <= 3) {
    return (
      <div className="flex grow flex-col justify-center gap-4.5">
        <div className="flex flex-col gap-1.5 pt-1.5">
          <span className="flex items-center gap-2 text-[26px] font-medium tracking-[-0.02em]">
            {chosenLabel ?? '—'}
            {isSending ? <SendingSpinner tone="violet" size={18} /> : null}
          </span>
          <span className="text-ui-sm text-foreground-subtle">{since}</span>
        </div>
        <OptionList
          title={entity.name}
          options={options}
          value={chosen}
          tone="violet"
          isTinted
          hasIcons={false}
          disabled={disabled}
          onPick={pick}
        />
      </div>
    );
  }

  if (options.length <= 8) {
    return (
      <div className="flex grow flex-col justify-center gap-5">
        <div
          role="radiogroup"
          aria-label={entity.name}
          className="entity-stagger flex flex-col gap-2"
        >
          {options.map((option) => (
            <RadioRow
              key={option.value}
              label={option.label}
              isChosen={option.value === chosen}
              isTall
              disabled={disabled}
              onPick={() => {
                pick(option.value);
              }}
            />
          ))}
        </div>
        <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
          {t('entity.sheet.select.oneOf', 'One of the options the device offers.')}
        </span>
      </div>
    );
  }

  const found = options.filter((option) =>
    option.label.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const current = options.find((option) => option.value === chosen);

  return (
    <div className="flex grow flex-col gap-4">
      <label className="flex h-10 items-center gap-2 rounded-tile border border-border-strong bg-surface-raised px-3 text-ui-sm text-foreground-subtle">
        <AppIcon id="search" size={15} />
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder={t('entity.sheet.select.find', 'Find an option')}
          className="min-w-0 grow bg-transparent text-foreground outline-none placeholder:text-foreground-subtle"
        />
      </label>
      {current === undefined || search !== '' ? null : (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-4.5 items-center justify-between gap-3">
            <MonoLabel>{t('entity.sheet.select.now', 'Now')}</MonoLabel>
            <span className="text-ui-sm text-foreground-muted">
              {t('entity.sheet.select.count', '{{count}} options', { count: options.length })}
            </span>
          </div>
          <div className="flex flex-col">
            <RadioRow
              label={current.label}
              isChosen
              isTall={false}
              disabled={disabled}
              onPick={() => undefined}
            />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <MonoLabel>{t('entity.sheet.select.all', 'All')}</MonoLabel>
        <div
          role="radiogroup"
          aria-label={entity.name}
          className="entity-stagger -mr-2 flex max-h-80 flex-col gap-1.5 overflow-auto pr-2"
        >
          {found
            .filter((option) => search !== '' || option.value !== chosen)
            .map((option) => (
              <RadioRow
                key={option.value}
                label={option.label}
                isChosen={option.value === chosen}
                isTall={false}
                disabled={disabled}
                onPick={() => {
                  pick(option.value);
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The body of a number: − and + either side of the value, on a slider when its steps are few
 * enough to drag through and in a box beyond (or as the device says).
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function NumberBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, reportedAt } = props;
  const params = paramsOf(entity, 'number');
  const value = usePendingValue(
    state.number?.value ?? params?.min ?? 0,
    reportedAt,
    commander.busy.has('number'),
  );
  const [typed, setTyped] = useState<string | null>(null);

  if (params === null) {
    return null;
  }

  const { min, max, step } = params;
  const unit = entity.unitOfMeasurement ?? '';
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const isBox = params.mode === 'box' || (params.mode === 'auto' && (max - min) / step > 200);
  const shown = value.shown.toFixed(decimals).replace('-', '−');

  /**
   * Sets the value, kept within the limits and on a step.
   *
   * @param next - The value asked for.
   */
  const set = (next: number): void => {
    const clamped = Math.min(max, Math.max(min, Math.round((next - min) / step) * step + min));
    const rounded = Number(clamped.toFixed(decimals));

    value.sent(rounded);
    commander.send('number', { command: 'set_value', value: rounded });
  };

  const range = t(
    'entity.sheet.number.range',
    'From {{min}} to {{max}}{{unit}}, in steps of {{step}}.',
    {
      min,
      max,
      unit: unit === '' ? '' : ` ${unit}`,
      step,
    },
  );

  return (
    <div className="flex grow flex-col justify-center gap-5">
      <div className="flex items-center justify-between gap-2.5">
        <RoundAction
          icon="minus"
          label={t('entity.sheet.number.less', 'Less')}
          disabled={disabled || value.shown <= min}
          onClick={() => {
            set(value.shown - step);
          }}
        />
        {isBox ? (
          <label className="flex h-16 grow items-baseline justify-center gap-1.5 rounded-card border border-primary/60 bg-surface-raised pt-2.5 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_15%,transparent)]">
            <input
              inputMode="decimal"
              value={typed ?? shown}
              aria-label={entity.name}
              disabled={disabled}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              onBlur={() => {
                if (typed !== null) {
                  const parsed = Number(typed.replace('−', '-').replace(',', '.'));

                  if (!Number.isNaN(parsed)) {
                    set(parsed);
                  }

                  setTyped(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              className="w-28 bg-transparent text-right text-[36px] font-medium tracking-[-0.03em] text-foreground tabular outline-none"
            />
            <span className="text-subhead text-foreground-muted">{unit}</span>
          </label>
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className="text-[56px] leading-none font-medium tracking-[-0.04em] tabular">
              {shown}
            </span>
            {unit === '' ? null : <span className="text-[22px] text-foreground-muted">{unit}</span>}
          </span>
        )}
        <RoundAction
          icon="plus"
          label={t('entity.sheet.number.more', 'More')}
          disabled={disabled || value.shown >= max}
          onClick={() => {
            set(value.shown + step);
          }}
        />
      </div>
      {isBox ? null : (
        <div className="flex flex-col gap-1">
          <ThinSlider
            label={entity.name}
            value={Math.round(((value.shown - min) / Math.max(1e-9, max - min)) * 100)}
            fill="bg-primary"
            disabled={disabled}
            onChange={(next) => {
              value.hold(min + (next / 100) * (max - min));
            }}
            onCommit={(next) => {
              set(min + (next / 100) * (max - min));
            }}
          />
        </div>
      )}
      <span className="text-ui-sm leading-[1.45] text-foreground-subtle">{range}</span>
    </div>
  );
}

/** How a button is drawn by what it does. */
const BUTTON_LOOKS: Readonly<Record<string, { icon: UiIconId; isDanger: boolean }>> = {
  restart: { icon: 'rotate-ccw', isDanger: true },
  identify: { icon: 'scan-eye', isDanger: false },
  update: { icon: 'circle-arrow-up', isDanger: false },
};

/**
 * The body of a button: one press. A restart is held for a second first.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function ButtonBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, commander, disabled } = props;
  const look = BUTTON_LOOKS[entity.deviceClass ?? ''] ?? { icon: 'bell' as const, isDanger: false };
  const isSending = commander.busy.has('button');

  /** Presses it. */
  const press = (): void => {
    commander.send('button', { command: 'press' });
  };

  const note =
    entity.deviceClass === 'restart'
      ? t('entity.sheet.button.restartNote', 'Restarts the device. It goes offline for a moment.')
      : entity.deviceClass === 'identify'
        ? t('entity.sheet.button.identifyNote', 'Makes the device blink or beep, to find it.')
        : t('entity.sheet.button.note', 'Sends one command. It has no state of its own.');

  return (
    <div className="flex grow flex-col items-center justify-center gap-5">
      {look.isDanger ? (
        <div className="flex size-42 overflow-hidden rounded-full border border-danger/50 bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-danger)_18%,transparent),color-mix(in_oklab,var(--color-danger)_3%,transparent)_70%)] text-danger">
          <HoldAction
            icon="rotate-ccw"
            isStacked
            disabled={disabled}
            onConfirm={press}
            fill="h-full rounded-full bg-transparent text-danger"
          >
            {t('entity.sheet.button.holdToRestart', 'Hold to restart')}
          </HoldAction>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={press}
          className="press-scale flex size-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-full border border-violet/50 bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklab,var(--color-violet)_30%,transparent),color-mix(in_oklab,var(--color-violet)_6%,transparent)_72%)] p-0 text-violet shadow-[0_0_60px_color-mix(in_oklab,var(--color-violet)_20%,transparent)] disabled:cursor-not-allowed"
        >
          {isSending ? (
            <SendingSpinner tone="violet" size={40} />
          ) : (
            <AppIcon id={look.icon} size={40} />
          )}
          <span className="text-title font-medium text-foreground">
            {entity.deviceClass === 'identify'
              ? t('entity.sheet.button.identify', 'Identify')
              : t('entity.sheet.button.press', 'Press')}
          </span>
        </button>
      )}
      <span className="text-center text-ui-sm leading-[1.45] text-foreground-muted">{note}</span>
    </div>
  );
}

/**
 * The body of a camera: its picture - live, the last still, or greyed while it is off - with
 * Full screen, Snapshot or Refresh under it, and its motion detection.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function CameraBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, now } = props;
  const params = paramsOf(entity, 'camera');
  const picture = useRef<HTMLDivElement>(null);
  const camera = state.camera;
  const hasPower = hasCapability(entity, 'on_off');
  const isOff = hasPower && state.on_off?.isOn === false;
  // The still comes from the platform's snapshot endpoint, fetched with the session.
  const still = useCameraStill(
    entity.entityId,
    camera?.snapshotPath !== undefined && params?.hasSnapshot === true && !isOff,
  );

  if (camera === undefined || params === null) {
    return null;
  }

  const isLive = !isOff && params.hasStream && camera.isStreamAvailable;
  const since = entity.lastChanged?.getTime() ?? now;
  /**
   * Does what a button under the picture says: switch the camera on, take a still, or show the
   * picture full screen.
   *
   * @param key - Which button.
   */
  const perform = (key: string): void => {
    if (key === 'on') {
      commander.send('on_off', { command: 'turn_on' });
    } else if (key === 'full') {
      void picture.current?.requestFullscreen();
    } else {
      commander.send('camera', { command: 'snapshot' });
    }
  };

  const buttons: { key: string; icon: UiIconId; label: string }[] = isOff
    ? [
        {
          key: 'on',
          icon: 'power',
          label: t('entity.sheet.camera.turnOn', 'Turn on'),
        },
      ]
    : [
        ...(isLive
          ? []
          : [
              {
                key: 'refresh',
                icon: 'refresh-cw' as const,
                label: t('entity.sheet.camera.refresh', 'Refresh'),
              },
            ]),
        {
          key: 'full',
          icon: 'maximize-2',
          label: t('entity.sheet.camera.fullScreen', 'Full screen'),
        },
        ...(isLive && params.hasSnapshot
          ? [
              {
                key: 'snapshot',
                icon: 'camera' as const,
                label: t('entity.sheet.camera.snapshot', 'Snapshot'),
              },
            ]
          : []),
      ];

  return (
    <div className="flex grow flex-col gap-4.5 pt-1">
      <div
        ref={picture}
        role="img"
        aria-label={entity.name}
        className={cn(
          'relative h-49.5 overflow-hidden rounded-card border border-border-strong bg-linear-to-b from-[#1e2438] via-[#161a2c] via-55% to-[#10131f]',
          isOff && '[filter:grayscale(0.7)_brightness(0.65)]',
        )}
      >
        {still === null ? (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-x-[-10%] -bottom-[30%] h-[70%] rounded-t-[50%] bg-[#191d30]"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-[18%] left-[22%] h-[24%] w-[34%] rounded-t-[10px] rounded-b-[4px] bg-border-strong"
            />
            <span
              aria-hidden="true"
              className="absolute right-[12%] bottom-[30%] h-[44%] w-[16%] rounded-[4px] border-2 border-b-0 border-foreground-muted/18"
            />
          </>
        ) : (
          <img
            key={still}
            src={still}
            alt=""
            className="absolute inset-0 size-full animate-fade-in object-cover"
          />
        )}
        <span className="absolute top-3 left-3 inline-flex h-6 items-center gap-1.5 rounded-pill bg-canvas/70 px-2.25 text-[11px] text-foreground-muted">
          {isOff ? (
            <>
              <AppIcon id="video-off" size={12} />
              <span className="text-foreground">
                {t('entity.sheet.camera.offSince', 'Off since {{time}}', {
                  time: clockText(since),
                })}
              </span>
            </>
          ) : isLive ? (
            <>
              <span className="entity-blink size-1.75 rounded-full bg-danger" />
              <span className="font-semibold tracking-[0.04em] text-foreground">
                {t('entity.sheet.camera.live', 'LIVE')}
              </span>
            </>
          ) : (
            <>
              <AppIcon id="image" size={12} />
              {clockText(entity.lastUpdated?.getTime() ?? now)}
            </>
          )}
        </span>
        {camera.isRecording ? (
          <span className="absolute top-3 right-3 inline-flex h-6 items-center gap-1.5 rounded-pill bg-canvas/70 px-2.25 text-[11px] font-semibold text-danger">
            <span className="entity-blink size-1.75 rounded-full bg-danger" />
            {t('entity.sheet.camera.recording', 'Recording')}
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        {buttons.map((button) => (
          <button
            key={button.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              perform(button.key);
            }}
            className="press inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-inner border border-border-strong bg-surface-raised px-4 text-ui font-medium text-foreground transition-colors duration-200 hover:border-foreground-subtle disabled:cursor-not-allowed"
          >
            <AppIcon id={button.icon} size={16} />
            {button.label}
          </button>
        ))}
      </div>
      {params.hasMotionDetection && !isOff ? (
        <div className="flex items-center gap-4 border-t border-border pt-4">
          <span className="grow text-ui">
            {t('entity.sheet.camera.motionDetection', 'Motion detection')}
          </span>
          <BigSwitch
            label={t('entity.sheet.camera.motionDetection', 'Motion detection')}
            size="small"
            tone="primary"
            isOn={camera.isMotionDetectionOn === true}
            disabled={disabled}
            onChange={(isOn) => {
              commander.send('camera', { command: 'set_motion_detection', isOn });
            }}
          />
        </div>
      ) : null}
      <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
        {isOff
          ? t('entity.sheet.camera.off', 'Off')
          : camera.isRecording
            ? t('entity.sheet.camera.recording', 'Recording')
            : isLive
              ? t('entity.sheet.camera.streaming', 'Streaming')
              : t('entity.sheet.camera.idle', 'Idle')}
      </span>
    </div>
  );
}
