/**
 * The fields one trigger needs, which depend on what kind of trigger it is (board
 * N-Blocks-Triggers).
 *
 * An entity is chosen first and the rest fits it (`entity-match-fields.tsx`). A time is Simple - a
 * time of day, the days of the week and the months it fires on - or Advanced, a cron expression
 * said back in words with its next runs. The sun is one of its moments - sunrise, the golden
 * hour, the sun crossing an elevation - worked out where the house stands, with when it next
 * comes. `manual` has no fields and says how it runs; `event` is kept as written and says that
 * nothing reports device events yet.
 */
import { useTranslation } from 'react-i18next';

import {
  clockAtToCron,
  MONTHS,
  nextSunEvent,
  SUN_EVENTS,
  TWICE_DAILY_SUN_EVENTS,
  type AutomationTrigger,
  type Month,
  type SunEvent,
} from '@nebulahome/contracts';
import { Note, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { ChoiceChips } from '@/components/choice-chips';
import { WeekdayPicker } from '@/components/weekday-picker';
import { sunEventWord, triggerSummary } from '@/lib/block-summary';
import { cronWords, nextCronRuns, shortMoment } from '@/lib/cron-words';
import { partialEntityId, withoutKey } from '@/library/automation-draft';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { EntityTriggerFields } from '@/routes/library/automation/entity-match-fields';
import { EntityField } from '@/routes/library/entity-field';

export { operatorOptions, StateField } from '@/routes/library/automation/entity-match-fields';

/** What the fields need. */
export type TriggerFieldsProps = {
  /** The trigger being edited. */
  readonly trigger: AutomationTrigger;

  /** Called with the trigger as it now stands. */
  readonly onChange: (trigger: AutomationTrigger) => void;
};

/**
 * Renders the fields for one trigger.
 *
 * @param props - See {@link TriggerFieldsProps}.
 * @returns The fields.
 */
export function TriggerFields(props: TriggerFieldsProps) {
  const { t } = useTranslation();

  const { trigger, onChange } = props;

  switch (trigger.type) {
    case 'manual': {
      return (
        <p className="text-ui-sm text-foreground-subtle">
          {t(
            'library.triggerFields.runsFromItsRun',
            'Runs from its Run button, from the API, or from another automation.',
          )}
        </p>
      );
    }
    case 'entity': {
      return <EntityTriggerFields trigger={trigger} onChange={onChange} />;
    }
    case 'time': {
      return <TimeTriggerFields trigger={trigger} onChange={onChange} />;
    }
    case 'sun': {
      return <SunTriggerFields trigger={trigger} onChange={onChange} />;
    }
    case 'event': {
      return (
        <>
          <Note tone="warning">
            {t(
              'library.triggerFields.notAvailableYetNothing',
              'Not available yet: nothing reports device events to the platform, so this trigger is kept as written and never fires.',
            )}
          </Note>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('library.triggerFields.event', 'Event')}
              size="compact"
              placeholder={t('library.triggerFields.buttonPressed', 'button.pressed')}
              value={trigger.event}
              onChange={(event) => {
                onChange({ ...trigger, event: event.target.value });
              }}
            />
            <EntityField
              label={t('library.triggerFields.from', 'From')}
              isOptional
              hint={t(
                'library.triggerFields.anyEntityWhenNone',
                'Any entity, when none is chosen.',
              )}
              value={trigger.entityId ?? ''}
              onChange={(entityId) => {
                onChange({
                  ...trigger,
                  entityId: entityId === '' ? null : partialEntityId(entityId),
                });
              }}
            />
          </div>
        </>
      );
    }
  }
}

/** A time trigger. */
type TimeTrigger = Extract<AutomationTrigger, { type: 'time' }>;

/** The months as chips: three letters each. */
const MONTH_CHIPS = MONTHS.map((month) => ({
  value: month,
  label: month.charAt(0).toUpperCase() + month.slice(1, 3),
}));

