/**
 * The fields one action needs.
 *
 * Leaf kinds that do something, and nested blocks that hold others. Nested blocks are not edited
 * here — the mockup that designed this screen left nesting out too — and an automation that
 * already has one keeps it exactly as it was.
 *
 * Durations are asked for in seconds and stored in milliseconds. Nobody types 300000.
 */
import { CAPABILITIES, commandSchemaFor, type AutomationAction } from '@nebulahome/contracts';
import { SelectField, TextField } from '@nebulahome/ui';

import { isEditableAction } from '@/library/automation-draft';
import { isCommandable } from '@/library/entity-control';
import { capabilityLabel } from '@/library/entity-kind';
import { ConditionTreeEditor } from '@/routes/library/condition-tree-editor';
import { EntityField } from '@/routes/library/entity-field';
import { TriggerFields } from '@/routes/library/trigger-fields';

/** What the fields need. */
export type ActionFieldsProps = {
  /** The action being edited. */
  readonly action: AutomationAction;

  /** Called with the action as it now stands. */
  readonly onChange: (action: AutomationAction) => void;
};

/**
 * Renders the fields for one action.
 *
 * @param props - See {@link ActionFieldsProps}.
 * @returns The fields.
 */
export function ActionFields(props: ActionFieldsProps) {
  const { action, onChange } = props;

  if (!isEditableAction(action)) {
    return null;
  }

  if (action.type === 'command') {
    return (
      <>
        <EntityField
          label="Entity"
          accept={isCommandable}
          value={action.entityId}
          onChange={(entityId, entity) => {
            const declared = entity?.capabilities
              .map((entry) => entry.capability)
              .filter((capability) => commandSchemaFor(capability) !== null);

            // A capability the new entity does not declare would be refused by core; the first
            // one it can be told to do is the likelier meaning.
            onChange({
              ...action,
              entityId,
              capability:
                declared === undefined ||
                declared.length === 0 ||
                declared.some((capability) => capability === action.capability)
                  ? action.capability
                  : (declared[0] ?? action.capability),
            });
          }}
        />
        <SelectField
          label="Capability"
          size="compact"
          options={CAPABILITIES.filter((value) => commandSchemaFor(value) !== null).map(
            (value) => ({ value, label: capabilityLabel(value) }),
          )}
          value={action.capability}
          onChange={(capability) => {
            onChange({ ...action, capability });
          }}
        />
      </>
    );
  }

  if (action.type === 'scene') {
    return (
      <TextField
        label="Scene"
        size="compact"
        placeholder="good_night"
        value={action.sceneKey}
        onChange={(event) => {
          onChange({ ...action, sceneKey: event.target.value });
        }}
      />
    );
  }

  if (action.type === 'automation') {
    return (
      <TextField
        label="Automation"
        size="compact"
        placeholder="evening_lights"
        hint="Its key, not its name."
        value={action.automationKey}
        onChange={(event) => {
          onChange({ ...action, automationKey: event.target.value });
        }}
      />
    );
  }

  if (action.type === 'wait_duration') {
    return (
      <TextField
        label="Wait (seconds)"
        size="compact"
        type="number"
        value={String(Math.round(action.durationMs / 1000))}
        onChange={(event) => {
          onChange({ ...action, durationMs: Number(event.target.value) * 1000 });
        }}
      />
    );
  }

  if (action.type === 'wait_for') {
    return (
      <>
        <ConditionTreeEditor
          value={action.condition}
          onChange={(condition) => {
            onChange({ ...action, condition });
          }}
        />
        <TextField
          label="Give up after (s)"
          size="compact"
          type="number"
          value={String(Math.round(action.timeoutMs / 1000))}
          onChange={(event) => {
            onChange({ ...action, timeoutMs: Number(event.target.value) * 1000 });
          }}
        />
      </>
    );
  }

  if (action.type === 'wait_for_trigger') {
    return (
      <>
        <div className="sm:col-span-2">
          <TriggerFields
            trigger={action.trigger}
            onChange={(trigger) => {
              onChange({ ...action, trigger });
            }}
          />
        </div>
        <TextField
          label="Give up after (s)"
          size="compact"
          type="number"
          value={String(Math.round(action.timeoutMs / 1000))}
          onChange={(event) => {
            onChange({ ...action, timeoutMs: Number(event.target.value) * 1000 });
          }}
        />
      </>
    );
  }

  if (action.type === 'notify') {
    return (
      <>
        <TextField
          label="Channel"
          size="compact"
          placeholder="push"
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
      </>
    );
  }

  if (action.type !== 'package_service') {
    return null;
  }

  return (
    <>
      <TextField
        label="Package"
        size="compact"
        placeholder="weather"
        value={action.packageId}
        onChange={(event) => {
          onChange({ ...action, packageId: event.target.value });
        }}
      />
      <TextField
        label="Service"
        size="compact"
        value={action.service}
        onChange={(event) => {
          onChange({ ...action, service: event.target.value });
        }}
      />
    </>
  );
}
