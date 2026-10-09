/**
 * The fields one check needs (board N-Blocks-Conditions).
 *
 * Six kinds. An entity's state is offered as its own words; a time window that ends before it
 * starts says it ends the next morning; occupancy is read from the room's sensors and says so; an
 * expression names the readings it uses and shows what it reads now. Groups - ALL OF, ANY OF,
 * NONE OF - are drawn by the group block, not here.
 */
import {
  aliasScalarFromState,
  evaluateAliasExpression,
  type AliasScalar,
  type AutomationCondition,
  type ComparisonOperator,
} from '@nebulahome/contracts';
import { AppIcon, Button, IconButton, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { WeekdayPicker } from '@/components/weekday-picker';
import { crossesMidnight } from '@/lib/block-summary';
import { partialEntityId } from '@/library/automation-draft';
import { hasNumber } from '@/library/entity-control';
import { AreaKeyField } from '@/routes/library/area-key-field';
import { useEditorHouse, type EditorHouse } from '@/routes/library/automation/editor-house';
import { EntityField } from '@/routes/library/entity-field';
import { OPERATOR_OPTIONS, StateField } from '@/routes/library/trigger-fields';

/** What the fields need. */
export type ConditionFieldsProps = {
  /** The check being edited, without its NOT. */
  readonly condition: AutomationCondition;

  /** Called with the check as it now stands. */
  readonly onChange: (condition: AutomationCondition) => void;
};

/**
 * Renders the fields for one check.
 *
 * @param props - See {@link ConditionFieldsProps}.
 * @returns The fields.
 */
export function ConditionFields(props: ConditionFieldsProps) {
  const { condition, onChange } = props;

  switch (condition.type) {
    case 'and':
    case 'or':
    case 'not': {
      return null;
    }
    case 'state': {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <EntityField
            label="Entity"
            value={condition.entityId}
            onChange={(entityId) => {
              onChange({ ...condition, entityId, state: '' });
            }}
          />
          <StateField
            label="State"
            entityId={condition.entityId}
            value={condition.state}
            onChange={(state) => {
              onChange({ ...condition, state });
            }}
          />
        </div>
      );
    }
    case 'numeric': {
      return (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <EntityField
            label="Entity"
            accept={hasNumber}
            value={condition.entityId}
            onChange={(entityId) => {
              onChange({ ...condition, entityId });
            }}
          />
          <SelectField
            label="Is"
            size="compact"
            options={OPERATOR_OPTIONS}
            value={condition.operator}
            onChange={(operator) => {
              onChange({ ...condition, operator: operator as ComparisonOperator });
            }}
          />
          <TextField
            label="Value"
            size="compact"
            type="number"
            className="font-mono"
            value={String(condition.value)}
            onChange={(event) => {
              const value = Number(event.target.value);

              onChange({ ...condition, value: Number.isFinite(value) ? value : 0 });
            }}
          />
        </div>
      );
    }
    case 'time_window': {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="From"
            size="compact"
            type="time"
            className="font-mono"
            value={condition.from}
            onChange={(event) => {
              onChange({ ...condition, from: event.target.value });
            }}
          />
          <TextField
            label="To"
            size="compact"
            type="time"
            className="font-mono"
            hint={
              crossesMidnight(condition.from, condition.to) ? 'Ends the next morning.' : undefined
            }
            value={condition.to}
            onChange={(event) => {
              onChange({ ...condition, to: event.target.value });
            }}
          />
        </div>
      );
    }
    case 'day_of_week': {
      return (
        <WeekdayPicker
          label="Days"
          value={condition.days}
          onChange={(days) => {
            onChange({ ...condition, days });
          }}
        />
      );
    }
    case 'area_occupancy': {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <AreaKeyField
            label="Area"
            value={condition.areaKey}
            onChange={(areaKey) => {
              onChange({ ...condition, areaKey });
            }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-foreground-muted">Is</span>
            <Segmented
              label="Is"
              size="compact"
              options={[
                { value: 'occupied', label: 'Occupied' },
                { value: 'empty', label: 'Empty' },
              ]}
              value={condition.isOccupied ? 'occupied' : 'empty'}
              onChange={(value) => {
                onChange({ ...condition, isOccupied: value === 'occupied' });
              }}
            />
            <span className="text-caption text-foreground-subtle">
              Read from the motion, occupancy and presence sensors in it and the rooms below.
            </span>
          </div>
        </div>
      );
    }
    case 'expression': {
      return <ExpressionFields condition={condition} onChange={onChange} />;
    }
  }
}

