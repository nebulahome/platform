/**
 * A text the house may write, as the canvas draws it (`N-Entity-Text-Set`, `N-Entity-Text-More`):
 * the text in its field, growing to three lines, a counter when the device says how long it may
 * be, and its last values under it - one tapped goes back in the field, as a change.
 *
 * A change is a draft until Set, as a time's is: the text and the counter turn violet, "Was …",
 * Cancel and Set show under it, and nothing reaches the device before Set. A text the device would
 * refuse turns the field red, says why - its pattern as the device sent it - and keeps Set off. A
 * password is always eight dots, with an eye that shows it; no counter and no last values. A text
 * the house may only read is not drawn here: it stays a text sensor (`SensorBody`).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PASSWORD_MASK, textProblemOf, type EntityView } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { durationText } from '@/library/history-stats';
import { LastValues } from '@/routes/library/entity/sheet/bodies/sensor-body';
import { SetBar, useDraft } from '@/routes/library/entity/sheet/bodies/time-body';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';

/** The longest text the field takes: the longest a text's state may be. */
const LONGEST = 512;

/**
 * Whether the house may write an entity's text: what picks this body over the text sensor's.
 *
 * @param entity - The entity.
 * @returns True when it may.
 */
export function canSetText(entity: Pick<EntityView, 'capabilities'>): boolean {
  return paramsOf(entity, 'sensor_text')?.canSet === true;
}

/**
 * Reads the text off a state from history.
 *
 * @param state - The state, as history holds it.
 * @returns The text, or undefined.
 */
function textOf(state: unknown): string | undefined {
  const value = (state as { sensor_text?: { value?: unknown } } | null)?.sensor_text?.value;

  return typeof value === 'string' ? value : undefined;
}

