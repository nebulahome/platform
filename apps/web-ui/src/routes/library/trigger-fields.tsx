/**
 * The fields one trigger needs, which depend on what kind of trigger it is (board
 * N-Blocks-Triggers).
 *
 * An entity's states are offered as its own words - a door's Open and Closed, a thermostat's
 * modes - rather than typed; "For at least" is a duration as a person writes one. A time is a time
 * of day, the sun, or a schedule. `manual` has no fields and says how it runs; `event` is kept as
 * written and says that nothing reports device events yet.
 */
import {
  COMPARISON_OPERATORS,
  SOLAR_EVENTS,
  type AutomationTrigger,
  type ComparisonOperator,
  type SolarEvent,
} from '@nebulahome/contracts';
import { Note, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { partialEntityId } from '@/library/automation-draft';
import { hasNumber } from '@/library/entity-control';
import { DurationField } from '@/routes/library/automation/duration-field';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { stateChoices } from '@/routes/library/automation/state-choices';
import { EntityField } from '@/routes/library/entity-field';

/** What the fields need. */
export type TriggerFieldsProps = {
  /** The trigger being edited. */
  readonly trigger: AutomationTrigger;

  /** Called with the trigger as it now stands. */
  readonly onChange: (trigger: AutomationTrigger) => void;
};

/** The comparisons, as a dropdown reads them. */
export const OPERATOR_OPTIONS = COMPARISON_OPERATORS.map((value) => ({
  value,
  label: {
    lt: 'below <',
    lte: 'at most ≤',
    gt: 'above >',
    gte: 'at least ≥',
    eq: 'equal =',
    neq: 'not equal ≠',
  }[value],
}));

/** The longest a hold may be: the format's week. */
const WEEK_MS = 604_800_000;

/**
 * A state field: the entity's states as a dropdown, with Any; typed when the state is a number or
 * a text.
 *
 * @param props - The field's label, value and entity.
 * @param props.label - What it is.
 * @param props.entityId - The entity whose states are offered.
 * @param props.value - The state chosen; empty for any.
 * @param props.onChange - Called with the state; empty for any.
 * @param props.anyLabel - What "any" is called; absent when the field must name a state.
 * @returns The field.
 */
export function StateField(props: {
  readonly label: string;
  readonly entityId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly anyLabel?: string;
}) {
  const { label, entityId, value, onChange, anyLabel } = props;
  const house = useEditorHouse();
  const choices = stateChoices(house.entityOf(entityId));

  if (choices === null) {
    return (
      <TextField
        label={label}
        size="compact"
        placeholder={anyLabel ?? 'on'}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  const known = choices.some((choice) => choice.value === value);

  return (
    <SelectField
      label={label}
      size="compact"
      options={[
        ...(anyLabel === undefined ? [] : [{ value: '', label: anyLabel }]),
        ...(anyLabel === undefined && value === '' ? [{ value: '', label: 'Choose…' }] : []),
        ...choices,
        // A state the entity no longer offers is still shown, so it is not lost by looking.
        ...(known || value === '' ? [] : [{ value, label: value }]),
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

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
      <p className="text-ui-sm text-foreground-subtle">
        Runs from its Run button, from the API, or from another automation.
      </p>
    );
  }

  if (trigger.type === 'state') {
    return (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <EntityField
          label="Entity"
          value={trigger.entityId}
          onChange={(entityId) => {
            onChange({ ...trigger, entityId: partialEntityId(entityId), from: null, to: null });
          }}
        />
        <StateField
          label="From"
          anyLabel="Any"
          entityId={trigger.entityId}
          value={trigger.from ?? ''}
          onChange={(from) => {
            onChange({ ...trigger, from: from === '' ? null : from });
          }}
        />
        <StateField
          label="To"
          anyLabel="Any"
          entityId={trigger.entityId}
          value={trigger.to ?? ''}
          onChange={(to) => {
            onChange({ ...trigger, to: to === '' ? null : to });
          }}
        />
        <DurationField
          label="For at least"
          isOptional
          maxMs={WEEK_MS}
          value={trigger.forMs ?? null}
          onChange={(forMs) => {
            onChange({ ...trigger, forMs: forMs === 0 ? null : forMs });
          }}
        />
      </div>
    );
  }

  if (trigger.type === 'numeric_state') {
    return (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <EntityField
          label="Entity"
          accept={hasNumber}
          value={trigger.entityId}
          onChange={(entityId) => {
            onChange({ ...trigger, entityId: partialEntityId(entityId) });
          }}
        />
        <SelectField
          label="Is"
          size="compact"
          options={OPERATOR_OPTIONS}
          value={trigger.operator}
          onChange={(operator) => {
            onChange({ ...trigger, operator: operator as ComparisonOperator });
          }}
        />
        <TextField
          label="Value"
          size="compact"
          type="number"
          className="font-mono"
          value={String(trigger.value)}
          onChange={(event) => {
            const value = Number(event.target.value);

            onChange({ ...trigger, value: Number.isFinite(value) ? value : 0 });
          }}
        />
        <DurationField
          label="For at least"
          isOptional
          maxMs={WEEK_MS}
          value={trigger.forMs ?? null}
          onChange={(forMs) => {
            onChange({ ...trigger, forMs: forMs === 0 ? null : forMs });
          }}
        />
      </div>
    );
  }

  if (trigger.type === 'event') {
    return (
      <>
        <Note tone="warning">
          Not available yet: nothing reports device events to the platform, so this trigger is kept
          as written and never fires.
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

  return <TimeTriggerFields trigger={trigger} onChange={onChange} />;
}

/** What the time fields need. */
type TimeTriggerFieldsProps = {
  /** The trigger, which is known to be a time one. */
  readonly trigger: Extract<AutomationTrigger, { type: 'time' }>;

  /** Called with the trigger as it now stands. */
  readonly onChange: (trigger: AutomationTrigger) => void;
};

/** What a time can be, as the segmented control reads it. */
const TIME_KINDS = [
  { value: 'clock', label: 'Time of day' },
  { value: 'solar', label: 'Sun' },
  { value: 'cron', label: 'Schedule' },
] as const;

/**
 * Renders the fields for a time trigger: a time of day, the sun, or a schedule.
 *
 * @param props - See {@link TimeTriggerFieldsProps}.
 * @returns The fields.
 */
function TimeTriggerFields(props: TimeTriggerFieldsProps) {
  const { trigger, onChange } = props;
  const house = useEditorHouse();
  const { at } = trigger;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">At</span>
        <Segmented
          label="At"
          size="compact"
          options={TIME_KINDS}
          value={at.kind}
          onChange={(kind) => {
            onChange({
              type: 'time',
              at:
                kind === 'clock'
                  ? { kind: 'clock', time: '07:00' }
                  : kind === 'cron'
                    ? { kind: 'cron', expression: '0 7 * * 1-5' }
                    : { kind: 'solar', event: 'sunset', offsetMinutes: 0 },
            });
          }}
        />
      </div>

      {at.kind === 'clock' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Time"
            size="compact"
            type="time"
            step={1}
            className="font-mono"
            hint="Every day, on the house's clock."
            value={at.time}
            onChange={(event) => {
              onChange({ type: 'time', at: { kind: 'clock', time: event.target.value } });
            }}
          />
        </div>
      ) : null}

      {at.kind === 'cron' ? (
        <TextField
          label="Schedule"
          size="compact"
          className="font-mono"
          placeholder="0 7 * * 1-5"
          hint="Five fields as cron writes them - minute, hour, day, month, weekday - or six with seconds first. 0 7 * * 1-5 is 07:00 on weekdays."
          value={at.expression}
          onChange={(event) => {
            onChange({ type: 'time', at: { kind: 'cron', expression: event.target.value } });
          }}
        />
      ) : null}

      {at.kind === 'solar' ? (
        <>
          {house.hasPosition ? null : (
            <Note tone="warning">
              The house has no position yet, so the sun has no time here. Set it on the house, under
              Library › Areas.
            </Note>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-foreground-muted">Event</span>
              <Segmented
                label="Event"
                size="compact"
                options={SOLAR_EVENTS.map((value) => ({
                  value,
                  label: value === 'sunrise' ? 'Sunrise' : 'Sunset',
                }))}
                value={at.event}
                onChange={(event: SolarEvent) => {
                  onChange({ type: 'time', at: { ...at, event } });
                }}
              />
            </div>
            <TextField
              label="Offset (min)"
              size="compact"
              type="number"
              className="font-mono"
              min={-720}
              max={720}
              hint="Negative is before."
              value={String(at.offsetMinutes)}
              onChange={(event) => {
                const minutes = Math.round(Number(event.target.value));

                onChange({
                  type: 'time',
                  at: { ...at, offsetMinutes: Number.isFinite(minutes) ? minutes : 0 },
                });
              }}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
