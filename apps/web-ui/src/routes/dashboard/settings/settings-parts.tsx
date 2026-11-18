/**
 * The pieces the settings of a card type are written with, the same the panel's own fields are
 * drawn as: a field with its label, a choice of a few drawn as pills, and a list of entities
 * with Remove on each and Add at the foot, which opens the platform's entity picker.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityView } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { entityKindOf } from '@/library/entity-kind';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { EntityTile } from '@/routes/library/entity-tile';

/**
 * Renders one field of a card's settings: its label, a quiet note at the right, the control.
 *
 * @param props - The field.
 * @param props.label - What it sets.
 * @param props.note - A quiet word at the right of the label.
 * @param props.children - The control.
 * @returns The field.
 */
export function SettingsField(props: {
  readonly label: string;
  readonly note?: string | undefined;
  readonly children: ReactNode;
}) {
  const { label, note, children } = props;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4.5 items-center justify-between gap-2 text-caption text-foreground-subtle">
        <span>{label}</span>
        {note === undefined ? null : <span>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Renders a choice of a few as pills, the one chosen raised.
 *
 * @param props - The choice.
 * @param props.label - What it chooses, for a screen reader.
 * @param props.options - The choices.
 * @param props.value - The one chosen.
 * @param props.onChange - When another is chosen.
 * @returns The choice.
 */
export function PillChoice<TValue extends string>(props: {
  readonly label: string;
  readonly options: readonly { readonly value: TValue; readonly label: string }[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
}) {
  const { label, options, value, onChange } = props;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-pill border border-border-strong bg-surface p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cn(
            'flex h-7.5 flex-1 items-center justify-center rounded-pill text-ui-sm whitespace-nowrap',
            'transition-[background-color,color] duration-150 ease-out',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            option.value === value
              ? 'bg-surface-high font-medium text-foreground'
              : 'text-foreground-muted hover:text-foreground',
          )}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** What a list of entities needs. */
export type EntityRowsProps = {
  /** The entities chosen, in order. */
  readonly entities: readonly EntityView[];

  /** Which entities may be added. */
  readonly accept: (entity: EntityView) => boolean;

  /** How many it may hold. */
  readonly maximum: number;

  /** What the picker is headed. */
  readonly pickerTitle: string;

  /** Takes the new list. */
  readonly onChange: (entityIds: readonly string[]) => void;
};

/**
 * Renders a list of entities with Remove on each row and Add at the foot.
 *
 * @param props - See {@link EntityRowsProps}.
 * @returns The list.
 */
export function EntityRows(props: EntityRowsProps) {
  const { t } = useTranslation();

  const { entities, accept, maximum, pickerTitle, onChange } = props;
  const [isPicking, setPicking] = useState(false);
  const ids = entities.map((entity) => entity.entityId);

  return (
    <div className="flex flex-col overflow-hidden rounded-tile border border-border-strong bg-surface-raised/50">
      {entities.map((entity) => (
        <div
          key={entity.entityId}
          className="flex h-10 animate-fade-in items-center gap-2.5 border-b border-border px-2.5"
        >
          <EntityTile
            icon={undefined}
            kind={entityKindOf(entity)}
            isActive={null}
            size="tiny"
            isPlain
          />
          <span className="flex min-w-0 grow items-baseline gap-1.5">
            <span className="truncate text-ui-sm">{entity.name}</span>
            {entity.areaName === null ? null : (
              <span className="shrink-0 text-caption text-foreground-subtle">
                {entity.areaName}
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label={t('dashboard.settingsParts.removeName', 'Remove {{name}}', {
              name: entity.name,
            })}
            className="flex size-6 shrink-0 items-center justify-center rounded-pill text-foreground-subtle transition-colors hover:bg-danger-soft hover:text-danger"
            onClick={() => {
              onChange(ids.filter((id) => id !== entity.entityId));
            }}
          >
            <AppIcon id="x" size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={entities.length >= maximum}
        className="flex h-10 items-center gap-2 px-3 text-ui-sm font-medium text-foreground-muted transition-colors hover:enabled:text-foreground disabled:opacity-50"
        onClick={() => {
          setPicking(true);
        }}
      >
        <AppIcon id="plus" size={14} />
        {entities.length >= maximum
          ? t('dashboard.settingsParts.full', 'At most {{count}}', { count: maximum })
          : t('dashboard.settingsParts.add', 'Add')}
      </button>
      <EntityPicker
        isOpen={isPicking}
        onClose={() => {
          setPicking(false);
        }}
        title={pickerTitle}
        value={ids}
        accept={accept}
        isMultiple
        onChoose={(chosen) => {
          setPicking(false);
          onChange(chosen.map((entity) => entity.entityId).slice(0, maximum));
        }}
      />
    </div>
  );
}
