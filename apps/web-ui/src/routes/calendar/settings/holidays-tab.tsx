/**
 * The Holidays tab (CAL-Set-Holidays, CAL-States): where the house keeps its holidays - country,
 * region and town, the town suggested from the house's position, its patron saint from our list or
 * typed by hand - the weekend days, and the year's holidays, each of which can be hidden (a working
 * day again). Holidays added by hand are events of the Holidays calendar.
 *
 * The place, the weekend and the hidden holidays are settings (`calendar.*`), saved at once
 * through `PATCH /settings`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  DAYS_OF_WEEK,
  type CalendarHoliday,
  type CalendarPatron,
  type CalendarView,
  type JsonValue,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  DateField,
  EmptyState,
  IconButton,
  Pill,
  SelectField,
  TAG_FILL_CLASSES,
  TAG_TINT_CLASSES,
  TextField,
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { WeekdayPicker } from '@/components/weekday-picker';
import { dateTimeFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';
import { fetchAutomationHouse, LIBRARY_QUERY_KEYS } from '@/library/api';
import { CALENDAR_QUERY_KEYS, fetchHolidays } from '@/routes/calendar/api';
import { dayWords } from '@/routes/calendar/calendar-time';
import { AddHolidayDialog } from '@/routes/calendar/settings/add-holiday-dialog';
import {
  CALENDAR_SETTINGS_KEYS,
  fetchPlaces,
  fetchPlaceSuggestion,
} from '@/routes/calendar/settings/settings-api';
import { useHolidayPlace } from '@/routes/calendar/settings/use-holiday-place';
import { SETTINGS_QUERY_KEYS, updateServerSettings } from '@/settings/api';

/** What the tab needs. */
export type HolidaysTabProps = {
  readonly calendars: readonly CalendarView[];

  /** Opens the Calendars tab, where Day off is set. */
  readonly onOpenCalendars: () => void;
};

/** A card of the tab. */
const CARD = 'flex flex-col rounded-card border border-border bg-surface shadow-edge';

/** A day of the year, as a patron is kept: month and day of a leap year, so 29 February fits. */
const PATRON_YEAR = 2024;

/**
 * The day of a patron in words: "7 December".
 *
 * @param patron - The month and day.
 * @param patron.month - The month, from 1.
 * @param patron.day - The day.
 * @returns The words.
 */
