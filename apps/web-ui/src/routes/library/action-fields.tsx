/**
 * The fields of an action that does something (board N-Blocks-Actions). The blocks that hold
 * other blocks are drawn by the action list, and their checks by the condition list.
 *
 * **Set entity shows the fields of the command it is given**, so each kind of device gets its own
 * controls: a light's level is a warm slider with a fade beside it, a colour a hue and a
 * saturation, a thermostat its modes, a cover its position. The commands offered are the chosen
 * entity's own, read from the capabilities it declares (`command-choices.ts`).
 *
 * Scenes and automations are picked from the ones there are, packages from the ones installed.
 * Notify is kept as written and says it cannot run yet.
 */
import type {
  AutomationAction,
  CapabilityName,
  EntityView,
  JsonObject,
  JsonValue,
} from '@nebulahome/contracts';
import { CAPABILITIES, commandSchemaFor } from '@nebulahome/contracts';
import { Note, Segmented, SelectField, Slider, TextArea, TextField } from '@nebulahome/ui';

import {
  choiceOf,
  commandChoicesFor,
  defaultParams,
  type CommandChoice,
  type CommandField,
} from '@/lib/command-choices';
import { partialEntityId } from '@/library/automation-draft';
import { hueGradient, isCommandable, saturationGradient } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import { DurationField } from '@/routes/library/automation/duration-field';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { EntityField } from '@/routes/library/entity-field';

/** What the fields need. */
export type ActionFieldsProps = {
  /** The action being edited. */
  readonly action: AutomationAction;

  /** Called with the action as it now stands. */
  readonly onChange: (action: AutomationAction) => void;
};

/** A transition's longest: the format's ten minutes. */
const TEN_MINUTES = 600_000;

/** The longest a wait may be: the format's week. */
const WEEK_MS = 604_800_000;

/**
 * The capabilities an entity can be told something on.
 *
 * @param entity - The entity, or undefined while none is chosen.
 * @returns Its commandable capabilities; every commandable one when it is not known.
 */
function commandableCapabilities(entity: EntityView | undefined): CapabilityName[] {
  const declared =
    entity === undefined ? CAPABILITIES : entity.capabilities.map((entry) => entry.capability);

  return declared.filter((capability) => commandSchemaFor(capability) !== null);
}

/**
 * Renders the fields for one action.
 *
 * @param props - See {@link ActionFieldsProps}.
 * @returns The fields, or null for a block whose fields are drawn elsewhere.
 */
export function ActionFields(props: ActionFieldsProps) {
  const { action, onChange } = props;
  const house = useEditorHouse();

  switch (action.type) {
    case 'command': {
      return <CommandFields action={action} onChange={onChange} />;
    }
    case 'scene': {
      return house.scenes.length === 0 ? (
        <TextField
          label="Scene"
          size="compact"
          className="font-mono"
          placeholder="evening"
          hint="Its key. There are no scenes yet to choose from."
          value={action.sceneKey}
          onChange={(event) => {
            onChange({ ...action, sceneKey: event.target.value });
          }}
        />
      ) : (
        <SelectField
          label="Scene"
          size="compact"
          options={[
            ...(action.sceneKey === '' ? [{ value: '', label: 'Choose a scene…' }] : []),
            ...house.scenes.map((scene) => ({ value: scene.key, label: scene.name })),
            ...(action.sceneKey === '' ||
            house.scenes.some((scene) => scene.key === action.sceneKey)
              ? []
              : [{ value: action.sceneKey, label: `${action.sceneKey} (not found)` }]),
          ]}
          value={action.sceneKey}
          onChange={(sceneKey) => {
            onChange({ ...action, sceneKey });
          }}
        />
      );
    }
    case 'automation': {
      return (
        <SelectField
          label="Automation"
          size="compact"
          hint="It starts, and this run carries on without waiting for it."
          options={[
            ...(action.automationKey === '' ? [{ value: '', label: 'Choose an automation…' }] : []),
            ...house.automations.map((automation) => ({
              value: automation.key,
              label: automation.name,
            })),
            ...(action.automationKey === '' ||
            house.automations.some((automation) => automation.key === action.automationKey)
              ? []
              : [{ value: action.automationKey, label: `${action.automationKey} (not found)` }]),
          ]}
          value={action.automationKey}
          onChange={(automationKey) => {
            onChange({ ...action, automationKey });
          }}
        />
      );
    }
    case 'wait_duration': {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <DurationField
            label="Wait"
            maxMs={WEEK_MS}
            value={action.durationMs}
            onChange={(durationMs) => {
              onChange({ ...action, durationMs: durationMs ?? 0 });
            }}
          />
        </div>
      );
    }
    case 'notify': {
      return (
        <>
          <Note tone="warning">
            Not available yet: there is no notification service, so a run that reaches this block
            records it as failed.
          </Note>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <TextField
              label="Channel"
              size="compact"
              placeholder="telegram"
              value={action.channel}
              onChange={(event) => {
                onChange({ ...action, channel: event.target.value });
              }}
            />
            <TextField
              label="Message"
              size="compact"
              value={action.message}
              onChange={(event) => {
                onChange({ ...action, message: event.target.value });
              }}
            />
          </div>
        </>
      );
    }
    case 'package_service': {
      return <PackageServiceFields action={action} onChange={onChange} />;
    }
    default: {
      return null;
    }
  }
}

