/**
 * A scene, as the button it is.
 *
 * One press applies it: every member is sent to what the scene stores, as ordinary commands. The
 * card says it is applying while it waits, and a toast says how it went - every member, or how
 * many did not answer. A scene that is gone,
 * or a person who may not apply scenes, gets a card that says so rather than a button that fails.
 */
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { DashboardSceneCard, SceneApplyResult } from '@nebulahome/contracts';
import { AppIcon } from '@nebulahome/ui';

import { applyScene } from '@/library/api';
import { toastSceneApplied, toastSceneFailed } from '@/library/scene-apply-toast';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { DeviceIcon } from '@/routes/library/device-icon';

/** What a scene card needs. */
export type SceneCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardSceneCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders a scene card.
 *
 * @param props - See {@link SceneCardProps}.
 * @returns The card.
 */
export function SceneCard(props: SceneCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const scene = data.sceneById.get(card.sceneId);
  const title =
    card.title ?? scene?.name ?? t('dashboard.cards.sceneCard.sceneNotFound', 'Scene not found');
  const apply = useMutation({
    /**
     * Applies the scene.
     *
     * @returns What the server reported.
     */
    mutationFn: async (): Promise<SceneApplyResult> => applyScene(card.sceneId),

    /**
     * Says how it went.
     *
     * @param result - What came back.
     */
    onSuccess: (result) => {
      toastSceneApplied(result, title);
    },

    /**
     * Says why it could not be applied.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      toastSceneFailed(error, title);
    },
  });

  const iconId = card.icon ?? scene?.icon ?? null;
  const disabled = scene === undefined || !data.canApplyScenes || apply.isPending;
  const note = apply.isPending
    ? t('dashboard.cards.sceneCard.applying', 'Applying…')
    : scene === undefined
      ? t(
          'dashboard.cards.sceneCard.itWasRemovedOr',
          'It was removed, or it is not one you may see.',
        )
      : data.canApplyScenes
        ? t('dashboard.cards.sceneCard.things', {
            count: scene.members.length,
            defaultValue_one: '{{count}} thing',
            defaultValue_other: '{{count}} things',
          })
        : t('dashboard.cards.sceneCard.youMayLookNot', 'You may look, not apply.');

  return (
    <CardFrame label={title} tone={scene === undefined ? 'faint' : 'plain'} className="p-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          apply.mutate();
        }}
        className="press flex h-full w-full min-w-0 items-center gap-3 p-4 text-left disabled:cursor-not-allowed"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-tile border border-primary/25 bg-primary/12 text-primary"
        >
          {iconId === null ? (
            <AppIcon id="play" size={18} />
          ) : (
            <DeviceIcon icon={data.icons.get(iconId)} size={18} />
          )}
        </span>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-title font-medium tracking-tight">{title}</span>
          <span className="truncate text-caption text-foreground-subtle">{note}</span>
        </span>
      </button>
    </CardFrame>
  );
}
