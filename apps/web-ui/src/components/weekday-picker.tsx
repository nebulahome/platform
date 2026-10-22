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
              // The board's day chips: 44 by 34, chosen in the colour of the lane they sit in.
              'press flex h-8.5 min-w-11 items-center justify-center rounded-field border px-2 text-ui-sm capitalize',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              isChosen
                ? 'border-[color-mix(in_srgb,var(--lane,var(--color-primary))_60%,transparent)] bg-[color-mix(in_srgb,var(--lane,var(--color-primary))_14%,transparent)] text-foreground'
                : 'border-border-strong text-foreground-muted hover:text-foreground',
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
