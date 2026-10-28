/**
 * The Bluetooth proxy row of a device page: for a device whose integration can make it a proxy
 * (its profile declares `bluetoothProxy`), whether it is one, and how it scans.
 *
 * Turning it on runs the same flow as the broker's Add proxy, starting at this device; turning
 * it off asks first, since its script is removed. The broker's Scanners tab is still the one
 * place that lists every proxy. Nothing is drawn for a device that cannot be one, nor for a role
 * that may not change the house's hardware.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Segmented, Switch, toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import {
  BLUETOOTH_QUERY_KEYS,
  fetchBluetoothProxyCandidates,
  fetchBluetoothScanners,
  removeBluetoothProxy,
  setBluetoothProxyMode,
} from '@/library/bluetooth-api';
import {
  AddProxyDialog,
  StopProxyConfirm,
} from '@/routes/library/broker-bluetooth/bluetooth-dialogs';

/** What the row needs. */
export type BluetoothProxyRowProps = {
  readonly deviceId: string;
  readonly name: string;

  /** Whether the device's integration makes Bluetooth proxies at all. */
  readonly canBeProxy: boolean;
};

/**
 * Renders the row.
 *
 * @param props - See {@link BluetoothProxyRowProps}.
 * @returns The row, or nothing for a device that cannot be a proxy.
 */
export function BluetoothProxyRow(props: BluetoothProxyRowProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { deviceId, name, canBeProxy } = props;
  const canConfigure = useSession((state) => state.can('integration:configure'));
  const [isAdding, setAdding] = useState(false);
  const [isStopping, setStopping] = useState(false);
  const isAsked = canBeProxy && canConfigure;

  const candidate = useQuery({
    queryKey: [...BLUETOOTH_QUERY_KEYS.candidates, deviceId, 'one'],
    enabled: isAsked,
    retry: false,

    /**
     * Asks whether this device can be a proxy.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns It, as a candidate, or nothing.
     */
    queryFn: async ({ signal }) =>
      (await fetchBluetoothProxyCandidates(deviceId, signal)).find(
        (each) => each.deviceId === deviceId,
      ) ?? null,
  });
  const scanners = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.scanners,
    enabled: isAsked,
    retry: false,

    /**
     * Reads the scanners, for this device's own.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchBluetoothScanners(signal),
  });

  /** Reads the broker again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers', 'bluetooth'] });
  };

  const mode = useMutation({
    /**
     * Changes how it scans.
     *
     * @param next - The mode.
     * @returns Its scanner.
     */
    mutationFn: async (next: 'passive' | 'active') => setBluetoothProxyMode(deviceId, next),
    onSettled: refresh,

    /**
     * Says why not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.bluetooth.modeFailed', 'Couldn’t change the scan mode'),
        message: toMessage(error),
      });
    },
  });
  const stop = useMutation({
    /**
     * Removes its script.
     *
     * @returns Once removed.
     */
    mutationFn: async () => removeBluetoothProxy(deviceId),
    onSettled: refresh,

    /** Closes the confirmation. */
    onSuccess: () => {
      setStopping(false);
    },

    /**
     * Says why not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.bluetooth.stopFailed', 'Couldn’t remove the script'),
        message: toMessage(error),
      });
    },
  });

  const found = candidate.data ?? null;

  if (!isAsked || found === null) {
    return null;
  }

  const scanner = scanners.data?.find((each) => each.deviceId === deviceId);
  const isProxy =
    scanner !== undefined || (found.proxy?.eligible === true && found.proxy.installed);
  const isEligible = found.proxy?.eligible === true;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface px-5 py-4">
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-ui font-medium text-foreground">
          {t('device.bluetoothProxy.title', 'Bluetooth proxy')}
        </span>
        <span className="text-ui-sm text-foreground-muted">
          {isProxy ? (
            <>
              {t(
                'device.bluetoothProxy.on',
                'It listens for the house and forwards what it hears.',
              )}{' '}
              <Link
                to="/brokers/bluetooth?tab=scanners"
                className="text-primary hover:text-primary-hover"
              >
                {t('device.bluetoothProxy.scanners', 'See Scanners')}
              </Link>
            </>
          ) : isEligible ? (
            t(
              'device.bluetoothProxy.off',
              'A small script would make it listen for the house too, without changing what it does.',
            )
          ) : (
            t('device.bluetoothProxy.cannot', 'This one cannot be a proxy.')
          )}
        </span>
      </span>
      {isProxy && scanner !== undefined ? (
        <Segmented
          label={t('brokers.bluetooth.scanMode', 'Scan mode')}
          value={scanner.scanMode}
          onChange={(next) => {
            mode.mutate(next);
          }}
          options={[
            {
              value: 'passive',
              label: t('brokers.bluetooth.passive', 'Passive'),
              disabled: !found.modes.includes('passive'),
            },
            {
              value: 'active',
              label: t('brokers.bluetooth.active', 'Active'),
              disabled: !found.modes.includes('active'),
            },
          ]}
        />
      ) : null}
      <Switch
        label={t('device.bluetoothProxy.title', 'Bluetooth proxy')}
        isOn={isProxy}
        disabled={!isProxy && !isEligible}
        onChange={(isOn) => {
          if (isOn) {
            setAdding(true);
          } else {
            setStopping(true);
          }
        }}
      />
      {isAdding ? (
        <AddProxyDialog
          deviceId={deviceId}
          roomOf={() => null}
          defaultMode={found.modes[0] ?? 'passive'}
          onClose={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : null}
      <StopProxyConfirm
        name={isStopping ? name : null}
        isBusy={stop.isPending}
        onClose={() => {
          setStopping(false);
        }}
        onConfirm={() => {
          stop.mutate();
        }}
      />
    </div>
  );
}
