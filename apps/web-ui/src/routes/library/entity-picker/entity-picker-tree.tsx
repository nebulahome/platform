/**
 * The body of the entity picker: the house laid out by floor, room and device, each entity a row
 * that can be chosen.
 *
 * A floor is a heading that stays at the top of the list while its rooms scroll under it, so a
 * person half-way down "Ground floor" still knows where they are. A room is a smaller heading
 * with a count. A device is a row that opens and shuts: shut, a Shelly energy meter is one line
 * instead of ten, and it opens by itself when a search or a kind has narrowed the list, because
 * then its entities are what the person asked to see.
 *
 * The rows are buttons; the arrow keys move between them, Home and End to the first and last,
 * the way a list of choices moves.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import type { EntityView } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { capabilityStateOf } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import type { DeviceGroup, EntityTree } from '@/library/entity-tree';
import { isActiveState } from '@/library/history-series';
import { DeviceIcon } from '@/routes/library/device-icon';
import type { EntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';
import { EntityStateSummary } from '@/routes/library/entity-state-summary';
import { EntityTile } from '@/routes/library/entity-tile';

/** A device with more entities than this starts shut, unless the list has been narrowed. */
const OPEN_UP_TO = 4;

/** What the tree needs. */
export type EntityPickerTreeProps = {
  readonly tree: EntityTree;

  /** The icons and the live readings. */
  readonly directory: Pick<EntityDirectory, 'icons' | 'readings'>;

  /** The addresses chosen so far. */
  readonly chosen: ReadonlySet<string>;

  /** Whether several may be chosen; the rows are then checkboxes rather than options. */
  readonly isMultiple: boolean;

  /** Whether a search or a kind has narrowed the list. */
  readonly isNarrowed: boolean;

  /** Called with the entity a row was pressed for. */
  readonly onToggle: (entity: EntityView) => void;

  /** Called with an entity chosen by a double press, to take it at once. */
  readonly onTake: (entity: EntityView) => void;
};

/**
 * Moves focus between the rows with the arrow keys.
 *
 * @param event - The key, on the list.
 */
function moveBetweenRows(event: KeyboardEvent<HTMLDivElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

  if (!keys.includes(event.key)) {
    return;
  }

  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-picker-row]')];
  const at = rows.findIndex((row) => row === document.activeElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)));

  event.preventDefault();
  rows[next]?.focus();
}

/**
 * Renders the tree.
 *
 * @param props - See {@link EntityPickerTreeProps}.
 * @returns The list.
 */
export function EntityPickerTree(props: EntityPickerTreeProps) {
  const { tree, directory, chosen, isMultiple, isNarrowed, onToggle, onTake } = props;
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());

  /**
   * Draws one device and, when open, its entities.
   *
   * @param group - The device and its entities in this place.
   * @param place - The place's id, so the same device in two rooms opens separately.
   * @returns The group.
   */
  const renderGroup = (group: DeviceGroup, place: string): ReactNode => {
    const key = `${place}:${group.device?.id ?? 'none'}`;
    const startsOpen = isNarrowed || group.device === null || group.entities.length <= OPEN_UP_TO;
    const isOpen = toggled.has(key) ? !startsOpen : startsOpen;

    const rows = group.entities.map((entity) => {
      const live = directory.readings[entity.entityId];
      const state = capabilityStateOf(entity, live);
      const reading = readingOf(entity, live);
      const isChosen = chosen.has(entity.entityId);

      return (
        <li key={entity.entityId}>
          <button
            type="button"
            data-picker-row
            {...(isMultiple
              ? { role: 'checkbox', 'aria-checked': isChosen }
              : { 'aria-pressed': isChosen })}
            title={entity.entityId}
            onClick={() => {
              onToggle(entity);
            }}
            onDoubleClick={() => {
              onTake(entity);
            }}
            className={cn(
              'flex h-12 w-full items-center gap-3 rounded-field border px-3 text-left transition-colors',
              'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
              isChosen
                ? 'border-primary/50 bg-primary/13'
                : 'border-transparent hover:bg-surface-raised',
            )}
          >
            <EntityTile
              size="small"
              icon={entity.icon === null ? undefined : directory.icons.get(entity.icon)}
              kind={entityKindOf(entity)}
              isActive={isActiveState(state)}
              isAvailable={reading.isAvailable}
            />
            <span className="flex min-w-0 grow flex-col">
              <span className="truncate text-ui font-medium text-foreground">{entity.name}</span>
              <span className="truncate text-caption text-foreground-subtle">
                {entityKindOf(entity).label}
              </span>
            </span>
            <EntityStateSummary reading={reading} state={state} className="shrink-0" />
            <span
              aria-hidden="true"
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border',
                isChosen
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border-strong',
              )}
            >
              {isChosen ? <AppIcon id="check" size={12} strokeWidth={3} /> : null}
            </span>
          </button>
        </li>
      );
    });

    if (group.device === null) {
      return (
        <ul key={key} className="flex flex-col gap-0.5">
          {rows}
        </ul>
      );
    }

    return (
      <div key={key} className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => {
            setToggled((current) => {
              const next = new Set(current);

              if (next.has(key)) {
                next.delete(key);
              } else {
                next.add(key);
              }

              return next;
            });
          }}
          className="flex h-8 items-center gap-2 rounded-chip px-2 text-left text-caption text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
        >
          <AppIcon
            id="chevron-right"
            size={13}
            className={cn('shrink-0 transition-transform', isOpen && 'rotate-90')}
          />
          <DeviceIcon
            icon={group.device.icon === null ? undefined : directory.icons.get(group.device.icon)}
            size={15}
            className="shrink-0"
          />
          <span className="truncate font-medium">{group.device.name}</span>
          <span className="ml-auto shrink-0 text-foreground-subtle tabular">
            {group.entities.length}
          </span>
        </button>
        {isOpen ? <ul className="flex flex-col gap-0.5 pl-5">{rows}</ul> : null}
      </div>
    );
  };

  return (
    // The arrow keys are the list's, as they are a listbox's; every row in it is a real button.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- see above
    <div className="flex flex-col gap-4" onKeyDown={moveBetweenRows}>
      {tree.floors.map((floor) => (
        <section key={floor.floor.id} aria-label={floor.floor.name} className="flex flex-col gap-2">
          <h3 className="sticky top-0 z-10 flex items-center gap-2 border-b border-border-soft bg-surface py-2 text-label text-foreground-subtle uppercase">
            <AppIcon id="layers" size={13} />
            {floor.floor.name}
          </h3>
          {floor.onFloor.map((group) => renderGroup(group, floor.floor.id))}
          {floor.rooms.map((room) => (
            <section key={room.room.id} aria-label={room.room.name} className="flex flex-col gap-1">
              <h4 className="flex items-center gap-2 px-1 pt-1 text-caption font-medium text-foreground">
                <AppIcon id="door-open" size={13} className="text-foreground-subtle" />
                {room.room.name}
              </h4>
              {room.devices.map((group) => renderGroup(group, room.room.id))}
            </section>
          ))}
        </section>
      ))}
      {tree.unplaced.length === 0 ? null : (
        <section aria-label="Not in a room" className="flex flex-col gap-2">
          <h3 className="sticky top-0 z-10 border-b border-border-soft bg-surface py-2 text-label text-foreground-subtle uppercase">
            Not in a room
          </h3>
          {tree.unplaced.map((group) => renderGroup(group, 'unplaced'))}
        </section>
      )}
    </div>
  );
}