/**
 * What an expression reads now, as a line under it.
 *
 * @param condition - The expression.
 * @param house - Where the readings come from.
 * @returns The line, and whether it reads true.
 */
function previewOf(
  condition: Extract<AutomationCondition, { type: 'expression' }>,
  house: EditorHouse,
): { readonly text: string; readonly tone: 'true' | 'false' | 'error' } {
  const bindings = new Map<string, AliasScalar>();
  const read: string[] = [];

  for (const [name, entityId] of Object.entries(condition.variables ?? {})) {
    const scalar = aliasScalarFromState(house.stateOf(entityId));

    if (scalar === undefined) {
      return { text: `${name} has no reading yet`, tone: 'error' };
    }

    bindings.set(name, scalar);
    read.push(`${name} ${String(scalar)}`);
  }

  if (condition.expression.trim() === '') {
    return { text: 'Write what has to hold, using the names below.', tone: 'error' };
  }

  const result = evaluateAliasExpression(condition.expression, bindings);

  if (!result.ok) {
    return { text: result.error, tone: 'error' };
  }

  const holds =
    typeof result.value === 'number'
      ? result.value !== 0
      : typeof result.value === 'string'
        ? result.value.length > 0
        : result.value;

  return {
    text: `Reads ${holds ? 'true' : 'false'} now${read.length === 0 ? '' : ` · ${read.join(', ')}`}`,
    tone: holds ? 'true' : 'false',
  };
}

/**
 * The fields of an expression: the formula, the readings it names, and what it reads now.
 *
 * @param props - The expression and its change handler.
 * @param props.condition - The expression.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function ExpressionFields(props: {
  readonly condition: Extract<AutomationCondition, { type: 'expression' }>;
  readonly onChange: (condition: AutomationCondition) => void;
}) {
  const { condition, onChange } = props;
  const house = useEditorHouse();
  const variables = Object.entries(condition.variables ?? {});
  const preview = previewOf(condition, house);

  /**
   * Writes the readings back.
   *
   * @param entries - Name and entity, in order.
   */
  const setVariables = (entries: readonly (readonly [string, string])[]): void => {
    onChange({ ...condition, variables: Object.fromEntries(entries) });
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <TextField
          label="Expression"
          size="compact"
          className="font-mono"
          placeholder="power > 2 * avg_power"
          value={condition.expression}
          onChange={(event) => {
            onChange({ ...condition, expression: event.target.value });
          }}
        />
        <span
          className={
            preview.tone === 'error'
              ? 'text-caption text-foreground-subtle'
              : 'flex items-center gap-1.5 text-caption text-foreground-muted'
          }
        >
          {preview.tone === 'error' ? null : (
            <AppIcon
              id={preview.tone === 'true' ? 'check' : 'x'}
              size={12}
              className={preview.tone === 'true' ? 'text-success' : 'text-foreground-subtle'}
            />
          )}
          {preview.text}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-foreground-muted">Readings it uses</span>
        {variables.map(([name, entityId], index) => (
          <div
            key={`variable-${String(index)}`}
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-end gap-2"
          >
            <TextField
              label="Name"
              isLabelHidden
              size="compact"
              className="font-mono"
              placeholder="power"
              value={name}
              onChange={(event) => {
                setVariables(
                  variables.map((entry, at) =>
                    at === index ? [event.target.value.toLowerCase(), entry[1]] : entry,
                  ),
                );
              }}
            />
            <EntityField
              label={`Entity for ${name}`}
              isLabelHidden
              value={entityId}
              onChange={(next) => {
                setVariables(
                  variables.map((entry, at) =>
                    at === index ? [entry[0], partialEntityId(next)] : entry,
                  ),
                );
              }}
            />
            <IconButton
              label={`Remove ${name}`}
              variant="danger"
              size="small"
              className="mb-1.5"
              onClick={() => {
                setVariables(variables.filter((entry) => entry !== variables[index]));
              }}
            >
              <AppIcon id="x" size={13} />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="compact"
          className="self-start"
          disabled={variables.length >= 16}
          onClick={() => {
            setVariables([...variables, [`value_${String(variables.length + 1)}`, '']]);
          }}
        >
          <AppIcon id="plus" size={13} />
          Add a reading
        </Button>
      </div>
    </>
  );
}
