/**
 * What the automation editor knows of the house, read once for every block in it.
 *
 * A block's summary names the entity, the room, the scene; its fields offer the entity's own
 * states and commands, the scenes and automations there are, the packages installed. Read here
 * rather than by each block, so forty blocks are forty readers of one answer.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type {
  ApiPackage,
  AreaView,
  AutomationView,
  CapabilityState,
  EntityView,
  GeoPosition,
  SceneView,
} from '@nebulahome/contracts';

import type { BlockNames } from '@/lib/block-summary';
import {
  fetchAutomationHouse,
  fetchAutomations,
  fetchScenes,
  LIBRARY_QUERY_KEYS,
} from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { fetchPackages, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { stateLabel } from '@/routes/library/automation/state-choices';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** What the editor knows of the house. */
export type EditorHouse = {
  /** An entity, by its address. */
  readonly entityOf: (entityId: string) => EntityView | undefined;

  /** What an entity reads now, live when the channel has said, as it was read otherwise. */
  readonly stateOf: (entityId: string) => CapabilityState | undefined;

  /** Names for summaries. */
  readonly names: BlockNames;

  readonly entities: readonly EntityView[];
  readonly areas: readonly AreaView[];
  readonly scenes: readonly SceneView[];
  readonly automations: readonly AutomationView[];
  readonly packages: readonly ApiPackage[];

  /** Whether the house has a position, without which the sun has no time. */
  readonly hasPosition: boolean;

  /** The zone the house's clock keeps, for the next runs of a schedule. */
  readonly timeZone: string;

  /** Where the house stands, for the times of the sun; null when nobody has said. */
  readonly position: GeoPosition | null;

  /** Whether the entities are still being read. */
  readonly isPending: boolean;
};

/**
 * Knows nothing of what it is asked.
 *
 * @returns Nothing.
 */
function nothing(): undefined {
  return undefined;
}

/** A house that knows nothing: outside the editor, and in tests that do not provide one. */
const EMPTY: EditorHouse = {
  entityOf: nothing,
  stateOf: nothing,
  names: { entity: nothing },
  entities: [],
  areas: [],
  scenes: [],
  automations: [],
  packages: [],
  hasPosition: true,
  timeZone: 'UTC',
  position: null,
  isPending: false,
};

const HouseContext = createContext<EditorHouse>(EMPTY);

/**
 * Reads the house for the editor inside it.
 *
 * @param props - What it wraps.
 * @param props.children - The editor.
 * @returns The provider.
 */
export function EditorHouseProvider(props: { readonly children: ReactNode }) {
  const { children } = props;
  const directory = useEntityDirectory(false);
  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    /**
     * Reads every scene, for the Apply a scene block.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The scenes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchScenes(signal),
  });
  const automations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    /**
     * Reads every automation, for the Run automation block.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The automations.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAutomations(signal),
  });
  const house = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automationHouse,
    /**
     * Reads the house's zone and position, for the time and sun blocks.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The zone and the position.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAutomationHouse(signal),
  });
  const packages = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.list,
    /**
     * Reads the installed packages, for the Package service block.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The packages.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchPackages(signal),
  });

  const value = useMemo<EditorHouse>(() => {
    const byId = new Map(directory.entities.map((entity) => [String(entity.entityId), entity]));
    const sceneByKey = new Map((scenes.data ?? []).map((scene) => [scene.key, scene.name]));
    const automationByKey = new Map(
      (automations.data ?? []).map((automation) => [automation.key, automation.name]),
    );

    return {
      /**
       * An entity, by its address.
       *
       * @param entityId - The address.
       * @returns The entity, or undefined.
       */
      entityOf: (entityId) => byId.get(entityId),
      /**
       * What an entity reads now.
       *
       * @param entityId - The address.
       * @returns Its state, or undefined.
       */
      stateOf: (entityId) => {
        const entity = byId.get(entityId);

        return entity === undefined
          ? undefined
          : capabilityStateOf(entity, directory.readings[entityId]);
      },
      names: {
        /**
         * An entity's name.
         *
         * @param entityId - The address.
         * @returns Its name, or undefined.
         */
        entity: (entityId) => byId.get(entityId)?.name,
        /**
         * A scene's name.
         *
         * @param sceneKey - The key.
         * @returns Its name, or undefined.
         */
        scene: (sceneKey) => sceneByKey.get(sceneKey),
        /**
         * An automation's name.
         *
         * @param automationKey - The key.
         * @returns Its name, or undefined.
         */
        automation: (automationKey) => automationByKey.get(automationKey),
        /**
         * A state of an entity in the entity's own words.
         *
         * @param entityId - The address.
         * @param token - The state.
         * @returns The words, or undefined.
         */
        stateWord: (entityId, token) => {
          const entity = byId.get(entityId);

          return entity === undefined ? undefined : stateLabel(token, entity);
        },
      },
      entities: directory.entities,
      areas: directory.areas,
      scenes: scenes.data ?? [],
      automations: automations.data ?? [],
      packages: packages.data ?? [],
      // Said only once the house has been read: a warning that flashes while it loads is noise.
      hasPosition: house.data?.position !== null,
      timeZone: house.data?.timeZone ?? 'UTC',
      position: house.data?.position ?? null,
      isPending: directory.isPending,
    };
  }, [
    automations.data,
    directory.areas,
    directory.entities,
    directory.isPending,
    directory.readings,
    house.data,
    packages.data,
    scenes.data,
  ]);

  return <HouseContext value={value}>{children}</HouseContext>;
}

/**
 * What the editor knows of the house.
 *
 * @returns See {@link EditorHouse}.
 */
export function useEditorHouse(): EditorHouse {
  return useContext(HouseContext);
}
