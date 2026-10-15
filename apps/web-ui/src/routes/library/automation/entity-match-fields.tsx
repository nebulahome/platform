/**
 * The Entity block's fields, for a trigger and for a condition alike: the entity first, then
 * what fits it.
 *
 * An entity with states - a switch, a door, a thermostat's modes - is matched by its states, in
 * its own words; one with a number - a temperature, a light's level, a blind's position - by a
 * comparison; one with both, a dimmable light, says which with a switch. One block for what used
 * to be two, so the question is always the same: which entity, and what about it.
 */
import {
  COMPARISON_OPERATORS,
  type AutomationTrigger,
  type ComparisonOperator,
  type ConditionNode,
  type EntityView,
} from '@nebulahome/contracts';
import { Segmented, SelectField, TextField } from '@nebulahome/ui';

import { ChoiceChips } from '@/components/choice-chips';
import { partialEntityId } from '@/library/automation-draft';
import { DurationField } from '@/routes/library/automation/duration-field';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { stateChoices } from '@/routes/library/automation/state-choices';
import { EntityField } from '@/routes/library/entity-field';

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

/** An entity's number: what it is called, and its unit. */
export type EntityReading = {
  readonly label: string;
  readonly unit: string | null;
};

/**
 * The number an entity can be compared by, in the order the engine reads one
 * (`numericReadingOf` in the contracts).
 *
 * @param entity - The entity.
 * @returns What its number is called and its unit, or null when it has none.
 */
export function readingOf(entity: EntityView | undefined): EntityReading | null {
  /**
   * Whether the entity declares a capability.
   *
   * @param capability - The capability.
   * @returns True when it does.
   */
  const has = (capability: string): boolean =>
    entity?.capabilities.some((entry) => entry.capability === capability) ?? false;

  if (entity === undefined) {
    return null;
  }

  if (has('sensor_numeric') || has('number')) {
    return { label: 'Value', unit: entity.unitOfMeasurement ?? null };
  }

  if (has('level')) {
    return { label: 'Level', unit: '%' };
  }

  if (has('cover')) {
    return { label: 'Position', unit: '%' };
  }

  if (has('thermostat')) {
    return { label: 'Temperature', unit: '°' };
  }

  return has('media_player') ? { label: 'Volume', unit: '%' } : null;
}

/**
 * What an entity is best matched by: its states when it has them, else its number.
 *
 * @param entity - The entity.
 * @returns The kind.
 */
function kindFor(entity: EntityView | undefined): 'state' | 'numeric' {
  return stateChoices(entity) === null && readingOf(entity) !== null ? 'numeric' : 'state';
}

/**
 * The State / Level switch, for an entity that has both.
 *
 * @param props - The kind chosen, the reading and the change handler.
 * @param props.kind - State or numeric.
 * @param props.reading - The entity's number.
 * @param props.onChange - Called with the kind chosen.
 * @returns The switch.
 */
