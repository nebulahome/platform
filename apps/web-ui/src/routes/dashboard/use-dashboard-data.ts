/**
 * Everything the cards on a dashboard read, gathered once for the whole page.
 *
 * The entities, their devices and the live readings are the reads the entity picker makes, under
 * the same keys; the scenes are the scenes page's. So a dashboard opened after the devices page
 * draws at once, and one opened first fills the cache for the pages after it.
 *
 * Whether this person may command an entity is worked out the way the server works it out - the
 * entity, its area, its tags and its device's - so a card shows a switch that works or says why
 * it cannot, rather than a switch that is refused when pressed.
 */
import { useQuery } from '@tanstack/react-query';

import type {
  ApiPackage,
  DashboardLayout,
  EntityView,
  IconView,
  SceneView,
} from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { CARD_SIZES, cardKindOf, packageCardSizes } from '@/dashboard/card-sizes';
import { allCards, type SizesOf } from '@/dashboard/dashboard-layout';
import { fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { entityScopesOf, isCommandable } from '@/library/entity-control';
import type { LiveReading } from '@/live/live-store';
import { useInstalledPackages } from '@/packages/use-packages';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';
import { useTags } from '@/routes/library/use-tags';

/** What the cards read. */
export type DashboardData = {
  /** Every entity this person may see, by address. */
  readonly entityById: ReadonlyMap<string, EntityView>;

  /** Every scene this person may see, by id. */
  readonly sceneById: ReadonlyMap<string, SceneView>;

  /** Every installed package, by id: whose cards the page draws. None for a role without them. */
  readonly packageById: ReadonlyMap<string, ApiPackage>;

  /** The catalogue's drawings for every icon on the page, by id. */
  readonly icons: ReadonlyMap<string, IconView>;

  /** What the live channel has said since the page was read, by entity. */
  readonly readings: Readonly<Record<string, LiveReading>>;

  /** Whether this person may command an entity, and whether it takes commands at all. */
  readonly canControl: (entity: EntityView) => boolean;

  /** Whether this person may read an entity's history, for a card that draws it. */
  readonly canReadHistory: (entity: EntityView) => boolean;

  /** Whether this person may apply scenes. */
  readonly canApplyScenes: boolean;

  /** The sizes each card may take. */
  readonly sizesOf: SizesOf;

  /** Whether the entities are still being read, so no card can yet say what it is. */
  readonly isPending: boolean;
};

/**
 * Reads what a dashboard's cards need.
 *
 * @param layout - The layout on screen, for the icons its cards were given.
 * @returns See {@link DashboardData}.
 */
export function useDashboardData(layout: DashboardLayout | undefined): DashboardData {
  const directory = useEntityDirectory();
  const { tags } = useTags();
  const can = useSession((state) => state.can);
  const canReadScenes = can('scene:read');

  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    /**
     * Reads every scene, for the scene cards.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every scene.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchScenes(signal),
    enabled: canReadScenes,
  });

  const entityById = new Map(directory.entities.map((entity) => [entity.entityId, entity]));
  const deviceById = new Map(directory.devices.map((device) => [device.id, device]));
  const sceneById = new Map((scenes.data ?? []).map((scene) => [scene.id, scene]));
  const { packages } = useInstalledPackages();
  const packageById = new Map(packages.map((found) => [found.id, found]));
  const cards = layout === undefined ? [] : allCards(layout);

  const chosen = useCatalogueIcons([
    ...cards.map((card) => ('icon' in card ? card.icon : null)),
    ...(scenes.data ?? []).map((scene) => scene.icon),
  ]);

  /**
   * The scopes an entity falls under, the way the server works them out.
   *
   * @param entity - The entity.
   * @returns Its scopes.
   */
  const scopesOf = (entity: EntityView): string[] =>
    entityScopesOf(
      entity,
      tags,
      entity.deviceId === null ? [] : (deviceById.get(entity.deviceId)?.tagIds ?? []),
    );

  return {
    entityById,
    sceneById,
    packageById,
    icons: new Map([...directory.icons, ...chosen]),
    readings: directory.readings,
    /**
     * Whether this person may command an entity, and it takes commands at all.
     *
     * @param entity - The entity.
     * @returns True when a command would be accepted.
     */
    canControl: (entity) => isCommandable(entity) && can('entity:control', scopesOf(entity)),

    /**
     * Whether this person may read an entity's history.
     *
     * @param entity - The entity.
     * @returns True when they may.
     */
    canReadHistory: (entity) => can('history:read', scopesOf(entity)),
    canApplyScenes: can('scene:apply'),

    /**
     * The sizes a card may take: those of the kind of card its entity is drawn as, or those its
     * package's manifest names.
     *
     * @param card - The card.
     * @returns Its sizes.
     */
    sizesOf: (card) => {
      if (card.type === 'package') {
        const declared = packageById
          .get(card.packageId)
          ?.ui?.cards.find((each) => each.id === card.cardId);

        return declared === undefined ? CARD_SIZES.package.sizes : packageCardSizes(declared.sizes);
      }

      if (card.type !== 'entity') {
        return CARD_SIZES[card.type].sizes;
      }

      const entity = entityById.get(card.entityId);

      return CARD_SIZES[entity === undefined ? 'missing' : cardKindOf(entity)].sizes;
    },
    isPending: directory.isPending,
  };
}
