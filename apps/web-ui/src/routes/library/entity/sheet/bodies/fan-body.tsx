/**
 * A fan, as the canvas draws it (`N-Entity-Fan-OnOff`, `-Percent`, `-Steps`, `-Presets`, `-Full`).
 * The picture is the fan itself: the blades turn with its speed, blur when it is fast, turn the
 * other way in reverse, and the head swings side to side while it oscillates. Under it, the same
 * controls as a lamp's:
 *
 * - its speed: one button per speed for fewer than ten, a wide bar with 25 / 50 / 75 / 100 for
 *   more;
 * - its presets, as chips - or, with no speed, as tiles that are the main control;
 * - Oscillate and Direction, when it has them.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { knownIcon, OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import {
  BlockHead,
  LevelBar,
  QuickPicks,
  useSinceLine,
} from '@/routes/library/entity/sheet/parts/sheet-controls';
import { BigSwitch, ValueHead } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** What the picture needs. */
type FanPictureProps = {
  /** Whether it turns. */
  readonly isOn: boolean;

  /** How fast, 0 to 1; a fan with no speeds turns at a middle pace. */
  readonly speed: number;

  /** Whether its head swings. */
  readonly isOscillating: boolean;

  /** Whether the blades turn the other way. */
  readonly isReverse: boolean;
};

/**
 * The fan, drawn: its stand, its head, its blades turning at its speed.
 *
 * @param props - See {@link FanPictureProps}.
 * @returns The picture.
 */
