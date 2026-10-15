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
import { SUN_EVENT_WORDS, triggerSummary } from '@/lib/block-summary';
import { cronWords, nextCronRuns, shortMoment } from '@/lib/cron-words';
import { partialEntityId, withoutKey } from '@/library/automation-draft';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { EntityTriggerFields } from '@/routes/library/automation/entity-match-fields';
import { EntityField } from '@/routes/library/entity-field';

export { OPERATOR_OPTIONS, StateField } from '@/routes/library/automation/entity-match-fields';

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
  const { trigger, onChange } = props;

  switch (trigger.type) {
    case 'manual': {
      return (
        <p className="text-ui-sm text-foreground-subtle">
          Runs from its Run button, from the API, or from another automation.
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
            Not available yet: nothing reports device events to the platform, so this trigger is
            kept as written and never fires.
          </Note>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Event"
              size="compact"
              placeholder="button.pressed"
              value={trigger.event}
              onChange={(event) => {
                onChange({ ...trigger, event: event.target.value });
              }}
            />
            <EntityField
              label="From"
              isOptional
              hint="Any entity, when none is chosen."
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
  const { trigger, onChange } = props;
  const { at } = trigger;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">Written as</span>
        <Segmented
          label="Written as"
          size="compact"
          options={[
            { value: 'clock', label: 'Simple' },
            { value: 'cron', label: 'Advanced' },
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
          label="Time"
          size="compact"
          type="time"
          step={1}
          className="font-mono"
          hint="On the house's clock."
          value={at.time}
          onChange={(event) => {
            write({ time: event.target.value });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">On</span>
        <WeekdayPicker
          label="On"
          value={at.weekdays ?? []}
          onChange={(weekdays) => {
            write({ weekdays });
          }}
        />
        {(at.weekdays ?? []).length === 0 ? (
          <span className="text-caption text-foreground-subtle">None chosen: every day.</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">In</span>
        <ChoiceChips
          label="In"
          options={MONTH_CHIPS}
          value={at.months ?? []}
          onChange={(months) => {
            write({ months: months as Month[] });
          }}
        />
        {(at.months ?? []).length === 0 ? (
          <span className="text-caption text-foreground-subtle">None chosen: every month.</span>
        ) : null}
      </div>
      <p className="text-caption text-foreground-muted">{`Fires: ${triggerSummary(trigger)}.`}</p>
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
      label="Expression"
      size="compact"
      className="font-mono"
      placeholder="0 */2 * * 1-5"
      hint={
        said ??
        'Five fields as cron writes them - minute, hour, day, month, weekday - or six with seconds first.'
      }
      {...(words === null && expression.trim() !== ''
        ? { error: 'Not a schedule cron can read' }
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

/** The moments of the sun, as the dropdown offers them, in the order of a day. */
const SUN_EVENT_OPTIONS = SUN_EVENTS.map((event) => ({
  value: event,
  label: SUN_EVENT_WORDS[event] ?? event,
}));

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
          The house has no position yet, so the sun has no time here. Set it on the house, under
          Library › Areas.
        </Note>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="When"
          size="compact"
          options={SUN_EVENT_OPTIONS}
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
            label="Offset (min)"
            size="compact"
            type="number"
            className="font-mono"
            min={-720}
            max={720}
            hint="Negative is before."
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
          <span className="text-caption font-medium text-foreground-muted">Which</span>
          <Segmented
            label="Which"
            size="compact"
            options={[
              { value: 'both', label: 'Both' },
              { value: 'morning', label: 'Morning' },
              { value: 'evening', label: 'Evening' },
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
            label="Elevation (°)"
            size="compact"
            type="number"
            className="font-mono"
            min={-90}
            max={90}
            hint="Above the horizon; negative is below it."
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
            <span className="text-caption font-medium text-foreground-muted">Going</span>
            <Segmented
              label="Going"
              size="compact"
              options={[
                { value: 'either', label: 'Either way' },
                { value: 'rising', label: 'Rising' },
                { value: 'setting', label: 'Setting' },
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
          ? 'Fires each time the sun entity reports its elevation, about once a minute.'
          : next === null
            ? house.position === null
              ? 'Worked out where the house stands, once it has a position.'
              : 'This does not happen where the house is.'
            : `Next: ${shortMoment(next, house.timeZone)}, on the house's clock.`}
      </p>
    </>
  );
}