/**
 * Renders the fields for a time trigger: Simple, or Advanced.
 *
 * @param props - The trigger and its change handler.
 * @param props.trigger - The time trigger.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function TimeTriggerFields(props: {
  readonly trigger: TimeTrigger;
  readonly onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t } = useTranslation();

  const { trigger, onChange } = props;
  const { at } = trigger;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">
          {t('library.triggerFields.writtenAs', 'Written as')}
        </span>
        <Segmented
          label={t('library.triggerFields.writtenAs', 'Written as')}
          size="compact"
          options={[
            { value: 'clock', label: t('library.triggerFields.simple', 'Simple') },
            { value: 'cron', label: t('library.triggerFields.advanced', 'Advanced') },
          ]}
          value={at.kind}
          onChange={(kind) => {
            onChange({
              ...trigger,
              at:
                kind === 'cron'
                  ? // The same moments, written as cron: Advanced starts from what Simple said.
                    {
                      kind: 'cron',
                      expression: at.kind === 'clock' ? clockAtToCron(at) : '0 7 * * *',
                    }
                  : { kind: 'clock', time: '07:00' },
            });
          }}
        />
      </div>
      {at.kind === 'clock' ? (
        <SimpleTimeFields trigger={{ ...trigger, at }} onChange={onChange} />
      ) : (
        <CronFields trigger={{ ...trigger, at }} onChange={onChange} />
      )}
    </>
  );
}

/**
 * Simple: a time of day with its seconds, the weekdays and the months.
 *
 * @param props - The trigger and its change handler.
 * @param props.trigger - The time trigger, written simply.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function SimpleTimeFields(props: {
  readonly trigger: TimeTrigger & { readonly at: Extract<TimeTrigger['at'], { kind: 'clock' }> };
  readonly onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t } = useTranslation();

  const { trigger, onChange } = props;
  const { at } = trigger;

  /**
   * Writes the time back with a change.
   *
   * @param next - What changes.
   */
  const write = (next: Partial<typeof at>): void => {
    const merged = { ...at, ...next };

    onChange({
      ...trigger,
      at: {
        kind: 'clock',
        time: merged.time,
        ...((merged.weekdays ?? []).length === 0 ? {} : { weekdays: merged.weekdays }),
        ...((merged.months ?? []).length === 0 ? {} : { months: merged.months }),
      },
    });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t('library.triggerFields.time', 'Time')}
          size="compact"
          type="time"
          step={1}
          className="font-mono"
          hint={t('library.triggerFields.onTheHouseS', "On the house's clock.")}
          value={at.time}
          onChange={(event) => {
            write({ time: event.target.value });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">
          {t('common.on', 'On')}
        </span>
        <WeekdayPicker
          label={t('common.on', 'On')}
          value={at.weekdays ?? []}
          onChange={(weekdays) => {
            write({ weekdays });
          }}
        />
        {(at.weekdays ?? []).length === 0 ? (
          <span className="text-caption text-foreground-subtle">
            {t('library.triggerFields.noneChosenEveryDay', 'None chosen: every day.')}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">
          {t('library.triggerFields.in', 'In')}
        </span>
        <ChoiceChips
          label={t('library.triggerFields.in', 'In')}
          options={MONTH_CHIPS}
          value={at.months ?? []}
          onChange={(months) => {
            write({ months: months as Month[] });
          }}
        />
        {(at.months ?? []).length === 0 ? (
          <span className="text-caption text-foreground-subtle">
            {t('library.triggerFields.noneChosenEveryMonth', 'None chosen: every month.')}
          </span>
        ) : null}
      </div>
      <p className="text-caption text-foreground-muted">
        {t('library.triggerFields.fires', 'Fires: {{summary}}.', {
          summary: triggerSummary(trigger),
        })}
      </p>
    </>
  );
}

/**
 * Advanced: a cron expression, said back in words, with when it next fires.
 *
 * @param props - The trigger and its change handler.
 * @param props.trigger - The time trigger, written as cron.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function CronFields(props: {
  readonly trigger: TimeTrigger & { readonly at: Extract<TimeTrigger['at'], { kind: 'cron' }> };
  readonly onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t } = useTranslation();

  const { trigger, onChange } = props;
  const house = useEditorHouse();
  const { expression } = trigger.at;
  const words = cronWords(expression);
  const next = words === null ? null : nextCronRuns(expression, house.timeZone, 3);
  const said =
    words === null
      ? undefined
      : `${words}${
          next === null || next.length === 0
            ? ''
            : ` · next: ${next.map((moment) => shortMoment(moment, house.timeZone)).join(', ')}`
        }`;

  return (
    <TextField
      label={t('library.triggerFields.expression', 'Expression')}
      size="compact"
      className="font-mono"
      placeholder="0 */2 * * 1-5"
      hint={
        said ??
        t(
          'library.triggerFields.fiveFieldsAsCron',
          'Five fields as cron writes them - minute, hour, day, month, weekday - or six with seconds first.',
        )
      }
      {...(words === null && expression.trim() !== ''
        ? { error: t('library.triggerFields.notAScheduleCron', 'Not a schedule cron can read') }
        : {})}
      value={expression}
      onChange={(event) => {
        onChange({ ...trigger, at: { kind: 'cron', expression: event.target.value } });
      }}
    />
  );
}

/** A sun trigger. */
type SunTrigger = Extract<AutomationTrigger, { type: 'sun' }>;

/**
 * The moments of the sun, as the dropdown offers them, in the order of a day.
 *
 * @returns The options, in the language spoken now.
 */
function sunEventOptions(): { readonly value: SunEvent; readonly label: string }[] {
  return SUN_EVENTS.map((event) => ({ value: event, label: sunEventWord(event) }));
}

/** Events that are a moment on their own: an offset from them means nothing. */
const NO_OFFSET: ReadonlySet<SunEvent> = new Set<SunEvent>([
  'midnight_sun_start',
  'midnight_sun_end',
  'polar_night_start',
  'polar_night_end',
  'elevation_changed',
]);

