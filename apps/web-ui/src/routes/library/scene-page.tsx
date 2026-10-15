/**
 * A scene's own page: `/scenes/new` makes one, `/scenes/:sceneId` changes one.
 *
 * The form is the scene editor's (`scene-dialog.tsx`), drawn as a page as the board draws it:
 * its members in the main column, What it is and How it applies beside them, Apply now, Delete,
 * Cancel and Save in the header. Saving and deleting go back to the list; Apply now applies the
 * scene as it is saved, and says when part of it did not take.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { toMessage } from '@/lib/error-message';
import { applyScene, fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { DetailPlaceholder } from '@/routes/library/detail-page';
import { SceneDialog } from '@/routes/library/scene-dialog';

/**
 * Renders a scene's page.
 *
 * @returns The page.
 */
export function ScenePage() {
  const { t } = useTranslation();

  const { sceneId } = useParams();
  const navigate = useNavigate();
  const isNew = sceneId === undefined;

  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    enabled: !isNew,

    /**
     * Reads every scene, for the one being changed.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The scenes.
     */
    queryFn: async ({ signal }) => fetchScenes(signal),
  });
  const apply = useMutation({
    /**
     * Applies the scene.
     *
     * @param id - The scene.
     * @returns What the server reported.
     */
    mutationFn: async (id: string) => applyScene(id),
  });

  /** Goes back to the list. */
  const back = (): void => {
    void navigate('/scenes');
  };

  const scene = scenes.data?.find((each) => each.id === sceneId);

  if (!isNew && scene === undefined) {
    return (
      <div className="min-h-0 grow overflow-y-auto px-8 pt-6 pb-10">
        <DetailPlaceholder isProblem={!scenes.isPending}>
          {scenes.isPending
            ? t('library.scene.reading', 'Reading…')
            : scenes.error === null
              ? t('library.scene.thereIsNoScene', 'There is no scene with that id.')
              : toMessage(scenes.error)}
        </DetailPlaceholder>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 grow flex-col">
      {apply.error === null ? null : (
        <p role="alert" className="shrink-0 px-8 pt-3 text-ui-sm text-danger">
          {toMessage(apply.error)}
        </p>
      )}
      {apply.data === undefined ? null : (
        <p
          role={apply.data.failed === 0 ? 'status' : 'alert'}
          className="shrink-0 px-8 pt-3 text-ui-sm text-foreground-muted"
        >
          {apply.data.failed === 0
            ? t('library.scene.applied', 'Applied.')
            : t('library.scene.appliedButFailedDid', 'Applied, but {{failed}} did not take.', {
                failed: String(apply.data.failed),
              })}
        </p>
      )}
      <SceneDialog
        key={scene?.id ?? 'new'}
        presentation="page"
        target={scene === undefined ? { mode: 'create' } : { mode: 'edit', scene }}
        onClose={back}
        onSaved={back}
        onDeleted={back}
        onApply={(id) => {
          apply.mutate(id);
        }}
      />
    </div>
  );
}