function FanPicture(props: FanPictureProps) {
  const { isOn, speed, isOscillating, isReverse } = props;
  const turn = Math.max(0.12, 1.5 - 1.38 * speed);

  return (
    <div
      aria-hidden="true"
      className="relative h-59 overflow-hidden rounded-panel border border-border-strong bg-linear-to-b from-[#10142a] to-[#0b0e1c]"
    >
      <span
        className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_40%,color-mix(in_oklab,var(--color-cyan)_18%,transparent),transparent_70%)] transition-opacity duration-700"
        // eslint-disable-next-line react/forbid-dom-props -- the glow grows with the speed
        style={{ opacity: isOn ? 0.33 + 0.67 * speed : 0 }}
      />
      <span className="absolute top-42.5 left-[calc(50%-7px)] h-11.5 w-3.5 rounded-[4px] bg-linear-to-r from-border-strong via-[#343b62] to-border-strong" />
      <span className="absolute top-52 left-[calc(50%-58px)] h-4 w-29 rounded-[50%] bg-[radial-gradient(ellipse_at_50%_30%,#3a4170,#1b1f35)]" />
      <div className="absolute top-3.5 left-[calc(50%-88px)] size-44 [perspective:700px]">
        <div
          className={cn(
            'relative size-44 [transform-style:preserve-3d]',
            isOn && isOscillating && 'entity-yaw',
          )}
        >
          <span
            className={cn(
              'absolute inset-0 rounded-full bg-[radial-gradient(circle,#121733_0%,#0b0e1d_70%)]',
              isOn
                ? 'shadow-[inset_0_0_0_4px_#2d3352,inset_0_0_0_6px_#1b1f35,0_18px_40px_-16px_color-mix(in_oklab,var(--color-cyan)_35%,transparent)]'
                : 'shadow-[inset_0_0_0_4px_#2d3352,inset_0_0_0_6px_#1b1f35]',
            )}
          />
          <div
            // Always turning, held still while off: switched on, the blades go on from where
            // they stopped instead of jumping back to the start.
            className="entity-fan absolute inset-1 overflow-hidden rounded-full transition-[filter] duration-700"
            // eslint-disable-next-line react/forbid-dom-props -- the blades turn and blur with the speed
            style={{
              ['--spin' as string]: `${turn.toFixed(2)}s`,
              animationDirection: isReverse ? 'reverse' : 'normal',
              animationPlayState: isOn ? 'running' : 'paused',
              filter: `blur(${isOn ? (speed * 1.4).toFixed(2) : '0'}px)`,
            }}
          >
            {[8, 98, 188, 278].map((angle) => (
              <span
                key={angle}
                className={cn(
                  'absolute top-2 left-15.25 h-19 w-11.5 origin-bottom rounded-[50%_50%_42%_42%/64%_64%_36%_36%]',
                  isOn ? '' : 'bg-linear-to-b from-[#3a4170] to-[#1f2440]',
                )}
                // eslint-disable-next-line react/forbid-dom-props -- each blade at its own angle, lit as fast as it turns
                style={{
                  transform: `rotate(${String(angle)}deg) skewX(-10deg)`,
                  ...(isOn
                    ? {
                        background: `linear-gradient(180deg, color-mix(in oklab, var(--color-cyan) ${String(Math.round((0.7 - 0.25 * speed) * 100))}%, transparent), color-mix(in oklab, var(--color-cyan) 12%, transparent))`,
                      }
                    : {}),
                }}
              />
            ))}
          </div>
          <span className="absolute inset-1.5 rounded-full bg-[repeating-radial-gradient(circle_at_center,transparent_0_12px,rgb(190_200_255/0.1)_12px_13.5px),repeating-conic-gradient(from_0deg,rgb(190_200_255/0.09)_0deg_1.4deg,transparent_1.4deg_22.5deg)]" />
          <span className="absolute top-17.5 left-17.5 size-9 rounded-full bg-[radial-gradient(circle_at_40%_35%,#3a4170,#161a2e)] shadow-[0_2px_6px_rgb(0_0_0/0.5)]" />
          <span
            className={cn(
              'absolute top-21 left-21 size-2 rounded-full transition-colors duration-500',
              isOn ? 'bg-cyan shadow-[0_0_8px_var(--color-cyan)]' : 'bg-[#3a4170]',
            )}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The body of a fan.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function FanBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, reportedAt, history } = props;
  const since = useSinceLine(entity, history);
  const params = paramsOf(entity, 'fan');
  const percentage = usePendingValue(
    state.fan?.percentage ?? 0,
    reportedAt,
    commander.busy.has('fan'),
  );
  const isOn = state.on_off?.isOn === true;
  const count = params?.speedCount ?? 0;
  const presets = params?.presets ?? [];
  const preset = state.fan?.preset ?? null;
  const shown = Math.round(percentage.shown);
  const step = count > 0 ? Math.round((shown / 100) * count) : 0;
  const isReverse = state.fan?.direction === 'reverse';
  const isOscillating = state.fan?.isOscillating === true;

  /**
   * Sets the speed, in percent: none switches the fan off.
   *
   * @param next - The speed.
   */
  const setSpeed = (next: number): void => {
    if (next <= 0) {
      commander.send('on_off', { command: 'turn_off' });

      return;
    }

    percentage.sent(next);
    commander.send('fan', { command: 'set_percentage', percentage: next });
  };

  const big = !isOn
    ? t('common.off', 'Off')
    : count >= 10
      ? String(shown)
      : count > 0
        ? String(step)
        : (preset ?? t('common.on', 'On'));
  const unit = !isOn
    ? undefined
    : count >= 10
      ? '%'
      : count > 0
        ? t('entity.sheet.fan.ofCount', 'of {{count}}', { count })
        : undefined;
  const status = !isOn
    ? count > 0
      ? t('entity.sheet.fan.wasAt', 'Was at {{speed}}', {
          speed:
            count >= 10
              ? `${String(shown)}%`
              : t('entity.sheet.fan.stepOf', '{{step}} of {{count}}', { step, count }),
        })
      : since
    : preset !== null && count > 0
      ? t('entity.sheet.fan.presetName', '{{preset}} preset', { preset })
      : isOscillating
        ? t('entity.sheet.fan.oscillating', 'Oscillating')
        : count > 0
          ? t('entity.sheet.fan.speed', 'Speed')
          : since;

  return (
    <div className="flex grow flex-col justify-center gap-4.5">
      <FanPicture
        isOn={isOn}
        speed={count > 0 ? shown / 100 : 0.55}
        isOscillating={isOscillating}
        isReverse={isReverse}
      />

      <ValueHead
        value={big}
        unit={unit}
        line={status}

        trail={
          <BigSwitch
            label={t('entity.sheet.fan.fan', 'Fan')}
            isOn={isOn}
            isSending={commander.busy.has('fan') || commander.busy.has('on_off')}
            tone="cyan"
            disabled={disabled}
            onChange={(next) => {
              commander.send('on_off', { command: next ? 'turn_on' : 'turn_off' });
            }}
          />
        }
      />

      {count >= 10 ? (
        <>
          <LevelBar
            label={t('entity.sheet.fan.speed', 'Speed')}
            value={shown}
            isOn={isOn}
            tone="cyan"
            icon="fan"
            disabled={disabled}
            onChange={percentage.hold}
            onCommit={setSpeed}
          />
          <QuickPicks
            values={[25, 50, 75, 100]}
            value={isOn ? shown : null}
            tone="cyan"
            disabled={disabled}
            onPick={setSpeed}
          />
        </>
      ) : count > 0 ? (
        <div
          role="radiogroup"
          aria-label={t('entity.sheet.fan.speed', 'Speed')}
          className="flex gap-1.5"
        >
          {[...Array.from({ length: count }).keys()].map((index) => {
            const isLit = isOn && index < step;
            const isCurrent = isOn && index === step - 1;

            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={isCurrent}
                aria-label={t('entity.sheet.fan.speedNumber', 'Speed {{n}}', { n: index + 1 })}
                disabled={disabled}
                onClick={() => {
                  setSpeed(isCurrent ? 0 : Math.round(((index + 1) * 100) / count));
                }}
                className={cn(
                  'press h-14 flex-1 cursor-pointer font-mono text-ui-sm transition-colors duration-200 disabled:cursor-not-allowed',
                  index === 0
                    ? 'rounded-l-panel rounded-r-chip'
                    : index === count - 1
                      ? 'rounded-l-chip rounded-r-panel'
                      : 'rounded-chip',
                  isCurrent
                    ? 'bg-cyan font-semibold text-canvas'
                    : isLit
                      ? 'text-foreground'
                      : 'border border-border bg-surface-raised text-foreground-subtle',
                )}
                // eslint-disable-next-line react/forbid-dom-props -- the speeds below the one chosen are lit more the nearer they are
                style={
                  isLit && !isCurrent
                    ? {
                        background: `color-mix(in oklab, var(--color-cyan) ${String(Math.round((0.22 + (0.4 * (index + 1)) / step) * 100))}%, transparent)`,
                      }
                    : undefined
                }
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      ) : null}

      {presets.length === 0 ? null : count === 0 ? (
        <div className="flex flex-col gap-2.5">
          <BlockHead title={t('entity.sheet.fan.preset', 'Preset')} />
          <div
            role="radiogroup"
            aria-label={t('entity.sheet.fan.preset', 'Preset')}
            className="grid grid-cols-2 gap-2"
          >
            {presets.map((name) => {
              const isChosen = isOn && preset === name;

              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={isChosen}
                  disabled={disabled}
                  onClick={() => {
                    commander.send('fan', { command: 'set_preset', preset: name });
                  }}
                  className={cn(
                    'press flex h-14 cursor-pointer items-center gap-2.5 rounded-inner border px-3.5 text-ui transition-colors duration-200 disabled:cursor-not-allowed',
                    isChosen
                      ? 'border-cyan/50 bg-cyan/12 text-cyan'
                      : 'border-border-strong bg-surface-raised text-foreground',
                  )}
                >
                  <AppIcon id={knownIcon(name) ?? 'wind'} size={17} />
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <BlockHead
            title={t('entity.sheet.fan.preset', 'Preset')}
            aside={isOn && preset !== null ? preset : t('entity.sheet.fan.manual', 'Manual')}
          />
          <OptionList
            title={t('entity.sheet.fan.preset', 'Preset')}
            options={presets.map((value) => ({ value }))}
            value={isOn ? preset : null}
            tone="cyan"
            disabled={disabled}
            onPick={(next) => {
              commander.send('fan', { command: 'set_preset', preset: next });
            }}
          />
        </div>
      )}

      {params?.canOscillate === true || params?.canReverse === true ? (
        <div className="flex flex-col gap-4">
          {params.canOscillate ? (
            <div className="flex items-center gap-4 border-t border-border pt-4">
              <div className="flex grow flex-col gap-0.5">
                <span className="text-ui">{t('entity.sheet.fan.oscillate', 'Oscillate')}</span>
                <span className="text-caption text-foreground-subtle">
                  {t('entity.sheet.fan.oscillateHint', 'Turns from side to side')}
                </span>
              </div>
              <BigSwitch
                label={t('entity.sheet.fan.oscillate', 'Oscillate')}
                size="small"
                isOn={isOscillating}
                tone="cyan"
                disabled={disabled}
                onChange={(next) => {
                  commander.send('fan', { command: 'set_oscillating', isOscillating: next });
                }}
              />
            </div>
          ) : null}
          {params.canReverse ? (
            <div className="flex items-center gap-4 border-t border-border pt-4">
              <span className="grow text-ui">{t('entity.sheet.fan.direction', 'Direction')}</span>
              <div className="w-47.5">
                <OptionList
                  title={t('entity.sheet.fan.direction', 'Direction')}
                  options={[
                    { value: 'forward', label: t('entity.sheet.fan.forward', 'Forward') },
                    { value: 'reverse', label: t('entity.sheet.fan.reverse', 'Reverse') },
                  ]}
                  value={isReverse ? 'reverse' : 'forward'}
                  tone="cyan"
                  isTinted
                  disabled={disabled}
                  onPick={(direction) => {
                    commander.send('fan', { command: 'set_direction', direction });
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
