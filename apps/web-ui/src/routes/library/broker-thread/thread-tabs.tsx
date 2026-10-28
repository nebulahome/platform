/**
 * The Thread broker's panels and tabs: the panel before setup, Overview, Devices and Border
 * routers. (Network is `thread-map`.)
 *
 * Before setup there are no tabs: one centred panel says Thread needs a radio, with Set up and
 * the fold of what it needs - disabled, with why, on a bridge network or Docker Desktop. Overview
 * is the health strip - the border router, its radio, the network, the devices on it - then the
 * credentials, the network key shown only while held, and Copy dataset. Devices lists the nodes
 * on the network with their role, parent and link; Border routers those heard, with which network
 * each is on.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ThreadBorderRouter, ThreadDevice, ThreadStatus } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  FactGrid,
  HealthCard,
  HealthStrip,
  HoldButton,
  ListRow,
  Note,
  RowList,
  Section,
} from '@nebulahome/ui';

import { ThreadLogo } from '@/components/brand-logos';
import { copyText } from '@/lib/clipboard';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { fetchThreadDataset, fetchThreadNetworkKey } from '@/library/thread-api';
import { HEAD_CELL, SignalBars, TABLE_FRAME } from '@/routes/library/broker-parts';
import { devicePath } from '@/routes/library/device/device-path';
import { threadRoleName } from '@/routes/library/device/transport-facts';

/** What the panel before setup needs. */
export type BeforeSetupProps = {
  readonly status: ThreadStatus;

  /** Opens Set up; absent when the person may not. */
  readonly onSetUp?: (() => void) | undefined;
};

/**
 * The panel before Thread is set up: it needs a radio, Set up, and what it needs.
 *
 * @param props - See {@link BeforeSetupProps}.
 * @returns The panel.
 */
