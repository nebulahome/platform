/**
 * The installed packages, for whatever draws something of theirs: a dashboard card, an entity's
 * view, the dashboard editor's list of cards.
 *
 * One query, the one the Packages page reads, so a package event that reads it again updates all
 * of them at once. Somebody whose role does not show packages reads none, and what would have been
 * drawn by one says so.
 */
import { useQuery } from '@tanstack/react-query';

import type { ApiPackage } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchPackages, PACKAGE_QUERY_KEYS } from '@/packages/api';

/** The installed packages, as a component reads them. */
export type InstalledPackages = {
  /** The packages; none while they are being read, or for somebody who may not see them. */
  readonly packages: readonly ApiPackage[];

  /** Whether this person may see packages at all. */
  readonly canRead: boolean;

  readonly isPending: boolean;
  readonly error: unknown;
};

/**
 * Reads the installed packages.
 *
 * @returns Them, and whether they could be read.
 */
export function useInstalledPackages(): InstalledPackages {
  const canRead = useSession((state) => state.can('package:read'));
  const query = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.list,
    enabled: canRead,

    /**
     * Reads the installed packages.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The packages.
     */
    queryFn: async ({ signal }) => fetchPackages(signal),
  });

  return {
    packages: query.data ?? [],
    canRead,
    isPending: canRead && query.isPending,
    error: query.error,
  };
}