/**
 * The fields of Set entity: the entity, what to tell it, and that command's own fields.
 *
 * @param props - The action and its change handler.
 * @param props.action - The command action.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function CommandFields(props: {
  readonly action: Extract<AutomationAction, { type: 'command' }>;
  readonly onChange: (action: AutomationAction) => void;
}) {
  const { action, onChange } = props;
  const house = useEditorHouse();
  const entity = house.entityOf(action.entityId);
  const choices = commandChoicesFor(commandableCapabilities(entity));
  const chosen = choiceOf(choices, action.capability, action.params);

  /**
   * Switches to another command, with its fields at their defaults.
   *
   * @param choice - The command.
   */
  const choose = (choice: CommandChoice): void => {
    onChange({ ...action, capability: choice.capability, params: defaultParams(choice) });
  };

  /**
   * Sets one field of the command.
   *
   * @param key - Which.
   * @param value - Its value; undefined to leave it out.
   */
  const setField = (key: string, value: JsonValue | undefined): void => {
    const rest = Object.fromEntries(
      Object.entries(action.params).filter(([name]) => name !== key),
    ) as JsonObject;

    onChange({ ...action, params: value === undefined ? rest : { ...rest, [key]: value } });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <EntityField
          label="Entity"
          accept={isCommandable}
          value={action.entityId}
          onChange={(entityId, next) => {
            const nextChoices = commandChoicesFor(commandableCapabilities(next));
            const keeps = choiceOf(nextChoices, action.capability, action.params);
            const first = nextChoices[0];

            // A command the new entity does not take would be refused when the run reaches it;
            // its first one is the likelier meaning.
            onChange({
              ...action,
              entityId: partialEntityId(entityId),
              ...(keeps !== undefined || first === undefined
                ? {}
                : { capability: first.capability, params: defaultParams(first) }),
            });
          }}
        />
        <SelectField
          label="Command"
          size="compact"
          options={[
            ...(chosen === undefined ? [{ value: '', label: 'Choose what to do…' }] : []),
            ...choices.map((choice) => ({
              value: `${choice.capability}:${choice.command}`,
              label:
                choices.filter((other) => other.command === choice.command).length > 1
                  ? `${capabilityLabel(choice.capability)} · ${choice.label}`
                  : choice.label,
            })),
          ]}
          value={chosen === undefined ? '' : `${chosen.capability}:${chosen.command}`}
          onChange={(value) => {
            const next = choices.find(
              (choice) => `${choice.capability}:${choice.command}` === value,
            );

            if (next !== undefined) {
              choose(next);
            }
          }}
        />
      </div>

      {chosen === undefined || chosen.fields.length === 0 ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          {chosen.fields.map((field) => (
            <CommandFieldControl
              key={field.key}
              field={field}
              value={action.params[field.key]}
              hue={typeof action.params['hue'] === 'number' ? action.params['hue'] : 0}
              onChange={(value) => {
                setField(field.key, value);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The control for one field of a command, by what kind of value it is.
 *
 * @param props - The field, its value and its change handler.
 * @param props.field - The field.
 * @param props.value - Its value in the command body.
 * @param props.hue - The command's hue, for a saturation slider's groove.
 * @param props.onChange - Called with the new value; undefined to leave it out.
 * @returns The control.
 */
function CommandFieldControl(props: {
  readonly field: CommandField;
  readonly value: unknown;
  readonly hue: number;
  readonly onChange: (value: JsonValue | undefined) => void;
}) {
  const { field, value, hue, onChange } = props;

  switch (field.kind) {
    case 'percent': {
      const number = typeof value === 'number' ? value : 0;

      return (
        <Slider
          label={field.label}
          min={0}
          max={100}
          value={number}
          display={`${String(Math.round(number))}%`}
          fill={field.key === 'level' ? 'warm' : 'accent'}
          gradient={field.key === 'saturation' ? saturationGradient(hue) : undefined}
          onChange={(next) => {
            onChange(Math.round(next));
          }}
        />
      );
    }
    case 'duration': {
      return (
        <DurationField
          label={field.label}
          isOptional={field.isOptional}
          maxMs={TEN_MINUTES}
          value={typeof value === 'number' ? value : null}
          onChange={(ms) => {
            onChange(ms === null || ms === 0 ? undefined : ms);
          }}
        />
      );
    }
    case 'number': {
      if (field.key === 'hue') {
        const number = typeof value === 'number' ? value : 0;

        return (
          <Slider
            label={field.label}
            min={0}
            max={360}
            value={number}
            display={`${String(Math.round(number))}°`}
            gradient={hueGradient()}
            onChange={(next) => {
              onChange(Math.round(next));
            }}
          />
        );
      }

      return (
        <TextField
          label={field.label}
          size="compact"
          type="number"
          className="font-mono"
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(event) => {
            const number = Number(event.target.value);

            onChange(
              event.target.value === '' && field.isOptional
                ? undefined
                : Number.isFinite(number)
                  ? number
                  : 0,
            );
          }}
        />
      );
    }
    case 'enum': {
      const options = field.options ?? [];

      return options.length <= 4 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">{field.label}</span>
          <Segmented
            label={field.label}
            size="compact"
            options={options.map((option) => ({ value: option, label: humaniseOption(option) }))}
            value={typeof value === 'string' ? value : (options[0] ?? '')}
            onChange={onChange}
          />
        </div>
      ) : (
        <SelectField
          label={field.label}
          size="compact"
          options={options.map((option) => ({ value: option, label: humaniseOption(option) }))}
          value={typeof value === 'string' ? value : (options[0] ?? '')}
          onChange={onChange}
        />
      );
    }
    case 'boolean': {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">{field.label}</span>
          <Segmented
            label={field.label}
            size="compact"
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={value === true ? 'on' : 'off'}
            onChange={(next) => {
              onChange(next === 'on');
            }}
          />
        </div>
      );
    }
    case 'list': {
      return (
        <TextField
          label={field.label}
          size="compact"
          hint="Separated by commas."
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={(event) => {
            onChange(
              event.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ''),
            );
          }}
        />
      );
    }
    case 'text': {
      return (
        <TextField
          label={field.label}
          size="compact"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(
              event.target.value === '' && field.isOptional ? undefined : event.target.value,
            );
          }}
        />
      );
    }
  }
}

/**
 * An option of a command's choice, in words: `fan_only` reads "Fan only".
 *
 * @param option - The option.
 * @returns The words.
 */
function humaniseOption(option: string): string {
  const spaced = option.replaceAll('_', ' ');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The fields of a package service: which package, which service, and what it is given.
 *
 * @param props - The action and its change handler.
 * @param props.action - The package service action.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
function PackageServiceFields(props: {
  readonly action: Extract<AutomationAction, { type: 'package_service' }>;
  readonly onChange: (action: AutomationAction) => void;
}) {
  const { action, onChange } = props;
  const house = useEditorHouse();
  const params = JSON.stringify(action.params, null, 2);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {house.packages.length === 0 ? (
          <TextField
            label="Package"
            size="compact"
            className="font-mono"
            placeholder="nvr"
            hint="No packages are installed yet."
            value={action.packageId}
            onChange={(event) => {
              onChange({ ...action, packageId: event.target.value });
            }}
          />
        ) : (
          <SelectField
            label="Package"
            size="compact"
            options={[
              ...(action.packageId === '' ? [{ value: '', label: 'Choose a package…' }] : []),
              ...house.packages.map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
            value={action.packageId}
            onChange={(packageId) => {
              onChange({ ...action, packageId });
            }}
          />
        )}
        <TextField
          label="Service"
          size="compact"
          className="font-mono"
          placeholder="record"
          hint="The name the package gives it."
          value={action.service}
          onChange={(event) => {
            onChange({ ...action, service: event.target.value });
          }}
        />
      </div>
      <TextArea
        label="What it is given"
        className="font-mono text-mono-ui"
        hint="A JSON object, as the package's documentation describes it."
        defaultValue={params}
        onBlur={(event) => {
          try {
            const parsed: unknown = JSON.parse(
              event.target.value === '' ? '{}' : event.target.value,
            );

            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
              onChange({ ...action, params: parsed as JsonObject });
            }
          } catch {
            // Left as typed: the save names what is wrong with it.
          }
        }}
      />
    </>
  );
}
