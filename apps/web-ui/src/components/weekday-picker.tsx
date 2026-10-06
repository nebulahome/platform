/**
 * The days of the week as chips: several at once, or exactly one.
 *
 * A row of seven short names rather than a list: the week reads at a glance, and the chosen days
 * stand out. Each chip is a checkbox - or a radio, choosing one - hidden behind its label, so the
 * keyboard and a screen reader get the control they expect.
 */
import { DAYS_OF_WEEK, type DayOfWeek } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

/** What the picker needs. */
export type WeekdayPickerProps = {
  /** What the group is, to a screen reader. */
  readonly label: string;

  /** The days chosen. */
  readonly value: readonly DayOfWeek[];

  /** Called with the days chosen now. */
  readonly onChange: (days: DayOfWeek[]) => void;

  /** Whether exactly one day is chosen, as radios, rather than any number. */
  readonly isSingle?: boolean;

  readonly disabled?: boolean;
  readonly className?: string;
};

/**
 * Renders the picker.
 *
 * @param props - See {@link WeekdayPickerProps}.
 * @returns The chips.
 */
export function WeekdayPicker(props: WeekdayPickerProps) {
  const { label, value, onChange, isSingle = false, disabled = false, className } = props;

  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {DAYS_OF_WEEK.map((day) => {
        const isChosen = value.includes(day);

        return (
          <label
            key={day}
            className={cn(
              'press flex h-control-sm items-center rounded-chip border px-3 text-ui capitalize',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              isChosen
                ? 'border-border-strong bg-surface-high text-foreground'
                : 'border-border text-foreground-muted hover:text-foreground',
            )}
          >
            <input
              type={isSingle ? 'radio' : 'checkbox'}
              name={isSingle ? label : undefined}
              checked={isChosen}
              disabled={disabled}
              className="sr-only"
              onChange={() => {
                if (isSingle) {
                  onChange([day]);

                  return;
                }

                onChange(
                  isChosen
                    ? value.filter((one) => one !== day)
                    : DAYS_OF_WEEK.filter((one) => one === day || value.includes(one)),
                );
              }}
            />
            {day.slice(0, 3)}
          </label>
        );
      })}
    </div>
  );
}
