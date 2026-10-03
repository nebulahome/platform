/**
 * Installing a package: what it would take, asked before anything is downloaded, and the install
 * itself.
 *
 * The packet-manager answers the plan - the package and every package it needs that is not
 * installed yet, in the order they go in - or why it cannot be done, naming both parties. The
 * install reads the packages again once it is in: nothing restarts, and the package's page, its
 * cards and its devices appear as it starts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { InstalledPackage } from '@nebulahome/contracts';

import { installPackage, PACKAGE_QUERY_KEYS, planPackage } from '@/packages/api';

/**
 * Plans and installs one package.
 *
 * @param packageId - The package; null while none can be installed, which asks nothing.
 * @param onInstalled - Called once it is in, with what went in: the one asked for last.
 * @returns The plan, the install, the other packages that go in with it, what stands in the way,
 *   and whether the button may be pressed.
 */
export function usePackageInstall(
  packageId: string | null,
  onInstalled: (installed: readonly InstalledPackage[]) => void,
) {
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.plan(packageId ?? ''),
    enabled: packageId !== null,
    retry: false,
    gcTime: 0,

    /**
     * Asks what installing would take.
     *
     * @returns The plan.
     */
    queryFn: async () => planPackage(packageId ?? ''),
  });

  const install = useMutation({
    /**
     * Installs it and what it needs.
     *
     * @returns What went in.
     */
    mutationFn: async () => installPackage(packageId ?? ''),

    /**
     * Reads the packages again and hands what went in on.
     *
     * @param installed - What went in.
     */
    onSuccess: (installed): void => {
      void queryClient.invalidateQueries({ queryKey: PACKAGE_QUERY_KEYS.all });
      onInstalled(installed);
    },
  });

  const others = (plan.data?.install ?? []).filter((each) => each.id !== packageId);
  const problems = plan.data?.problems ?? [];

  return {
    plan,
    install,
    others,
    problems,
    canInstall:
      packageId !== null && plan.data !== undefined && problems.length === 0 && !install.isPending,
  };
}
