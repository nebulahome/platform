/**
 * A field that holds one entity, chosen from the house by floor, room and device.
 *
 * It looks like the other fields it sits among, and shows what it holds the way the picker does:
 * the entity's tile, its name, and its room. Pressing it opens the {@link EntityPicker}. A field
 * that may be left empty says so and offers to clear itself.
 *
 * A new installation has no entities at all - nothing has been adopted yet - and a picker with
 * nothing in it is a control that cannot be used; so when the registry is empty, or cannot be
 * read, the field becomes a text field, and somebody can still write the rule they are planning
 * for the light they are about to plug in. The two are the same field to whoever is filling it
 * in, which is why the switch lives here rather than at every call site.
 */
import { useState } from 'react';

import type { EntityView } from '@nebula-home/contracts';
import { AppIcon, cn, controlFace, FieldShell, IconButton, TextField } from '@nebula-home/ui';

import { capabilityStateOf } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { isActiveState } from '@/library/history-series';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';
import { EntityTile } from '@/routes/library/entity-tile';

/** What the field needs. */
export type EntityFieldProps = {
  /** What this entity is for. */
  readonly label: string;

  /** Whether the label is read to a screen reader only. */
  readonly isLabelHidden?: boolean;

  /** The address chosen so far; empty for none. */
  readonly value: string;

  /** Called with the new address; empty when the field was cleared. */
  readonly onChange: (value: string, entity: EntityView | undefined) => void;

  /** Which entities may be chosen; every one unless said otherwise. */
  readonly accept?: ((entity: EntityView) => boolean) | undefined;

  /** Whether the field may be left empty, which offers to clear it. */
  readonly isOptional?: boolean;

  /** How tall; compact beside other compact fields. */
  readonly size?: 'compact' | 'medium';

  /** What the picker asks. */
  readonly pickerTitle?: string;

  /** A line under the field. */
  readonly hint?: string | undefined;

  /** What is wrong with the choice, when something is. */
  readonly error?: string | undefined;

  /** Whether it can be changed at all. */
  readonly disabled?: boolean;
};

/**
 * Renders an entity field.
 *
 * @param props - See {@link EntityFieldProps}.
 * @returns The field.
 */
export function EntityField(props: EntityFieldProps) {
  const {
    label,
    isLabelHidden = false,
    value,
    onChange,
    accept,
    isOptional = false,
    size = 'compact',
    pickerTitle,
    hint,
    error,
    disabled = false,
  } = props;
  const [isPicking, setPicking] = useState(false);
  const directory = useEntityDirectory(value !== '');
  const chosen = directory.entities.find((entity) => entity.entityId === value);

  if (!directory.isPending && directory.entities.length === 0) {
    return (
      <TextField
        label={label}
        isLabelHidden={isLabelHidden}
        value={value}
        size={size}
        placeholder="light.hallway_ceiling"
        disabled={disabled}
        error={error}
        hint={
          hint ??
          (directory.error === null
            ? 'Nothing adopted yet, so this is typed rather than chosen.'
            : 'The entities could not be read, so this is typed rather than chosen.')
        }
        onChange={(event) => {
          onChange(event.target.value, undefined);
        }}
      />
    );
  }

  const room = chosen?.areaName;

  return (
    <FieldShell label={label} isLabelHidden={isLabelHidden} hint={hint} error={error}>
      {(ids) => (
        <div className="relative">
          <button
            id={ids.id}
            type="button"
            aria-haspopup="dialog"
            aria-describedby={ids.describedBy}
            disabled={disabled}
            title={chosen?.entityId ?? (value === '' ? undefined : value)}
            onClick={() => {
              setPicking(true);
            }}
            className={cn(
              controlFace({ size, isInvalid: ids.isInvalid }),
              'press flex items-center gap-2 text-left',
              isOptional && value !== '' ? 'pr-9' : undefined,
            )}
          >
            {chosen === undefined ? (
              <span
                className={cn(
                  'grow truncate',
                  value === '' ? 'text-foreground-disabled' : 'font-mono text-foreground',
                )}
              >
                {value === '' ? 'Choose an entity…' : value}
              </span>
            ) : (
              <>
                <EntityTile
                  size="tiny"
                  icon={chosen.icon === null ? undefined : directory.icons.get(chosen.icon)}
                  kind={entityKindOf(chosen)}
                  isActive={isActiveState(capabilityStateOf(chosen, directory.readings[value]))}
                  isAvailable={chosen.isAvailable}
                />
                <span className="min-w-0 grow truncate">
                  <span className="text-foreground">{chosen.name}</span>
                  {room === null ? null : <span className="text-foreground-subtle"> · {room}</span>}
                </span>
              </>
            )}
            {isOptional && value !== '' ? null : (
              <AppIcon id="chevron-down" size={14} className="shrink-0 text-foreground-subtle" />
            )}
          </button>
          {isOptional && value !== '' ? (
            <IconButton
              size="small"
              label={`Clear ${label}`}
              disabled={disabled}
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => {
                onChange('', undefined);
              }}
            >
              <AppIcon id="x" size={13} />
            </IconButton>
          ) : null}
          <EntityPicker
            isOpen={isPicking}
            {...(pickerTitle === undefined ? {} : { title: pickerTitle })}
            value={value === '' ? [] : [value]}
            accept={accept}
            onClose={() => {
              setPicking(false);
            }}
            onChoose={(entities) => {
              const [entity] = entities;

              setPicking(false);

              if (entity !== undefined) {
                onChange(entity.entityId, entity);
              }
            }}
          />
        </div>
      )}
    </FieldShell>
  );
}
