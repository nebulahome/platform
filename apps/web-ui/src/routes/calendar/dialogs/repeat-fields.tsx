/**
 * Repeat, always custom (CAL-Repeat): one switch, and when it is on the rule - every N days,
 * weeks, months or years; the days of the week for weeks; the same date or the same weekday for
 * months; ending never, on a day or after a number of times - and the next times it gives, the
 * holidays among them marked. The rule slides open under the switch and folds away again.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { addDays, occurrencesOf, weekdayOf, type CalendarRepeat } from '@nebulahome/contracts';
import {
  AppIcon,
  cn,
  Collapse,
  DateField,
  RadioGroup,
  SelectField,
  Switch,
  TextField,
} from '@nebulahome/ui';

import { WeekdayPicker } from '@/components/weekday-picker';
import { signalled } from '@/lib/signalled';

import { CALENDAR_QUERY_KEYS, fetchHolidays } from '../api';
import { dayWords, monthlyWords, nthOfMonth } from '../calendar-time';

/** The next times shown. */
const NEXT_TIMES = 5;

/** What the fields need. */
export type RepeatFieldsProps = {
  /** The rule; null when it does not repeat. */
  readonly value: CalendarRepeat | null;
  readonly onChange: (rule: CalendarRepeat | null) => void;

  /** The event's first day: what the rule counts from. */
  readonly start: string;
};

/**
 * The holidays of a year, by day, to mark the next times with.
 *
 * @param year - The year.
 * @returns Their names by day; empty until read.
 */
function useHolidayNames(year: number): ReadonlyMap<string, string> {
  const holidays = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.holidays, year],
    queryFn: signalled(async (signal) => fetchHolidays(year, signal)),
    staleTime: 3_600_000,
  });

  return new Map(
    (holidays.data ?? []).filter((each) => !each.isHidden).map((each) => [each.date, each.name]),
  );
}

/**
 * Renders the repeat block.
 *
 * @param props - See {@link RepeatFieldsProps}.
 * @returns The block.
 */
export function RepeatFields(props: RepeatFieldsProps) {
  const { t } = useTranslation();
  const { value: rule, onChange, start } = props;
  const year = Number(start.slice(0, 4));
  const thisYear = useHolidayNames(year);
  const nextYear = useHolidayNames(year + 1);
  const isOn = rule !== null;

  const head = (
    <div className="flex items-center gap-4">
      <span className="flex grow items-center gap-3">
        <AppIcon
          id="repeat"
          size={16}
          className={isOn ? 'text-primary' : 'text-foreground-subtle'}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-ui">{t('calendar.repeat.repeat', 'Repeat')}</span>
          {isOn ? null : (
            <span className="text-caption text-foreground-subtle">
              {t('calendar.repeat.doesNotRepeat', 'Doesn’t repeat')}
            </span>
          )}
        </span>
      </span>
      <Switch
        label={t('calendar.repeat.repeat', 'Repeat')}
        isOn={isOn}
        onChange={(on) => {
          onChange(
            on
              ? { every: 1, unit: 'week', weekdays: [weekdayOf(start)], ends: { kind: 'never' } }
              : null,
          );
        }}
      />
    </div>
  );

  // The rule stays drawn while the block slides shut, so switching it off folds it away.
  const [kept, setKept] = useState(rule);

  if (rule !== null && rule !== kept) {
    setKept(rule);
  }

  const shown = rule ?? kept;

  return (
    <div
      className={cn(
        'flex flex-col border bg-well px-4',
        'transition-[border-color,border-radius,padding] duration-250 ease-out motion-reduce:transition-none',
        isOn ? 'rounded-card border-primary/45 pt-3.5 pb-4' : 'rounded-inner border-border py-3.25',
      )}
    >
      {head}
      <Collapse isOpen={isOn} className="flex flex-col gap-3.5 pt-3.5">
        {shown === null ? null : (
          <RuleFields
            rule={shown}
            start={start}
            onChange={onChange}
            thisYear={thisYear}
            nextYear={nextYear}
          />
        )}
      </Collapse>
    </div>
  );
}

/** What the rule's fields need. */
type RuleFieldsProps = {
  readonly rule: CalendarRepeat;
  readonly onChange: (rule: CalendarRepeat) => void;
  readonly start: string;

  /** The holidays of the start's year and the next, by day, to mark the next times with. */
  readonly thisYear: ReadonlyMap<string, string>;
  readonly nextYear: ReadonlyMap<string, string>;
};

/**
 * Renders the rule: every how many of what, on which days, when it ends, and the next times.
 *
 * @param props - See {@link RuleFieldsProps}.
 * @returns The fields.
 */
