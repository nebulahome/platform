/**
 * Installing a package: what it takes, then the one button.
 *
 * Before anything is downloaded the packet-manager is asked what installing would take - the
 * package and every package it needs that is not installed yet, in the order they go in - and
 * the dialog says so: "Also installs MQTT". A package that cannot be installed says why, naming
 * both parties ("Watcher needs a package that provides object-detection, and none does"), and
 * the button stays off. Nothing restarts: the package starts once it is in, and its page, its
 * cards and its devices appear as it does.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AvailablePackage, InstalledPackage } from '@nebulahome/contracts';
import { Button, Modal } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { installPackage, PACKAGE_QUERY_KEYS, planPackage } from '@/packages/api';

/** What the dialog needs. */
export type InstallPackageDialogProps = {
  /** What is being installed; null while the dialog is shut. */
  readonly target: AvailablePackage | null;

  readonly onClose: () => void;

  /** Called once it is in, with what went in: the one asked for last. */
  readonly onInstalled: (installed: readonly InstalledPackage[]) => void;
};

/**
 * Names in a sentence: "MQTT", "MQTT and Matter", "MQTT, Matter and NVR".
 *
 * @param names - The names.
 * @returns The sentence's words.
 */
function listed(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join('');
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link InstallPackageDialogProps}.
 * @returns The dialog.
 */
export function InstallPackageDialog(props: InstallPackageDialogProps) {
  const { target, onClose, onInstalled } = props;
  const queryClient = useQueryClient();
  const packageId = target?.id ?? '';

  const plan = useQuery({
    queryKey: ['packages', 'plan', packageId],
    enabled: target !== null,
    retry: false,
    gcTime: 0,

    /**
     * Asks what installing would take.
     *
     * @returns The plan.
     */
    queryFn: async () => planPackage(packageId),
  });

  const install = useMutation({
    /**
     * Installs it and what it needs.
     *
     * @returns What went in.
     */
    mutationFn: async () => installPackage(packageId),

    /**
     * Reads the packages again and hands what went in to the page.
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
  const canInstall = plan.data !== undefined && problems.length === 0 && !install.isPending;

  return (
    <Modal
      isOpen={target !== null}
      onClose={() => {
        if (!install.isPending) {
          onClose();
        }
      }}
      title={`Install ${target?.name ?? ''}`}
      description={target?.description}
      footer={
        <>
          <Button variant="ghost" disabled={install.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            isBusy={install.isPending}
            disabled={!canInstall}
            onClick={() => {
              install.mutate();
            }}
          >
            {others.length === 0 ? 'Install' : `Install ${String(others.length + 1)} packages`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-ui">
        {target?.latest === null || target === null ? null : (
          <p className="text-foreground-muted">
            Release{' '}
            <span className="font-medium text-foreground tabular">{target.latest.version}</span>,
            from <span className="font-mono">{target.repository}</span>.
          </p>
        )}

        {plan.isPending ? (
          <p role="status" className="text-foreground-subtle">
            Working out what it needs…
          </p>
        ) : null}

        {others.length === 0 ? null : (
          <p role="status" className="text-foreground">
            Also installs {listed(others.map((each) => each.name))}, which it needs.
          </p>
        )}

        {problems.length === 0 ? null : (
          <ul role="alert" className="flex flex-col gap-1 text-danger">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {plan.error === null ? null : (
          <p role="alert" className="text-danger">
            {toMessage(plan.error)}
          </p>
        )}

        {install.error === null ? null : (
          <p role="alert" className="text-danger">
            {toMessage(install.error)}
          </p>
        )}

        {install.isPending ? (
          <p role="status" className="text-foreground-muted">
            Downloading and starting it. Nothing else restarts.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
