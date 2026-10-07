/**
 * What a vendor's page offers about the vendor's bundle itself: an update the integrations index
 * has, a rebuild in the local folder to reinstall, and removing the integration - with everything
 * that came in through it, after the owner sees what that is.
 *
 * Only for a vendor the platform installed. One built into this NebulaHome - a bundle of the
 * repository's - says so and offers nothing: there is nothing of it to update or take away here.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';

import type { IntegrationVendorView } from '@nebulahome/contracts';
import { Badge, Button, Modal } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useIntegrationInstall, useIntegrationRemove } from '@/library/use-integration-install';

/** What the actions need. */
export type VendorInstallActionsProps = {
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
 * Renders the vendor's install actions.
 *
 * @param props - See {@link VendorInstallActionsProps}.
 * @returns The buttons, and the confirmation removing opens; nothing for who may not install.
 */
export function VendorInstallActions(props: VendorInstallActionsProps) {
  const { vendor, deviceCount } = props;
  const canInstall = useSession((state) => state.can('integration:install'));
  const navigate = useNavigate();
  const [isConfirming, setConfirming] = useState(false);
  const install = useIntegrationInstall(() => undefined);
  const remove = useIntegrationRemove(() => {
    setConfirming(false);
    void navigate('/integrations');
  });

  if (!canInstall) {
    return null;
  }

  if (vendor.origin === 'development') {
    return (
      <Badge tone="neutral" size="small">
        Built in
      </Badge>
    );
  }

  const update = vendor.update;
  const accounts = vendor.accounts.length;

  return (
    <>
      {update?.hasUpdate === true && update.latestVersion !== null ? (
        <Button
          variant="ghost"
          size="compact"
          isBusy={install.isPending}
          title={install.error === null ? undefined : toMessage(install.error)}
          onClick={() => {
            install.mutate({ vendorId: vendor.id, version: update.latestVersion ?? undefined });
          }}
        >
          Update to {update.latestVersion}
        </Button>
      ) : update?.hasNewBuild === true ? (
        <Button
          variant="ghost"
          size="compact"
          isBusy={install.isPending}
          title={install.error === null ? undefined : toMessage(install.error)}
          onClick={() => {
            install.mutate({ vendorId: vendor.id });
          }}
        >
          Reinstall
        </Button>
      ) : null}

      <Button
        variant="danger"
        size="compact"
        onClick={() => {
          remove.reset();
          setConfirming(true);
        }}
      >
        Remove
      </Button>

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
        {install.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(install.error)}
          </p>
        )}
        {remove.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(remove.error)}
          </p>
        )}
      </Modal>
    </>
  );
}
