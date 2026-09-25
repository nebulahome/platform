/**
 * Reads what names an entity, from the lists the library already keeps.
 *
 * Each list is read only for somebody who may see it: a guest who may not read automations is not
 * sent them to be filtered here, and the panel says nothing about what they cannot see.
 */
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/auth/session-store';
import { fetchAliases, fetchAutomations, fetchScenes, LIBRARY_QUERY_KEYS } from '@/library/api';
import { correlationsOf, type EntityCorrelations } from '@/library/entity-correlations';

/** What the panel gets. */
export type EntityCorrelationsData = {
  /** What names the entity, once every list the person may read has been read. */
  readonly correlations: EntityCorrelations | undefined;

  /** Which lists the person may read, so the panel does not claim what it did not look for. */
  readonly canRead: {
    readonly automations: boolean;
    readonly scenes: boolean;
    readonly aliases: boolean;
  };
};

/**
 * Reads what names one entity.
 *
 * @param entityId - The entity, by its address.
 * @returns See {@link EntityCorrelationsData}.
 */
export function useEntityCorrelations(entityId: string): EntityCorrelationsData {
  const can = useSession((state) => state.can);
  const canRead = {
    automations: can('automation:read'),
    scenes: can('scene:read'),
    aliases: can('alias:read'),
  };

  const automations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    enabled: canRead.automations,

    /**
     * Reads every automation.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The automations.
     */
    queryFn: async ({ signal }) => fetchAutomations(signal),
  });

  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    enabled: canRead.scenes,

    /**
     * Reads every scene.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The scenes.
     */
    queryFn: async ({ signal }) => fetchScenes(signal),
  });

  const aliases = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.aliases,
    enabled: canRead.aliases,

    /**
     * Reads every alias.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The aliases.
     */
    queryFn: async ({ signal }) => fetchAliases(signal),
  });

  const isReading =
    (canRead.automations && automations.isPending) ||
    (canRead.scenes && scenes.isPending) ||
    (canRead.aliases && aliases.isPending);

  return {
    correlations: isReading
      ? undefined
      : correlationsOf(entityId, {
          automations: automations.data ?? [],
          scenes: scenes.data ?? [],
          aliases: aliases.data ?? [],
        }),
    canRead,
  };
}
