/**
 * Plain buttons with no readings: scenes, buttons and switches (`K-Overview`, Quick actions). Two
 * fit a 1×1, four a 2×1, six a 1×2. A scene is applied, a button pressed, a switch turned the
 * other way - and a switch stays lit while it is on. A scene or an entity that is gone is left
 * out; a card with nothing left waits with a dashed face.
 */
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type {
  DashboardActionsCard,
  EntityView,
  SceneApplyResult,
  SceneView,
} from '@nebulahome/contracts';
import { AppIcon, cn, UI_ICON_IDS, type UiIconId } from '@nebulahome/ui';

import { applyScene } from '@/library/api';
import { capabilityStateOf, hasCapability, powerCommand } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { toastSceneApplied, toastSceneFailed } from '@/library/scene-apply-toast';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { toneText, WaitingFace } from '@/routes/dashboard/cards/overview-parts';
import { useCardCommand } from '@/routes/dashboard/cards/use-card-command';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The interface's own icons, which a scene may be given by id. */
const UI_ICONS: ReadonlySet<string> = new Set(UI_ICON_IDS);

/** The face every button has, at rest and lit. */
const BUTTON =
  'press-scale flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-tile border px-1.5 text-caption font-medium whitespace-nowrap text-foreground transition-colors duration-200 disabled:opacity-40';

/** A button at rest. */
const AT_REST = 'border-border-strong bg-surface-raised hover:enabled:bg-surface-high';

/** A switch that is on. */
const LIT = 'border-primary/60 bg-primary/12';

/** What an actions card needs. */
export type ActionsCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardActionsCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/**
 * Renders an actions card.
 *
 * @param props - See {@link ActionsCardProps}.
 * @returns The card.
 */
export function ActionsCard(props: ActionsCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const title = card.title ?? t('dashboard.cards.actionsCard.quickActions', 'Quick actions');
  const room = card.h === 2 ? 6 : card.w === 2 ? 4 : 2;
  const items = card.items
    .flatMap(
      (item): ({ key: string; scene: SceneView } | { key: string; entity: EntityView })[] => {
        if (item.kind === 'scene') {
          const scene = data.sceneById.get(item.sceneId);

          return scene === undefined ? [] : [{ key: item.sceneId, scene }];
        }

        const entity = data.entityById.get(item.entityId);

        return entity === undefined ? [] : [{ key: item.entityId, entity }];
      },
    )
    .slice(0, room);

  if (items.length === 0) {
    return (
      <WaitingFace
        label={title}
        icon="mouse-pointer-click"
        title={t('dashboard.cards.actionsCard.noButtonsYet', 'No buttons yet')}
        note={t('dashboard.cards.actionsCard.addThem', 'Add scenes, buttons or switches')}
      />
    );
  }

  return (
    <CardFrame label={title} className="p-2.5">
      <div className={cn('h-full gap-2', card.h === 2 ? 'grid grid-cols-2 grid-rows-3' : 'flex')}>
        {items.map((item) =>
          'scene' in item ? (
            <SceneButton key={item.key} scene={item.scene} data={data} />
          ) : (
            <EntityButton key={item.key} entity={item.entity} data={data} />
          ),
        )}
      </div>
    </CardFrame>
  );
}

/**
 * Renders a scene's button: one press applies it, and a toast says how it went.
 *
 * @param props - The scene.
 * @param props.scene - The scene.
 * @param props.data - What the page read: whether this person may apply scenes.
 * @returns The button.
 */
function SceneButton(props: { readonly scene: SceneView; readonly data: DashboardData }) {
  const { scene, data } = props;
  const apply = useMutation({
    /**
     * Applies the scene.
     *
     * @returns What the server reported.
     */
    mutationFn: async (): Promise<SceneApplyResult> => applyScene(scene.id),

    /**
     * Says how it went.
     *
     * @param result - What came back.
     */
    onSuccess: (result) => {
      toastSceneApplied(result, scene.name);
    },

    /**
     * Says why it could not be applied.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      toastSceneFailed(error, scene.name);
    },
  });
  const icon: UiIconId =
    scene.icon !== null && UI_ICONS.has(scene.icon) ? (scene.icon as UiIconId) : 'sparkles';

  return (
    <button
      type="button"
      disabled={!data.canApplyScenes || scene.unresolvedMembers.length > 0 || apply.isPending}
      className={cn(BUTTON, AT_REST)}
      onClick={() => {
        apply.mutate();
      }}
    >
      <ButtonGlyph icon={icon} colour="text-violet" isBusy={apply.isPending} />
      <span className="max-w-full truncate">{scene.name}</span>
    </button>
  );
}

/**
 * Renders a button or a switch's button: a button is pressed, a switch turned the other way and
 * lit while it is on.
 *
 * @param props - The entity.
 * @param props.entity - The entity.
 * @param props.data - What the page read.
 * @returns The button.
 */
function EntityButton(props: { readonly entity: EntityView; readonly data: DashboardData }) {
  const { t } = useTranslation();

  const { entity, data } = props;
  const live = data.readings[entity.entityId];
  const reportedAt = live?.receivedAt ?? entity.lastUpdated?.getTime() ?? null;
  const command = useCardCommand(entity.entityId, reportedAt);
  const isSwitch = hasCapability(entity, 'on_off');
  const isOn = capabilityStateOf(entity, live).on_off?.isOn ?? false;
  const power = usePendingValue(isOn, reportedAt, command.sending === 'on_off');
  const shown = command.hasFailed ? isOn : power.shown;
  const isLit = isSwitch && shown;
  const kind = entityKindOf(entity);
  const isAvailable = readingOf(entity, live).isAvailable;

  return (
    <button
      type="button"
      aria-pressed={isSwitch ? shown : undefined}
      title={
        command.hasFailed ? t('dashboard.cards.kit.didNotAnswer', 'Did not answer') : undefined
      }
      disabled={!data.canControl(entity) || !isAvailable || command.sending !== null}
      className={cn(BUTTON, isLit ? LIT : AT_REST)}
      onClick={() => {
        if (command.hasFailed) {
          command.retry();
        } else if (isSwitch) {
          power.sent(!shown);
          command.send('on_off', powerCommand(!shown));
        } else {
          command.send('button', { command: 'press' });
        }
      }}
    >
      {command.hasFailed ? (
        <span className="inline-flex text-danger">
          <AppIcon id="triangle-alert" size={18} />
        </span>
      ) : (
        <ButtonGlyph
          icon={kind.icon}
          colour={isSwitch && !shown ? 'text-foreground-muted' : toneText(kind)}
          isBusy={command.sending !== null}
        />
      )}
      <span className="max-w-full truncate">{entity.name}</span>
    </button>
  );
}

/**
 * Renders a button's glyph, or a spinner while what it sent is out.
 *
 * @param props - The glyph.
 * @param props.icon - Its icon.
 * @param props.colour - Its colour class.
 * @param props.isBusy - Whether what it sent is out.
 * @returns The glyph.
 */
function ButtonGlyph(props: {
  readonly icon: UiIconId;
  readonly colour: string;
  readonly isBusy: boolean;
}) {
  const { icon, colour, isBusy } = props;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex transition-colors duration-200',
        isBusy ? 'animate-spin text-cyan' : colour,
      )}
    >
      <AppIcon id={isBusy ? 'loader-circle' : icon} size={18} />
    </span>
  );
}
