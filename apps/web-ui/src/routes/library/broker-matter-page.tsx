/**
 * The house's Matter fabric: how its controller stands, every node commissioned into it, and the
 * way a new one comes in.
 *
 * As the board draws a detail page: the way back, the mark, the name and its line, the state as a
 * Pill, then the tabs. Overview is the health strip - the controller, the devices answering, the
 * fabric - with a callout when the controller failed or cannot hear the house's network. Devices is
 * every node, a bridge with each device behind it: who makes it, its firmware and addresses, which
 * integration has it - or the platform's own mapping - and what of it is not mapped. Add is the
 * pairing code another app shares, and how the commissioning goes.
 *
 * A node is added to the house the moment it is commissioned: an integration whose rules
 * recognise it takes it, and the platform takes the rest. Removing one takes its devices out of
 * the house and the node off the fabric; it stays in the apps it was shared from.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type {
  MatterIdentity,
  MatterNode,
  MatterNodeDevice,
  MatterStatus,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  Button,
  DetailHero,
  HealthCard,
  HealthStrip,
  HeroFact,
  Note,
  Pill,
  RowList,
  Section,
  TabPanel,
  Tabs,
  TextField,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import { fetchDevices, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  BROKER_QUERY_KEYS,
  commissionMatter,
  fetchMatterNodes,
  fetchMatterStatus,
  removeMatterNode,
  restoreMatterDevice,
} from '@/library/brokers-api';
import { brokerStateOf, MatterMark } from '@/routes/library/brokers-page';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { devicePath } from '@/routes/library/device/device-path';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices', 'add'] as const;

/** One tab. */
type MatterTab = (typeof TABS)[number];

/** How often the fabric is read again, and how often while a device is being commissioned. */
const REFRESH_MS = 10_000;
const COMMISSIONING_REFRESH_MS = 2000;

/**
 * The name a device is shown under.
 *
 * @param identity - Who it says it is.
 * @returns What the owner called it in the app it came from, then what it is sold as.
 */
function nameOf(identity: MatterIdentity): string {
  return (
    identity.nodeLabel ??
    identity.productLabel ??
    identity.productName ??
    (identity.endpoint === null
      ? `Matter ${identity.nodeId}`
      : `Matter ${identity.nodeId}:${String(identity.endpoint)}`)
  );
}

/**
 * A cluster number as the specification writes it.
 *
 * @param cluster - The number.
 * @returns `0x0202`.
 */
function hexOf(cluster: number): string {
  return `0x${cluster.toString(16).padStart(4, '0').toUpperCase()}`;
}

/** What one device row needs. */
type DeviceRowProps = {
  readonly device: MatterNodeDevice;

  /** The device of the house it is, by id: its name. */
  readonly names: ReadonlyMap<string, string>;

  /** The integrations, by id: their names. */
  readonly vendors: ReadonlyMap<string, string>;
  readonly canWrite: boolean;

  /** Brings it back into the house. */
  readonly onRestore: () => void;
  readonly isRestoring: boolean;
};

/**
 * One device of a node: the node itself, or one behind a bridge.
 *
 * @param props - See {@link DeviceRowProps}.
 * @returns The row.
 */
