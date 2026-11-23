/**
 * One calendar in the Calendars tab, opening in place (CAL-Set-Calendars, CAL-Set-Rows): its name
 * and colour, its event models, its source, Day off, its Editors, the entity it is in the Calendar
 * device as, and Delete. Every change saves at once.
 *
 * Holidays is worked out rather than typed: its name is fixed, it has no models, source or
 * Editors, and it is always a day off. A person's own calendar goes with the account, so it has no
 * Delete.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type { CalendarUpdate, CalendarView } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  Collapse,
  ColorSwatches,
  Pill,
  Switch,
  TextField,
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { PeopleField } from '@/components/people-field';
import { listFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { clockText } from '@/lib/format-time';
import { signalled } from '@/lib/signalled';
import { CALENDAR_QUERY_KEYS, fetchHolidays } from '@/routes/calendar/api';
import { CalendarMark } from '@/routes/calendar/settings/calendar-mark';
import { DeleteCalendarDialog } from '@/routes/calendar/settings/delete-calendar-dialog';
import { IcsSource } from '@/routes/calendar/settings/ics-source';
import { ModelsBlock } from '@/routes/calendar/settings/models-block';
import {
  setCalendarEditors,
  updateCalendar,
  type CalendarPerson,
} from '@/routes/calendar/settings/settings-api';
import { useHolidayPlace } from '@/routes/calendar/settings/use-holiday-place';
import { WellRow } from '@/routes/calendar/settings/well-row';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { entityPath } from '@/routes/library/entity/entity-path';

/** The columns of the table, shared by its heading and its rows. */
export const CALENDAR_ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-4 md:grid-cols-[minmax(0,1fr)_9.5rem_8.5rem_7rem_2rem]';

/** What the row needs. */
export type CalendarRowProps = {
  readonly calendar: CalendarView;

  /** Everyone in the house, for the Editors. */
  readonly people: readonly CalendarPerson[];
  readonly isPeoplePending: boolean;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
};

/**
 * What a row's kind column says.
 *
 * @param calendar - The calendar.
 * @returns "House", "Holidays", "Personal", "From a URL" or "From a file".
 */
function kindWord(calendar: CalendarView): string {
  if (calendar.kind === 'holidays') {
    return translate('calendar.settings.kindHolidays', 'Holidays');
  }

  if (calendar.kind === 'personal') {
    return translate('calendar.settings.kindPersonal', 'Personal');
  }

  if (calendar.icsUrl !== null) {
    return translate('calendar.settings.kindUrl', 'From a URL');
  }

  return calendar.icsFile === null
    ? translate('calendar.settings.kindHouse', 'House')
    : translate('calendar.settings.kindFile', 'From a file');
}

/**
 * Renders the row.
 *
 * @param props - See {@link CalendarRowProps}.
 * @returns The row.
 */
