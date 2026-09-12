/**
 * The saved states of the house.
 *
 * A scene is a button: it sets a set of entities to a set of states, and the only thing anybody
 * does with one is press it. Which is exactly what this page cannot offer — `POST
 * /scenes/:id/apply` waits on the scene engine (ARCHITECTURE.md §6.2), where applying a set of
 * states transactionally, and rolling back when half of them fail, belongs.
 *
 * So the page shows what each scene would set. That is worth having on its own: "what does Good
 * night actually do" is the question people ask before they trust one, and it is unanswerable
 * from a list of names.
 */
import { useQuery } from '@tanstack/react-query';

import { Badge, Panel, PanelRow } from '@nebula-home/ui';

import { fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { LibraryPage } from '@/routes/library/library-page';

/**
 * Renders the scenes page.
 *
 * @returns The page.
 */
export function ScenesPage() {
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

  const items = scenes.data ?? [];

  return (
    <LibraryPage
      title="Scenes"
      summary="A saved set of states. Applying one waits on the scene engine, which is not built — until then this is what each would set."
      noun="scene"
      count={scenes.isPending ? undefined : items.length}
      isPending={scenes.isPending}
      error={scenes.error}
      isEmpty={items.length === 0}
      emptyMessage="No scenes yet."
    >
      <Panel title="Saved">
        {items.map((scene) => (
          <PanelRow
            key={scene.id}
            title={
              <span className="flex items-center gap-2.5">
                <span>{scene.name}</span>
                {scene.areaKey === null ? null : (
                  <Badge tone="neutral" size="small">
                    {scene.areaKey.replaceAll('_', ' ')}
                  </Badge>
                )}
              </span>
            }
            note={`${String(scene.members.length)} entit${scene.members.length === 1 ? 'y' : 'ies'}${
              scene.transitionMs > 0
                ? ` · over ${String(Math.round(scene.transitionMs / 100) / 10)}s`
                : ''
            }${scene.rollbackOnPartialFailure ? ' · rolls back on failure' : ''}`}
            control={
              <span className="font-mono text-caption text-foreground-subtle">{scene.key}</span>
            }
          />
        ))}
      </Panel>
    </LibraryPage>
  );
}
