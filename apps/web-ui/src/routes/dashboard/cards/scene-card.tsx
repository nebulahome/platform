/**
 * A scene, as the button it is.
 *
 * One press applies it: every member is sent to what the scene stores, as ordinary commands. The
 * tile is its name, what it sets ("6 lights · 2 blinds") and the round play button, with a mark
 * for each of its first members; the strip puts the marks and Apply at the right. The card says it
 * is applying while it waits, and a toast says how it went - every member, or how many did not
 * answer. A scene that is gone gets a card that says so; a person who may not apply scenes, or a
 * scene still waiting for an entity, gets no button that would only be refused.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardSceneCard, SceneApplyResult, SceneView } from '@nebulahome/contracts';
import { AppIcon, cn, UI_ICON_IDS, type UiIconId } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { applyScene } from '@/library/api';
import { entityKindOf } from '@/library/entity-kind';
import { toastSceneApplied, toastSceneFailed } from '@/library/scene-apply-toast';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { cardTime } from '@/routes/dashboard/cards/entity-model';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { DeviceIcon } from '@/routes/library/device-icon';
import { TONE_CLASSES } from '@/routes/library/entity-tile';

/** The interface's own icons, which a scene may be given by id. */
const UI_ICONS: ReadonlySet<string> = new Set(UI_ICON_IDS);

/**
 * Whether an icon id is one of the interface's own, drawn without the catalogue.
 *
 * @param id - The id.
 * @returns True for one of `UI_ICON_IDS`.
 */
function isUiIcon(id: string | null): id is UiIconId {
  return id !== null && UI_ICONS.has(id);
}

/** What a scene card needs. */
export type SceneCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardSceneCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * What a scene sets, in a few words: "6 lights · 2 blinds" when it is lights, blinds and switches
 * of no more than two kinds, "12 entities" otherwise.
 *
 * @param scene - The scene.
 * @returns The words.
 */
function membersText(scene: SceneView): string {
  const counts = new Map<string, number>();

  scene.members.forEach((member) => {
    const domain = member.entityId.split('.')[0] ?? '';

    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  });

  /**
   * A count of one kind, in words.
   *
   * @param domain - The kind.
   * @param count - How many.
   * @returns The words, or null for a kind without its own word.
   */
  const words = (domain: string, count: number): string | null => {
    switch (domain) {
      case 'light':
        return translate('dashboard.cards.sceneCard.lights', {
          count,
          defaultValue_one: '{{count}} light',
          defaultValue_other: '{{count}} lights',
        });
      case 'cover':
        return translate('dashboard.cards.sceneCard.blinds', {
          count,
          defaultValue_one: '{{count}} blind',
          defaultValue_other: '{{count}} blinds',
        });
      case 'switch':
        return translate('dashboard.cards.sceneCard.switches', {
          count,
          defaultValue_one: '{{count}} switch',
          defaultValue_other: '{{count}} switches',
        });
      default:
        return null;
    }
  };
  const parts = [...counts].map(([domain, count]) => words(domain, count));

  return parts.length > 0 && parts.length <= 2 && parts.every((part) => part !== null)
    ? parts.join(' · ')
    : translate('dashboard.cards.sceneCard.entities', {
        count: scene.members.length,
        defaultValue_one: '{{count}} entity',
        defaultValue_other: '{{count}} entities',
      });
}

/**
 * Renders the marks of a scene's first members: each a round chip with its kind's glyph in its
 * kind's colour, overlapping the one before; "+3" for the rest.
 *
 * @param props - The scene and how many to draw.
 * @param props.scene - The scene.
 * @param props.data - What the page read, for the members' kinds.
 * @param props.shown - How many marks there is room for.
 * @param props.isLarge - 28 px marks on a strip, 24 px on a tile.
 * @returns The marks.
 */