function MatterDeviceRow(props: DeviceRowProps) {
  const { t } = useTranslation();
  const { device, names, vendors, canWrite, onRestore, isRestoring } = props;
  const { identity } = device;
  const maker = [identity.vendorName, identity.productName].filter(Boolean).join(' · ');
  const addresses = [
    identity.softwareVersionString === null
      ? null
      : t('brokers.matter.firmware', 'Firmware {{version}}', {
          version: identity.softwareVersionString,
        }),
    identity.serialNumber,
    ...identity.macAddresses,
  ].filter((part): part is string => part !== null);
  const [vendorId = ''] = (device.kind ?? '').split('/');

  return (
    <li className="flex flex-col gap-1.5 border-t border-border px-5 py-3 first:border-t-0">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        {device.deviceId === null ? (
          <span className="truncate text-ui font-medium text-foreground">{nameOf(identity)}</span>
        ) : (
          <Link
            to={devicePath(device.deviceId)}
            className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
          >
            {names.get(device.deviceId) ?? nameOf(identity)}
          </Link>
        )}
        {identity.isBridged ? (
          <Badge size="small">{t('brokers.matter.behindBridge', 'Behind the bridge')}</Badge>
        ) : identity.isBridge ? (
          <Badge size="small">{t('brokers.matter.bridge', 'Bridge')}</Badge>
        ) : null}
        {device.isRemoved ? (
          <Badge size="small" tone="warning">
            {t('brokers.matter.removed', 'Removed from the house')}
          </Badge>
        ) : device.kind === null ? (
          <Badge size="small" tone="cyan">
            {t('brokers.matter.adding', 'Being added')}
          </Badge>
        ) : vendorId === 'matter' ? (
          <Badge size="small">{t('brokers.matter.platformMapping', 'Matter, generic')}</Badge>
        ) : (
          <Badge size="small" tone="accent">
            {vendors.get(vendorId) ?? vendorId}
          </Badge>
        )}
        {device.isRemoved && canWrite ? (
          <Button variant="ghost" size="compact" isBusy={isRestoring} onClick={onRestore}>
            {t('brokers.matter.addBack', 'Add back')}
          </Button>
        ) : null}
      </span>
      {maker === '' ? null : <span className="text-caption text-foreground-subtle">{maker}</span>}
      {addresses.length === 0 ? null : (
        <span className="font-mono text-mono-caption break-all text-foreground-subtle">
          {addresses.join(' · ')}
        </span>
      )}
      {device.claimedBy.length > 1 ? (
        <span className="text-caption text-warning">
          {t(
            'brokers.matter.claimedBy',
            "More than one integration recognises it ({{vendors}}): it runs on the platform's own mapping.",
            {
              vendors: device.claimedBy.map((each) => vendors.get(each) ?? each).join(', '),
            },
          )}
        </span>
      ) : null}
      {device.unmappedClusters.length === 0 ? null : (
        <span className="text-caption text-foreground-subtle">
          {t('brokers.matter.notMapped', 'Not mapped yet: {{clusters}}', {
            clusters: device.unmappedClusters.map(hexOf).join(', '),
          })}
        </span>
      )}
    </li>
  );
}

/**
 * Renders the Matter broker's page.
 *
 * @returns The page.
 */
