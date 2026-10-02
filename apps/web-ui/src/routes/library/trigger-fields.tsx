/**
 * The fields one trigger needs, which depend on what kind of trigger it is.
 *
 * Five kinds, and the switch is on `type` because that is what the format discriminates on. A
 * form that tried to show every field for every kind would ask for a threshold on a trigger that
 * fires at eight in the morning.
 *
 * `manual` has no fields at all, and says so rather than rendering an empty box: a block with
 * nothing in it looks like something failed to load.
 */
import {
  COMPARISON_OPERATORS,
  type ComparisonOperator,
  SOLAR_EVENTS,
  type SolarEvent,
  type AutomationTrigger,
} from '@nebulahome/contracts';
import { SelectField, TextField } from '@nebulahome/ui';

import { partialEntityId } from '@/library/automation-draft';
import { hasNumber } from '@/library/entity-control';
import { EntityField } from '@/routes/library/entity-field';

/** What the fields need. */
export type TriggerFieldsProps = {
  /** The trigger being edited. */
  readonly trigger: AutomationTrigger;

  /** Called with the trigger as it now stands. */
  readonly onChange: (trigger: AutomationTrigger) => void;
};

/** The comparisons, as a dropdown reads them. */
const OPERATORS = COMPARISON_OPERATORS.map((value) => ({
  value,
  label: {
    lt: 'below',
    lte: 'at most',
    gt: 'above',
    gte: 'at least',
    eq: 'equals',
    neq: 'differs',
  }[value],
}));

/**
 * Renders the fields for one trigger.
 *
 * @param props - See {@link TriggerFieldsProps}.
 * @returns The fields.
 */
export function TriggerFields(props: TriggerFieldsProps) {
  const { trigger, onChange } = props;

  if (trigger.type === 'manual') {
    return (
      <p className="text-ui text-foreground-subtle sm:col-span-2">
        Nothing wakes this on its own. It runs when somebody asks it to.
      </p>
    );
  }

  if (trigger.type === 'state') {
    return (
      <>
        <EntityField
          label="Entity"
          value={trigger.entityId}
          onChange={(entityId) => {
            onChange({ ...trigger, entityId: partialEntityId(entityId) });
          }}
        />
        <TextField
          label="Becomes"
          size="compact"
          placeholder="on"
          value={trigger.to ?? ''}
          hint="Leave empty to fire on any change."
          onChange={(event) => {
            onChange({ ...trigger, to: event.target.value });
          }}
        />
      </>
    );
  }

  if (trigger.type === 'numeric_state') {
    return (
      <>
        <EntityField
          label="Entity"
          accept={hasNumber}
          value={trigger.entityId}
          onChange={(entityId) => {
            onChange({ ...trigger, entityId: partialEntityId(entityId) });
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Goes"
            size="compact"
            options={OPERATORS}
            value={trigger.operator}
            onChange={(operator) => {
              onChange({ ...trigger, operator: operator as ComparisonOperator });
            }}
          />
          <TextField
            label="Value"
            size="compact"
            type="number"
            value={String(trigger.value)}
            onChange={(event) => {
              onChange({ ...trigger, value: Number(event.target.value) });
            }}
          />
        </div>
      </>
    );
  }

  if (trigger.type === 'event') {
    return (
      <>
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
            onChange({ ...trigger, entityId: entityId === '' ? null : partialEntityId(entityId) });
          }}
        />
      </>
    );
  }

  return <TimeTriggerFields trigger={trigger} onChange={onChange} />;
}

/** What the time fields need. */
type TimeTriggerFieldsProps = {
  /** The trigger, which is known to be a time one. */
  readonly trigger: Extract<AutomationTrigger, { type: 'time' }>;

  /** Called with the trigger as it now stands. */
  readonly onChange: (trigger: AutomationTrigger) => void;
};

/**
 * Renders the fields for a time trigger.
 *
 * Its own component because a time is three different things — a clock, a schedule, or the sun —
 * and each has its own field. Inline, it would have doubled the length of the switch above.
 *
 * @param props - See {@link TimeTriggerFieldsProps}.
 * @returns The fields.
 */
function TimeTriggerFields(props: TimeTriggerFieldsProps) {
  const { trigger, onChange } = props;

  return (
    <>
      <SelectField
        label="When"
        size="compact"
        options={[
          { value: 'clock', label: 'At a time' },
          { value: 'cron', label: 'On a schedule' },
          { value: 'solar', label: 'With the sun' },
        ]}
        value={trigger.at.kind}
        onChange={(kind) => {
          onChange({
            type: 'time',
            at:
              kind === 'clock'
                ? { kind: 'clock', time: '08:00' }
                : kind === 'cron'
                  ? { kind: 'cron', expression: '0 8 * * *' }
                  : { kind: 'solar', event: 'sunset', offsetMinutes: 0 },
          });
        }}
      />

      {trigger.at.kind === 'clock' ? (
        <TextField
          label="Time"
          size="compact"
          type="time"
          value={trigger.at.time}
          onChange={(event) => {
            onChange({ type: 'time', at: { kind: 'clock', time: event.target.value } });
          }}
        />
      ) : null}

      {trigger.at.kind === 'cron' ? (
        <TextField
          label="Schedule"
          size="compact"
          placeholder="0 7 * * 1-5"
          hint="Five or six fields, as cron writes them."
          value={trigger.at.expression}
          onChange={(event) => {
            onChange({ type: 'time', at: { kind: 'cron', expression: event.target.value } });
          }}
        />
      ) : null}

      {trigger.at.kind === 'solar' ? (
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Event"
            size="compact"
            options={SOLAR_EVENTS.map((value) => ({ value, label: value }))}
            value={trigger.at.event}
            onChange={(event) => {
              onChange({
                type: 'time',
                at: {
                  kind: 'solar',
                  event: event as SolarEvent,
                  offsetMinutes: trigger.at.kind === 'solar' ? trigger.at.offsetMinutes : 0,
                },
              });
            }}
          />
          <TextField
            label="Offset (min)"
            size="compact"
            type="number"
            hint="Negative is before."
            value={String(trigger.at.offsetMinutes)}
            onChange={(event) => {
              onChange({
                type: 'time',
                at: {
                  kind: 'solar',
                  event: trigger.at.kind === 'solar' ? trigger.at.event : 'sunset',
                  offsetMinutes: Number(event.target.value),
                },
              });
            }}
          />
        </div>
      ) : null}
    </>
  );
}
