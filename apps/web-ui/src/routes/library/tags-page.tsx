/**
 * Tags: every word the owner groups devices and entities by, and what each is on.
 *
 * The list is the tags; what carries each is worked out here from the devices and the entities
 * the library already reads, the way the devices page groups entities under devices, so a tag
 * opens to its carriers without a request per tag. Search narrows by name, the filter by colour
 * and by what the tag is on, and a tag is made, renamed, recoloured or deleted from its own
 * dialog - the tag itself, that is; putting one on a device or an entity is done from theirs.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { DeviceView, EntityView } from '@nebula-home/contracts';
import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import { matchesTagFilter, OPEN_TAG_FILTER, type TagFilter } from '@/library/tag-filters';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { LibraryPage } from '@/routes/library/library-page';
import { TagDialog, type TagDialogTarget } from '@/routes/library/tag-dialog';
import { TagFilterButton } from '@/routes/library/tag-filter';
import { TAG_COLUMNS, TagRow } from '@/routes/library/tag-row';
import { useTags } from '@/routes/library/use-tags';

/**
 * Groups rows by each tag they carry.
 *
 * @param rows - Devices or entities, each with its tag ids.
 * @returns A map from tag id to the rows carrying it, in the order given.
 */
function byTag<TRow extends { readonly tagIds: readonly string[] }>(
  rows: readonly TRow[],
): Map<string, TRow[]> {
  const groups = new Map<string, TRow[]>();

  for (const row of rows) {
    for (const tagId of row.tagIds) {
      groups.set(tagId, [...(groups.get(tagId) ?? []), row]);
    }
  }

  return groups;
}

/**
 * Renders the tags page.
 *
 * @returns The page.
 */
export function TagsPage() {
  const can = useSession((state) => state.can);
  const canWrite = can('tag:write');
  const { tags, isPending } = useTags();
  const [filter, setFilter] = useState<TagFilter>(OPEN_TAG_FILTER);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<TagDialogTarget | null>(null);

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,

    /**
     * Reads every device, for what carries each tag.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,

    /**
     * Reads every entity, for what carries each tag.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The entities.
     */
    queryFn: async ({ signal }) => fetchEntities(signal),
  });

  const icons = useCatalogueIcons([
    ...tags.map((tag) => tag.icon),
    ...(devices.data ?? []).map((device) => device.icon),
    ...(entities.data ?? []).map((entity) => entity.icon),
  ]);
  const devicesByTag: Map<string, DeviceView[]> = byTag(devices.data ?? []);
  const entitiesByTag: Map<string, EntityView[]> = byTag(entities.data ?? []);
  const shown = tags.filter((tag) => matchesTagFilter(tag, filter));

  /**
   * Opens a tag that is shut, or shuts one that is open.
   *
   * @param tagId - Which tag.
   */
  const toggle = (tagId: string): void => {
    setOpenIds((current) => {
      const next = new Set(current);

      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }

      return next;
    });
  };

  return (
    <>
      <LibraryPage
        title="Tags"
        noun="tag"
        count={isPending ? undefined : tags.length}
        tools={
          <>
            <TextField
              label="Search"
              isLabelHidden
              size="compact"
              type="search"
              placeholder="Search tags…"
              className="w-44 lg:w-72"
              value={filter.search}
              onChange={(event) => {
                setFilter({ ...filter, search: event.target.value });
              }}
            />
            <TagFilterButton filter={filter} onChange={setFilter} />
          </>
        }
        action={
          canWrite ? (
            <Button
              size="compact"
              onClick={() => {
                setTarget({ mode: 'create' });
              }}
            >
              New tag
            </Button>
          ) : undefined
        }
        isPending={isPending}
        isEmpty={tags.length === 0}
        emptyMessage="No tags yet. A tag groups devices and entities, so an automation or a scene can pick them all at once."
      >
        <div className="rounded-panel border border-border face-card">
          <div
            className={`${TAG_COLUMNS} border-b border-border-soft px-4 py-2.5 text-label text-foreground-subtle uppercase`}
            aria-hidden="true"
          >
            <span className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <span>Tag</span>
              <span className="hidden md:block">On</span>
              <span />
            </span>
            <span />
          </div>

          {shown.length === 0 ? (
            <p className="px-4 py-3.5 text-ui text-foreground-muted">
              Nothing matches. Clear the search or widen the filters.
            </p>
          ) : (
            <ul>
              {shown.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  devices={devicesByTag.get(tag.id) ?? []}
                  entities={entitiesByTag.get(tag.id) ?? []}
                  icons={icons}
                  isOpen={openIds.has(tag.id)}
                  onToggle={() => {
                    toggle(tag.id);
                  }}
                  canEdit={canWrite}
                  onEdit={() => {
                    setTarget({ mode: 'edit', tag });
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </LibraryPage>

      {/*
       * Beside the frame rather than inside it: the frame shows a notice in place of its
       * children while the list is empty, and a dialog that is one of those children cannot
       * open to make the first tag.
       */}
      <TagDialog
        // Keyed on the target, so the dialog is a fresh one each time it opens.
        key={
          target === null
            ? 'tag-shut'
            : target.mode === 'create'
              ? 'tag-create'
              : `tag-${target.tag.id}`
        }
        target={target}
        onClose={() => {
          setTarget(null);
        }}
        onSaved={() => {
          setTarget(null);
        }}
        onDeleted={() => {
          setTarget(null);
        }}
      />
    </>
  );
}