/**
 * Renders the fields for a sun trigger: the moment, then what the moment needs, and when it next
 * comes where the house stands.
 *
 * @param props - The trigger and its change handler.
 * @param props.trigger - The sun trigger.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function SunTriggerFields(props: {
  readonly trigger: SunTrigger;
  readonly onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t } = useTranslation();

  const { trigger, onChange } = props;
  const house = useEditorHouse();
  const isTwice = TWICE_DAILY_SUN_EVENTS.has(trigger.event);
  const next =
    house.position === null || trigger.event === 'elevation_changed'
      ? null
      : nextSunEvent(trigger, house.position, new Date());

  return (
    <>
      {house.hasPosition ? null : (
        <Note tone="warning">
          {t(
            'library.triggerFields.houseHasNoPosition',
            'The house has no position yet, so the sun has no time here. Set it on the house, under Library › Areas.',
          )}
        </Note>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t('library.triggerFields.when', 'When')}
          size="compact"
          options={sunEventOptions()}
          value={trigger.event}
          onChange={(value) => {
            const event = value as SunEvent;

            onChange({
              type: 'sun',
              ...(trigger.name === undefined ? {} : { name: trigger.name }),
              ...(trigger.isEnabled === undefined ? {} : { isEnabled: trigger.isEnabled }),
              event,
              ...(event === 'elevation_crossed' ? { elevation: trigger.elevation ?? 10 } : {}),
              ...(NO_OFFSET.has(event) || trigger.offsetMinutes === undefined
                ? {}
                : { offsetMinutes: trigger.offsetMinutes }),
            });
          }}
        />
        {NO_OFFSET.has(trigger.event) ? null : (
          <TextField
            label={t('library.triggerFields.offsetMin', 'Offset (min)')}
            size="compact"
            type="number"
            className="font-mono"
            min={-720}
            max={720}
            hint={t('library.triggerFields.negativeIsBefore', 'Negative is before.')}
            value={String(trigger.offsetMinutes ?? 0)}
            onChange={(event) => {
              const minutes = Math.round(Number(event.target.value));
              const rest = withoutKey(trigger, 'offsetMinutes');

              onChange(
                Number.isFinite(minutes) && minutes !== 0
                  ? { ...rest, offsetMinutes: Math.max(-720, Math.min(720, minutes)) }
                  : rest,
              );
            }}
          />
        )}
      </div>

      {isTwice ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">
            {t('library.triggerFields.which', 'Which')}
          </span>
          <Segmented
            label={t('library.triggerFields.which', 'Which')}
            size="compact"
            options={[
              { value: 'both', label: t('library.triggerFields.both', 'Both') },
              { value: 'morning', label: t('library.triggerFields.morning', 'Morning') },
              { value: 'evening', label: t('library.triggerFields.evening', 'Evening') },
            ]}
            value={trigger.period ?? 'both'}
            onChange={(period) => {
              const rest = withoutKey(trigger, 'period');

              onChange(period === 'both' ? rest : { ...rest, period });
            }}
          />
        </div>
      ) : null}

      {trigger.event === 'elevation_crossed' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t('library.triggerFields.elevation', 'Elevation (°)')}
            size="compact"
            type="number"
            className="font-mono"
            min={-90}
            max={90}
            hint={t(
              'library.triggerFields.aboveTheHorizonNegative',
              'Above the horizon; negative is below it.',
            )}
            value={String(trigger.elevation ?? 0)}
            onChange={(event) => {
              const degrees = Number(event.target.value);

              onChange({
                ...trigger,
                elevation: Number.isFinite(degrees) ? Math.max(-90, Math.min(90, degrees)) : 0,
              });
            }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-foreground-muted">
              {t('library.triggerFields.going', 'Going')}
            </span>
            <Segmented
              label={t('library.triggerFields.going', 'Going')}
              size="compact"
              options={[
                { value: 'either', label: t('library.triggerFields.eitherWay', 'Either way') },
                { value: 'rising', label: t('library.triggerFields.rising', 'Rising') },
                { value: 'setting', label: t('library.triggerFields.setting', 'Setting') },
              ]}
              value={trigger.direction ?? 'either'}
              onChange={(direction) => {
                const rest = withoutKey(trigger, 'direction');

                onChange(direction === 'either' ? rest : { ...rest, direction });
              }}
            />
          </div>
        </div>
      ) : null}

      <p className="text-caption text-foreground-subtle">
        {trigger.event === 'elevation_changed'
          ? t(
              'library.triggerFields.firesEachTimeThe',
              'Fires each time the sun entity reports its elevation, about once a minute.',
            )
          : next === null
            ? house.position === null
              ? t(
                  'library.triggerFields.workedOutWhereThe',
                  'Worked out where the house stands, once it has a position.',
                )
              : t(
                  'library.triggerFields.thisDoesNotHappen',
                  'This does not happen where the house is.',
                )
            : t('library.triggerFields.nextNextOnThe', "Next: {{next}}, on the house's clock.", {
                next: shortMoment(next, house.timeZone),
              })}
      </p>
    </>
  );
}
