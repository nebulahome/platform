/**
 * A field that holds a time of day: typed, or picked from a list of quarter hours under it.
 *
 * The value is a plain `20:30`, on a 24-hour clock and with no zone, as a native time input speaks
 * it; the box writes it as the language does - `20:30`, or `8:30 PM` where the clock has twelve
 * hours - and reads back whatever is typed in either form (`2030`, `8.30`, `8:30 pm`, `8pm`). What
 * is typed counts when the box is left or Enter is pressed; a time it cannot read puts the old one
 * back. The arrows step a quarter of an hour, and the list follows the value so the next quarter
 * is always in sight.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';
import { controlFace, type ControlFaceVariants } from '../lib/control-face.js';

import { AppIcon } from './app-icon.js';
import { FieldShell } from './field-shell.js';
import { Popover } from './popover.js';

/** The list's step, in minutes. */
const STEP_MINUTES = 15;

/** The minutes in a day. */
const DAY_MINUTES = 24 * 60;

/** What the field reads: hours, minutes perhaps, and a morning or an afternoon perhaps. */
const TYPED = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(?:([ap])\.?m?\.?)?$/u;

/**
 * Reads a time of day as a person types it.
 *
 * @param typed - `20:30`, `2030`, `20`, `8.30`, `8:30 pm`, `8pm`, `12 am`.
 * @returns `HH:MM` on a 24-hour clock, or null when it is not a time.
 */
export function parseClock(typed: string): string | null {
  const match = TYPED.exec(typed.trim().toLowerCase());

  if (match === null) {
    return null;
  }

  const [, hourText = '', minuteText = '0', half] = match;
  let hour = Number(hourText);
  const minute = Number(minuteText);

  if (half !== undefined) {
    if (hour < 1 || hour > 12) {
      return null;
    }

    hour = (hour % 12) + (half === 'p' ? 12 : 0);
  }

  return hour < 24 && minute < 60
    ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : null;
}

/**
 * The minutes since midnight of a time.
 *
 * @param clock - `HH:MM`.
 * @returns The minutes.
 */
function minutesOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/**
 * Writes minutes since midnight as a time.
 *
 * @param minutes - The minutes; any number, wrapped round the day.
 * @returns `HH:MM`.
 */
function clockOf(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * Brings the quarter nearest a time into sight in the list.
 *
 * @param list - The list, when it is open.
 * @param clock - `HH:MM`.
 */
function showNear(list: HTMLElement | null, clock: string): void {
  const nearest = clockOf(Math.round(minutesOf(clock) / STEP_MINUTES) * STEP_MINUTES);

  list?.querySelector(`[data-clock="${nearest}"]`)?.scrollIntoView({ block: 'nearest' });
}

/** Every quarter hour of a day. */
const STEPS = Array.from({ length: DAY_MINUTES / STEP_MINUTES }, (unused, index) =>
  clockOf(index * STEP_MINUTES),
);

/** What the field needs. */
export type TimeFieldProps = Pick<ControlFaceVariants, 'size'> & {
  /** What the field is for. */
  readonly label: string;

  /** Whether the label is drawn, or only announced. */
  readonly isLabelHidden?: boolean;

  /** The time, `HH:MM` on a 24-hour clock. */
  readonly value: string;

  /** Called with the time typed or picked. */
  readonly onChange: (clock: string) => void;

  /** Whether the time can be changed at all. */
  readonly disabled?: boolean;

  /** A line under the control, for what the label cannot say. */
  readonly hint?: ReactNode;

  /** What is wrong with the time, when something is. */
  readonly error?: string | undefined;

  /** Anything extra for the outer element, such as a width. */
  readonly className?: string;
};

/**
 * Renders a time field.
 *
 * @param props - See {@link TimeFieldProps}.
 * @returns The field, and the list it opens.
 */
export function TimeField(props: TimeFieldProps) {
  const { label, isLabelHidden = false, value, onChange, size, disabled = false } = props;
  const { i18n } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [isOpen, setOpen] = useState(false);

  // What is being typed; null while the box shows the value.
  const [draft, setDraft] = useState<string | null>(null);

  /**
   * Writes a time as the language does.
   *
   * @param clock - `HH:MM`.
   * @returns `20:30`, or `8:30 PM`.
   */
  const written = (clock: string): string =>
    new Intl.DateTimeFormat(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(minutesOf(clock) * 60_000);

  /**
   * Hands a time on, when it is another.
   *
   * @param clock - `HH:MM`.
   */
  const choose = (clock: string): void => {
    if (clock !== value) {
      onChange(clock);
    }
  };

  // The list opens, and follows the value, with the quarter nearest it in sight.
  const listRef = useCallback(
    (node: HTMLDivElement | null): void => {
      showNear(node, value);
    },
    [value],
  );

  /** Takes what was typed, or puts the value back when it is not a time. */
  const commit = (): void => {
    const typed = draft === null ? null : parseClock(draft);

    if (typed !== null) {
      choose(typed);
    }

    setDraft(null);
  };

  /**
   * Steps with the arrows, takes the text on Enter, and shuts the list on Escape alone.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      const from = minutesOf(parseClock(draft ?? '') ?? value) / STEP_MINUTES;

      // To the next quarter after it, or the one before it: 20:10 steps to 20:15 or to 20:00.
      const to = event.key === 'ArrowDown' ? Math.floor(from) + 1 : Math.ceil(from) - 1;

      setDraft(null);
      setOpen(true);
      choose(clockOf(to * STEP_MINUTES));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      setOpen(false);
    } else if (event.key === 'Escape' && isOpen) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <FieldShell
      label={label}
      isLabelHidden={isLabelHidden}
      hint={props.hint}
      error={props.error}
      {...(props.className === undefined ? {} : { className: props.className })}
    >
      {(ids) => (
        <>
          <div ref={box} className="relative">
            <AppIcon
              id="clock"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-foreground-subtle"
            />
            <input
              id={ids.id}
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={ids.isInvalid}
              aria-describedby={ids.describedBy}
              disabled={disabled}
              value={draft ?? written(value)}
              onFocus={() => {
                setOpen(true);
              }}
              onClick={() => {
                setOpen(true);
              }}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onBlur={() => {
                commit();
                setOpen(false);
              }}
              onKeyDown={onKeyDown}
              className={cn(
                controlFace({ size, isInvalid: ids.isInvalid }),
                'pl-9.5 font-mono tabular',
              )}
            />
          </div>

          <Popover
            anchor={box}
            isOpen={isOpen}
            onClose={() => {
              setOpen(false);
            }}
            label={label}
            width={140}
          >
            <div ref={listRef} className="flex max-h-60 flex-col overflow-y-auto p-1">
              {STEPS.map((step) => (
                <button
                  key={step}
                  type="button"
                  tabIndex={-1}
                  data-clock={step}
                  aria-pressed={step === value}
                  // The box keeps the focus: losing it would take the typed text before the press.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    setDraft(null);
                    choose(step);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex h-8 shrink-0 cursor-pointer items-center rounded-chip px-2.5 text-left font-mono text-ui tabular',
                    step === value
                      ? 'bg-primary/14 font-medium text-foreground'
                      : 'text-foreground-muted hover:bg-surface-high hover:text-foreground',
                  )}
                >
                  {written(step)}
                </button>
              ))}
            </div>
          </Popover>
        </>
      )}
    </FieldShell>
  );
}
