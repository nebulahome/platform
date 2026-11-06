/**
 * A thing that only switches - a relay, a socket, a lamp that does not dim - as the canvas draws
 * it (`N-Entity-Switch-Basic`, `-More`, `N-Entity-Modal-Lights`): the round power target, the
 * word, and since when. A socket draws a plug. A relay that never reports back (assumed state)
 * gets two buttons instead, and says what was last sent rather than what it is.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { isBusy } from '@/routes/library/entity/controls/control-block';
import { PowerTarget, useSinceLine } from '@/routes/library/entity/sheet/parts/sheet-controls';
import { SendingSpinner } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { TONE_CHOSEN, type SheetTone } from '@/routes/library/entity/sheet/tones';

/** What the on/off body needs beyond a body's props. */
export type OnOffBodyProps = SheetBodyProps & {
  /** Its colour. */
  readonly tone: SheetTone;
};

/**
 * The body of a thing that only switches.
 *
 * @param props - See {@link OnOffBodyProps}.
 * @returns The body.
 */
export function OnOffBody(props: OnOffBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, history, tone } = props;
  const isOn = state.on_off?.isOn === true;
  const since = useSinceLine(entity, history);
  const isAssumed = paramsOf(entity, 'on_off')?.isAssumed === true;
  const isSending = isBusy(props, 'on_off');
  const word = isOn ? t('common.on', 'On') : t('common.off', 'Off');

  /**
   * Turns it on or off.
   *
   * @param next - Whether it should be on.
   */
  const turn = (next: boolean): void => {
    commander.send('on_off', { command: next ? 'turn_on' : 'turn_off' });
  };

  if (isAssumed) {
    return (
      <div className="flex grow flex-col justify-center gap-5">
        <div className="flex items-center gap-4">
          <span className="flex size-16 items-center justify-center rounded-full border border-dashed border-border-strong text-foreground-muted">
            <AppIcon id="toggle-right" size={26} />
          </span>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[22px] font-medium">
              {t('entity.sheet.switch.lastSent', 'Last sent: {{state}}', { state: word })}
              {isSending ? <SendingSpinner tone={tone} size={18} /> : null}
            </span>
            <span className="text-ui-sm text-foreground-subtle">{since}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {[true, false].map((next) => (
            <button
              key={String(next)}
              type="button"
              disabled={disabled}
              onClick={() => {
                turn(next);
              }}
              className={cn(
                'inline-flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-card border text-title font-medium text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isOn === next
                  ? cn(TONE_CHOSEN[tone], 'text-foreground')
                  : 'border-border-strong bg-surface-raised',
              )}
            >
              <AppIcon id={next ? 'power' : 'power-off'} size={18} />
              {next
                ? t('entity.sheet.switch.turnOn', 'Turn on')
                : t('entity.sheet.switch.turnOff', 'Turn off')}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex grow flex-col items-center justify-center gap-6">
      <PowerTarget
        label={entity.name}
        isOn={isOn}
        onChange={turn}
        tone={tone}
        disabled={disabled}
        {...(entity.deviceClass === 'outlet' ? { icon: 'plug' as const } : {})}
      />
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="flex items-center gap-2 text-[28px] font-medium tracking-[-0.02em]">
          {word}
          {isSending ? <SendingSpinner tone={tone} size={20} /> : null}
        </span>
        <span className="text-ui-sm leading-[1.45] text-foreground-subtle">{since}</span>
      </div>
    </div>
  );
}

/**
 * The body of a switch, in the interface's own colour.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function SwitchBody(props: SheetBodyProps) {
  return <OnOffBody {...props} tone="primary" />;
}
