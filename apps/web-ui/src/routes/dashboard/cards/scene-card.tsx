/**
 * A scene, as the button it is.
 *
 * One press applies it: every member is sent to what the scene stores, as ordinary commands. The
 * card says it is applying while it waits, and afterwards says how it went - every member, or how
 * many did not answer - for a few seconds, then goes back to being a button. A scene that is gone,
 * or a person who may not apply scenes, gets a card that says so rather than a button that fails.
 */
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardSceneCard, SceneApplyResult } from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { applyScene } from '@/library/api';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { DeviceIcon } from '@/routes/library/device-icon';

/** How long the outcome of a press stays on the card. */
const OUTCOME_MS = 4000;

/** What a scene card needs. */
export type SceneCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardSceneCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Says how applying went, in a few words.
 *
 * @param result - What the server reported.
 * @returns "Applied", or how many failed.
 */
function outcomeOf(result: SceneApplyResult): string {
  return result.failed === 0
    ? 'Applied'
    : `${String(result.failed)} of ${String(result.applied + result.failed)} did not answer`;
}

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
  const [outcome, setOutcome] = useState<{ text: string; isProblem: boolean } | null>(null);

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
      setOutcome({ text: outcomeOf(result), isProblem: result.failed > 0 });
    },

    /**
     * Says why it could not be applied.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setOutcome({ text: toMessage(error), isProblem: true });
    },
  });

  // A timer is something outside React to synchronise with: the outcome fades after a while.
  useEffect(() => {
    if (outcome === null) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setOutcome(null);
    }, OUTCOME_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [outcome]);

  const title =
    card.title ?? scene?.name ?? t('dashboard.cards.sceneCard.sceneNotFound', 'Scene not found');
  const iconId = card.icon ?? scene?.icon ?? null;
  const disabled = scene === undefined || !data.canApplyScenes || apply.isPending;
  const note =
    outcome?.text ??
    (apply.isPending
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
          : t('dashboard.cards.sceneCard.youMayLookNot', 'You may look, not apply.'));

  return (
    <CardFrame label={title} tone={scene === undefined ? 'faint' : 'plain'} className="p-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOutcome(null);
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
          <span
            role={outcome === null ? undefined : 'status'}
            className={cn(
              'truncate text-caption',
              outcome?.isProblem === true ? 'text-danger' : 'text-foreground-subtle',
            )}
          >
            {note}
          </span>
        </span>
      </button>
    </CardFrame>
  );
}