/**
 * The body of a text the house may write.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function TextBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, history, now, disabled } = props;
  const params = paramsOf(entity, 'sensor_text');
  const draft = useDraft(props, 'sensor_text');
  const [isShown, setShown] = useState(false);
  const isPassword = params?.isPassword === true;
  const isMasked = isPassword && !isShown;
  const value = draft.shown;
  const problem =
    draft.isChanged && params !== null && value !== null ? textProblemOf(params, value) : undefined;
  const maxLength = isPassword ? undefined : params?.maxLength;
  // A text not known is a dash and an empty one says so, never a blank box; a password is eight
  // dots until a change is typed or the eye shows it.
  const placeholder =
    value === null
      ? '—'
      : value === ''
        ? t('entity.sheet.text.empty', 'Empty')
        : isMasked
          ? PASSWORD_MASK
          : undefined;
  const past = history.states.filter((point) => {
    const text = textOf(point.state);

    return text !== undefined && text !== draft.base;
  });
  const look = cn(
    'min-w-0 flex-1 bg-transparent text-[20px] leading-7 font-medium tracking-[-0.015em] outline-none',
    draft.isChanged
      ? 'text-violet'
      : entity.isAvailable
        ? 'text-foreground'
        : 'text-foreground-subtle',
    placeholder === PASSWORD_MASK
      ? 'placeholder:text-foreground'
      : 'placeholder:text-foreground-subtle',
  );

  /**
   * Takes what was typed: a device's text is one line, so a line break pasted in is a space.
   *
   * @param text - The field's text.
   */
  const change = (text: string): void => {
    draft.change(text.replaceAll(/\r?\n/gu, ' '));
  };

  /** Sends the draft, when there is one the device would take. */
  const set = (): void => {
    if (draft.isChanged && problem === undefined && !disabled) {
      draft.set();
    }
  };

  return (
    <div className={cn('flex grow flex-col gap-2.5 pt-2', isPassword && 'justify-center')}>
      <label
        className={cn(
          'flex min-h-16 cursor-text items-center gap-1.5 rounded-card border py-3.5 pl-4.5 transition-colors duration-200',
          isPassword ? 'pr-2' : 'pr-4.5',
          problem === undefined
            ? cn(
                'bg-surface-raised focus-within:border-primary/60 focus-within:bg-primary/8',
                draft.isChanged ? 'border-violet/60' : 'border-border',
              )
            : 'border-danger/60 bg-danger/6',
        )}
      >
        {isPassword ? (
          <>
            <input
              type={isShown ? 'text' : 'password'}
              aria-label={entity.name}
              autoComplete="off"
              maxLength={LONGEST}
              disabled={disabled}
              placeholder={placeholder}
              value={isMasked && !draft.isChanged ? '' : (value ?? '')}
              onChange={(event) => {
                change(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  set();
                }
              }}
              className={cn(look, isMasked && 'tracking-[0.12em]')}
            />
            <button
              type="button"
              aria-pressed={isShown}
              aria-label={
                isShown
                  ? t('entity.sheet.text.hide', 'Hide the text')
                  : t('entity.sheet.text.show', 'Show the text')
              }
              title={
                isShown
                  ? t('entity.sheet.text.hide', 'Hide the text')
                  : t('entity.sheet.text.show', 'Show the text')
              }
              onClick={() => {
                setShown(!isShown);
              }}
              className="press-scale inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-muted transition-colors duration-200 hover:bg-surface-raised hover:text-foreground"
            >
              <AppIcon id={isShown ? 'eye-off' : 'eye'} size={18} />
            </button>
          </>
        ) : (
          <textarea
            aria-label={entity.name}
            rows={1}
            maxLength={LONGEST}
            disabled={disabled}
            placeholder={placeholder}
            value={value ?? ''}
            onChange={(event) => {
              change(event.target.value);
            }}
            onKeyDown={(event) => {
              // One line: Enter sets the text rather than starting another.
              if (event.key === 'Enter') {
                event.preventDefault();
                set();
              }
            }}
            className={cn(look, 'field-sizing-content max-h-21 resize-none')}
          />
        )}
      </label>
      <div className="flex min-h-5 items-center gap-2 px-1">
        <span
          role={problem === undefined ? undefined : 'alert'}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.75 text-ui-sm',
            problem === undefined ? 'text-foreground-subtle' : 'text-danger',
          )}
        >
          {problem === 'pattern' ? (
            <>
              <AppIcon id="circle-alert" size={15} />
              {t('entity.sheet.text.noMatch', 'Doesn’t match')}
              <code className="truncate rounded-md bg-danger/10 px-1.5 py-px font-mono text-[12px]">
                {params?.pattern}
              </code>
            </>
          ) : problem === 'short' ? (
            <>
              <AppIcon id="circle-alert" size={15} />
              {t('entity.sheet.text.tooShort', 'At least {{min}} characters', {
                min: params?.minLength,
              })}
            </>
          ) : problem === 'long' ? (
            <>
              <AppIcon id="circle-alert" size={15} />
              {t('entity.sheet.text.tooLong', 'At most {{max}} characters', {
                max: params?.maxLength,
              })}
            </>
          ) : draft.isChanged || entity.lastChanged === null ? null : (
            t('entity.sheet.sensor.changedAgo', 'Changed {{ago}} ago', {
              ago: durationText(Math.max(0, now - entity.lastChanged.getTime())),
            })
          )}
        </span>
        {maxLength === undefined || value === null ? null : (
          <span
            className={cn(
              'font-mono text-[11px] tabular',
              problem === undefined
                ? draft.isChanged
                  ? 'text-violet'
                  : 'text-foreground-subtle'
                : 'text-danger',
            )}
          >
            {`${String(value.length)}/${String(maxLength)}`}
          </span>
        )}
      </div>
      <SetBar
        draft={draft}
        format={(text) =>
          isPassword ? PASSWORD_MASK : t('entity.sheet.text.quoted', '“{{text}}”', { text })
        }
        disabled={disabled || problem !== undefined}
      />
      {isPassword || past.length === 0 ? null : (
        <div className="pt-2">
          <LastValues
            points={past}
            now={now}
            current=""
            disabled={disabled}
            onPick={(text) => {
              draft.change(text);
            }}
          />
        </div>
      )}
    </div>
  );
}
