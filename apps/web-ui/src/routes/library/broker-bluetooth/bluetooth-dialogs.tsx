/**
 * The Bluetooth broker's dialogs: Add proxy, Settings, and the two confirmations nobody drew -
 * stopping a device being a proxy, and turning the server's adapter off (which also turns off
 * Matter's New device, so it says so).
 *
 * **Add proxy** is three steps across the dialog: pick a device - a search above the list, those
 * that can be proxies to pick, the others greyed with why (battery, Gen1, firmware too old, with
 * the way to its update) - then what happens on it and its scan mode, then the job's steps ticking
 * as the script is installed, started and first heard from; a failure stops on its step with the
 * integration's line and Try again.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type {
  BluetoothProxyCandidate,
  BluetoothProxyJob,
  BluetoothScanMode,
  BluetoothSettings,
  BluetoothStatus,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Modal,
  Note,
  Segmented,
  SelectField,
  StatusDot,
  Stepper,
  Switch,
  WizardSteps,
} from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import {
  addBluetoothProxy,
  BLUETOOTH_QUERY_KEYS,
  fetchBluetoothProxyCandidates,
  fetchBluetoothProxyJob,
  saveBluetoothSettings,
} from '@/library/bluetooth-api';
import { TickingSteps } from '@/routes/library/broker-matter/matter-steps';
import { ChoiceCard } from '@/routes/library/broker-parts';
import { BrokerMark } from '@/routes/library/brokers-page';
import { devicePath } from '@/routes/library/device/device-path';
import { SearchField } from '@/routes/library/search-field';

/** How often a proxy job is read while it runs. */
const JOB_POLL_MS = 1000;

/**
 * Why a device cannot be a proxy, in words.
 *
 * @param candidate - The device.
 * @returns The reason, or null for one that can.
 */
function reasonOf(candidate: BluetoothProxyCandidate): string | null {
  const proxy = candidate.proxy;

  if (proxy === null) {
    return translate('brokers.bluetooth.proxy.noAnswer', 'It does not answer');
  }

  if (proxy.eligible) {
    return candidate.isOnline ? null : translate('brokers.bluetooth.proxy.offline', 'Offline');
  }

  switch (proxy.reason) {
    case 'battery':
      return translate('brokers.bluetooth.proxy.battery', 'Battery powered');
    case 'gen1':
      return translate('brokers.bluetooth.proxy.gen1', 'Gen1, no Bluetooth');
    case 'firmware':
      return translate('brokers.bluetooth.proxy.firmware', 'Firmware too old: update it first');
    case 'no-bluetooth':
      return translate('brokers.bluetooth.proxy.noBluetooth', 'No Bluetooth');
  }
}

/** What Add proxy needs. */
export type AddProxyDialogProps = {
  readonly onClose: () => void;
  readonly roomOf: (areaId: string | null) => string | null;
  readonly defaultMode: BluetoothScanMode;

  /** A device to start at: its page's Bluetooth proxy row. */
  readonly deviceId?: string | undefined;

  /** A job to follow from the start, for the gallery. */
  readonly jobId?: string;
};

/**
 * Renders Add proxy.
 *
 * @param props - See {@link AddProxyDialogProps}.
 * @returns The dialog.
 */