function MemberMarks(props: {
  readonly scene: SceneView;
  readonly data: DashboardData;
  readonly shown: number;
  readonly isLarge: boolean;
}) {
  const { scene, data, shown, isLarge } = props;
  const rest = scene.members.length - shown;

  return (
    <div aria-hidden="true" className="flex shrink-0 items-center">
      {scene.members.slice(0, shown).map((member, index) => {
        const entity = data.entityById.get(member.entityId);
        const kind = entity === undefined ? undefined : entityKindOf(entity);
        const color =
          kind === undefined
            ? 'text-foreground-subtle'
            : TONE_CLASSES[kind.tone].split(' ').find((name) => name.startsWith('text-'));

        return (
          <span
            key={member.entityId}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-raised',
              isLarge ? 'size-7' : 'size-6',
              index > 0 && '-ml-1.5',
              color,
            )}
          >
            <AppIcon id={kind?.icon ?? 'circle-dot'} size={isLarge ? 13 : 11} />
          </span>
        );
      })}
      {rest > 0 && isLarge ? (
        <span className="ml-2 text-caption text-foreground-subtle">{`+${String(rest)}`}</span>
      ) : null}
    </div>
  );
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
  const title =
    card.title ?? scene?.name ?? t('dashboard.cards.sceneCard.sceneNotFound', 'Scene not found');
  // When it was applied from this card: the scene itself does not say when it last was.
  const [appliedAt, setAppliedAt] = useState<Date | null>(null);
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
      setAppliedAt(new Date());
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
  const icon = iconId === null ? undefined : data.icons.get(iconId);
  const glyph: UiIconId = isUiIcon(iconId) ? iconId : 'sparkles';
  const isWaiting = scene !== undefined && scene.unresolvedMembers.length > 0;
  const canApply = scene !== undefined && data.canApplyScenes && !isWaiting;
  const applied =
    appliedAt === null
      ? null
      : t('dashboard.cards.sceneCard.appliedAt', 'Applied today at {{time}}', {
          time: cardTime(appliedAt),
        });
  const note = apply.isPending ? (
    <span className="inline-flex min-w-0 animate-fade-in items-center gap-1.5 text-caption text-cyan">
      <span className="inline-flex shrink-0 animate-spin">
        <AppIcon id="loader-circle" size={13} />
      </span>
      <span className="truncate">{t('dashboard.cards.sceneCard.applying', 'Applying…')}</span>
    </span>
  ) : (
    <Caption>
      {scene === undefined
        ? t(
            'dashboard.cards.sceneCard.itWasRemovedOr',
            'It was removed, or it is not one you may see.',
          )
        : isWaiting
          ? t('dashboard.cards.sceneCard.waitingForEntities', 'Waiting for an entity to be picked')
          : (applied ?? '')}
    </Caption>
  );
  const isStrip = card.w > 1;
  const chip = (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-field',
        isStrip ? 'size-11' : 'size-8',
        scene === undefined
          ? 'bg-surface-raised text-foreground-subtle'
          : 'bg-violet/14 text-violet',
      )}
    >
      {icon === undefined ? (
        <AppIcon id={glyph} size={isStrip ? 20 : 16} />
      ) : (
        <DeviceIcon icon={icon} size={isStrip ? 20 : 16} />
      )}
    </span>
  );
  const tone = scene === undefined ? 'faint' : 'plain';
  const lookOnly =
    scene !== undefined && !data.canApplyScenes ? (
      <span
        className="inline-flex shrink-0 text-foreground-subtle"
        title={t('dashboard.cards.kit.viewOnly', 'View only')}
      >
        <AppIcon id="eye" size={14} />
      </span>
    ) : null;

  /** Applies the scene. */
  const onApply = (): void => {
    apply.mutate();
  };

  if (isStrip) {
    return (
      <CardFrame label={title} tone={tone}>
        <div className="flex h-full min-w-0 items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {chip}
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-title font-medium">{title}</span>
              {scene === undefined || isWaiting || apply.isPending || applied !== null ? (
                note
              ) : (
                <Caption>{membersText(scene)}</Caption>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {scene === undefined ? null : (
              <MemberMarks scene={scene} data={data} shown={5} isLarge />
            )}
            {canApply ? (
              <button
                type="button"
                disabled={apply.isPending}
                className="press-scale inline-flex h-9 shrink-0 items-center gap-2 rounded-pill bg-primary px-3.5 text-ui-sm font-medium whitespace-nowrap text-primary-foreground transition-colors duration-200 hover:enabled:bg-primary/90 disabled:opacity-60"
                onClick={onApply}
              >
                <AppIcon id="play" size={15} />
                {t('dashboard.cards.sceneCard.apply', 'Apply')}
              </button>
            ) : (
              lookOnly
            )}
          </div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} tone={tone}>
      <div className="flex h-8 min-w-0 shrink-0 items-center gap-2.5">
        {chip}
        <div className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
          {scene === undefined ? null : (
            <span className="truncate text-caption leading-4 text-foreground-subtle">
              {membersText(scene)}
            </span>
          )}
        </div>
        {canApply ? (
          <button
            type="button"
            aria-label={t('dashboard.cards.sceneCard.applyName', 'Apply {{name}}', { name: title })}
            title={t('dashboard.cards.sceneCard.applyName', 'Apply {{name}}', { name: title })}
            disabled={apply.isPending}
            className="press-scale inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-primary text-primary-foreground transition-colors duration-200 hover:enabled:bg-primary/90 disabled:opacity-60"
            onClick={onApply}
          >
            <AppIcon id="play" size={15} />
          </button>
        ) : (
          lookOnly
        )}
      </div>
      <div className="grow" />
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        {note}
        {scene === undefined ? null : (
          <MemberMarks scene={scene} data={data} shown={3} isLarge={false} />
        )}
      </div>
    </CardFrame>
  );
}
