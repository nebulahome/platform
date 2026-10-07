/**
 * Installing and removing an integration from the interface: the request, then the vendors and
 * the catalogue read again, since both just changed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { IntegrationInstallReply, IntegrationRemoved } from '@nebulahome/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  INTEGRATION_CATALOGUE_KEYS,
  installIntegration,
  removeIntegration,
} from '@/library/integration-catalogue-api';

/** What an install is asked with. */
export type IntegrationInstallRequest = {
  readonly vendorId: string;

  /** A release; the newest that fits when not said. */
  readonly version?: string | undefined;
};

/**
 * Installs, updates or reinstalls an integration.
 *
 * @param onInstalled - Called with what was done, once the hub runs the build.
 * @returns The mutation.
 */
export function useIntegrationInstall(onInstalled: (reply: IntegrationInstallReply) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * Installs the bundle.
     *
     * @param request - Which vendor, which release.
     * @returns What was done.
     */
    mutationFn: async (request: IntegrationInstallRequest) =>
      installIntegration(request.vendorId, request.version),

    /**
     * Reads the vendors and the catalogue again, and hands the reply on.
     *
     * @param reply - What was done.
     */
    onSuccess: (reply): void => {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
      void queryClient.invalidateQueries({ queryKey: INTEGRATION_CATALOGUE_KEYS.all });
      onInstalled(reply);
    },
  });
}

/**
 * Removes an integration, and everything that came in through it.
 *
 * @param onRemoved - Called with what went with it.
 * @returns The mutation.
 */
export function useIntegrationRemove(onRemoved: (removed: IntegrationRemoved) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * Removes it.
     *
     * @param vendorId - The vendor.
     * @returns What went with it.
     */
    mutationFn: async (vendorId: string) => removeIntegration(vendorId),

    /**
     * Reads what it took with it again, and hands the reply on.
     *
     * @param removed - What went with it.
     */
    onSuccess: (removed): void => {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
      void queryClient.invalidateQueries({ queryKey: INTEGRATION_CATALOGUE_KEYS.all });
      onRemoved(removed);
    },
  });
}
