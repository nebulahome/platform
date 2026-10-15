/**
 * The fields one condition needs (board N-Blocks-Conditions).
 *
 * Four kinds. An entity is chosen first and the rest fits it - the states it may be in, or the
 * number it must pass (`entity-match-fields.tsx`). A time holds from one time to another, either
 * left open, on the days ticked; one that ends before it starts says it ends the next morning. The
 * sun is a phase - day, night, the golden hour - or an elevation, worked out where the house
 * stands, with what it is now. An expression names the readings it uses and shows what it reads
 * now. The AND and OR groups are drawn by the group block, not here.
 */
import {
  aliasScalarFromState,
  evaluateAliasExpression,
  isSunPhase,
  sunState,
  SUN_PHASES,
  type AliasScalar,
  type ConditionNode,
  type SunPhase,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  IconButton,
  Note,
  Segmented,
  SelectField,
  TextField,
} from '@nebulahome/ui';

import { WeekdayPicker } from '@/components/weekday-picker';
import { crossesMidnight, SUN_PHASE_WORDS } from '@/lib/block-summary';
import { partialEntityId, withoutKey } from '@/library/automation-draft';
import { useEditorHouse, type EditorHouse } from '@/routes/library/automation/editor-house';
import { EntityConditionFields } from '@/routes/library/automation/entity-match-fields';
import { EntityField } from '@/routes/library/entity-field';

/** What the fields need. */
export type ConditionFieldsProps = {
  /** The condition being edited. */
  readonly condition: ConditionNode;

  /** Called with the condition as it now stands. */
  readonly onChange: (condition: ConditionNode) => void;
};

/**
 * Renders the fields for one condition.
 *
 * @param props - See {@link ConditionFieldsProps}.
 * @returns The fields, or null for a group or a condition this build no longer has.
 */
export function ConditionFields(props: ConditionFieldsProps) {
  const { condition, onChange } = props;

  switch (condition.type) {
    case 'entity': {
      return <EntityConditionFields condition={condition} onChange={onChange} />;
    }
    case 'time': {
      return <TimeConditionFields condition={condition} onChange={onChange} />;
    }
    case 'sun': {
      return <SunConditionFields condition={condition} onChange={onChange} />;
    }
    case 'expression': {
      return <ExpressionFields condition={condition} onChange={onChange} />;
    }
    default: {
      return null;
    }
  }
}