function patronDay(patron: { readonly month: number; readonly day: number }): string {
  return dateTimeFormat({ day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(PATRON_YEAR, patron.month - 1, patron.day),
  );
}

/**
 * Renders the tab.
 *
 * @param props - See {@link HolidaysTabProps}.
 * @returns The tab.
 */
export function HolidaysTab(props: HolidaysTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { calendars, onOpenCalendars } = props;
  const can = useSession((state) => state.can);
  const canWrite = can('calendar:manage') && can('settings:write');
  const place = useHolidayPlace();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [isPicking, setPicking] = useState(false);
  const [editing, setEditing] = useState<CalendarHoliday | 'new' | null>(null);
  const [patronDraft, setPatronDraft] = useState<{ name: string; day: string | null } | null>(null);
  const holidaysCalendar = calendars.find((calendar) => calendar.kind === 'holidays');

  const house = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automationHouse,
    queryFn: signalled(fetchAutomationHouse),
    staleTime: 3_600_000,
  });
  const suggestion = useQuery({
    queryKey: CALENDAR_SETTINGS_KEYS.suggestion,
    queryFn: signalled(fetchPlaceSuggestion),
    staleTime: 3_600_000,
  });
  const countries = useQuery({
    queryKey: [...CALENDAR_SETTINGS_KEYS.places, 'countries'],
    queryFn: signalled(async (signal) => fetchPlaces({}, signal)),
    staleTime: 3_600_000,
    enabled: place.canRead,
  });
  const regions = useQuery({
    queryKey: [...CALENDAR_SETTINGS_KEYS.places, place.country ?? ''],
    queryFn: signalled(async (signal) => fetchPlaces({ country: place.country }, signal)),
    staleTime: 3_600_000,
    enabled: place.canRead && place.country !== null,
  });
  const towns = useQuery({
    queryKey: [...CALENDAR_SETTINGS_KEYS.places, place.country ?? '', place.region ?? ''],
    queryFn: signalled(async (signal) =>
      fetchPlaces({ country: place.country, region: place.region }, signal),
    ),
    staleTime: 3_600_000,
    enabled: place.canRead && place.country !== null && place.region !== null,
  });
  const holidays = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.holidays, year],
    queryFn: signalled(async (signal) => fetchHolidays(year, signal)),
  });

  const save = useMutation({
    /**
     * Saves some of the holiday settings.
     *
     * @param changes - The settings, by key.
     * @returns Every setting.
     */
    mutationFn: async (changes: Readonly<Record<string, JsonValue>>) =>
      updateServerSettings(changes),

    /**
     * Keeps what the server now holds, and reads the holidays again.
     *
     * @param answer - Every setting.
     */
    onSuccess: async (answer) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEYS.server, answer);
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
    },

    /**
     * Says why it was not saved.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('calendar.holidays.notSaved', 'Not saved'),
        message: toMessage(error),
      });
    },
  });

  const town = towns.data?.towns.find((one) => one.town === place.town);
  const listedPatron = town?.patronName ?? null;
  const patronHoliday = holidays.data?.find((holiday) => holiday.kind === 'patron');
  const isSuggested =
    suggestion.data?.country === place.country &&
    suggestion.data.region === place.region &&
    suggestion.data.town === place.town;
  const list = holidays.data ?? [];
  const hidden = new Set(place.hiddenHolidays);
  const dayOffCalendars = calendars.filter((calendar) => calendar.isDayOff);

  /**
   * Saves a typed patron once it has a name and a day.
   *
   * @param draft - What is typed.
   * @param draft.name - The saint's name.
   * @param draft.day - The day, `YYYY-MM-DD`, of which the month and day count.
   */
  const savePatron = (draft: { name: string; day: string | null }): void => {
    if (draft.name.trim() === '' || draft.day === null) {
      return;
    }

    const patron: CalendarPatron = {
      name: draft.name.trim(),
      month: Number(draft.day.slice(5, 7)),
      day: Number(draft.day.slice(8, 10)),
    };

    save.mutate(
      { 'calendar.patron': patron },
      {
        /** Puts the typed patron away: the card says it now. */
        onSuccess: () => {
          setPatronDraft(null);
        },
      },
    );
  };

  // Nowhere yet, and the house has no position to suggest one from (CAL-States).
  if (
    place.canRead &&
    !place.isPending &&
    place.country === null &&
    house.data?.position === null &&
    !isPicking
  ) {
    return (
      <div className="relative min-h-96 overflow-hidden rounded-card border border-dashed border-border-strong">
        <EmptyState
          icon={<AppIcon id="map-pin" size={32} />}
          title={t('calendar.holidays.needPosition', 'Holidays need to know where the house is')}
          description={t(
            'calendar.holidays.needPositionLine',
            'With the house’s position I suggest country, region and town. You can also pick them by hand.',
          )}
          action={
            <span className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setPicking(true);
                }}
              >
                {t('calendar.holidays.pickByHand', 'Pick by hand')}
              </Button>
              <Button
                onClick={() => {
                  void navigate('/areas');
                }}
              >
                <AppIcon id="map-pin" size={15} />
                {t('calendar.holidays.setPosition', 'Set the position')}
              </Button>
            </span>
          }
        />
      </div>
    );
  }

  const typed = patronDraft;
  const patronCard =
    place.town === null ? null : patronDraft !== null ||
      (listedPatron === null && place.patron === null) ? (
      <div className="flex flex-col gap-3 rounded-inner border border-warning-line bg-warning-soft p-3.5">
        <span className="flex items-center gap-2.5 text-ui">
          <AppIcon id="flag" size={16} className="shrink-0 text-warning" />
          {listedPatron === null
            ? t('calendar.holidays.patronMissing', '{{town}}’s patron saint isn’t in our list', {
                town: town?.name ?? place.town,
              })
            : t('calendar.holidays.patronTyped', 'The patron saint of {{town}}', {
                town: town?.name ?? place.town,
              })}
        </span>
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <TextField
            label={t('calendar.holidays.patronName', 'Patron saint’s name')}
            isLabelHidden
            placeholder={t('calendar.holidays.patronName', 'Patron saint’s name')}
            disabled={!canWrite}
            value={typed?.name ?? ''}
            onChange={(change) => {
              setPatronDraft({ name: change.target.value, day: typed?.day ?? null });
            }}
            onBlur={() => {
              if (typed !== null) {
                savePatron(typed);
              }
            }}
          />
          <DateField
            label={t('calendar.holidays.day', 'Day')}
            isLabelHidden
            disabled={!canWrite}
            value={typed?.day ?? null}
            onChange={(day) => {
              const next = { name: typed?.name ?? '', day };
              setPatronDraft(next);
              savePatron(next);
            }}
          />
        </div>
        <span className="text-caption text-foreground-subtle">
          {t(
            'calendar.holidays.patronLine',
            'It comes back every year and makes the day a day off. You’ll find it with the holidays added by hand.',
          )}
        </span>
      </div>
    ) : (
      <div
        className={cn(
          'flex items-center gap-3.5 rounded-inner border px-3.5 py-3',
          TAG_TINT_CLASSES.red,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-tag-red/14">
          <AppIcon id="flag" size={17} />
        </span>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-ui font-medium text-foreground">
            {place.patron === null
              ? [
                  listedPatron,
                  patronHoliday === undefined
                    ? null
                    : patronDay({
                        month: Number(patronHoliday.date.slice(5, 7)),
                        day: Number(patronHoliday.date.slice(8, 10)),
                      }),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `${place.patron.name} · ${patronDay(place.patron)}`}
          </span>
          <span className="text-caption text-foreground-subtle">
            {place.patron === null
              ? t(
                  'calendar.holidays.patronListed',
                  'Patron of {{town}}, from our list of provincial capitals',
                  {
                    town: town?.name ?? place.town,
                  },
                )
              : t('calendar.holidays.patronByHand', 'Patron of {{town}}, typed by hand', {
                  town: town?.name ?? place.town,
                })}
          </span>
        </span>
        {canWrite ? (
          <IconButton
            label={t('calendar.holidays.changePatron', 'Change the patron')}
            onClick={() => {
              setPatronDraft({
                name: place.patron?.name ?? '',
                day:
                  place.patron === null
                    ? null
                    : `${String(year)}-${String(place.patron.month).padStart(2, '0')}-${String(place.patron.day).padStart(2, '0')}`,
              });
            }}
          >
            <AppIcon id="pencil" size={15} />
          </IconButton>
        ) : null}
      </div>
    );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[27.5rem_minmax(0,1fr)]">
      {place.canRead ? (
        <div className="flex flex-col gap-5">
          <section className={cn(CARD, 'gap-4.5 p-5')}>
            <span className="flex flex-col gap-1">
              <span className="text-subhead font-medium">
                {t('calendar.holidays.where', 'Where')}
              </span>
              <span className="text-caption text-foreground-subtle">
                {t(
                  'calendar.holidays.whereLine',
                  'National holidays, the region’s, and the town’s patron saint.',
                )}
              </span>
            </span>
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label={t('calendar.holidays.country', 'Country')}
                disabled={!canWrite}
                options={[
                  ...(place.country === null
                    ? [{ value: '', label: t('calendar.holidays.pick', 'Pick one') }]
                    : []),
                  ...(countries.data?.countries ?? []).map((one) => ({
                    value: one.code,
                    label: one.name,
                  })),
                ]}
                value={place.country ?? ''}
                onChange={(country) => {
                  save.mutate({
                    'calendar.country': country,
                    'calendar.region': null,
                    'calendar.town': null,
                    'calendar.patron': null,
                  });
                }}
              />
              <SelectField
                label={t('calendar.holidays.region', 'Region')}
                disabled={!canWrite || place.country === null}
                options={[
                  { value: '', label: t('calendar.holidays.noRegion', 'None') },
                  ...(regions.data?.regions ?? []).map((one) => ({
                    value: one.code,
                    label: one.name,
                  })),
                ]}
                value={place.region ?? ''}
                onChange={(region) => {
                  save.mutate({
                    'calendar.region': region === '' ? null : region,
                    'calendar.town': null,
                    'calendar.patron': null,
                  });
                }}
              />
            </div>
            {place.region === null || (towns.data?.towns.length ?? 0) === 0 ? null : (
              <SelectField
                label={t('calendar.holidays.town', 'Town')}
                disabled={!canWrite}
                options={[
                  { value: '', label: t('calendar.holidays.noTown', 'None') },
                  ...(towns.data?.towns ?? []).map((one) => ({
                    value: one.town,
                    label: one.province === null ? one.name : `${one.name} (${one.province})`,
                  })),
                ]}
                value={place.town ?? ''}
                hint={
                  isSuggested ? (
                    <span className="inline-flex items-center gap-1.5">
                      <AppIcon id="map-pin" size={13} />
                      {t('calendar.holidays.suggested', 'Suggested from the house’s position')}
                      {' · '}
                      <button
                        type="button"
                        className="text-primary hover:text-primary-hover"
                        onClick={() => {
                          void navigate('/areas');
                        }}
                      >
                        {t('calendar.holidays.changePosition', 'change the position')}
                      </button>
                    </span>
                  ) : undefined
                }
                onChange={(value) => {
                  setPatronDraft(null);
                  save.mutate({
                    'calendar.town': value === '' ? null : value,
                    'calendar.patron': null,
                  });
                }}
              />
            )}
            {patronCard}
          </section>

          <section className={cn(CARD, 'gap-3.5 p-5')}>
            <span className="flex flex-col gap-1">
              <span className="text-subhead font-medium">
                {t('calendar.holidays.daysOff', 'Days off')}
              </span>
              <span className="text-caption text-foreground-subtle">
                {t(
                  'calendar.holidays.daysOffLine',
                  'With the holidays and the calendars marked as Day off, they decide the entities Working today and Working tomorrow.',
                )}
              </span>
            </span>
            <WeekdayPicker
              label={t('calendar.holidays.weekend', 'Weekend days')}
              disabled={!canWrite}
              value={place.weekendDays.flatMap((index) => DAYS_OF_WEEK[index] ?? [])}
              onChange={(days) => {
                save.mutate({
                  'calendar.weekend_days': days.map((day) => DAYS_OF_WEEK.indexOf(day)),
                });
              }}
            />
            <span className="flex flex-wrap items-center gap-2 text-caption text-foreground-subtle">
              {t('calendar.holidays.alsoCounting', 'Also counting:')}
              {dayOffCalendars.map((calendar) => (
                <span
                  key={calendar.id}
                  className={cn(
                    'inline-flex h-6 items-center gap-1.5 rounded-pill border px-2.5 font-medium',
                    TAG_TINT_CLASSES[calendar.color],
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', TAG_FILL_CLASSES[calendar.color])} />
                  {calendar.name}
                </span>
              ))}
              <button
                type="button"
                className="text-primary hover:text-primary-hover"
                onClick={onOpenCalendars}
              >
                {t('calendar.holidays.changeInCalendars', 'change in the calendars')}
              </button>
            </span>
          </section>
        </div>
      ) : null}

      <section className={cn(CARD, 'overflow-hidden')}>
        <div className="flex items-center justify-between gap-3 py-3 pr-3 pl-5">
          <span className="flex items-baseline gap-2.5">
            <span className="text-subhead font-medium">
              {t('calendar.holidays.inYear', 'Holidays in {{year}}', { year })}
            </span>
            <span className="font-mono text-mono-caption text-foreground-subtle">
              {t('calendar.holidays.counted', '{{count}} · {{hidden}} hidden', {
                count: list.filter((holiday) => !holiday.isHidden).length,
                hidden: list.filter((holiday) => holiday.isHidden).length,
              })}
            </span>
          </span>
          <span className="flex gap-0.5">
            <IconButton
              label={t('calendar.holidays.previousYear', 'Previous year')}
              onClick={() => {
                setYear(year - 1);
              }}
            >
              <AppIcon id="chevron-left" size={16} />
            </IconButton>
            <IconButton
              label={t('calendar.holidays.nextYear', 'Next year')}
              onClick={() => {
                setYear(year + 1);
              }}
            >
              <AppIcon id="chevron-right" size={16} />
            </IconButton>
          </span>
        </div>
        <ul className="border-t border-border">
          {holidays.isPending ? (
            <li className="px-5 py-4 text-ui-sm text-foreground-subtle">
              {t('library.detail.reading', 'Reading…')}
            </li>
          ) : list.length === 0 ? (
            <li className="px-5 py-4 text-ui-sm text-foreground-subtle">
              {t('calendar.holidays.none', 'No holidays in {{year}} at this place.', { year })}
            </li>
          ) : (
            list.map((holiday) => {
              const weekday = (new Date(`${holiday.date}T12:00:00Z`).getUTCDay() + 6) % 7;
              const isWeekend = place.weekendDays.includes(weekday);

              return (
                <li
                  key={`${holiday.key}-${holiday.date}`}
                  className={cn(
                    'grid h-11.5 grid-cols-[5.75rem_minmax(0,1fr)_auto_2rem] items-center gap-3 border-t border-border pr-3 pl-5 first:border-t-0',
                    holiday.isHidden && 'opacity-55',
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-mono-caption',
                      isWeekend ? 'text-foreground-subtle' : 'text-foreground-muted',
                    )}
                  >
                    {dayWords(holiday.date, 'short')}
                  </span>
                  <span
                    className={cn(
                      'truncate text-ui',
                      holiday.isHidden && 'line-through',
                      isWeekend && 'text-foreground-muted',
                    )}
                  >
                    {holiday.name}
                    {isWeekend ? (
                      <span className="text-caption text-foreground-subtle">
                        {' · '}
                        {t('calendar.holidays.onWeekday', 'on a {{weekday}}', {
                          weekday: dateTimeFormat({ weekday: 'long', timeZone: 'UTC' }).format(
                            Date.parse(`${holiday.date}T12:00:00Z`),
                          ),
                        })}
                      </span>
                    ) : null}
                  </span>
                  {holiday.isHidden ? (
                    <Pill>{t('calendar.holidays.hidden', 'Hidden')}</Pill>
                  ) : holiday.kind === 'patron' ? (
                    <Pill tone="danger">{t('calendar.holidays.patron', 'Patron')}</Pill>
                  ) : holiday.kind === 'manual' ? (
                    <Pill tone="accent">{t('calendar.holidays.addedByHand', 'Added by hand')}</Pill>
                  ) : (
                    <span className="text-caption text-foreground-subtle">
                      {holiday.kind === 'national'
                        ? t('calendar.holidays.national', 'National')
                        : t('calendar.holidays.regional', 'Regional')}
                    </span>
                  )}
                  {!canWrite ? (
                    <span />
                  ) : holiday.kind === 'manual' && holiday.eventId !== null ? (
                    <IconButton
                      label={t('calendar.holidays.edit', 'Edit')}
                      onClick={() => {
                        setEditing(holiday);
                      }}
                    >
                      <AppIcon id="pencil" size={15} />
                    </IconButton>
                  ) : (
                    <IconButton
                      label={
                        holiday.isHidden
                          ? t('calendar.holidays.showAgain', 'Show again')
                          : t('calendar.holidays.hide', 'Hide')
                      }
                      className={holiday.isHidden ? 'text-primary' : undefined}
                      onClick={() => {
                        const next = new Set(hidden);

                        if (holiday.isHidden) {
                          next.delete(holiday.key);
                        } else {
                          next.add(holiday.key);
                        }

                        save.mutate({ 'calendar.hidden_holidays': [...next] });
                      }}
                    >
                      <AppIcon id={holiday.isHidden ? 'eye' : 'eye-off'} size={15} />
                    </IconButton>
                  )}
                </li>
              );
            })
          )}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          {canWrite && holidaysCalendar !== undefined ? (
            <Button
              variant="bare"
              size="compact"
              onClick={() => {
                setEditing('new');
              }}
            >
              <AppIcon id="plus" size={14} />
              {t('calendar.holidays.add', 'Add a holiday')}
            </Button>
          ) : (
            <span />
          )}
          <span className="text-caption text-foreground-subtle">
            {t('calendar.holidays.hiddenLine', 'A hidden holiday is a working day again')}
          </span>
        </div>
      </section>

      {editing === null || holidaysCalendar === undefined ? null : (
        <AddHolidayDialog
          calendarId={holidaysCalendar.id}
          year={year}
          {...(editing === 'new' ? {} : { holiday: editing })}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