export function BeforeSetup(props: BeforeSetupProps) {
  const { t } = useTranslation();
  const { status, onSetUp } = props;
  const blocked = status.setupBlockedBy;
  const [isOpen, setOpen] = useState(true);
  const needs = [
    {
      key: 'linux',
      isMet: blocked !== 'desktop',
      title: t('brokers.thread.before.linux', 'Linux'),
      line: t('brokers.thread.before.linuxLine', 'the platform runs on a Linux host'),
    },
    {
      key: 'host',
      isMet: blocked === null,
      title: t('brokers.thread.before.host', 'The host’s network'),
      line: t(
        'brokers.thread.before.hostLine',
        'NEBULA_NETWORK=host, so the border router can reach the house’s network',
      ),
    },
    {
      key: 'ipv6',
      isMet: true,
      title: t('brokers.thread.before.ipv6', 'IPv6'),
      line: t(
        'brokers.thread.before.ipv6Line',
        'on the house’s network, for routes to Thread devices',
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-6">
      {blocked === null ? null : (
        <Note tone="warning" className="w-full max-w-160">
          {blocked === 'desktop'
            ? t(
                'brokers.thread.before.desktop',
                'Thread needs the host’s network on Linux: Docker Desktop cannot give it.',
              )
            : t(
                'brokers.thread.before.bridge',
                'Thread needs the host’s network on Linux (NEBULA_NETWORK=host).',
              )}
        </Note>
      )}
      <div className="flex w-full max-w-160 flex-col items-center gap-4 rounded-panel border border-border bg-surface bg-[radial-gradient(circle_at_50%_0%,color-mix(in_srgb,var(--color-thread)_8%,transparent),transparent_60%)] px-8 pt-12 pb-7 text-center">
        <span className="flex size-18 items-center justify-center rounded-inner border border-border-strong bg-surface-raised thread-glow">
          <ThreadLogo width={34} height={34} />
        </span>
        <span className="text-title font-medium text-foreground">
          {t('brokers.thread.before.title', 'Thread needs a radio')}
        </span>
        <span className="max-w-120 text-ui leading-normal text-foreground-muted">
          {t(
            'brokers.thread.before.line',
            'Plug in a SkyConnect, ZBT-1 or another OpenThread RCP radio, then set up the network.',
          )}
        </span>
        {onSetUp === undefined ? null : (
          <span className="flex flex-col items-center gap-1.5">
            <Button disabled={blocked !== null} onClick={onSetUp}>
              {t('brokers.thread.setUp', 'Set up')}
            </Button>
            {blocked === null ? null : (
              <span className="text-caption text-foreground-subtle">
                {t('brokers.thread.before.disabled', 'Set up needs the host’s network')}
              </span>
            )}
          </span>
        )}
        <div className="mt-3 flex w-full flex-col gap-2.5 border-t border-border pt-4 text-left">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => {
              setOpen(!isOpen);
            }}
            className="flex items-center justify-between text-ui-sm text-foreground-muted"
          >
            {t('brokers.thread.before.needs', 'What it needs')}
            <AppIcon
              id="chevron-down"
              size={14}
              className={cn('transition-transform', isOpen && 'rotate-180')}
            />
          </button>
          {isOpen
            ? needs.map((need) => (
                <span key={need.key} className="flex items-start gap-2.5 text-ui-sm">
                  <AppIcon
                    id={need.isMet ? 'circle-check' : 'circle-x'}
                    size={16}
                    className={cn('mt-0.5 shrink-0', need.isMet ? 'text-success' : 'text-warning')}
                  />
                  <span className="text-foreground-muted">
                    <span className="font-medium text-foreground">{need.title}</span>
                    {` · ${need.line}`}
                  </span>
                </span>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A PAN id as it is written: `0x1A2B`.
 *
 * @param pan - The id, as OTBR gives it.
 * @returns The text.
 */
function panText(pan: string): string {
  return `0x${pan.replace(/^0x/iu, '').toUpperCase()}`;
}

/** What Overview needs. */
export type ThreadOverviewProps = {
  readonly status: ThreadStatus;

  /** Whether the person may see the key and the dataset. */
  readonly canConfigure: boolean;

  /** Opens How to fix, for the host's IPv6 settings. */
  readonly onFix: () => void;

  /** Restarts the border router; absent when the person may not. */
  readonly onRestart?: (() => void) | undefined;
};

/**
 * Renders Overview.
 *
 * @param props - See {@link ThreadOverviewProps}.
 * @returns The tab's content.
 */
export function ThreadOverview(props: ThreadOverviewProps) {
  const { t } = useTranslation();
  const { status, canConfigure } = props;
  const network = status.network;
  const border = status.borderRouter;
  const radio = status.radio;
  const isExternal = status.mode === 'external';
  const [key, setKey] = useState<string | null>(null);
  const [dataset, setDataset] = useState<string | null>(null);
  const reveal = useMutation({ mutationFn: fetchThreadNetworkKey, onSuccess: setKey });
  const copy = useMutation({
    /**
     * Reads the dataset and puts it on the clipboard.
     *
     * @returns The dataset.
     */
    mutationFn: async () => {
      const read = dataset ?? (await fetchThreadDataset());

      await copyText(read);

      return read;
    },
    onSuccess: setDataset,
  });

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.thread.borderRouter', 'Border router')}
          tone={border?.isRunning !== true ? 'danger' : status.ipv6.isOk ? 'neutral' : 'warning'}
          value={
            border?.isRunning !== true
              ? t('brokers.thread.stopped', 'Stopped')
              : !status.ipv6.isOk
                ? t('brokers.thread.cantReach', 'The server can’t reach Thread devices yet')
                : isExternal
                  ? t('brokers.thread.external', 'External')
                  : t('brokers.thread.running', 'Running')
          }
          detail={
            isExternal
              ? [border?.url.replace(/^https?:\/\//u, ''), border?.version]
                  .filter(Boolean)
                  .join(' · ')
              : (border?.version ?? undefined)
          }
          action={
            border?.isRunning !== true
              ? props.onRestart === undefined
                ? undefined
                : {
                    icon: 'rotate-ccw',
                    verb: t('brokers.thread.restart', 'Restart'),
                    onSelect: props.onRestart,
                  }
              : status.ipv6.isOk
                ? undefined
                : {
                    icon: 'chevron-right',
                    verb: t('brokers.thread.howToFix', 'How to fix'),
                    onSelect: props.onFix,
                  }
          }
        />
        <HealthCard
          label={t('brokers.thread.radio', 'Radio')}
          tone={isExternal || radio?.isConnected !== false ? 'neutral' : 'warning'}
          value={
            isExternal
              ? t('brokers.thread.managedExternally', 'Managed by the external border router')
              : radio === null
                ? '—'
                : radio.isConnected
                  ? t('brokers.thread.radioOn', '{{name}} on {{port}}', {
                      name: radio.name,
                      port: radio.path.replace(/^\/dev\//u, ''),
                    })
                  : t('brokers.thread.unplugged', 'Unplugged')
          }
          detail={
            isExternal || radio?.firmware == null
              ? undefined
              : t('brokers.thread.rcp', 'RCP {{firmware}}', { firmware: radio.firmware })
          }
        />
        <HealthCard
          label={t('brokers.thread.network', 'Network')}
          tone="neutral"
          value={
            network === null
              ? '—'
              : network.role === 'leader'
                ? t('brokers.thread.role.leader', 'Leader')
                : network.role === 'router'
                  ? t('brokers.thread.role.router', 'Router')
                  : network.role
          }
          detail={
            network === null
              ? undefined
              : t('brokers.thread.channelPan', 'Channel {{channel}} · PAN {{pan}}', {
                  channel: network.channel,
                  pan: panText(network.panId),
                })
          }
        />
        <HealthCard
          label={t('brokers.thread.devices', 'Devices')}
          tone="neutral"
          value={t('brokers.thread.onNetwork', '{{count}} on the network', {
            count: status.devices.routers + status.devices.endDevices + status.devices.sleepy,
          })}
          detail={t(
            'brokers.thread.devicesLine',
            '{{routers}} routers · {{endDevices}} end devices · {{sleepy}} sleepy',
            status.devices,
          )}
        />
      </HealthStrip>

      {network === null ? null : (
        <Section
          title={t('brokers.thread.credentials', 'Credentials')}
          note={t(
            'brokers.thread.credentialsNote',
            'Anything with these joins the network: keep them for border routers you trust.',
          )}
        >
          <div className="flex flex-col gap-3">
            <FactGrid
              facts={[
                { label: t('brokers.thread.networkName', 'Network name'), value: network.name },
                { label: t('brokers.thread.channel', 'Channel'), value: String(network.channel) },
                {
                  label: t('brokers.thread.panId', 'PAN ID'),
                  value: panText(network.panId),
                  isMono: true,
                },
                {
                  label: t('brokers.thread.extPanId', 'Extended PAN ID'),
                  value: network.extPanId,
                  isMono: true,
                },
                {
                  label: t('brokers.thread.meshPrefix', 'Mesh-local prefix'),
                  value: network.meshLocalPrefix,
                  isMono: true,
                },
                ...(canConfigure
                  ? [
                      {
                        label: t('brokers.thread.networkKey', 'Network key'),
                        value: (
                          <span className="flex flex-wrap items-center gap-3">
                            <span className="font-mono text-mono-ui tracking-wider text-foreground">
                              {key ?? '••••••••••'}
                            </span>
                            {key === null ? (
                              <HoldButton
                                variant="ghost"
                                holdingLabel={t('brokers.thread.keepHolding', 'Keep holding…')}
                                onConfirm={() => {
                                  reveal.mutate();
                                }}
                              >
                                {t('brokers.thread.holdToShow', 'Hold to show')}
                              </HoldButton>
                            ) : (
                              <Button
                                variant="bare"
                                size="compact"
                                onClick={() => {
                                  setKey(null);
                                }}
                              >
                                {t('brokers.thread.hide', 'Hide')}
                              </Button>
                            )}
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            {canConfigure ? (
              <div className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface px-5 py-3.5">
                <Button
                  variant="ghost"
                  isBusy={copy.isPending}
                  onClick={() => {
                    copy.mutate();
                  }}
                >
                  <AppIcon id={copy.isSuccess ? 'check' : 'copy'} size={15} />
                  {copy.isSuccess
                    ? t('brokers.thread.copied', 'Dataset copied')
                    : t('brokers.thread.copyDataset', 'Copy dataset')}
                </Button>
                <span className="grow text-ui-sm text-foreground-muted">
                  {t(
                    'brokers.thread.datasetLine',
                    'Paste it in another border router or phone app to join this network.',
                  )}
                </span>
                {dataset === null ? null : (
                  <span className="max-w-80 truncate font-mono text-mono-caption text-foreground-subtle">
                    {dataset}
                  </span>
                )}
              </div>
            ) : null}
            {[reveal.error, copy.error].map((error) =>
              error === null ? null : (
                <Note key={toMessage(error)} tone="danger">
                  {toMessage(error)}
                </Note>
              ),
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * A role as its chip: a router's in the Thread colour, the others plain.
 *
 * @param props - The role.
 * @param props.role - It.
 * @returns The chip.
 */
function RoleChip(props: { readonly role: ThreadDevice['role'] }) {
  const isRouter = props.role === 'router' || props.role === 'leader';

  return (
    <span
      className={cn(
        'inline-flex h-5.5 items-center rounded-pill border px-2 text-caption whitespace-nowrap',
        isRouter
          ? 'border-thread/50 bg-thread/10 text-thread'
          : 'border-border-strong text-foreground-muted',
      )}
    >
      {threadRoleName(props.role)}
    </span>
  );
}

/** What Devices needs. */
export type ThreadDevicesProps = {
  readonly devices: readonly ThreadDevice[];
  readonly roomOf: (areaId: string | null) => string | null;
};

/**
 * Renders Devices: the nodes on the network, unknown ones too.
 *
 * @param props - See {@link ThreadDevicesProps}.
 * @returns The tab's content.
 */
export function ThreadDevices(props: ThreadDevicesProps) {
  const { t } = useTranslation();
  const { devices, roomOf } = props;
  const headings = [
    t('brokers.thread.colName', 'Name'),
    t('brokers.thread.colRole', 'Role'),
    t('brokers.thread.colParent', 'Parent'),
    t('brokers.thread.colLink', 'Link'),
    t('brokers.thread.colLastSeen', 'Last seen'),
  ];

  return (
    <Section
      title={t('brokers.thread.devicesTitle', 'Devices')}
      note={t(
        'brokers.thread.devicesNote',
        'Added and controlled on the Matter page. A node the border router sees that the house does not have shows as unknown.',
      )}
    >
      {devices.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t(
            'brokers.thread.noDevices',
            'No device on the network yet. Add one on the Matter page.',
          )}
        </p>
      ) : (
        <div className={TABLE_FRAME}>
          <table className="w-full min-w-200 border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {headings.map((heading, index) => (
                  <th
                    key={heading}
                    scope="col"
                    className={index === 0 ? `${HEAD_CELL} pl-5` : HEAD_CELL}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.extAddress} className="border-t border-border first:border-t-0">
                  <td className="py-3 pr-4 pl-5">
                    <span className="flex items-center gap-3">
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised',
                          device.deviceId === null ? 'text-warning' : 'text-foreground-muted',
                        )}
                      >
                        <AppIcon
                          id={device.deviceId === null ? 'circle-dot' : 'waypoints'}
                          size={15}
                        />
                      </span>
                      {device.deviceId === null ? (
                        <span className="flex flex-col gap-0.5">
                          <span className="text-ui font-medium text-foreground">
                            {t('brokers.thread.unknownNode', 'Unknown Thread node')}
                          </span>
                          <span className="font-mono text-mono-caption text-foreground-muted">
                            {device.extAddress}
                          </span>
                        </span>
                      ) : (
                        <Link
                          to={devicePath(device.deviceId)}
                          className="flex flex-col gap-0.5 hover:text-primary"
                        >
                          <span className="text-ui font-medium text-foreground">{device.name}</span>
                          <span className="text-ui-sm text-foreground-muted">
                            {roomOf(device.areaId) ?? t('brokers.thread.noRoom', 'No room')}
                          </span>
                        </Link>
                      )}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <RoleChip role={device.role} />
                  </td>
                  <td className="py-3 pr-4 text-ui text-foreground">{device.parentName ?? '—'}</td>
                  <td className="py-3 pr-4">
                    {device.linkQuality === null ? (
                      '—'
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-mono-caption text-foreground-muted">
                        <SignalBars
                          lit={device.linkQuality}
                          of={3}
                          label={t('brokers.thread.linkOf', '{{quality}} of 3', {
                            quality: device.linkQuality,
                          })}
                        />
                        {t('brokers.thread.linkOf', '{{quality}} of 3', {
                          quality: device.linkQuality,
                        })}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-ui-sm whitespace-nowrap text-foreground-muted">
                    {device.lastSeenAt === null ? '—' : relativeTime(device.lastSeenAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** What Border routers needs. */
export type ThreadBorderRoutersProps = {
  readonly borderRouters: readonly ThreadBorderRouter[];

  /** Opens Settings at Join another network; absent when the person may not. */
  readonly onJoin?: (() => void) | undefined;
};

/**
 * Renders Border routers: those heard on the network, and which network each is on.
 *
 * @param props - See {@link ThreadBorderRoutersProps}.
 * @returns The tab's content.
 */
export function ThreadBorderRouters(props: ThreadBorderRoutersProps) {
  const { t } = useTranslation();

  return (
    <Section
      title={t('brokers.thread.borderRoutersTitle', 'Border routers')}
      note={t(
        'brokers.thread.borderRoutersNote',
        'The border routers heard on the house’s network. Those of the same network share its devices.',
      )}
    >
      {props.borderRouters.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t('brokers.thread.noBorderRouters', 'No border router heard yet.')}
        </p>
      ) : (
        <RowList>
          {props.borderRouters.map((router) => (
            <ListRow
              key={router.id}
              icon={
                router.isThisServer ? (
                  <ThreadLogo width={16} height={16} />
                ) : (
                  <AppIcon id="router" size={16} className="text-thread" />
                )
              }
              title={
                <span className="flex items-center gap-2">
                  {router.name}
                  {router.isThisServer ? (
                    <span className="inline-flex h-5.5 items-center rounded-pill border border-thread/50 bg-thread/10 px-2 text-caption font-normal text-thread">
                      {t('brokers.thread.thisServer', 'This server')}
                    </span>
                  ) : null}
                </span>
              }
              subtitle={[
                [router.vendor, router.model].filter(Boolean).join(' '),
                router.networkName,
                router.extPanId,
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={
                <>
                  <span
                    className={cn(
                      'inline-flex h-5.5 items-center rounded-pill border px-2 text-caption',
                      router.isSameNetwork
                        ? 'border-success/45 bg-success/10 text-success'
                        : 'border-border-strong text-foreground-muted',
                    )}
                  >
                    {router.isSameNetwork
                      ? t('brokers.thread.sameNetwork', 'Same network')
                      : t('brokers.thread.otherNetwork', 'Other network')}
                  </span>
                  {!router.isSameNetwork && props.onJoin !== undefined ? (
                    <Button variant="bare" size="compact" onClick={props.onJoin}>
                      {t('brokers.thread.joinInstead', 'Join that network instead')}
                    </Button>
                  ) : null}
                </>
              }
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}
