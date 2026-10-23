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
import { useTranslation } from 'react-i18next';

import type { DeviceView, EntityView } from '@nebulahome/contracts';
import { AppIcon, Button, EmptyState } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { DOCS_LINKS } from '@/lib/docs-links';
import { useListState } from '@/lib/use-list-state';
import { fetchDevices, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  isNarrowingTags,
  matchesTagFilter,
  OPEN_TAG_FILTER,
  TAG_FILTER_CODEC,
} from '@/library/tag-filters';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
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
  const { t } = useTranslation();

  const can = useSession((state) => state.can);
  const canWrite = can('tag:write');
  const { tags, isPending } = useTags();
  const [filter, setFilter] = useListState(TAG_FILTER_CODEC);
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
  const shown = tags.filter((tag) =>
    matchesTagFilter(tag, filter, {
      devices: devicesByTag.get(tag.id)?.length ?? 0,
      entities: entitiesByTag.get(tag.id)?.length ?? 0,
    }),
  );

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
        title={t('library.tags.tags', 'Tags')}
        counted={(count) =>
          t('library.tags.count', {
            count,
            defaultValue_one: '{{count}} tag',
            defaultValue_other: '{{count}} tags',
          })
        }
        count={isPending ? undefined : tags.length}
        shownCount={shown.length}
        tools={
          <>
            <SearchField
              placeholder={t('library.tags.searchTags', 'Search tags…')}
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <TagFilterButton filter={filter} onChange={setFilter} />
          </>
        }
        action={
          canWrite ? (
            <Button
              onClick={() => {
                setTarget({ mode: 'create' });
              }}
            >
              <AppIcon id="plus" size={15} />
              {t('library.tags.newTag', 'New tag')}
            </Button>
          ) : undefined
        }
        isPending={isPending}
        isEmpty={tags.length === 0}
        empty={
          <EmptyState
            icon={<AppIcon id="tag" size={28} />}
            title={t('library.tags.createYourFirstTag', 'Create your first tag')}
            description={t(
              'library.tags.tagGroupsDevicesAnd',
              'A tag groups devices and entities - every light downstairs, every sensor on a battery - so an automation or a scene can pick them all at once.',
            )}
            action={
              canWrite ? (
                <Button
                  onClick={() => {
                    setTarget({ mode: 'create' });
                  }}
                >
                  <AppIcon id="plus" size={15} />
                  {t('library.tags.newTag', 'New tag')}
                </Button>
              ) : undefined
            }
            learnMoreHref={DOCS_LINKS.tags}
          />
        }
      >
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <div
            className={`${TAG_COLUMNS} border-b border-border px-5.5 py-3 font-mono text-label text-foreground-subtle uppercase`}
            aria-hidden="true"
          >
            <span className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <span>{t('library.tags.tag', 'Tag')}</span>
              <span className="hidden md:block">{t('common.on', 'On')}</span>
              <span />
            </span>
            <span />
          </div>

          {shown.length === 0 ? (
            <div className="p-4">
              <NoMatches
                query={filter.search}
                onClear={
                  filter.search.trim() !== '' || isNarrowingTags(filter)
                    ? () => {
                        setFilter(OPEN_TAG_FILTER);
                      }
                    : undefined
                }
              />
            </div>
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