function RuleFields(props: RuleFieldsProps) {
  const { t } = useTranslation();
  const { rule, onChange, start, thisYear, nextYear } = props;

  /**
   * Hands on the rule with some of it changed.
   *
   * @param changes - What changes.
   */
  const change = (changes: Partial<CalendarRepeat>): void => {
    onChange({ ...rule, ...changes });
  };

  const next = occurrencesOf(
    {
      isAllDay: true,
      startsOn: start,
      endsOn: start,
      startsAt: null,
      endsAt: null,
      timeZone: 'UTC',
      repeat: rule,
      skippedOn: [],
    },
    start,
    addDays(start, 366 * 3),
    'UTC',
  ).slice(0, NEXT_TIMES);
  const units = [
    {
      value: 'day',
      label: t('calendar.repeat.days', {
        count: rule.every,
        defaultValue_one: 'day',
        defaultValue_other: 'days',
      }),
    },
    {
      value: 'week',
      label: t('calendar.repeat.weeks', {
        count: rule.every,
        defaultValue_one: 'week',
        defaultValue_other: 'weeks',
      }),
    },
    {
      value: 'month',
      label: t('calendar.repeat.months', {
        count: rule.every,
        defaultValue_one: 'month',
        defaultValue_other: 'months',
      }),
    },
    {
      value: 'year',
      label: t('calendar.repeat.years', {
        count: rule.every,
        defaultValue_one: 'year',
        defaultValue_other: 'years',
      }),
    },
  ] as const;
  const weekdayKind = nthOfMonth(start) === 5 ? 'last_weekday' : 'weekday';

  return (
    <>
      <div className="flex items-center gap-2.5 text-ui text-foreground-muted">
        <span>{t('calendar.repeat.every', 'Every')}</span>
        <TextField
          label={t('calendar.repeat.howMany', 'How many')}
          isLabelHidden
          type="number"
          min={1}
          max={99}
          className="w-16 font-mono"
          value={String(rule.every)}
          onChange={(event) => {
            const every = Math.round(Number(event.target.value));

            if (Number.isFinite(every) && every >= 1 && every <= 99) {
              change({ every });
            }
          }}
        />
        <SelectField
          label={t('calendar.repeat.unit', 'Unit')}
          isLabelHidden
          className="w-38"
          options={units}
          value={rule.unit}
          onChange={(unit) => {
            const picked = units.find((each) => each.value === unit)?.value ?? 'week';

            onChange({
              every: rule.every,
              unit: picked,
              ends: rule.ends,
              ...(picked === 'week' ? { weekdays: [weekdayOf(start)] } : {}),
            });
          }}
        />
      </div>

      {rule.unit === 'week' ? (
        <div className="flex flex-col gap-2">
          <span className="text-ui-sm text-foreground-muted">{t('calendar.repeat.on', 'On')}</span>
          <WeekdayPicker
            label={t('calendar.repeat.on', 'On')}
            value={rule.weekdays ?? [weekdayOf(start)]}
            onChange={(weekdays) => {
              if (weekdays.length > 0) {
                change({ weekdays });
              }
            }}
          />
        </div>
      ) : null}

      {rule.unit === 'month' ? (
        <RadioGroup<'date' | 'weekday' | 'last_weekday'>
          label={t('calendar.repeat.onWhich', 'On which day')}
          isLabelHidden
          value={rule.monthly ?? 'date'}
          onChange={(monthly) => {
            change({ monthly });
          }}
          options={[
            { value: 'date', label: firstUpper(monthlyWords('date', start)) },
            { value: weekdayKind, label: firstUpper(monthlyWords(weekdayKind, start)) },
          ]}
        />
      ) : null}

      {rule.unit === 'year' ? (
        <span className="text-ui text-foreground-muted">
          {t('calendar.repeat.onDate', 'On {{date}}', { date: dayWords(start, 'date') })}
        </span>
      ) : null}

      <RadioGroup<'never' | 'on' | 'after'>
        label={t('calendar.repeat.ends', 'Ends')}
        value={rule.ends.kind}
        onChange={(kind) => {
          change({
            ends:
              kind === 'never'
                ? { kind }
                : kind === 'on'
                  ? { kind, day: rule.ends.kind === 'on' ? rule.ends.day : addDays(start, 30) }
                  : { kind, count: rule.ends.kind === 'after' ? rule.ends.count : 10 },
          });
        }}
        options={[
          { value: 'never', label: t('calendar.repeat.never', 'Never') },
          {
            value: 'on',
            label: t('calendar.repeat.endsOn', 'On'),
            trail: (
              <DateField
                label={t('calendar.repeat.endDay', 'Last day')}
                isLabelHidden
                size="compact"
                min={start}
                disabled={rule.ends.kind !== 'on'}
                value={rule.ends.kind === 'on' ? rule.ends.day : addDays(start, 30)}
                onChange={(day) => {
                  change({ ends: { kind: 'on', day } });
                }}
              />
            ),
          },
          {
            value: 'after',
            label: t('calendar.repeat.after', 'After'),
            trail: (
              <TextField
                label={t('calendar.repeat.times', 'Times')}
                isLabelHidden
                size="compact"
                type="number"
                min={1}
                max={999}
                className="w-34 font-mono"
                trail={t('calendar.repeat.timesWord', 'times')}
                disabled={rule.ends.kind !== 'after'}
                value={String(rule.ends.kind === 'after' ? rule.ends.count : 10)}
                onChange={(event) => {
                  const count = Math.round(Number(event.target.value));

                  if (Number.isFinite(count) && count >= 1 && count <= 999) {
                    change({ ends: { kind: 'after', count } });
                  }
                }}
              />
            ),
          },
        ]}
      />

      {next.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-ui-sm text-foreground-muted">
            {t('calendar.repeat.next', 'Next times')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {next.map((time) => {
              const holiday = thisYear.get(time.occurrenceOn) ?? nextYear.get(time.occurrenceOn);

              return (
                <span
                  key={time.occurrenceOn}
                  className={cn(
                    'inline-flex h-6.5 items-center rounded-pill px-2.5 font-mono text-caption whitespace-nowrap',
                    holiday === undefined
                      ? 'bg-surface-raised text-foreground-muted'
                      : 'bg-tag-red/12 text-tag-red',
                  )}
                >
                  {holiday === undefined
                    ? dayWords(time.occurrenceOn, rule.unit === 'year' ? 'year' : 'short')
                    : `${dayWords(time.occurrenceOn, 'short')} · ${holiday}`}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Writes words with a capital first letter, as a choice of its own reads.
 *
 * @param words - The words.
 * @returns "On day 10".
 */
function firstUpper(words: string): string {
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}
