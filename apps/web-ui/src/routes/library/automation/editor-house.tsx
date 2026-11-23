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
  CalendarView,
  CapabilityState,
  EntityView,
  GeoPosition,
  SceneView,
} from '@nebulahome/contracts';

import type { BlockNames } from '@/lib/block-summary';
import { signalled } from '@/lib/signalled';
import {
  fetchAutomationHouse,
  fetchAutomations,
  fetchScenes,
  LIBRARY_QUERY_KEYS,
} from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { fetchPackages, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { CALENDAR_QUERY_KEYS, fetchCalendars } from '@/routes/calendar/api';
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
  readonly calendars: readonly CalendarView[];

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
  calendars: [],
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
    queryFn: signalled(fetchScenes),
  });
  const automations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    queryFn: signalled(fetchAutomations),
  });
  const house = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automationHouse,
    queryFn: signalled(fetchAutomationHouse),
  });
  const packages = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.list,
    queryFn: signalled(fetchPackages),
  });
  const calendars = useQuery({
    queryKey: CALENDAR_QUERY_KEYS.calendars,
    queryFn: signalled(fetchCalendars),
  });

  const value = useMemo<EditorHouse>(() => {
    const byId = new Map(directory.entities.map((entity) => [String(entity.entityId), entity]));
    const sceneByKey = new Map((scenes.data ?? []).map((scene) => [scene.key, scene.name]));
    const automationByKey = new Map(
      (automations.data ?? []).map((automation) => [automation.key, automation.name]),
    );
    const calendarById = new Map((calendars.data ?? []).map((one) => [one.id, one.name]));
    const modelById = new Map(
      (calendars.data ?? []).flatMap((one) => one.models.map((model) => [model.id, model.name])),
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
        /**
         * A calendar's name.
         *
         * @param calendarId - Its id.
         * @returns Its name, or undefined.
         */
        calendar: (calendarId) => calendarById.get(calendarId),
        /**
         * A calendar model's name.
         *
         * @param modelId - Its id.
         * @returns Its name, or undefined.
         */
        model: (modelId) => modelById.get(modelId),
      },
      entities: directory.entities,
      areas: directory.areas,
      scenes: scenes.data ?? [],
      automations: automations.data ?? [],
      packages: packages.data ?? [],
      calendars: calendars.data ?? [],
      // Said only once the house has been read: a warning that flashes while it loads is noise.
      hasPosition: house.data?.position !== null,
      timeZone: house.data?.timeZone ?? 'UTC',
      position: house.data?.position ?? null,
      isPending: directory.isPending,
    };
  }, [
    automations.data,
    calendars.data,
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
