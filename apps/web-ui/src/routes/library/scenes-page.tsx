/**
 * The saved states of the house.
 *
 * A scene is a button: it sets a set of entities to a set of states. This page lists them as
 * cards, lets anyone who may apply press Apply, and lets anyone who may write make, edit or
 * remove one — including the states themselves, not just the names.
 *
 * Apply is the one control a card carries in words, because it is what the card is for. Editing
 * and removing sit behind the spanner, the way they do on a device, a tag or a room: a card with
 * Edit and Remove spelled out above its name gave the two rarest actions the most prominent
 * place on it, and three buttons on a card that is itself a button is a card nobody can read.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type { EntityView, SceneApplyResult, SceneView } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  EmptyState,
  OverflowMenu,
  SelectField,
  TableFooter,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { SortHeader } from '@/components/sort-header';
import { areaFacetChoices } from '@/lib/area-tree';
import { DOCS_LINKS } from '@/lib/docs-links';
import { toMessage } from '@/lib/error-message';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import { applyScene, fetchEntities, fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { matchesSceneFilter, OPEN_SCENE_FILTER, SCENE_FILTER_CODEC } from '@/library/list-filters';
import { DeviceIcon, useCatalogueIcons } from '@/routes/library/device-icon';
import { Facet, facetChoices, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { useAreas } from '@/routes/library/use-areas';

/**
 * The area names a scene's members sit in, from the entity registry.
 *
 * @param scene - The scene.
 * @param entities - Every entity, by address.
 * @returns Distinct area names, in first-seen order.
 */
function areaNamesFor(scene: SceneView, entities: ReadonlyMap<string, EntityView>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const member of scene.members) {
    const areaName = entities.get(member.entityId)?.areaName;

    if (areaName === null || areaName === undefined || seen.has(areaName)) {
      continue;
    }

    seen.add(areaName);
    names.push(areaName);
  }

  return names;
}

/** The columns the table sorts by; the first is the order it opens in. */
const SORTS = ['name', 'members'] as const;

/**
 * Renders the scenes page.
 *
 * @returns The page.
 */
