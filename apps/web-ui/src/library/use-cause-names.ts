/**
 * The names of what changed an entity: "Evening lights", "anna", "Leaving home".
 *
 * Every recorded change carries its cause as a kind and an id. The kind is said in words by
 * itself; the id is named from the lists the house already serves - the automations, the scenes,
 * and the people for whoever may read them. A cause whose id cannot be named - a person to someone
 * who may not see the people, a scene since deleted - is said by its kind alone.
 */
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/auth/session-store';
import { fetchAutomations, fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { fetchUsers, SETTINGS_QUERY_KEYS } from '@/settings/api';

/** A change's cause, as the history records it. */
export type Cause = { readonly type: string; readonly id?: string | null | undefined };

/** A cause in words, and the glyph it is drawn with. */
export type CauseName = {
  readonly label: string;
  readonly icon: 'zap' | 'layers' | 'users' | 'cpu' | 'sigma' | 'power';
};

/** A change the device made of itself: what a cause with no kind is taken for. */
const ON_THE_DEVICE: CauseName = { label: 'On the device', icon: 'cpu' };

/** The words for each kind of cause, when its id cannot be named. */
const KINDS: Readonly<Record<string, CauseName>> = {
  user: { label: 'From the interface', icon: 'users' },
  automation: { label: 'By an automation', icon: 'zap' },
  scene: { label: 'By a scene', icon: 'layers' },
  device: { label: 'On the device', icon: 'cpu' },
  alias: { label: 'Worked out', icon: 'sigma' },
  startup: { label: 'At start-up', icon: 'power' },
};

/**
 * Reads what is needed to name causes, and returns the namer.
 *
 * @returns The namer: a cause in, its words out.
 */
export function useCauseNames(): (cause: Cause | null | undefined) => CauseName {
  const can = useSession((state) => state.can);
  const automations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    enabled: can('automation:read'),
    staleTime: 60_000,

    /**
     * Reads the automations, for their names.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The automations.
     */
    queryFn: async ({ signal }) => fetchAutomations(signal),
  });
  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    enabled: can('scene:read'),
    staleTime: 60_000,

    /**
     * Reads the scenes, for their names.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The scenes.
     */
    queryFn: async ({ signal }) => fetchScenes(signal),
  });
  const users = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.users,
    enabled: can('user:read'),
    staleTime: 60_000,

    /**
     * Reads the people, for their names.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The people.
     */
    queryFn: async ({ signal }) => fetchUsers(signal),
  });

  return (cause) => {
    const kind = KINDS[cause?.type ?? 'device'] ?? ON_THE_DEVICE;
    const id = cause?.id ?? null;

    if (id === null) {
      return kind;
    }

    const name =
      cause?.type === 'automation'
        ? automations.data?.find((each) => each.id === id || each.key === id)?.name
        : cause?.type === 'scene'
          ? scenes.data?.find((each) => each.id === id || each.key === id)?.name
          : cause?.type === 'user'
            ? users.data?.find((each) => each.id === id)?.displayName
            : undefined;

    return name === undefined ? kind : { label: name, icon: kind.icon };
  };
}