export function AddProxyDialog(props: AddProxyDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { onClose, roomOf } = props;
  const [step, setStep] = useState(props.jobId === undefined ? 0 : 2);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(props.deviceId ?? null);
  const [mode, setMode] = useState<BluetoothScanMode>(props.defaultMode);
  const [jobId, setJobId] = useState<string | null>(props.jobId ?? null);

  const candidates = useQuery({
    queryKey: [...BLUETOOTH_QUERY_KEYS.candidates, props.deviceId ?? ''],

    /**
     * Reads the devices that could be proxies.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchBluetoothProxyCandidates(props.deviceId, signal),
  });
  const job = useQuery<BluetoothProxyJob>({
    queryKey: [...BLUETOOTH_QUERY_KEYS.job, jobId ?? ''],
    enabled: jobId !== null,

    /**
     * Reads it again while it runs.
     *
     * @param query - The query, with what it read last.
     * @returns How soon, or false once it ended.
     */
    refetchInterval: (query) => (query.state.data?.state === 'running' ? JOB_POLL_MS : false),

    /**
     * Reads the job.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Where it stands.
     */
    queryFn: async ({ signal }) => fetchBluetoothProxyJob(jobId ?? '', signal),
  });
  const start = useMutation({
    /**
     * Starts installing the script.
     *
     * @returns The job.
     */
    mutationFn: async () => addBluetoothProxy(picked ?? '', mode),

    /**
     * Follows it.
     *
     * @param started - The job.
     */
    onSuccess: (started) => {
      queryClient.setQueryData([...BLUETOOTH_QUERY_KEYS.job, started.id], started);
      setJobId(started.id);
      setStep(2);
    },
  });

  const all = candidates.data ?? [];
  const needle = search.trim().toLowerCase();
  const shown = all.filter(
    (each) =>
      needle === '' ||
      [each.name, roomOf(each.areaId) ?? ''].join(' ').toLowerCase().includes(needle),
  );
  const device = all.find((each) => each.deviceId === picked);
  const current = job.data;
  const isDone = current?.state === 'succeeded';
  const isFailed = current?.state === 'failed' || current?.state === 'cancelled';

  return (
    <Modal
      isOpen
      onClose={() => {
        if (isDone) {
          void queryClient.invalidateQueries({ queryKey: ['brokers', 'bluetooth'] });
        }

        onClose();
      }}
      size="large"
      layout="card"
      lead={<BrokerMark broker="bluetooth" size={44} isLit />}
      title={t('brokers.bluetooth.proxy.title', 'Add a Bluetooth proxy')}
      description={t(
        'brokers.bluetooth.proxy.line',
        'A device that listens for the house and forwards what it hears',
      )}
      closesOnBackdrop={step === 0}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            {step === 2 ? (
              <>
                {isFailed ? (
                  <Button
                    variant="ghost"
                    isBusy={start.isPending}
                    onClick={() => {
                      start.mutate();
                    }}
                  >
                    {t('brokers.bluetooth.proxy.tryAgain', 'Try again')}
                  </Button>
                ) : null}
                <Button
                  variant={isDone ? 'primary' : 'bare'}
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ['brokers', 'bluetooth'] });
                    onClose();
                  }}
                >
                  {isDone ? t('brokers.bluetooth.proxy.done', 'Done') : t('common.close', 'Close')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="bare"
                  onClick={() => {
                    if (step === 0) {
                      onClose();
                    } else {
                      setStep(0);
                    }
                  }}
                >
                  {step === 0 ? t('common.cancel', 'Cancel') : t('common.back', 'Back')}
                </Button>
                {step === 0 ? (
                  <Button
                    disabled={device === undefined || reasonOf(device) !== null}
                    onClick={() => {
                      setStep(1);
                    }}
                  >
                    {t('common.next', 'Next')}
                  </Button>
                ) : (
                  <Button
                    isBusy={start.isPending}
                    onClick={() => {
                      start.mutate();
                    }}
                  >
                    {t('brokers.bluetooth.proxy.make', 'Make it a proxy')}
                  </Button>
                )}
              </>
            )}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <WizardSteps
          layout="stacked"
          current={step}
          steps={[
            t('brokers.bluetooth.proxy.pick', 'Pick a device'),
            t('brokers.bluetooth.proxy.whatHappens', 'What happens'),
            t('brokers.bluetooth.proxy.progress', 'Progress'),
          ]}
        />

        {step === 0 ? (
          <>
            <SearchField
              className="w-full lg:w-full"
              placeholder={t('brokers.bluetooth.proxy.search', 'Search devices')}
              value={search}
              onChange={setSearch}
            />
            <div role="radiogroup" className="flex flex-col gap-2.5">
              {shown.length === 0 ? (
                <p className="text-ui-sm text-foreground-subtle">
                  {candidates.isPending
                    ? t('brokers.bluetooth.proxy.reading', 'Asking the integrations…')
                    : t(
                        'brokers.bluetooth.proxy.none',
                        'No device of an integration that makes Bluetooth proxies.',
                      )}
                </p>
              ) : (
                shown.map((each) => {
                  const reason = reasonOf(each);
                  const canUpdate = each.proxy?.eligible === false && each.proxy.update === true;

                  return (
                    <ChoiceCard
                      key={each.deviceId}
                      isChosen={each.deviceId === picked}
                      isDisabled={reason !== null}
                      onSelect={() => {
                        setPicked(each.deviceId);
                      }}
                      trailing={
                        reason === null ? (
                          <>
                            <span className="flex items-center gap-1.5 text-success">
                              <StatusDot
                                isBare
                                tone="success"
                                title={t('brokers.bluetooth.proxy.online', 'Online')}
                              />
                              {t('brokers.bluetooth.proxy.online', 'Online')}
                            </span>
                            {each.wifiRssi === null ? null : (
                              <span className="flex items-center gap-1 font-mono text-mono-caption">
                                <AppIcon id="wifi" size={13} />
                                {t('brokers.bluetooth.dbm', '{{rssi}} dBm', {
                                  rssi: each.wifiRssi,
                                })}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {reason}
                            {canUpdate ? (
                              <Link
                                to={devicePath(each.deviceId)}
                                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
                              >
                                {t('brokers.bluetooth.proxy.update', 'Update')}
                                <AppIcon id="chevron-right" size={13} />
                              </Link>
                            ) : null}
                          </>
                        )
                      }
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-surface-raised font-mono text-mono-caption text-[#5b9dff]">
                        {each.vendorId.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-ui font-medium text-foreground">
                          {each.name}
                        </span>
                        <span className="text-ui-sm text-foreground-muted">
                          {roomOf(each.areaId) ?? t('brokers.bluetooth.noRoom', 'No room')}
                        </span>
                      </span>
                    </ChoiceCard>
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {step === 1 && device !== undefined ? (
          <>
            <div className="flex items-start gap-3.5 rounded-inner border border-border px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised font-mono text-mono-ui text-[#5b9dff]">
                {device.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-ui leading-normal font-medium text-foreground">
                {t(
                  'brokers.bluetooth.proxy.script',
                  'A small script is installed on {{name}}. It sends what it hears to the house and does not change what the device does.',
                  { name: device.name },
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-ui-sm font-medium text-foreground">
                  {t('brokers.bluetooth.scanMode', 'Scan mode')}
                </span>
                <span className="text-caption text-foreground-muted">
                  {t(
                    'brokers.bluetooth.activeHint',
                    'Active asks devices for more and uses more of their battery.',
                  )}
                </span>
              </span>
              <Segmented
                label={t('brokers.bluetooth.scanMode', 'Scan mode')}
                value={mode}
                onChange={setMode}
                options={[
                  {
                    value: 'passive',
                    label: t('brokers.bluetooth.passive', 'Passive'),
                    disabled: !device.modes.includes('passive'),
                  },
                  {
                    value: 'active',
                    label: t('brokers.bluetooth.active', 'Active'),
                    disabled: !device.modes.includes('active'),
                  },
                ]}
              />
            </div>
            <p className="flex gap-3 rounded-inner border border-border bg-rail px-4 py-3 text-ui-sm leading-normal text-foreground-muted">
              <AppIcon id="info" size={16} className="mt-0.5 shrink-0 text-foreground-subtle" />
              {t(
                'brokers.bluetooth.proxy.listensOnly',
                'A proxy only listens. Devices that need a connection, like a lock, still go through this server’s adapter.',
              )}
            </p>
          </>
        ) : null}

        {step === 2 && current !== undefined ? (
          <div className="flex flex-col gap-4 py-1">
            <TickingSteps
              steps={current.steps.map((each) => ({
                id: each.id,
                state: each.state,
                title:
                  each.id === 'installing'
                    ? t('brokers.bluetooth.proxy.installing', 'Installing the script')
                    : each.id === 'started'
                      ? t('brokers.bluetooth.proxy.started', 'Started')
                      : t('brokers.bluetooth.proxy.firstReport', 'First report received'),
                detail:
                  each.message ??
                  (each.id === 'installing'
                    ? t(
                        'brokers.bluetooth.proxy.installingLine',
                        'Through the device’s integration',
                      )
                    : each.id === 'started'
                      ? t('brokers.bluetooth.proxy.startedLine', 'Scanning, {{mode}}', {
                          mode:
                            current.mode === 'active'
                              ? t('brokers.bluetooth.active', 'Active')
                              : t('brokers.bluetooth.passive', 'Passive'),
                        })
                      : t('brokers.bluetooth.proxy.firstReportLine', 'Within a minute')),
              }))}
            />
            {current.error === null ? null : <Note tone="danger">{current.error}</Note>}
          </div>
        ) : null}

        {start.error === null ? null : <Note tone="danger">{toMessage(start.error)}</Note>}
      </div>
    </Modal>
  );
}

/** What Settings needs. */
export type BluetoothSettingsDialogProps = {
  readonly status: BluetoothStatus;
  readonly onClose: () => void;
};

/**
 * Renders Settings: the local adapter, the proxies' scan mode, and what Nearby keeps.
 *
 * @param props - See {@link BluetoothSettingsDialogProps}.
 * @returns The dialog.
 */
export function BluetoothSettingsDialog(props: BluetoothSettingsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { status } = props;
  const [settings, setSettings] = useState<BluetoothSettings>(status.settings);
  const [isConfirming, setConfirming] = useState(false);
  const save = useMutation({
    /**
     * Saves the settings.
     *
     * @returns Where the broker stands.
     */
    mutationFn: async () => saveBluetoothSettings(settings),

    /** Reads it again and closes. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
      props.onClose();
    },
  });
  const group = 'font-mono text-label text-foreground-subtle uppercase';
  const row = 'flex flex-wrap items-center justify-between gap-3 py-3';

  return (
    <>
      <Modal
        isOpen
        onClose={props.onClose}
        size="form"
        layout="card"
        lead={<BrokerMark broker="bluetooth" size={44} isLit />}
        title={t('brokers.bluetooth.settings.title', 'Bluetooth settings')}
        footer={
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={props.onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                isBusy={save.isPending}
                onClick={() => {
                  if (status.settings.localEnabled && !settings.localEnabled) {
                    setConfirming(true);
                  } else {
                    save.mutate();
                  }
                }}
              >
                {t('brokers.bluetooth.settings.save', 'Save')}
              </Button>
            </span>
          </>
        }
      >
        <div className="flex flex-col">
          <span className={group}>{t('brokers.bluetooth.settings.local', 'Local adapter')}</span>
          <div className={row}>
            <span className="flex flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.bluetooth.useAdapter', 'Use this server’s adapter')}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {t(
                  'brokers.bluetooth.settings.offLine',
                  'Turning it off also turns off adding new Matter devices, which pair through it.',
                )}
              </span>
            </span>
            <Switch
              label={t('brokers.bluetooth.useAdapter', 'Use this server’s adapter')}
              isOn={settings.localEnabled}
              onChange={(localEnabled) => {
                setSettings({ ...settings, localEnabled });
              }}
            />
          </div>
          {status.adapters.length < 2 ? null : (
            <div className={`${row} border-t border-border`}>
              <span className="text-ui font-medium text-foreground">
                {t('brokers.bluetooth.adapter', 'Adapter')}
              </span>
              <SelectField
                label={t('brokers.bluetooth.adapter', 'Adapter')}
                isLabelHidden
                className="w-60"
                value={settings.adapterId ?? ''}
                onChange={(adapterId) => {
                  setSettings({ ...settings, adapterId: adapterId === '' ? null : adapterId });
                }}
                options={status.adapters.map((adapter) => ({
                  value: adapter.id,
                  label: [adapter.id, adapter.name].filter(Boolean).join(' · '),
                }))}
              />
            </div>
          )}
          <div className={`${row} border-t border-border`}>
            <span className="text-ui font-medium text-foreground">
              {t('brokers.bluetooth.scanMode', 'Scan mode')}
            </span>
            <Segmented
              label={t('brokers.bluetooth.scanMode', 'Scan mode')}
              value={settings.localScanMode}
              onChange={(localScanMode) => {
                setSettings({ ...settings, localScanMode });
              }}
              options={[
                {
                  value: 'passive',
                  label: t('brokers.bluetooth.passive', 'Passive'),
                  disabled: status.adapter?.canPassive === false,
                },
                { value: 'active', label: t('brokers.bluetooth.active', 'Active') },
              ]}
            />
          </div>
          <span className={`${group} mt-4`}>
            {t('brokers.bluetooth.settings.proxies', 'Proxies')}
          </span>
          <div className={row}>
            <span className="flex flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.bluetooth.settings.proxyMode', 'Scan mode for new proxies')}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {t(
                  'brokers.bluetooth.settings.proxyModeLine',
                  'Each proxy can change it on Scanners.',
                )}
              </span>
            </span>
            <Segmented
              label={t('brokers.bluetooth.settings.proxyMode', 'Scan mode for new proxies')}
              value={settings.proxyScanMode}
              onChange={(proxyScanMode) => {
                setSettings({ ...settings, proxyScanMode });
              }}
              options={[
                { value: 'passive', label: t('brokers.bluetooth.passive', 'Passive') },
                { value: 'active', label: t('brokers.bluetooth.active', 'Active') },
              ]}
            />
          </div>
          <span className={`${group} mt-4`}>
            {t('brokers.bluetooth.settings.nearby', 'Nearby')}
          </span>
          <div className={row}>
            <span className="text-ui font-medium text-foreground">
              {t('brokers.bluetooth.settings.forget', 'Forget devices not heard for')}
            </span>
            <Stepper
              label={t('brokers.bluetooth.settings.forget', 'Forget devices not heard for')}
              value={settings.forgetAfterDays}
              min={1}
              max={365}
              step={1}
              size="field"
              format={(days) =>
                t('brokers.bluetooth.settings.days', {
                  count: days,
                  defaultValue_one: '{{count}} day',
                  defaultValue_other: '{{count}} days',
                })
              }
              onChange={(forgetAfterDays) => {
                setSettings({ ...settings, forgetAfterDays });
              }}
            />
          </div>
          <div className={`${row} border-t border-border`}>
            <span className="flex flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.bluetooth.settings.private', 'Show private addresses')}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {t(
                  'brokers.bluetooth.settings.privateLine',
                  'Phones and watches change address every few minutes.',
                )}
              </span>
            </span>
            <Switch
              label={t('brokers.bluetooth.settings.private', 'Show private addresses')}
              isOn={settings.showPrivate}
              onChange={(showPrivate) => {
                setSettings({ ...settings, showPrivate });
              }}
            />
          </div>
          {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}
        </div>
      </Modal>
      <AdapterOffConfirm
        isOpen={isConfirming}
        isBusy={save.isPending}
        onClose={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          save.mutate();
        }}
      />
    </>
  );
}

/**
 * Asks before the server's adapter is turned off: Matter's New device goes with it.
 *
 * @param props - Whether it is open, and what it does.
 * @param props.isOpen - Whether it is open.
 * @param props.isBusy - Whether the change is under way.
 * @param props.onClose - Closes it.
 * @param props.onConfirm - Turns the adapter off.
 * @returns The dialog.
 */
export function AdapterOffConfirm(props: {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="small"
      title={t('brokers.bluetooth.adapterOff.title', 'Stop using this server’s adapter?')}
      description={t(
        'brokers.bluetooth.adapterOff.line',
        'Devices that need a connection lose it, and Matter cannot add new devices until it is back on: they pair through it.',
      )}
      footer={
        <>
          <Button variant="bare" onClick={props.onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="danger" isBusy={props.isBusy} onClick={props.onConfirm}>
            {t('brokers.bluetooth.adapterOff.confirm', 'Turn it off')}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

/**
 * Asks before a device stops being a proxy: its script is removed.
 *
 * @param props - The device, and what it does.
 * @param props.name - The device.
 * @param props.isBusy - Whether the removal is under way.
 * @param props.onClose - Closes it.
 * @param props.onConfirm - Removes the script.
 * @returns The dialog.
 */
export function StopProxyConfirm(props: {
  readonly name: string | null;
  readonly isBusy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={props.name !== null}
      onClose={props.onClose}
      size="small"
      title={t('brokers.bluetooth.stop.title', 'Stop {{name}} being a proxy?', {
        name: props.name ?? '',
      })}
      description={t(
        'brokers.bluetooth.stop.line',
        'The script is removed from the device. What only it heard is no longer heard.',
      )}
      footer={
        <>
          <Button variant="bare" onClick={props.onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="danger" isBusy={props.isBusy} onClick={props.onConfirm}>
            {t('brokers.bluetooth.stop.confirm', 'Stop being a proxy')}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
