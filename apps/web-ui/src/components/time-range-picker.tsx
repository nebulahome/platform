/**
 * Choosing the stretch of time a chart shows: a window ending now at a press, or any stretch by
 * its two ends.
 *
 * The button says what is shown - "Last 24 hours", "3 Sep, 14:00 → 5 Sep, 09:30" - and opens a
 * small sheet under it. The presets are pills that take effect at once; the custom stretch is two
 * date-and-time fields and a button, because a window half typed is not one to read. A stretch
 * that ends before it starts, or ends in the future, is refused in words before anything is read.
 *
 * Shut by Escape, by a press anywhere else, and by the button again - the same shell as the
 * library's Filter sheet.
 */
import { useEffect, useId, useRef, useState } from 'react';

import { AppIcon, Button, cn, TextField } from '@nebulahome/ui';

import { readDateTimeLocal, shortTime, toDateTimeLocal } from '@/lib/format-time';
import {
  HISTORY_RANGE_LABELS,
  HISTORY_RANGES,
  windowOfChoice,
  type HistoryChoice,
} from '@/library/history-series';

/** What the picker needs. */
export type TimeRangePickerProps = {
  /** What is shown now. */
  readonly value: HistoryChoice;

  /** Called with the new choice. */
  readonly onChange: (choice: HistoryChoice) => void;
};

/**
 * Says what a choice shows, for the button.
 *
 * @param choice - The choice.
 * @returns "Last 24 hours", or the two ends of the stretch.
 */
export function describeChoice(choice: HistoryChoice): string {
  return choice.kind === 'preset'
    ? HISTORY_RANGE_LABELS[choice.range]
    : `${shortTime(new Date(choice.from))} → ${shortTime(new Date(choice.to))}`;
}

/**
 * Reads the two ends typed, or says why they will not do.
 *
 * @param fromText - The start, as the field holds it.
 * @param toText - The end, as the field holds it.
 * @param now - The present, which the end may not pass.
 * @returns The stretch, or a sentence.
 */
export function readCustomRange(
  fromText: string,
  toText: string,
  now: number,
): HistoryChoice | { readonly problem: string } {
  const from = readDateTimeLocal(fromText);
  const to = readDateTimeLocal(toText);

  if (from === null || to === null) {
    return { problem: 'Give both ends: a date and a time for each.' };
  }

  if (from >= to) {
    return { problem: 'The start has to come before the end.' };
  }

  // A minute's grace, since the field holds minutes and "now" has seconds.
  if (to > now + 60_000) {
    return { problem: 'The end cannot be in the future: nothing has been recorded there yet.' };
  }

  return { kind: 'custom', from, to };
}

/**
 * Renders the picker.
 *
 * @param props - See {@link TimeRangePickerProps}.
 * @returns The control.
 */
export function TimeRangePicker(props: TimeRangePickerProps) {
  const { value, onChange } = props;
  const [isOpen, setOpen] = useState(false);
  // Filled from what is shown each time the sheet opens, which is when they are first seen.
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const sheetId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /**
     * Shuts the sheet on a press that lands outside it.
     *
     * @param event - The press.
     */
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null;

      if (root.current !== null && target !== null && !root.current.contains(target)) {
        setOpen(false);
      }
    };

    /**
     * Shuts the sheet on Escape.
     *
     * @param event - The key.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return (): void => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  /**
   * Opens the sheet, with the custom fields starting from what is shown now.
   */
  const open = (): void => {
    const now = windowOfChoice(value, Date.now());

    setFromText(toDateTimeLocal(now.from));
    setToText(toDateTimeLocal(now.to));
    setProblem(null);
    setOpen(true);
  };

  /** Shows the stretch typed, when it reads. */
  const apply = (): void => {
    const reading = readCustomRange(fromText, toText, Date.now());

    if ('problem' in reading) {
      setProblem(reading.problem);

      return;
    }

    onChange(reading);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        size="compact"
        aria-expanded={isOpen}
        aria-controls={sheetId}
        aria-label={`Window: ${describeChoice(value)}`}
        onClick={() => {
          if (isOpen) {
            setOpen(false);
          } else {
            open();
          }
        }}
      >
        <AppIcon id="clock" size={14} />
        <span className="tabular">{describeChoice(value)}</span>
        <AppIcon id="chevron-down" size={14} />
      </Button>

      {isOpen ? (
        <div
          id={sheetId}
          role="group"
          aria-label="Choose the window"
          className="absolute top-full right-0 z-40 mt-2 flex w-80 animate-rise flex-col gap-4 rounded-field border border-border-strong bg-surface p-4 shadow-dialog"
        >
          <div className="flex flex-col gap-2">
            <span className="font-mono text-label text-foreground-subtle uppercase">Up to now</span>
            <div role="group" aria-label="Up to now" className="flex flex-wrap gap-1.5">
              {HISTORY_RANGES.map((range) => {
                const isChosen = value.kind === 'preset' && value.range === range;

                return (
                  <button
                    key={range}
                    type="button"
                    aria-pressed={isChosen}
                    onClick={() => {
                      onChange({ kind: 'preset', range });
                      setOpen(false);
                    }}
                    className={cn(
                      'press h-7 rounded-full border px-3 text-caption transition-colors',
                      'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                      isChosen
                        ? 'border-border-strong bg-surface-high font-medium text-foreground'
                        : 'border-border text-foreground-muted hover:text-foreground',
                    )}
                  >
                    {range}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-border" />

          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <span className="font-mono text-label text-foreground-subtle uppercase">Between</span>
            <TextField
              label="From"
              size="compact"
              type="datetime-local"
              value={fromText}
              onChange={(event) => {
                setFromText(event.target.value);
                setProblem(null);
              }}
            />
            <TextField
              label="To"
              size="compact"
              type="datetime-local"
              value={toText}
              onChange={(event) => {
                setToText(event.target.value);
                setProblem(null);
              }}
            />
            {problem === null ? null : (
              <p role="alert" className="text-caption text-danger">
                {problem}
              </p>
            )}
            <Button type="submit" size="compact" className="self-end">
              Show this window
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
