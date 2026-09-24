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

import type { EntityView, SceneApplyResult, SceneView } from '@nebula-home/contracts';
import { Badge, Button, cn, IconButton, SelectField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { WrenchIcon } from '@/components/icons';
import { areaFacetChoices } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import { useListState } from '@/lib/use-list-state';
import { applyScene, fetchEntities, fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { matchesSceneFilter, OPEN_SCENE_FILTER, SCENE_FILTER_CODEC } from '@/library/list-filters';
import { DeviceIcon, useCatalogueIcons } from '@/routes/library/device-icon';
import { Facet, facetChoices, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SceneDialog, type SceneDialogTarget } from '@/routes/library/scene-dialog';
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

/**
 * Renders the scenes page.
 *
 * @returns The page.
 */
export function ScenesPage() {
  const can = useSession((state) => state.can);
  const canWrite = can('scene:write');
  const canApply = can('scene:apply');
  const [target, setTarget] = useState<SceneDialogTarget | null>(null);
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
  const isNarrowed = filter.search.trim() !== '' || filter.areaKey !== '';
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
    'Any area',
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
              ? `${String(result.failed)} entit${result.failed === 1 ? 'y' : 'ies'} failed.`
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
    <>
      <LibraryPage
        title="Scenes"
        noun="scene"
        count={scenes.isPending ? undefined : items.length}
        shownCount={shown.length}
        tools={
          <>
            <SearchField
              placeholder="Search scenes, members…"
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label="Narrow the scenes"
              count={Number(filter.areaKey !== '')}
              onClear={() => {
                setFilter({ ...filter, areaKey: '' });
              }}
            >
              <Facet title="Area">
                {areaOptions.length === 1 ? (
                  <span className="text-caption text-foreground-subtle">
                    No scene is placed in an area yet.
                  </span>
                ) : (
                  <SelectField
                    label="Area"
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
              size="compact"
              onClick={() => {
                setTarget({ mode: 'create' });
              }}
            >
              New scene
            </Button>
          ) : undefined
        }
        isPending={scenes.isPending}
        error={scenes.error ?? (pageError === null ? undefined : new Error(pageError))}
        isEmpty={items.length === 0}
        emptyMessage="No scenes yet."
      >
        {shown.length === 0 ? (
          <NoMatches
            query={filter.search}
            onClear={() => {
              setFilter(OPEN_SCENE_FILTER);
            }}
          />
        ) : null}
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((scene) => {
            const memberAreas = areaNamesFor(scene, entityById);
            const partial = partialById.get(scene.id);
            const isBusy = busyId === scene.id;

            return (
              <li key={scene.id} className="list-none">
                <article
                  className={cn(
                    'flex h-full min-h-41 flex-col rounded-panel border border-border face-card p-4.5',
                    'transition-[border-color,box-shadow]',
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-tile bg-surface-raised text-foreground-muted"
                    >
                      {scene.icon === null ? (
                        <span className="text-subhead leading-none font-semibold tracking-tight">
                          {scene.name.charAt(0).toUpperCase()}
                        </span>
                      ) : (
                        <DeviceIcon icon={icons.get(scene.icon)} size={18} />
                      )}
                    </span>
                    <span className="grow" />
                    {canWrite ? (
                      <IconButton
                        variant="bare"
                        size="small"
                        label={`Configure ${scene.name}`}
                        className="-mt-0.5 -mr-1 text-foreground-subtle hover:text-foreground"
                        disabled={isBusy}
                        onClick={() => {
                          setTarget({ mode: 'edit', scene });
                        }}
                      >
                        <WrenchIcon width="15" height="15" />
                      </IconButton>
                    ) : null}
                  </div>

                  <div className="mt-4 flex min-w-0 flex-col gap-1">
                    <span className="truncate text-title leading-tight font-medium text-foreground">
                      {scene.name}
                    </span>
                    <span className="text-caption leading-tight text-foreground-subtle tabular">
                      {String(scene.members.length)} entit
                      {scene.members.length === 1 ? 'y' : 'ies'}
                      {memberAreas.length === 0
                        ? ''
                        : ` across ${String(memberAreas.length)} area${memberAreas.length === 1 ? '' : 's'}`}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {scene.areaKey === null ? null : (
                      <Badge tone="neutral" size="small">
                        {areaByKey.get(scene.areaKey)?.name ?? scene.areaKey.replaceAll('_', ' ')}
                      </Badge>
                    )}
                    {memberAreas.map((area) => (
                      <Badge key={area} tone="neutral" size="small">
                        {area}
                      </Badge>
                    ))}
                  </div>

                  <span className="grow" />

                  {partial === undefined ? null : (
                    <p role="alert" className="mt-3 text-caption text-danger">
                      {partial}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <span className="grow font-mono text-caption text-foreground-subtle">
                      {scene.key}
                    </span>
                    {canApply ? (
                      <Button
                        size="compact"
                        isBusy={isBusy}
                        disabled={busyId !== null && !isBusy}
                        onClick={() => {
                          setPageError(null);
                          setBusyId(scene.id);
                          apply.mutate(scene.id);
                        }}
                      >
                        Apply
                      </Button>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}

          {canWrite && !isNarrowed ? (
            <li className="list-none">
              <button
                type="button"
                className={cn(
                  'flex h-full min-h-41 w-full flex-col items-start justify-center gap-1 rounded-panel border border-dashed border-border-strong p-4.5 text-left',
                  'text-foreground-muted transition-colors hover:border-primary/40 hover:text-foreground',
                  'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                )}
                onClick={() => {
                  setTarget({ mode: 'create' });
                }}
              >
                <span className="text-title font-medium text-foreground">New scene</span>
                <span className="text-caption text-foreground-subtle">
                  Capture what is on right now
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      </LibraryPage>

      <SceneDialog
        key={
          target === null ? 'shut' : target.mode === 'create' ? 'create' : `edit:${target.scene.id}`
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
