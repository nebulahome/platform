/**
 * A field that holds one day, or a run of days: its label, a button that says it in words, and
 * the {@link Calendar} it opens under it.
 *
 * The value is a plain `2026-06-21`, or `{ from, to }`, as the calendar's is. Picking a day closes
 * the calendar and hands the focus back to the button, so the keyboard carries on from where it
 * was. A run stays open, so a wrong end is moved with one more press; a press outside or Escape
 * closes it.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';
import { controlFace, type ControlFaceVariants } from '../lib/control-face.js';

import { AppIcon } from './app-icon.js';
import { Calendar, formatDay, formatDayRange, type DayPick } from './calendar.js';
import { FieldShell } from './field-shell.js';
import { Popover } from './popover.js';

/**
 * What the field needs: one day (`mode` left out, or `single`), or a run of days (`range`, with
 * `maxDays` for the most it may hold).
 */
export type DateFieldProps = DayPick &
  Pick<ControlFaceVariants, 'size'> & {
    /** What the field is for. */
    readonly label: string;

    /** Whether the label is drawn, or only announced. */
    readonly isLabelHidden?: boolean;

    /** The first day that may be picked. */
    readonly min?: string | undefined;

    /** The last day that may be picked. */
    readonly max?: string | undefined;

    /** Whether the day can be changed at all. */
    readonly disabled?: boolean;

    /** A line under the control, for what the label cannot say. */
    readonly hint?: ReactNode;

    /** What is wrong with the day, when something is. */
    readonly error?: string | undefined;
  };

/**
 * Renders a date field.
 *
 * @param props - See {@link DateFieldProps}.
 * @returns The field, and the calendar it opens.
 */
export function DateField(props: DateFieldProps) {
  const { label, isLabelHidden = false, min, max, size, disabled = false, hint, error } = props;
  const { t, i18n } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);

  /** Shuts the calendar and hands the focus back. */
  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const shown =
    props.mode === 'range'
      ? props.value === null
        ? null
        : formatDayRange(props.value, i18n.language)
      : props.value === null
        ? null
        : formatDay(props.value, i18n.language);

  return (
    <FieldShell label={label} isLabelHidden={isLabelHidden} hint={hint} error={error}>
      {(ids) => (
        <>
          <button
            ref={button}
            id={ids.id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-labelledby={`${ids.labelId} ${ids.id}-value`}
            aria-describedby={ids.describedBy}
            disabled={disabled}
            onClick={() => {
              setOpen(!isOpen);
            }}
            className={cn(
              controlFace({ size, isInvalid: ids.isInvalid }),
              'press flex items-center justify-between gap-2 text-left',
            )}
          >
            <span
              id={`${ids.id}-value`}
              className={cn('truncate', shown === null ? 'text-foreground-subtle' : undefined)}
            >
              {shown ??
                (props.mode === 'range'
                  ? t('ui.dateField.chooseRange', 'Choose the days')
                  : t('ui.dateField.choose', 'Choose a date'))}
            </span>
            <AppIcon id="calendar" size={16} className="shrink-0 text-foreground-subtle" />
          </button>

          <Popover anchor={button} isOpen={isOpen} onClose={close} label={label} width={280}>
            {props.mode === 'range' ? (
              <Calendar
                takesFocus
                className="w-full p-3"
                mode="range"
                value={props.value}
                maxDays={props.maxDays}
                min={min}
                max={max}
                onChange={props.onChange}
              />
            ) : (
              <Calendar
                takesFocus
                className="w-full p-3"
                value={props.value}
                min={min}
                max={max}
                onChange={(day) => {
                  props.onChange(day);
                  close();
                }}
              />
            )}
          </Popover>
        </>
      )}
    </FieldShell>
  );
}