/**
 * The fields of a time condition: from, until - either left open - and the days.
 *
 * @param props - The condition and its change handler.
 * @param props.condition - The time condition.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function TimeConditionFields(props: {
  readonly condition: Extract<ConditionNode, { type: 'time' }>;
  readonly onChange: (condition: ConditionNode) => void;
}) {
  const { condition, onChange } = props;
  const { from, to, days = [] } = condition;

  /**
   * Writes one end back, or leaves it open.
   *
   * @param key - Which end.
   * @param value - The time; empty to leave it open.
   */
  const setEnd = (key: 'from' | 'to', value: string): void => {
    onChange(value === '' ? withoutKey(condition, key) : { ...condition, [key]: value });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="From"
          size="compact"
          type="time"
          className="font-mono"
          hint={from === undefined ? 'Empty: from midnight.' : undefined}
          value={from ?? ''}
          onChange={(event) => {
            setEnd('from', event.target.value);
          }}
        />
        <TextField
          label="To"
          size="compact"
          type="time"
          className="font-mono"
          hint={
            to === undefined
              ? 'Empty: until midnight.'
              : from !== undefined && crossesMidnight(from, to)
                ? 'Ends the next morning.'
                : undefined
          }
          value={to ?? ''}
          onChange={(event) => {
            setEnd('to', event.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-foreground-muted">On</span>
        <WeekdayPicker
          label="On"
          value={days}
          onChange={(next) => {
            onChange(
              next.length === 0 ? withoutKey(condition, 'days') : { ...condition, days: next },
            );
          }}
        />
        <span className="text-caption text-foreground-subtle">
          {days.length === 0
            ? 'None chosen: every day.'
            : from !== undefined && to !== undefined && crossesMidnight(from, to)
              ? 'After midnight, the day the evening began counts.'
              : 'Only on the days chosen.'}
        </span>
      </div>
    </>
  );
}

/** The phases of the sun, as the dropdown offers them. */
const PHASE_OPTIONS = SUN_PHASES.map((phase) => ({
  value: phase,
  label:
    phase === 'above' || phase === 'below'
      ? `${SUN_PHASE_WORDS[phase] ?? phase} an elevation`
      : (SUN_PHASE_WORDS[phase] ?? phase),
}));

/** The phases that come round twice a day, and can be narrowed to the morning or the evening. */
const TWICE_DAILY: ReadonlySet<SunPhase> = new Set<SunPhase>([
  'day',
  'twilight',
  'night',
  'golden_hour',
  'blue_hour',
  'above',
  'below',
]);

/**
 * The fields of a sun condition: the phase, an elevation where it takes one, the half of the
 * day, and what the sun is doing now.
 *
 * @param props - The condition and its change handler.
 * @param props.condition - The sun condition.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function SunConditionFields(props: {
  readonly condition: Extract<ConditionNode, { type: 'sun' }>;
  readonly onChange: (condition: ConditionNode) => void;
}) {
  const { condition, onChange } = props;
  const house = useEditorHouse();
  const takesElevation = condition.phase === 'above' || condition.phase === 'below';
  const now = house.position === null ? null : sunState(new Date(), house.position);
  const holds = now === null ? null : isSunPhase(condition, now);

  return (
    <>
      {house.hasPosition ? null : (
        <Note tone="warning">
          The house has no position yet, so the sun has no height here. Set it on the house, under
          Library › Areas.
        </Note>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Is"
          size="compact"
          options={PHASE_OPTIONS}
          value={condition.phase}
          onChange={(value) => {
            const phase = value as SunPhase;
            const rest = withoutKey(withoutKey(condition, 'elevation'), 'period');

            onChange({
              ...rest,
              phase,
              ...(phase === 'above' || phase === 'below'
                ? { elevation: condition.elevation ?? 10 }
                : {}),
              ...(TWICE_DAILY.has(phase) && condition.period !== undefined
                ? { period: condition.period }
                : {}),
            });
          }}
        />
        {takesElevation ? (
          <TextField
            label="Elevation (°)"
            size="compact"
            type="number"
            className="font-mono"
            min={-90}
            max={90}
            hint="Above the horizon; negative is below it."
            value={String(condition.elevation ?? 0)}
            onChange={(event) => {
              const degrees = Number(event.target.value);

              onChange({
                ...condition,
                elevation: Number.isFinite(degrees) ? Math.max(-90, Math.min(90, degrees)) : 0,
              });
            }}
          />
        ) : null}
      </div>
      {TWICE_DAILY.has(condition.phase) ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">When</span>
          <Segmented
            label="When"
            size="compact"
            options={[
              { value: 'any', label: 'Any time' },
              { value: 'morning', label: 'Morning' },
              { value: 'evening', label: 'Evening' },
            ]}
            value={condition.period ?? 'any'}
            onChange={(period) => {
              const rest = withoutKey(condition, 'period');

              onChange(period === 'any' ? rest : { ...rest, period });
            }}
          />
        </div>
      ) : null}
      <p className="flex items-center gap-1.5 text-caption text-foreground-muted">
        {now === null ? (
          'Worked out where the house stands, once it has a position.'
        ) : (
          <>
            <AppIcon
              id={holds === true ? 'check' : 'x'}
              size={12}
              className={holds === true ? 'text-success' : 'text-foreground-subtle'}
            />
            {`Now: the sun is at ${now.elevation.toFixed(1)}° and ${now.isRising ? 'rising' : 'setting'}, so it ${holds === true ? 'holds' : 'does not hold'}.`}
          </>
        )}
      </p>
    </>
  );
}

/**
 * What an expression reads now, as a line under it.
 *
 * @param condition - The expression.
 * @param house - Where the readings come from.
 * @returns The line, and whether it reads true.
 */
function previewOf(
  condition: Extract<ConditionNode, { type: 'expression' }>,
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
  readonly condition: Extract<ConditionNode, { type: 'expression' }>;
  readonly onChange: (condition: ConditionNode) => void;
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
