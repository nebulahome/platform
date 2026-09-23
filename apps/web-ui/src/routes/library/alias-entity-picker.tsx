/**
 * Choosing a source entity for an alias: a searchable list with domain and area filters.
 *
 * The entity is not typed. Pressing the source row opens this dialog; picking a row fills the
 * source and shuts it. The filters follow the devices page — domain and area as dropdowns —
 * because an installation with hundreds of sensors is unusable as a flat list.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { EntityView } from '@nebula-home/contracts';
import { Button, Modal, SelectField, TextField, cn } from '@nebula-home/ui';

import { fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';

/** What the picker lists before the entities arrive: one list, so the memos below keep. */
const NO_ENTITIES: readonly EntityView[] = [];

/** What the picker needs. */
export type AliasEntityPickerProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** The address already chosen for this source, drawn as pressed. */
  readonly current: string;

  /** Called with the entity picked. */
  readonly onPick: (entity: EntityView) => void;
};

/**
 * Renders the entity picker.
 *
 * @param props - See {@link AliasEntityPickerProps}.
 * @returns The dialog.
 */
export function AliasEntityPicker(props: AliasEntityPickerProps) {
  const { isOpen, onClose, current, onPick } = props;
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState('');
  const [areaKey, setAreaKey] = useState('');

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity the registry knows.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
    enabled: isOpen,
  });

  const items = entities.data ?? NO_ENTITIES;

  const domainOptions = useMemo(() => {
    const domains = [...new Set(items.map((entity) => entity.domain))].sort((left, right) =>
      left.localeCompare(right),
    );

    return [
      { value: '', label: 'Any domain' },
      ...domains.map((value) => ({ value, label: value })),
    ];
  }, [items]);

  const areaOptions = useMemo(() => {
    const areas = [
      ...new Map(
        items
          .filter((entity) => entity.areaKey !== null)
          .map((entity) => [entity.areaKey ?? '', entity.areaName ?? entity.areaKey ?? '']),
      ),
    ].sort((left, right) => left[1].localeCompare(right[1]));

    return [{ value: '', label: 'Any area' }, ...areas.map(([value, label]) => ({ value, label }))];
  }, [items]);

  const needle = search.trim().toLowerCase();
  const shown = items.filter((entity) => {
    if (domain !== '' && entity.domain !== domain) {
      return false;
    }

    if (areaKey !== '' && entity.areaKey !== areaKey) {
      return false;
    }

    if (needle === '') {
      return true;
    }

    const haystack = [entity.name, entity.entityId, entity.areaName ?? '', ...entity.searchAliases]
      .join(' ')
      .toLowerCase();

    return haystack.includes(needle);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Choose an entity"
      description="Search and narrow by domain or area, then pick a row."
      size="large"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Search"
            isLabelHidden
            size="compact"
            type="search"
            placeholder="Search entities…"
            className="min-w-40 grow"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <SelectField
            label="Domain"
            isLabelHidden
            size="compact"
            className="w-36"
            options={domainOptions}
            value={domain}
            onChange={setDomain}
          />
          <SelectField
            label="Area"
            isLabelHidden
            size="compact"
            className="w-36"
            options={areaOptions}
            value={areaKey}
            onChange={setAreaKey}
          />
        </div>

        {entities.isPending ? (
          <p className="text-ui text-foreground-muted">Looking…</p>
        ) : entities.error !== null ? (
          <p role="alert" className="text-ui text-danger">
            The entities could not be read.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-ui text-foreground-muted">
            Nothing matches. Clear the search or widen the filters.
          </p>
        ) : (
          <ul
            className="max-h-96 divide-y divide-border-soft overflow-y-auto rounded-panel border border-border"
            aria-label="Entities"
          >
            {shown.map((entity) => (
              <li key={entity.entityId}>
                <button
                  type="button"
                  aria-pressed={entity.entityId === current}
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors',
                    entity.entityId === current
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground hover:bg-surface-raised',
                  )}
                  onClick={() => {
                    onPick(entity);
                  }}
                >
                  <span className="truncate text-ui font-medium">{entity.name}</span>
                  <span className="truncate font-mono text-caption text-foreground-subtle">
                    {entity.entityId}
                    {entity.areaName === null ? '' : ` · ${entity.areaName}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