export function ScenesPage() {
  const { t } = useTranslation();

  const can = useSession((state) => state.can);
  const canWrite = can('scene:write');
  const canApply = can('scene:apply');
  const navigate = useNavigate();
  const [filter, setFilter] = useListState(SCENE_FILTER_CODEC);
  const { areas, tree } = useAreas();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [partialById, setPartialById] = useState<ReadonlyMap<string, string>>(new Map());

  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    /**
     * Reads every scene.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every saved set of states.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchScenes(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, so cards can name the areas a scene touches.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }) => fetchEntities(signal),
  });

  const items = scenes.data ?? [];
  const memberCount = items.reduce((sum, scene) => sum + scene.members.length, 0);
  const entityById = new Map((entities.data ?? []).map((entity) => [entity.entityId, entity]));
  const icons = useCatalogueIcons(items.map((scene) => scene.icon));
  const areaByKey = new Map(areas.map((area) => [area.key, area]));
  const shown = items.filter((scene) =>
    matchesSceneFilter(scene, filter, {
      areaName: scene.areaKey === null ? undefined : areaByKey.get(scene.areaKey)?.name,
      memberNames: scene.members.flatMap((member) => {
        const entity = entityById.get(member.entityId);

        return entity === undefined ? [] : [entity.name, entity.areaName ?? ''];
      }),
    }),
  );
  const paging = usePaging('scenes', SORTS, shown.length);
  const rows = paging.rows(
    [...shown].sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      const order =
        paging.sort === 'members' ? left.members.length - right.members.length || byName : byName;

      return paging.direction === 'asc' ? order : -order;
    }),
  );
  // Each area under its floor, the floors by their number, the way the areas page reads.
  const areaOptions = facetChoices(
    areaFacetChoices(
      tree,
      areas,
      new Map(
        items.flatMap((scene) =>
          scene.areaKey === null
            ? []
            : [[scene.areaKey, scene.areaKey.replaceAll('_', ' ')] as const],
        ),
      ),
    ),
    filter.areaKey,
    t('library.scenes.anyArea', 'Any area'),
    true,
  );

  const apply = useMutation({
    /**
     * Applies one scene.
     *
     * @param sceneId - Which one.
     * @returns What the server reported.
     */
    mutationFn: async (sceneId: string): Promise<SceneApplyResult> => applyScene(sceneId),

    /**
     * Clears the card's spinner and records partial failures.
     *
     * @param result - What came back.
     */
    onSuccess: (result) => {
      setBusyId(null);
      setPageError(null);

      if (result.failed > 0) {
        const failed = result.members
          .filter((member) => !member.ok)
          .map((member) => {
            const name = entityById.get(member.entityId)?.name ?? member.entityId;
            const detail = member.error === null || member.error === '' ? 'failed' : member.error;

            return `${name}: ${detail}`;
          });

        setPartialById((current) => {
          const next = new Map(current);

          next.set(
            result.sceneId,
            failed.length === 0
              ? t('library.scenes.entitiesFailed', {
                  count: result.failed,
                  defaultValue_one: '{{count}} entity failed.',
                  defaultValue_other: '{{count}} entities failed.',
                })
              : failed.join(' · '),
          );

          return next;
        });
      } else {
        setPartialById((current) => {
          const next = new Map(current);

          next.delete(result.sceneId);

          return next;
        });
      }
    },

    /**
     * Shows why apply failed entirely.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setBusyId(null);
      setPageError(toMessage(error));
    },
  });

  return (
    <LibraryPage
      title={t('library.scenes.scenes', 'Scenes')}
      counted={(count) =>
        t('library.scenes.count', {
          count,
          defaultValue_one: '{{count}} scene',
          defaultValue_other: '{{count}} scenes',
        })
      }
      count={scenes.isPending ? undefined : items.length}
      shownCount={shown.length}
      summary={[`${String(memberCount)} ${memberCount === 1 ? 'entity' : 'entities'} set`]}
      tools={
        <>
          <SearchField
            placeholder={t('library.scenes.searchScenesMembers', 'Search scenes, members…')}
            value={filter.search}
            onChange={(search) => {
              setFilter({ ...filter, search });
            }}
          />
          <FilterSheet
            label={t('library.scenes.narrowTheScenes', 'Narrow the scenes')}
            count={Number(filter.areaKey !== '')}
            onClear={() => {
              setFilter({ ...filter, areaKey: '' });
            }}
          >
            <Facet title={t('library.scenes.area', 'Area')}>
              {areaOptions.length === 1 ? (
                <span className="text-caption text-foreground-subtle">
                  {t('library.scenes.noSceneIsPlaced', 'No scene is placed in an area yet.')}
                </span>
              ) : (
                <SelectField
                  label={t('library.scenes.area', 'Area')}
                  isLabelHidden
                  size="compact"
                  options={areaOptions}
                  value={filter.areaKey}
                  onChange={(areaKey) => {
                    setFilter({ ...filter, areaKey });
                  }}
                />
              )}
            </Facet>
          </FilterSheet>
        </>
      }
      action={
        canWrite ? (
          <Button
            onClick={() => {
              void navigate('/scenes/new');
            }}
          >
            <AppIcon id="plus" size={15} />
            {t('library.scenes.newScene', 'New scene')}
          </Button>
        ) : undefined
      }
      isPending={scenes.isPending}
      error={scenes.error ?? (pageError === null ? undefined : new Error(pageError))}
      isEmpty={items.length === 0}
      empty={
        <EmptyState
          icon={<AppIcon id="layers" size={28} />}
          title={t('library.scenes.createYourFirstScene', 'Create your first scene')}
          description={t(
            'library.scenes.sceneRemembersHowA',
            'A scene remembers how a group of devices should be - lamps dimmed, blinds half closed, music low - and puts all of it back with one press, or from an automation.',
          )}
          action={
            canWrite ? (
              <Button
                onClick={() => {
                  void navigate('/scenes/new');
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('library.scenes.newScene', 'New scene')}
              </Button>
            ) : undefined
          }
          learnMoreHref={DOCS_LINKS.scenes}
        />
      }
    >
      {shown.length === 0 ? (
        <NoMatches
          query={filter.search}
          onClear={() => {
            setFilter(OPEN_SCENE_FILTER);
          }}
        />
      ) : null}
      {shown.length === 0 ? null : (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-border px-5 py-3 font-mono text-label text-foreground-subtle uppercase md:grid-cols-[minmax(0,1fr)_96px_auto_36px]">
            <SortHeader
              label={t('library.scenes.scene', 'Scene')}
              isSorted={paging.sort === 'name'}
              direction={paging.direction}
              onSort={() => {
                paging.toggleSort('name');
              }}
              className="justify-self-start"
            />
            <SortHeader
              label={t('library.scenes.members', 'Members')}
              isSorted={paging.sort === 'members'}
              direction={paging.direction}
              onSort={() => {
                paging.toggleSort('members');
              }}
              className="hidden justify-self-start md:inline-flex"
            />
            <span />
            <span className="hidden md:block" />
          </div>
          <ul>
            {rows.map((scene) => {
              const memberAreas = areaNamesFor(scene, entityById);
              const partial = partialById.get(scene.id);
              const isBusy = busyId === scene.id;
              const place =
                scene.areaKey === null
                  ? memberAreas.join(', ')
                  : (areaByKey.get(scene.areaKey)?.name ?? scene.areaKey.replaceAll('_', ' '));

              return (
                <li
                  key={scene.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-border px-5 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_96px_auto_36px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-field bg-surface-raised text-violet"
                    >
                      {scene.icon === null ? (
                        <AppIcon id="layers" size={17} />
                      ) : (
                        <DeviceIcon icon={icons.get(scene.icon)} size={17} />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        to={`/scenes/${scene.id}`}
                        className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {scene.name}
                      </Link>
                      <span className="truncate text-ui-sm text-foreground-subtle">
                        {place === '' ? scene.key : place}
                      </span>
                      {partial === undefined ? null : (
                        <span role="alert" className="truncate text-caption text-danger">
                          {partial}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="hidden font-mono text-mono-ui text-foreground-muted tabular md:block">
                    {scene.members.length}
                  </span>
                  <span>
                    {canApply ? (
                      <Button
                        variant="ghost"
                        size="compact"
                        isBusy={isBusy}
                        disabled={busyId !== null && !isBusy}
                        onClick={() => {
                          setPageError(null);
                          setBusyId(scene.id);
                          apply.mutate(scene.id);
                        }}
                      >
                        <AppIcon id="play" size={13} />
                        {t('library.scenes.apply', 'Apply')}
                      </Button>
                    ) : null}
                  </span>
                  <span className="hidden md:block">
                    {canWrite ? (
                      <OverflowMenu
                        label={t('library.scenes.moreForName', 'More for {{name}}', {
                          name: scene.name,
                        })}
                        items={[
                          {
                            label: t('common.edit', 'Edit'),
                            icon: 'pencil',
                            /** Opens the scene's page. */
                            onSelect: () => {
                              void navigate(`/scenes/${scene.id}`);
                            },
                          },
                        ]}
                      />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <TableFooter
            page={paging.page}
            size={paging.size}
            total={shown.length}
            onPage={paging.setPage}
            onSize={paging.setSize}
          />
        </div>
      )}
    </LibraryPage>
  );
}
