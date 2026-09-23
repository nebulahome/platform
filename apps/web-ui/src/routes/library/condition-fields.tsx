/**
 * The fields one condition needs.
 *
 * Six leaf kinds. The three that compose — `and`, `or`, `not` — are not edited here and are not
 * lost either: a condition this editor cannot draw is shown as itself, read-only, and written
 * back untouched when the automation is saved.
 */
import {
  COMPARISON_OPERATORS,
  type ComparisonOperator,
  DAYS_OF_WEEK,
  type AutomationCondition,
} from '@nebula-home/contracts';
import { SelectField, Segmented, TextField } from '@nebula-home/ui';

import { hasNumber } from '@/library/entity-control';
import { AreaKeyField } from '@/routes/library/area-key-field';
import { EntityField } from '@/routes/library/entity-field';

/** What the fields need. */
export type ConditionFieldsProps = {
  /** The condition being edited. */
  readonly condition: AutomationCondition;

  /** Called with the condition as it now stands. */
  readonly onChange: (condition: AutomationCondition) => void;
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
 * Renders the fields for one condition.
 *
 * @param props - See {@link ConditionFieldsProps}.
 * @returns The fields.
 */
export function ConditionFields(props: ConditionFieldsProps) {
  const { condition, onChange } = props;

  if (condition.type === 'and' || condition.type === 'or' || condition.type === 'not') {
    return (
      <p className="text-ui text-foreground-subtle sm:col-span-2">
        A composed condition. This editor does not take it apart, and saving will leave it exactly
        as it is.
      </p>
    );
  }

  if (condition.type === 'state') {
    return (
      <>
        <EntityField
          label="Entity"
          value={condition.entityId}
          onChange={(entityId) => {
            onChange({ ...condition, entityId });
          }}
        />
        <TextField
          label="Is"
          size="compact"
          placeholder="home"
          value={condition.state}
          onChange={(event) => {
            onChange({ ...condition, state: event.target.value });
          }}
        />
      </>
    );
  }

  if (condition.type === 'numeric') {
    return (
      <>
        <EntityField
          label="Entity"
          accept={hasNumber}
          value={condition.entityId}
          onChange={(entityId) => {
            onChange({ ...condition, entityId });
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Is"
            size="compact"
            options={OPERATORS}
            value={condition.operator}
            onChange={(operator) => {
              onChange({ ...condition, operator: operator as ComparisonOperator });
            }}
          />
          <TextField
            label="Value"
            size="compact"
            type="number"
            value={String(condition.value)}
            onChange={(event) => {
              onChange({ ...condition, value: Number(event.target.value) });
            }}
          />
        </div>
      </>
    );
  }

  if (condition.type === 'time_window') {
    return (
      <>
        <TextField
          label="From"
          size="compact"
          type="time"
          value={condition.from}
          onChange={(event) => {
            onChange({ ...condition, from: event.target.value });
          }}
        />
        <TextField
          label="Until"
          size="compact"
          type="time"
          hint="An end before the start wraps past midnight."
          value={condition.to}
          onChange={(event) => {
            onChange({ ...condition, to: event.target.value });
          }}
        />
      </>
    );
  }

  if (condition.type === 'day_of_week') {
    return (
      <div className="flex flex-wrap gap-1.5 sm:col-span-2">
        {DAYS_OF_WEEK.map((day) => {
          const isChosen = condition.days.includes(day);

          return (
            <label
              key={day}
              className={`press flex h-control-sm cursor-pointer items-center rounded-chip border px-3 text-ui capitalize ${
                isChosen
                  ? 'border-border-strong face-pill text-foreground'
                  : 'border-border text-foreground-muted hover:text-foreground'
              }`}
            >
              <input
                type="checkbox"
                checked={isChosen}
                className="sr-only"
                onChange={() => {
                  const days = isChosen
                    ? condition.days.filter((one) => one !== day)
                    : [...condition.days, day];

                  onChange({ ...condition, days });
                }}
              />
              {day.slice(0, 3)}
            </label>
          );
        })}
      </div>
    );
  }

  if (condition.type === 'area_occupancy') {
    return (
      <>
        <AreaKeyField
          label="Area"
          value={condition.areaKey}
          onChange={(areaKey) => {
            onChange({ ...condition, areaKey });
          }}
        />
        <Segmented
          label="Occupancy"
          size="compact"
          className="self-end"
          options={[
            { value: 'occupied', label: 'Occupied' },
            { value: 'empty', label: 'Empty' },
          ]}
          value={condition.isOccupied ? 'occupied' : 'empty'}
          onChange={(value) => {
            onChange({ ...condition, isOccupied: value === 'occupied' });
          }}
        />
      </>
    );
  }

  return (
    <div className="sm:col-span-2">
      <TextField
        label="Expression"
        size="compact"
        placeholder="temperature > 20 and not away"
        hint="Evaluated in the engine's sandbox."
        value={condition.expression}
        onChange={(event) => {
          onChange({ ...condition, expression: event.target.value });
        }}
      />
    </div>
  );
}
