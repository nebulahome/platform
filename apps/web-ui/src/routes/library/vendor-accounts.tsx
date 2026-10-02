/**
 * The accounts a vendor's devices are reached through, on its page: which are signed in, which
 * need the owner again, and the way to add another.
 *
 * A vendor with an account (`account.json`) has no Configure for it: signing in is a flow, not a
 * form to save (`account-dialog.tsx`). Each account is a row - its name, where it stands, since
 * when, and why not when it is not - with **Sign in again** for one the cloud stopped taking, and
 * **Remove**, which asks first and offers to remove the devices that came with it too: they stay,
 * unreachable, otherwise, until the account is signed in to again.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  AccountStatus,
  DeviceView,
  IntegrationAccountView,
  IntegrationVendorView,
} from '@nebulahome/contracts';
import { Badge, Button, Modal, Panel, Switch, type BadgeTone } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { deleteDevice, LIBRARY_QUERY_KEYS, signOutOfAccount } from '@/library/api';
import { AccountDialog } from '@/routes/library/account-dialog';

/** How each standing reads on its badge. */
const STATUS: Readonly<
  Record<AccountStatus, { readonly label: string; readonly tone: BadgeTone }>
> = {
  connected: { label: 'Signed in', tone: 'success' },
  'needs-sign-in': { label: 'Sign in again', tone: 'warning' },
  failed: { label: 'Not working', tone: 'danger' },
};

/** What the panel needs. */
export type VendorAccountsProps = {
  readonly vendor: IntegrationVendorView;

  /** The vendor's devices, among which those that came with each account. */
  readonly devices: readonly DeviceView[];

  /** Whether the person may sign in and out. */
  readonly canConfigure: boolean;
};

/**
 * The devices that came with an account.
 *
 * @param devices - The vendor's devices.
 * @param accountId - The account.
 * @returns Those whose configuration names it.
 */
function devicesOf(devices: readonly DeviceView[], accountId: string): DeviceView[] {
  return devices.filter((device) => device.transportConfig['account'] === accountId);
}

/**
 * The first letter of an account's name, for its mark.
 *
 * @param label - The name.
 * @returns One capital letter.
 */
function initialOf(label: string): string {
  return (label.trim()[0] ?? '?').toUpperCase();
}

/**
 * Renders the panel, for a vendor that has an account.
 *
 * @param props - See {@link VendorAccountsProps}.
 * @returns The panel, or nothing for a vendor without an account.
 */
export function VendorAccounts(props: VendorAccountsProps) {
  const { vendor, devices, canConfigure } = props;
  const queryClient = useQueryClient();
  const [signingIn, setSigningIn] = useState<{ again?: IntegrationAccountView } | null>(null);
  const [removing, setRemoving] = useState<IntegrationAccountView | null>(null);
  const [alsoDevices, setAlsoDevices] = useState(true);
  const [dialogKey, setDialogKey] = useState(0);

  /** Reads the vendor and its devices again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
  };

  const remove = useMutation({
    /**
     * Removes the account's devices when asked, then signs out of it.
     *
     * @param target - The account, and whether its devices go too.
     * @param target.account - The account.
     * @param target.withDevices - Whether its devices are removed first.
     * @returns Once it is signed out of.
     */
    mutationFn: async (target: {
      readonly account: IntegrationAccountView;
      readonly withDevices: boolean;
    }): Promise<void> => {
      if (target.withDevices) {
        for (const device of devicesOf(devices, target.account.id)) {
          // One after another, as the page removes them one by one.
          // eslint-disable-next-line no-await-in-loop -- see above
          await deleteDevice(device.id);
        }
      }

      await signOutOfAccount(vendor.id, target.account.id);
    },

    /** Shuts the question and reads everything again. */
    onSuccess: (): void => {
      setRemoving(null);
      refresh();
    },
  });

  if (vendor.account === null) {
    return null;
  }

  const name = vendor.account.name;

  /**
   * Opens the sign-in.
   *
   * @param again - The account signed in to again; nothing for a new one.
   */
  const openSignIn = (again?: IntegrationAccountView): void => {
    setDialogKey((key) => key + 1);
    setSigningIn(again === undefined ? {} : { again });
  };

  const removingDevices = removing === null ? [] : devicesOf(devices, removing.id);

  return (
    <>
      <Panel
        title={vendor.accounts.length === 1 ? name : `${name}s · ${String(vendor.accounts.length)}`}
        action={
          canConfigure && vendor.accounts.length > 0 ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                openSignIn();
              }}
            >
              Add account
            </Button>
          ) : undefined
        }
      >
        {vendor.accounts.length === 0 ? (
          <div className="flex flex-wrap items-center gap-4 px-4 py-3.5">
            <p role="status" className="grow text-ui text-foreground-muted">
              No {name} signed in yet. Sign in, and the devices bound to it are added here on their
              own.
            </p>
            {canConfigure ? (
              <Button
                size="compact"
                onClick={() => {
                  openSignIn();
                }}
              >
                Sign in
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {vendor.accounts.map((account) => {
              const status = STATUS[account.status];
              const count = devicesOf(devices, account.id).length;

              return (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/13 text-ui font-semibold text-primary"
                  >
                    {initialOf(account.label)}
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-ui">
                      <span className="truncate font-medium text-foreground">{account.label}</span>
                      <Badge tone={status.tone} size="small">
                        {status.label}
                      </Badge>
                    </span>
                    <span className="text-caption text-foreground-muted">
                      {account.status !== 'connected' && account.lastError !== null
                        ? account.lastError
                        : [
                            count === 1 ? '1 device' : `${String(count)} devices`,
                            account.connectedAt === null
                              ? null
                              : `signed in ${relativeTime(account.connectedAt)}`,
                          ]
                            .filter((part) => part !== null)
                            .join(' · ')}
                    </span>
                  </span>
                  {canConfigure ? (
                    <span className="flex items-center gap-2">
                      {account.status === 'connected' ? null : (
                        <Button
                          size="compact"
                          onClick={() => {
                            openSignIn(account);
                          }}
                        >
                          Sign in again
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="compact"
                        onClick={() => {
                          setAlsoDevices(true);
                          setRemoving(account);
                        }}
                      >
                        Remove
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {signingIn === null ? null : (
        <AccountDialog
          key={dialogKey}
          vendor={vendor}
          {...(signingIn.again === undefined ? {} : { again: signingIn.again })}
          onClose={() => {
            setSigningIn(null);
          }}
          onConnected={refresh}
        />
      )}

      <Modal
        isOpen={removing !== null}
        onClose={() => {
          setRemoving(null);
        }}
        title={`Remove ${removing?.label ?? ''}?`}
        description={`NebulaHome signs out of this ${name}. It can be signed in to again later.`}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setRemoving(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isBusy={remove.isPending}
              onClick={() => {
                if (removing !== null) {
                  remove.mutate({ account: removing, withDevices: alsoDevices });
                }
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {removingDevices.length === 0 ? (
            <p className="text-ui text-foreground-muted">No device came with it.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Switch
                label={
                  removingDevices.length === 1
                    ? `Remove its device too: ${removingDevices[0]?.name ?? ''}`
                    : `Remove its ${String(removingDevices.length)} devices too`
                }
                isOn={alsoDevices}
                onChange={setAlsoDevices}
              />
              <p className="text-caption text-foreground-subtle">
                Kept, they stay unreachable until the account is signed in to again.
              </p>
            </div>
          )}
          {remove.error === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {toMessage(remove.error)}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
