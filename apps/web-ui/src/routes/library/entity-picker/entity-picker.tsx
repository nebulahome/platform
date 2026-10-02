/**
 * Choosing an entity the way a person finds one: by floor, room and device, or by typing.
 *
 * Every place in the interface that needs an entity opens this - an alias's sources, an
 * automation's triggers, conditions and commands, a scene's members - so a lamp is found the same
 * way wherever it is asked for. The search reads the name, the address, the synonyms, the room
 * and the device, folding case and accents; the pills narrow by kind of thing. A caller may also
 * narrow what can be chosen at all - only what takes commands, only what a scene can set - and
 * what it rules out is not shown.
 *
 * A press chooses and the footer confirms, so a stray press is not a choice; a double press takes
 * it at once. Several may be chosen where the caller adds many at a time.
 */
import { useState } from 'react';

import type { EntityView } from '@nebulahome/contracts';
import { Button, cn, Modal, TextField } from '@nebulahome/ui';

import { matchesQuery } from '@/lib/search-text';
import {
  ENTITY_FAMILIES,
  entityFamilyOf,
  entityKindOf,
  FAMILY_LABELS,
  type EntityFamily,
} from '@/library/entity-kind';
import { buildEntityTree, entityCountOf } from '@/library/entity-tree';
import { EntityPickerTree } from '@/routes/library/entity-picker/entity-picker-tree';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** What the picker needs. */
export type EntityPickerProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** What the dialog asks: "Which one?", "Add to the scene". */
  readonly title?: string;

  /** The addresses already chosen, drawn as chosen when it opens. */
  readonly value?: readonly string[];

  /** Which entities may be chosen; every one unless said otherwise. */
  readonly accept?: ((entity: EntityView) => boolean) | undefined;

  /** Whether several may be chosen at once. */
  readonly isMultiple?: boolean;

  /** Called with what was chosen, when the choice is confirmed. */
  readonly onChoose: (entities: readonly EntityView[]) => void;
};

/**
 * Whether an entity answers a query, by everything a person might remember it by.
 *
 * @param entity - The entity.
 * @param deviceName - The name of its device, when it has one.
 * @param query - As typed.
 * @returns True when every word is found.
 */
export function pickerMatches(
  entity: EntityView,
  deviceName: string | null,
  query: string,
): boolean {
  return matchesQuery(
    [
      entity.name,
      entity.entityId,
      entity.areaName,
      deviceName,
      entityKindOf(entity).label,
      ...entity.searchAliases,
    ],
    query,
  );
}

/** What the body needs: the picker's props, without the opening and shutting. */
type PickerBodyProps = Omit<EntityPickerProps, 'isOpen' | 'title'>;

/**
 * The picker's contents, mounted fresh each time it opens so the search starts empty.
 *
 * @param props - See {@link PickerBodyProps}.
 * @returns The contents.
 */
function PickerBody(props: PickerBodyProps) {
  const { onClose, value = [], accept, isMultiple = false, onChoose } = props;
  const directory = useEntityDirectory();
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<EntityFamily | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(value));

  const deviceNames = new Map(directory.devices.map((device) => [device.id, device.name]));
  const choosable = directory.entities.filter((entity) => accept?.(entity) ?? true);
  const families = ENTITY_FAMILIES.filter((candidate) =>
    choosable.some((entity) => entityFamilyOf(entity) === candidate),
  );
  const shown = choosable.filter(
    (entity) =>
      (family === null || entityFamilyOf(entity) === family) &&
      pickerMatches(entity, deviceNames.get(entity.source) ?? null, query),
  );
  const tree = buildEntityTree({
    areas: directory.areas,
    devices: directory.devices,
    entities: shown,
  });
  const chosenEntities = directory.entities.filter((entity) => chosen.has(entity.entityId));

  /**
   * Chooses an entity, or - in a multiple choice - un-chooses one already chosen.
   *
   * @param entity - The entity pressed.
   */
  const toggle = (entity: EntityView): void => {
    setChosen((current) => {
      if (!isMultiple) {
        return new Set([entity.entityId]);
      }

      const next = new Set(current);

      if (next.has(entity.entityId)) {
        next.delete(entity.entityId);
      } else {
        next.add(entity.entityId);
      }

      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Search"
        isLabelHidden
        type="search"
        placeholder="Search by name, room or device…"
        // The dialog opens to find something; the search is where that starts.
        // eslint-disable-next-line jsx-a11y/no-autofocus -- see above
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />

      {families.length < 2 ? null : (
        <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5">
          {[null, ...families].map((candidate) => (
            <button
              key={candidate ?? 'all'}
              type="button"
              aria-pressed={family === candidate}
              onClick={() => {
                setFamily(candidate);
              }}
              className={cn(
                'press h-7 rounded-full border px-3 text-caption transition-colors',
                'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                family === candidate
                  ? 'border-border-strong face-pill font-medium text-foreground'
                  : 'border-border-soft text-foreground-muted hover:text-foreground',
              )}
            >
              {candidate === null ? 'Everything' : FAMILY_LABELS[candidate]}
            </button>
          ))}
        </div>
      )}

      <div className="h-96 overflow-y-auto pr-1">
        {directory.isPending ? (
          <p role="status" className="py-6 text-center text-ui text-foreground-muted">
            Reading…
          </p>
        ) : entityCountOf(tree) === 0 ? (
          <p role="status" className="py-6 text-center text-ui text-foreground-muted">
            {choosable.length === 0
              ? 'There is nothing here to choose yet.'
              : 'Nothing matches. Try fewer words, or another kind.'}
          </p>
        ) : (
          <EntityPickerTree
            tree={tree}
            directory={directory}
            chosen={chosen}
            isMultiple={isMultiple}
            isNarrowed={query.trim() !== '' || family !== null}
            onToggle={toggle}
            onTake={(entity) => {
              if (!isMultiple) {
                onChoose([entity]);
              }
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border-soft pt-4">
        <p className="mr-auto min-w-0 truncate text-caption text-foreground-subtle">
          {chosenEntities.length === 0
            ? 'Nothing chosen yet.'
            : isMultiple
              ? `${String(chosenEntities.length)} chosen`
              : `Chosen: ${chosenEntities[0]?.name ?? ''}`}
        </p>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={chosenEntities.length === 0}
          onClick={() => {
            onChoose(chosenEntities);
          }}
        >
          {isMultiple ? `Add ${String(chosenEntities.length)}` : 'Use this one'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Renders the picker.
 *
 * @param props - See {@link EntityPickerProps}.
 * @returns The dialog.
 */
export function EntityPicker(props: EntityPickerProps) {
  const { isOpen, onClose, title = 'Which one?', ...body } = props;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="large">
      {isOpen ? <PickerBody onClose={onClose} {...body} /> : null}
    </Modal>
  );
}