export function MatterBrokerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canWrite = can('device:write');
  const canRemove = can('device:delete');
  const [tab, setTab] = useTab<MatterTab>(TABS);
  const [code, setCode] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const status = useQuery<MatterStatus>({
    queryKey: BROKER_QUERY_KEYS.matterStatus,

    /**
     * Reads the fabric's state, faster while a device is being commissioned.
     *
     * @param query - The query, with what it read last.
     * @returns How often to read it again.
     */
    refetchInterval: (query) =>
      query.state.data?.commissioning?.state === 'running' ? COMMISSIONING_REFRESH_MS : REFRESH_MS,

    /**
     * Reads the fabric's state.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchMatterStatus(signal),
  });
  const isCommissioning = status.data?.commissioning?.state === 'running';

  const nodes = useQuery({
    queryKey: BROKER_QUERY_KEYS.matterNodes,
    refetchInterval: isCommissioning ? COMMISSIONING_REFRESH_MS : REFRESH_MS,

    /**
     * Reads the nodes.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The nodes.
     */
    queryFn: async ({ signal }) => fetchMatterNodes(signal),
  });

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,

    /**
     * Reads the devices, for the names of those the nodes are.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });

  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,

    /**
     * Reads the integrations, for the names of those that have a node.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The integrations.
     */
    queryFn: async ({ signal }) => fetchVendors(signal),
  });

  /** Reads everything the fabric touches again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
  };

  const commission = useMutation({
    /**
     * Starts commissioning.
     *
     * @param pairingCode - The code as typed.
     * @returns The job.
     */
    mutationFn: async (pairingCode: string) => commissionMatter(pairingCode),

    /** Clears the field and reads the job. */
    onSuccess: () => {
      setCode('');
      refresh();
    },
  });

  const remove = useMutation({
    /**
     * Removes a node from the house and the fabric.
     *
     * @param nodeId - The node.
     * @returns Once removed.
     */
    mutationFn: async (nodeId: string) => removeMatterNode(nodeId),

    /** Closes the question and reads everything again, whichever way it went. */
    onSettled: () => {
      setRemoving(null);
      refresh();
    },
  });

  const restore = useMutation({
    /**
     * Brings a device back into the house.
     *
     * @param device - The device.
     * @returns Whether it was removed.
     */
    mutationFn: async (device: MatterIdentity) =>
      restoreMatterDevice(device.nodeId, device.endpoint),

    /** Reads everything again. */
    onSettled: refresh,
  });

  const found = status.data;
  const all: readonly MatterNode[] = nodes.data ?? [];
  const names = new Map((devices.data ?? []).map((device) => [device.id, device.name]));
  const vendorNames = new Map((vendors.data ?? []).map((vendor) => [vendor.id, vendor.name]));
  const state = found === undefined ? null : brokerStateOf(found.state);
  const job = found?.commissioning ?? null;

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<MatterMark size={56} />}
          title={t('library.matterTag', 'Matter')}
          description={t(
            'brokers.matter.description',
            "The house's Matter fabric: every Matter device is reached through it, whoever makes it.",
          )}
          facts={
            found === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="network">
                  {found.isLanReachable
                    ? t('brokers.matter.localNetwork', 'Local network')
                    : t('brokers.matter.noNetwork', 'Network not heard')}
                </HeroFact>
                {found.fabricId === null ? null : (
                  <HeroFact>
                    {t('brokers.matter.fabric', 'Fabric {{id}}', { id: found.fabricId })}
                  </HeroFact>
                )}
              </>
            )
          }
          actions={
            canWrite && found?.state === 'running' ? (
              <Button
                onClick={() => {
                  setTab('add');
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('brokers.matter.addDevice', 'Add device')}
              </Button>
            ) : undefined
          }
          tabs={
            <Tabs
              label={t('library.matterTag', 'Matter')}
              idPrefix="matter"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.matter.overview', 'Overview') },
                { id: 'devices', label: t('brokers.matter.devices', 'Devices'), count: all.length },
                ...(canWrite
                  ? [{ id: 'add' as const, label: t('brokers.matter.add', 'Add') }]
                  : []),
              ]}
            />
          }
        />
      }
    >
      {found === undefined ? null : (
        <>
          {tab === 'overview' ? (
            <TabPanel idPrefix="matter" id="overview">
              <div className="flex flex-col gap-8">
                {found.state === 'failed' && found.error !== null ? (
                  <Note tone="danger">
                    {t('brokers.matter.failed', 'The Matter controller did not start: {{error}}', {
                      error: found.error,
                    })}
                  </Note>
                ) : null}
                {found.isLanReachable ? null : (
                  <Note tone="warning">
                    {t(
                      'brokers.matter.needsHostNetwork',
                      "Matter finds its devices over mDNS and IPv6, which the platform's bridge network does not carry. Run the platform on the host's network (NEBULA_NETWORK=host) for Matter devices to answer.",
                    )}
                  </Note>
                )}
                <HealthStrip>
                  <HealthCard
                    label={t('brokers.matter.controller', 'Controller')}
                    tone={
                      found.state === 'running'
                        ? 'success'
                        : found.state === 'failed'
                          ? 'danger'
                          : 'neutral'
                    }
                    value={state?.label}
                  />
                  <HealthCard
                    label={t('brokers.matter.devices', 'Devices')}
                    tone={
                      found.nodes.total === 0
                        ? 'neutral'
                        : found.nodes.online === found.nodes.total
                          ? 'success'
                          : 'warning'
                    }
                    value={t('brokers.matter.onlineOfTotal', '{{online}} of {{total}} online', {
                      online: found.nodes.online,
                      total: found.nodes.total,
                    })}
                  />
                  <HealthCard
                    label={t('brokers.matter.fabricLabel', 'Fabric')}
                    tone="neutral"
                    value={found.fabricId ?? '—'}
                  />
                </HealthStrip>
              </div>
            </TabPanel>
          ) : null}

          {tab === 'devices' ? (
            <TabPanel idPrefix="matter" id="devices">
              <div className="flex flex-col gap-6">
                {remove.error === null ? null : (
                  <Note tone="danger">{toMessage(remove.error)}</Note>
                )}
                {all.length === 0 ? (
                  <p className="text-ui text-foreground-subtle">
                    {t(
                      'brokers.matter.noNodes',
                      'No Matter device yet. Add one with the code its app shares.',
                    )}
                  </p>
                ) : (
                  all.map((node) => {
                    const [first] = node.devices;
                    const title = first === undefined ? node.nodeId : nameOf(first.identity);

                    return (
                      <Section
                        key={node.nodeId}
                        title={
                          <span className="flex items-center gap-2">
                            {title}
                            <Pill tone={node.isAvailable ? 'success' : 'warning'}>
                              {node.isAvailable
                                ? t('brokers.matter.online', 'Online')
                                : t('brokers.matter.offline', 'Offline')}
                            </Pill>
                          </span>
                        }
                        actions={
                          canRemove && removing !== node.nodeId ? (
                            <Button
                              variant="ghost"
                              size="compact"
                              onClick={() => {
                                setRemoving(node.nodeId);
                              }}
                            >
                              {t('brokers.matter.remove', 'Remove')}
                            </Button>
                          ) : undefined
                        }
                      >
                        {removing === node.nodeId ? (
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <ConfirmRemoval
                              question={t(
                                'brokers.matter.removeQuestion',
                                'Remove {{name}} from the house and from its Matter fabric? It stays in the apps it was shared from.',
                                { name: title },
                              )}
                              label={t('brokers.matter.remove', 'Remove')}
                              isBusy={remove.isPending}
                              onConfirm={() => {
                                remove.mutate(node.nodeId);
                              }}
                              onCancel={() => {
                                setRemoving(null);
                              }}
                            />
                          </div>
                        ) : null}
                        <RowList>
                          <ul>
                            {node.devices.map((device) => (
                              <MatterDeviceRow
                                key={`${node.nodeId}:${String(device.identity.endpoint)}`}
                                device={device}
                                names={names}
                                vendors={vendorNames}
                                canWrite={canWrite}
                                isRestoring={restore.isPending}
                                onRestore={() => {
                                  restore.mutate(device.identity);
                                }}
                              />
                            ))}
                          </ul>
                        </RowList>
                      </Section>
                    );
                  })
                )}
              </div>
            </TabPanel>
          ) : null}

          {tab === 'add' && canWrite ? (
            <TabPanel idPrefix="matter" id="add">
              <div className="flex max-w-2xl flex-col gap-6">
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ui text-foreground-muted">
                  <li>
                    {t(
                      'brokers.matter.stepPair',
                      "Set the device up in its maker's app, or in Google Home, Apple Home or Alexa.",
                    )}
                  </li>
                  <li>
                    {t(
                      'brokers.matter.stepShare',
                      'In that app, share it with another app: it shows a pairing code for a few minutes.',
                    )}
                  </li>
                  <li>
                    {t(
                      'brokers.matter.stepPaste',
                      'Type the code here. The integration that recognises the device takes it; the platform takes any other.',
                    )}
                  </li>
                </ol>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commission.mutate(code);
                  }}
                >
                  <TextField
                    label={t('brokers.matter.code', 'Pairing code')}
                    placeholder="3497-011-2332"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    aria-describedby="matter-code-hint"
                    className="font-mono"
                    onChange={(event) => {
                      setCode(event.target.value);
                    }}
                  />
                  <Button
                    type="submit"
                    disabled={code.trim() === '' || isCommissioning || found.state !== 'running'}
                    isBusy={commission.isPending}
                  >
                    {t('brokers.matter.addDevice', 'Add device')}
                  </Button>
                </form>
                {/* Under the row, not the field: a field's own hint would push the button off the input's line. */}
                <span id="matter-code-hint" className="-mt-4.5 text-caption text-foreground-subtle">
                  {t(
                    'brokers.matter.codeHint',
                    'The 11 or 21 digits, or the text of the QR code (MT:…).',
                  )}
                </span>
                {commission.error === null ? null : (
                  <Note tone="danger">{toMessage(commission.error)}</Note>
                )}
                {job === null ? null : job.state === 'running' ? (
                  <Note tone="accent">
                    {t(
                      'brokers.matter.commissioning',
                      'Adding the device to the fabric. This takes from a few seconds to a minute or two.',
                    )}
                  </Note>
                ) : job.state === 'failed' ? (
                  <Note tone="danger">
                    {t('brokers.matter.commissionFailed', 'The device was not added: {{error}}', {
                      error: job.error ?? '',
                    })}
                  </Note>
                ) : (
                  <Note
                    tone="accent"
                    action={
                      <Button
                        variant="ghost"
                        size="compact"
                        onClick={() => {
                          setTab('devices');
                        }}
                      >
                        {t('brokers.matter.seeDevices', 'See the devices')}
                      </Button>
                    }
                  >
                    {t(
                      'brokers.matter.commissioned',
                      'The device is on the fabric and in the house.',
                    )}
                  </Note>
                )}
              </div>
            </TabPanel>
          ) : null}
        </>
      )}
    </DetailFrame>
  );
}