function KindSwitch(props: {
  readonly kind: 'state' | 'numeric';
  readonly reading: EntityReading;
  readonly onChange: (kind: 'state' | 'numeric') => void;
}) {
  const { kind, reading, onChange } = props;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-foreground-muted">By its</span>
      <Segmented
        label="By its"
        size="compact"
        options={[
          { value: 'state', label: 'State' },
          { value: 'numeric', label: reading.label },
        ]}
        value={kind}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * The comparison of a number: the operator and the value, with the unit under it.
 *
 * @param props - The comparison, the reading and the change handler.
 * @param props.operator - How it compares.
 * @param props.value - With what.
 * @param props.reading - The entity's number, for its unit.
 * @param props.onChange - Called with the comparison as it now stands.
 * @returns The two fields.
 */
function Comparison(props: {
  readonly operator: ComparisonOperator;
  readonly value: number;
  readonly reading: EntityReading | null;
  readonly onChange: (operator: ComparisonOperator, value: number) => void;
}) {
  const { operator, value, reading, onChange } = props;

  return (
    <>
      <SelectField
        label="Is"
        size="compact"
        options={OPERATOR_OPTIONS}
        value={operator}
        onChange={(next) => {
          onChange(next as ComparisonOperator, value);
        }}
      />
      <TextField
        label={reading?.unit === null || reading === null ? 'Value' : `Value (${reading.unit})`}
        size="compact"
        type="number"
        className="font-mono"
        value={String(value)}
        onChange={(event) => {
          const number = Number(event.target.value);

          onChange(operator, Number.isFinite(number) ? number : 0);
        }}
      />
    </>
  );
}

/**
 * A state field: the entity's states as a dropdown, with Any; typed when its state is open-ended.
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

/** What the trigger's fields need. */
export type EntityTriggerFieldsProps = {
  readonly trigger: Extract<AutomationTrigger, { type: 'entity' }>;
  readonly onChange: (trigger: AutomationTrigger) => void;
};

/**
 * The fields of an Entity trigger: the entity; then From and To for a state, or the comparison
 * it crosses for a number; and how long it must hold.
 *
 * @param props - See {@link EntityTriggerFieldsProps}.
 * @returns The fields.
 */
export function EntityTriggerFields(props: EntityTriggerFieldsProps) {
  const { trigger, onChange } = props;
  const house = useEditorHouse();
  const entity = house.entityOf(trigger.entityId);
  const reading = readingOf(entity);
  const hasStates = stateChoices(entity) !== null;
  const { change } = trigger;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <EntityField
          label="Entity"
          value={trigger.entityId}
          onChange={(entityId, next) => {
            onChange({
              ...trigger,
              entityId: partialEntityId(entityId),
              change:
                kindFor(next) === 'numeric'
                  ? { kind: 'numeric', operator: 'gt', value: 0 }
                  : { kind: 'state' },
            });
          }}
        />
        {hasStates && reading !== null ? (
          <KindSwitch
            kind={change.kind}
            reading={reading}
            onChange={(kind) => {
              onChange({
                ...trigger,
                change:
                  kind === 'numeric'
                    ? { kind: 'numeric', operator: 'gt', value: 0 }
                    : { kind: 'state' },
              });
            }}
          />
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {change.kind === 'state' ? (
          <>
            <StateField
              label="From"
              anyLabel="Any"
              entityId={trigger.entityId}
              value={change.from ?? ''}
              onChange={(from) => {
                onChange({ ...trigger, change: { ...change, from: from === '' ? null : from } });
              }}
            />
            <StateField
              label="To"
              anyLabel="Any"
              entityId={trigger.entityId}
              value={change.to ?? ''}
              onChange={(to) => {
                onChange({ ...trigger, change: { ...change, to: to === '' ? null : to } });
              }}
            />
          </>
        ) : (
          <Comparison
            operator={change.operator}
            value={change.value}
            reading={reading}
            onChange={(operator, value) => {
              onChange({ ...trigger, change: { kind: 'numeric', operator, value } });
            }}
          />
        )}
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
    </>
  );
}

/** What the condition's fields need. */
export type EntityConditionFieldsProps = {
  readonly condition: Extract<ConditionNode, { type: 'entity' }>;
  readonly onChange: (condition: ConditionNode) => void;
};

/**
 * The fields of an Entity condition: the entity; then the states it may be in, or the comparison
 * its number must pass.
 *
 * @param props - See {@link EntityConditionFieldsProps}.
 * @returns The fields.
 */
export function EntityConditionFields(props: EntityConditionFieldsProps) {
  const { condition, onChange } = props;
  const house = useEditorHouse();
  const entity = house.entityOf(condition.entityId);
  const reading = readingOf(entity);
  const choices = stateChoices(entity);
  const { match } = condition;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <EntityField
          label="Entity"
          value={condition.entityId}
          onChange={(entityId, next) => {
            onChange({
              ...condition,
              entityId: partialEntityId(entityId),
              match:
                kindFor(next) === 'numeric'
                  ? { kind: 'numeric', operator: 'gt', value: 0 }
                  : { kind: 'state', states: [] },
            });
          }}
        />
        {choices !== null && reading !== null ? (
          <KindSwitch
            kind={match.kind}
            reading={reading}
            onChange={(kind) => {
              onChange({
                ...condition,
                match:
                  kind === 'numeric'
                    ? { kind: 'numeric', operator: 'gt', value: 0 }
                    : { kind: 'state', states: [] },
              });
            }}
          />
        ) : null}
      </div>
      {match.kind === 'numeric' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Comparison
            operator={match.operator}
            value={match.value}
            reading={reading}
            onChange={(operator, value) => {
              onChange({ ...condition, match: { kind: 'numeric', operator, value } });
            }}
          />
        </div>
      ) : choices === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Is"
            size="compact"
            placeholder="on"
            hint="Its state, as it reports it."
            value={match.states[0] ?? ''}
            onChange={(event) => {
              const state = event.target.value;

              onChange({
                ...condition,
                match: { kind: 'state', states: state === '' ? [] : [state] },
              });
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">Is one of</span>
          <ChoiceChips
            label="Is one of"
            options={[
              ...choices,
              // A state the entity no longer offers is still shown, so it is not lost by looking.
              ...match.states
                .filter((state) => !choices.some((choice) => choice.value === state))
                .map((state) => ({ value: state, label: state })),
            ]}
            value={match.states}
            onChange={(states) => {
              onChange({ ...condition, match: { kind: 'state', states } });
            }}
          />
        </div>
      )}
    </>
  );
}
