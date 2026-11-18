/**
 * The pieces the settings of Summary, Room, the entity list and quick actions are written with,
 * drawn as the panel's own fields are: a label row over its control, a chosen thing as a row with
 * its order and Remove, and the areas a card may stand for.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, type UiIconId } from '@nebulahome/ui';

import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { useAreas } from '@/routes/library/use-areas';

/**
 * Renders a field of the panel: its label, a quiet note at the right, and the control.
 *
 * @param props - The field.
 * @param props.label - What it sets.
 * @param props.note - A quiet word at the right of the label.
 * @param props.children - The control.
 * @returns The field.
 */
export function OverviewField(props: {
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
 * Renders a small round button of a chosen row.
 *
 * @param props - What it does.
 * @param props.label - What it does, for a screen reader.
 * @param props.icon - Its glyph.
 * @param props.disabled - Whether it can be pressed.
 * @param props.onPress - When pressed.
 * @returns The button.
 */
function RowButton(props: {
  readonly label: string;
  readonly icon: UiIconId;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { label, icon, disabled = false, onPress } = props;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="press-scale inline-flex size-6.5 shrink-0 items-center justify-center rounded-pill text-foreground-muted transition-colors duration-150 hover:enabled:bg-surface-high hover:enabled:text-foreground disabled:opacity-30"
      onClick={onPress}
    >
      <AppIcon id={icon} size={13} />
    </button>
  );
}

/**
 * Renders one chosen thing - an entity of a list, a button of quick actions - with its glyph, its
 * name, a note, and Move up, Move down and Remove.
 *
 * @param props - The row.
 * @param props.glyph - What stands before the name: the entity's tile.
 * @param props.name - Its name.
 * @param props.note - Where it is, or what kind it is.
 * @param props.onUp - Moves it up; absent for the first, or where the order cannot change.
 * @param props.onDown - Moves it down; absent for the last.
 * @param props.onRemove - Takes it off.
 * @returns The row.
 */
export function ChosenRow(props: {
  readonly glyph: ReactNode;
  readonly name: string;
  readonly note?: string | null | undefined;
  readonly onUp?: (() => void) | undefined;
  readonly onDown?: (() => void) | undefined;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();

  const { glyph, name, note, onUp, onDown, onRemove } = props;

  return (
    <li className="flex h-10 min-w-0 items-center gap-2 rounded-tile border border-border-strong bg-surface-raised pr-1 pl-2.5">
      {glyph}
      <span className="flex min-w-0 grow items-baseline gap-1.5">
        <span className="max-w-full shrink-0 truncate text-ui-sm">{name}</span>
        {note === undefined || note === null ? null : (
          <span className="min-w-0 truncate text-caption text-foreground-subtle">{note}</span>
        )}
      </span>
      {onUp === undefined && onDown === undefined ? null : (
        <>
          <RowButton
            label={t('dashboard.settings.overview.moveUp', 'Move up')}
            icon="chevron-up"
            disabled={onUp === undefined}
            onPress={() => {
              onUp?.();
            }}
          />
          <RowButton
            label={t('dashboard.settings.overview.moveDown', 'Move down')}
            icon="chevron-down"
            disabled={onDown === undefined}
            onPress={() => {
              onDown?.();
            }}
          />
        </>
      )}
      <RowButton
        label={t('dashboard.settings.overview.remove', 'Remove {{name}}', { name })}
        icon="x"
        onPress={onRemove}
      />
    </li>
  );
}

/**
 * Renders Add at the foot of a list of chosen things.
 *
 * @param props - What it adds.
 * @param props.label - "Add entities".
 * @param props.disabled - Whether the list is full.
 * @param props.onPress - When pressed.
 * @returns The button.
 */
export function AddButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { label, disabled = false, onPress } = props;

  return (
    <button
      type="button"
      disabled={disabled}
      className="press-scale inline-flex h-8 items-center gap-1.5 self-start rounded-pill px-2.5 text-ui-sm font-medium text-foreground transition-colors duration-150 hover:enabled:bg-surface-raised disabled:opacity-40"
      onClick={onPress}
    >
      <AppIcon id="plus" size={14} />
      {label}
    </button>
  );
}

/**
 * Moves one entry of a list a place up or down.
 *
 * @param list - The list.
 * @param index - The entry.
 * @param by - -1 for up, 1 for down.
 * @returns The list, with the entry moved.
 */
export function moved<TItem>(list: readonly TItem[], index: number, by: -1 | 1): TItem[] {
  const next = [...list];
  const [entry] = next.splice(index, 1);

  if (entry !== undefined) {
    next.splice(index + by, 0, entry);
  }

  return next;
}

/**
 * The areas a card may stand for, by key: the house's rooms and floors as the areas page lists
 * them, and any area an entity names that the list has not (yet) given.
 *
 * @param data - What the page read.
 * @returns Each area's key and name, in the order the owner arranged.
 */
export function useAreaChoices(data: DashboardData): { value: string; label: string }[] {
  const { areas } = useAreas();
  const choices = new Map(
    areas.filter((area) => area.kind !== 'house').map((area) => [area.key, area.name]),
  );

  data.entityById.forEach((entity) => {
    if (entity.areaKey !== null && !choices.has(entity.areaKey)) {
      choices.set(entity.areaKey, entity.areaName ?? entity.areaKey);
    }
  });

  return [...choices].map(([value, label]) => ({ value, label }));
}