export function CalendarRow(props: CalendarRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selfId = useSession((state) => state.user?.id);
  const { calendar, people, isPeoplePending, isOpen, onToggle } = props;
  const [name, setName] = useState<string | null>(null);
  const [isDeleting, setDeleting] = useState(false);
  const icons = useCatalogueIcons([calendar.icon]);
  const isHolidays = calendar.kind === 'holidays';
  const isPersonal = calendar.kind === 'personal';
  const hasSource = calendar.icsUrl !== null || calendar.icsFile !== null;
  const canManage = calendar.canManage;
  const place = useHolidayPlace();
  const year = new Date().getFullYear();
  const holidays = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.holidays, year],
    queryFn: signalled(async (signal) => fetchHolidays(year, signal)),
    enabled: isHolidays,
  });

  const owner = people.find((person) => person.id === calendar.ownerUserId);
  const houseOwner = people.find((person) => person.role === 'owner');
  const locked = new Map<string, string>([
    ...people.flatMap((person): [string, string][] =>
      person.role === 'owner'
        ? [[person.id, t('calendar.settings.alwaysOwner', 'Always · owner')]]
        : person.role === 'admin'
          ? [[person.id, t('calendar.settings.alwaysAdmin', 'Always · admin')]]
          : [],
    ),
    ...(owner === undefined
      ? []
      : [[owner.id, t('calendar.settings.alwaysItsOwner', 'Always · its owner')] as const]),
  ]);
  const editorIds = calendar.editorIds.filter((id) => !locked.has(id));
  const editors = people.filter(
    (person) => locked.has(person.id) || calendar.editorIds.includes(person.id),
  );

  const update = useMutation({
    /**
     * Saves one change of the row.
     *
     * @param body - What changes.
     * @returns The calendar.
     */
    mutationFn: async (body: CalendarUpdate) => updateCalendar(calendar.id, body),

    /** Reads the calendars again. */
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.calendars });
    },

    /**
     * Says why it was not saved.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('calendar.settings.notSaved', 'Not saved'),
        message: toMessage(error),
      });
    },
  });
  const setEditors = useMutation({
    /**
     * Saves who edits.
     *
     * @param userIds - Everyone ticked.
     * @returns When it is saved.
     */
    mutationFn: async (userIds: readonly string[]) => setCalendarEditors(calendar.id, userIds),

    /** Reads the calendars again. */
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.calendars });
    },

    /**
     * Says why it was not saved.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('calendar.settings.notSaved', 'Not saved'),
        message: toMessage(error),
      });
    },
  });

  const caption = isHolidays
    ? place.words === null
      ? t('calendar.settings.workedOut', 'Worked out')
      : t('calendar.settings.workedOutAt', 'Worked out · {{place}}', { place: place.words })
    : isPersonal
      ? t('calendar.settings.ownersOwn', '{{name}}’s own', {
          name: owner?.username ?? calendar.name,
        })
      : calendar.icsUrl !== null
        ? calendar.icsState?.lastSuccessAt == null
          ? t('calendar.settings.kindUrl', 'From a URL')
          : t('calendar.settings.fromUrlUpdated', 'From a URL · updated at {{time}}', {
              time: clockText(calendar.icsState.lastSuccessAt),
            })
        : calendar.icsFile !== null
          ? t('calendar.settings.fromFileNamed', 'From a file · {{name}}', {
              name: calendar.icsFile.name,
            })
          : calendar.models.length === 0
            ? kindWord(calendar)
            : t('calendar.settings.kindModels', {
                kind: kindWord(calendar),
                count: calendar.models.length,
                defaultValue_one: '{{kind}} · {{count}} model',
                defaultValue_other: '{{kind}} · {{count}} models',
              });
  const isFailing = calendar.icsUrl !== null && calendar.icsState?.error != null;
  const others = people.filter((person) => !editors.includes(person));

  return (
    <div className={cn('border-t border-border', isOpen && 'bg-surface-raised')}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={cn(
          CALENDAR_ROW_GRID,
          'w-full px-5 py-3.5 text-left transition-colors hover:bg-surface-raised/40',
        )}
      >
        <span className="flex min-w-0 items-center gap-3.5">
          <CalendarMark calendar={calendar} icon={icons.get(calendar.icon ?? '')} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-ui font-medium text-foreground">{calendar.name}</span>
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-caption',
                isFailing ? 'text-warning' : 'text-foreground-subtle',
              )}
            >
              {isFailing ? <AppIcon id="triangle-alert" size={13} className="shrink-0" /> : null}
              <span className="truncate">{caption}</span>
            </span>
          </span>
        </span>
        <span className="flex -space-x-1.5 max-md:hidden">
          {editors.slice(0, 5).map((person) => (
            <Avatar
              key={person.id}
              displayName={person.displayName}
              avatarUrl={person.avatarUrl}
              className="ring-2 ring-surface"
            />
          ))}
        </span>
        <span className="max-md:hidden">
          <Pill>{kindWord(calendar)}</Pill>
        </span>
        <span className="font-mono text-ui-sm text-foreground-muted tabular-nums max-md:hidden">
          {isHolidays
            ? holidays.data === undefined
              ? ''
              : t('calendar.settings.holidaysInYear', '{{count}} in {{year}}', {
                  count: holidays.data.filter((holiday) => !holiday.isHidden).length,
                  year,
                })
            : calendar.eventCount}
        </span>
        <AppIcon
          id="chevron-down"
          size={15}
          className={cn(
            'justify-self-center text-foreground-subtle transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      <Collapse isOpen={isOpen} className="flex flex-col gap-5 px-5 pt-1.5 pb-5 md:pl-17.5">
        <div className="grid items-start gap-6 md:grid-cols-[18.75rem_minmax(0,1fr)]">
          <TextField
            label={t('calendar.settings.name', 'Name')}
            value={name ?? calendar.name}
            disabled={isHolidays || !canManage}
            maxLength={40}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onBlur={() => {
              const trimmed = (name ?? '').trim();

              if (trimmed !== '' && trimmed !== calendar.name) {
                update.mutate({ name: trimmed });
              }

              setName(null);
            }}
          />
          <ColorSwatches
            label={t('calendar.settings.colour', 'Colour')}
            value={calendar.color}
            disabled={!canManage}
            onChange={(color) => {
              update.mutate({ color });
            }}
          />
        </div>

        {isHolidays ? (
          <>
            <WellRow
              title={t('calendar.settings.whichHolidays', 'Which holidays')}
              line={place.words ?? t('calendar.settings.noPlaceYet', 'No place chosen yet')}
            >
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  void navigate('?tab=holidays');
                }}
              >
                {t('calendar.settings.openHolidays', 'Open Holidays')}
              </Button>
            </WellRow>
            <WellRow
              title={t('calendar.settings.dayOff', 'Day off')}
              line={t(
                'calendar.settings.holidaysAlwaysOff',
                'Holidays always make the day a day off.',
              )}
            >
              <span className="flex items-center gap-1.5 text-foreground-subtle">
                <AppIcon id="lock" size={13} />
                <Switch
                  label={t('calendar.settings.dayOff', 'Day off')}
                  isOn
                  disabled
                  onChange={() => null}
                />
              </span>
            </WellRow>
            <WellRow
              title={t('calendar.settings.editors', 'Editors')}
              line={t(
                'calendar.settings.holidaysEditors',
                'Only the owner and admins: holidays are a house setting.',
              )}
            >
              <AppIcon id="lock" size={15} className="text-foreground-subtle" />
            </WellRow>
          </>
        ) : (
          <>
            {/* A calendar that reads a source says so first, as its events come from there. */}
            {hasSource ? <IcsSource calendar={calendar} people={people} /> : null}
            <ModelsBlock calendar={calendar} />
            {hasSource ? null : <IcsSource calendar={calendar} people={people} />}
            <WellRow
              title={t('calendar.settings.dayOff', 'Day off')}
              line={t(
                'calendar.settings.dayOffLine',
                'Days with an event in this calendar count as days off.',
              )}
            >
              <Switch
                label={t('calendar.settings.dayOff', 'Day off')}
                isOn={calendar.isDayOff}
                disabled={!canManage}
                isBusy={update.isPending}
                onChange={(isDayOff) => {
                  update.mutate({ isDayOff });
                }}
              />
            </WellRow>
            <div className="flex flex-col gap-2.5">
              <PeopleField
                legend={
                  <span className="flex flex-col gap-0.75">
                    <span className="text-ui font-medium text-foreground">
                      {t('calendar.settings.editors', 'Editors')}
                    </span>
                    <span className="font-normal text-foreground-subtle">
                      {t(
                        'calendar.settings.editorsLine',
                        'Who adds, moves and deletes its events. Everyone sees it.',
                      )}
                    </span>
                  </span>
                }
                people={people}
                value={editorIds}
                onChange={(userIds) => {
                  setEditors.mutate(userIds);
                }}
                selfId={selfId}
                isPending={isPeoplePending}
                locked={locked}
                isReadOnly={!canManage}
                trail={(person) => roleWord(person.role)}
                summary={(ids) =>
                  ids.length === 1
                    ? t('calendar.settings.onlyEdits', 'Only {{name}} edits it.', {
                        name: people.find((person) => person.id === ids[0])?.displayName ?? '',
                      })
                    : [
                        t('calendar.settings.peopleEdit', '{{count}} people edit {{calendar}}.', {
                          count: ids.length,
                          calendar: calendar.name,
                        }),
                        others.length === 0 || others.length > 2
                          ? ''
                          : t('calendar.settings.onlySee', {
                              count: others.length,
                              names: listFormat({ type: 'conjunction' }).format(
                                others.map((person) => person.displayName),
                              ),
                              defaultValue_one: '{{names}} only sees it.',
                              defaultValue_other: '{{names}} only see it.',
                            }),
                      ]
                        .filter(Boolean)
                        .join(' ')
                }
              />
              {canManage || houseOwner === undefined ? null : (
                <span className="flex items-center gap-2 rounded-inner border border-border px-3 py-2.5 text-caption text-foreground-muted">
                  <AppIcon id="lock" size={14} className="shrink-0 text-foreground-subtle" />
                  {t(
                    'calendar.settings.askOwner',
                    'Only the owner and admins change who edits {{calendar}}. Ask {{owner}}.',
                    { calendar: calendar.name, owner: houseOwner.username },
                  )}
                </span>
              )}
              {calendar.icsUrl === null || (calendar.icsState?.eventCount ?? 0) === 0 ? null : (
                <span className="flex items-center gap-2 text-caption text-foreground-subtle">
                  <AppIcon id="link" size={13} className="shrink-0" />
                  {t(
                    'calendar.settings.urlEventsReadOnly',
                    'The {{count}} events from the URL stay read only for everyone.',
                    { count: calendar.icsState?.eventCount ?? 0 },
                  )}
                </span>
              )}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          {calendar.entityId === null ? (
            <span />
          ) : (
            <span className="flex min-w-0 items-center gap-2.5 text-ui-sm text-foreground-muted">
              <AppIcon id="cpu" size={15} className="shrink-0 text-foreground-subtle" />
              {t('calendar.settings.inTheDevice', 'In the Calendar device as')}
              <Link
                to={entityPath(calendar.entityId)}
                className="flex min-w-0 items-center gap-1.5 font-mono text-mono-caption text-foreground hover:text-primary"
              >
                <span className="truncate">{calendar.entityId}</span>
                <AppIcon id="external-link" size={12} className="shrink-0 text-foreground-subtle" />
              </Link>
            </span>
          )}
          {isHolidays ? (
            <span className="text-caption text-foreground-subtle">
              {t('calendar.settings.alwaysThere', 'Always there: it can’t be deleted')}
            </span>
          ) : isPersonal ? (
            <span className="flex items-center gap-2 text-caption text-foreground-subtle">
              <AppIcon id="user-round" size={14} />
              {t(
                'calendar.settings.goesWithAccount',
                'Goes away with {{name}}’s account, with its entity',
                { name: owner?.username ?? calendar.name },
              )}
            </span>
          ) : (
            <span className="flex items-center gap-3">
              <span className="text-caption text-foreground-subtle">
                {t('calendar.settings.savedAtOnce', 'Changes save at once')}
              </span>
              {canManage ? (
                <Button
                  variant="danger"
                  size="compact"
                  onClick={() => {
                    setDeleting(true);
                  }}
                >
                  <AppIcon id="trash-2" size={14} />
                  {t('calendar.settings.deleteCalendar', 'Delete calendar')}
                </Button>
              ) : null}
            </span>
          )}
        </div>
      </Collapse>

      {isDeleting ? (
        <DeleteCalendarDialog
          calendar={calendar}
          onClose={() => {
            setDeleting(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A role in words, at the right of a person's row.
 *
 * @param role - The role key.
 * @returns "Member", "Guest"; a custom role's key as it is.
 */
function roleWord(role: string | undefined): string {
  switch (role) {
    case 'owner':
      return translate('calendar.settings.roleOwner', 'Owner');
    case 'admin':
      return translate('calendar.settings.roleAdmin', 'Admin');
    case 'member':
      return translate('calendar.settings.roleMember', 'Member');
    case 'guest':
      return translate('calendar.settings.roleGuest', 'Guest');
    default:
      return role ?? '';
  }
}
