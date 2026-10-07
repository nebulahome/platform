/**
 * The ⋮ of an integration's page: updating its bundle to what the integrations index has,
 * reinstalling a rebuild from the local folder, and removing the integration - with everything
 * that came in through it, after the owner sees what that is.
 *
 * Only for a vendor the platform installed, and only for who may install: one built into this
 * NebulaHome - a bundle of the repository's - has nothing to update or take away here, and its
 * hero says "Built in" instead.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';

import type { IntegrationVendorView } from '@nebulahome/contracts';
import { Button, Modal, OverflowMenu, type MenuItem } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useIntegrationInstall, useIntegrationRemove } from '@/library/use-integration-install';

/** What the menu needs. */
export type VendorInstallMenuProps = {
  readonly vendor: IntegrationVendorView;

  /** How many devices were added under it: what removing it takes with it. */
  readonly deviceCount: number;
};

/**
 * Says how many of a thing there are, in words.
 *
 * @param count - How many.
 * @param one - The word for one.
 * @param many - The word for several.
 * @returns `1 device`, `3 devices`.
 */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * Renders the ⋮ and the confirmation removing opens.
 *
 * @param props - See {@link VendorInstallMenuProps}.
 * @returns The menu, or nothing for who may not install and for a vendor built in.
 */
export function VendorInstallMenu(props: VendorInstallMenuProps) {
  const { vendor, deviceCount } = props;
  const canInstall = useSession((state) => state.can('integration:install'));
  const navigate = useNavigate();
  const [isConfirming, setConfirming] = useState(false);
  const install = useIntegrationInstall(() => undefined);
  const remove = useIntegrationRemove(() => {
    setConfirming(false);
    void navigate('/integrations');
  });

  if (!canInstall || vendor.origin === 'development') {
    return null;
  }

  const update = vendor.update;
  const accounts = vendor.accounts.length;
  const items: MenuItem[] = [
    ...(update?.hasUpdate === true && update.latestVersion !== null
      ? [
          {
            label: `Update to ${update.latestVersion}`,
            icon: 'circle-arrow-up' as const,
            disabled: install.isPending,
            /** Installs the newer release. */
            onSelect: () => {
              install.mutate({ vendorId: vendor.id, version: update.latestVersion ?? undefined });
            },
          },
        ]
      : []),
    ...(update?.hasNewBuild === true
      ? [
          {
            label: 'Reinstall',
            description: 'The build in the local folder',
            icon: 'rotate-ccw' as const,
            disabled: install.isPending,
            /** Installs the rebuild of the same version. */
            onSelect: () => {
              install.mutate({ vendorId: vendor.id });
            },
          },
        ]
      : []),
    {
      label: 'Remove',
      icon: 'trash-2',
      tone: 'danger',
      /** Asks first: removing takes the devices with it. */
      onSelect: () => {
        remove.reset();
        setConfirming(true);
      },
    },
  ];

  return (
    <>
      <OverflowMenu items={items} />

      {install.error === null ? null : (
        <p role="alert" className="basis-full text-right text-ui-sm text-danger">
          {toMessage(install.error)}
        </p>
      )}

      <Modal
        isOpen={isConfirming}
        size="small"
        title={`Remove ${vendor.name}?`}
        description="Removing an integration takes everything that came in through it."
        onClose={() => {
          if (!remove.isPending) {
            setConfirming(false);
          }
        }}
        footer={
          <>
            <Button
              variant="bare"
              disabled={remove.isPending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isBusy={remove.isPending}
              onClick={() => {
                remove.mutate(vendor.id);
              }}
            >
              Remove {vendor.name}
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1.5 text-ui text-foreground-muted">
          <li>{counted(deviceCount, 'device', 'devices')}, and every entity they have</li>
          {accounts === 0 ? null : (
            <li>{counted(accounts, 'account', 'accounts')} signed in to, signed out</li>
          )}
          <li>Its settings, and its bundle</li>
        </ul>
        {remove.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(remove.error)}
          </p>
        )}
      </Modal>
    </>
  );
}
