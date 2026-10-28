/**
 * The Matter broker's Network tab: the fabric as a map to move around.
 *
 * Nebula Home in the middle; around it the Wi-Fi access points and the Thread routers its nodes
 * reach the house through, each a rounded square in its network's colour; around those the
 * devices, round, with their icon and name - a device that is also a Thread router carries a
 * badge - and a bridge's devices behind it on dotted links. Links are straight and coloured by
 * the network, Wi-Fi cyan and Thread magenta, dashed red to a device that does not answer.
 *
 * The canvas - dragging, zoom, fit, arrange, the legend and the cards' place - is the network
 * maps' own (`network-map/map-canvas`). Hovering a point - or focusing it, or clicking it, which keeps
 * it open - shows a card: a device's (its name opens its page) with its MAC, last call,
 * transport and role, link quality and node; a router's with its network and channel and how many
 * devices go through it, saying that it is not a Matter device and so shares no more.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { MatterNetwork } from '@nebulahome/contracts';
import { AppIcon, cn, Pill, Segmented, type UiIconId } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';
import { useLasted } from '@/routes/library/broker-matter/matter-overview';
import { LIGHT_TYPES, type MatterRow } from '@/routes/library/broker-matter/matter-rows';
import {
  networkMapOf,
  type LinkLook,
  type MapPoint,
  type NetworkFilter,
} from '@/routes/library/broker-matter/network-model';
import { BrokerMark } from '@/routes/library/brokers-page';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon, type DeviceIcons } from '@/routes/library/device-icon';
import { CardRow, MapCanvas, MapLabel } from '@/routes/library/network-map/map-canvas';

/** How each link is drawn. */
export const LINK_STYLES: Record<LinkLook, CSSProperties> = {
  controller: { stroke: 'var(--color-foreground-muted)', strokeWidth: 1.5, opacity: 0.45 },
  wifi: { stroke: 'var(--color-cyan)', strokeWidth: 2.2, opacity: 0.85 },
  thread: { stroke: 'var(--color-thread)', strokeWidth: 2.2, opacity: 0.85 },
  bridge: {
    stroke: 'var(--color-foreground-subtle)',
    strokeWidth: 1.5,
    opacity: 0.85,
    strokeDasharray: '2 5',
    strokeLinecap: 'round',
  },
  offline: {
    stroke: 'var(--color-danger)',
    strokeWidth: 2.2,
    opacity: 0.7,
    strokeDasharray: '6 6',
  },
};

/** What the tab needs. */
export type NetworkGraphProps = {
  /** The fabric's network; undefined while it is read. */
  readonly network: MatterNetwork | undefined;
  readonly rows: readonly MatterRow[];
  readonly icons: DeviceIcons;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link NetworkGraphProps}.
 * @returns The filter, the map and its controls.
 */
export function NetworkGraph(props: NetworkGraphProps) {
  const { t } = useTranslation();
  const { network, rows, icons } = props;
  const [filter, setFilter] = useState<NetworkFilter>('all');
  const map = useMemo(
    () => networkMapOf(network ?? { collectedAt: null, nodes: [], links: [] }, rows, filter),
    [network, rows, filter],
  );
  const links = useMemo(
    () =>
      map.links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        style: LINK_STYLES[link.look],
      })),
    [map],
  );

  return (
    <MapCanvas
      points={map.points}
      links={links}
      layoutKey={filter}
      label={t('brokers.matter.map.label', 'The Matter network')}
      emptyText={
        network === undefined
          ? t('brokers.matter.map.reading', 'Reading the network…')
          : t(
              'brokers.matter.map.empty',
              'No node has said how it is connected yet. Its routes show here once it does.',
            )
      }
      shapeOf={(point, isSelected) => (
        <PointShape point={point} icons={icons} isSelected={isSelected} />
      )}
      labelOf={(point) => <PointLabelOf point={point} />}
      cardOf={(point) =>
        point.kind === 'controller' ? null : point.kind === 'device' ? (
          <DeviceCard point={point} icons={icons} />
        ) : (
          <RouterCard point={point} />
        )
      }
      legend={[
        { label: t('brokers.matter.map.wifi', 'Wi-Fi'), style: LINK_STYLES.wifi },
        { label: t('brokers.matter.map.thread', 'Thread'), style: LINK_STYLES.thread },
        {
          label: t('brokers.matter.map.behindBridge', 'Behind a bridge'),
          style: LINK_STYLES.bridge,
        },
        {
          label: t('brokers.matter.map.notAnswering', 'Not answering'),
          style: LINK_STYLES.offline,
        },
      ]}
      toolbar={
        <Segmented
          label={t('brokers.matter.show', 'Show')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('brokers.matter.map.all', 'All') },
            { value: 'wifi', label: t('brokers.matter.map.wifi', 'Wi-Fi') },
            { value: 'thread', label: t('brokers.matter.map.thread', 'Thread') },
          ]}
          className="bg-surface/90 shadow-popover backdrop-blur-sm"
        />
      }
    />
  );
}

/**
 * A point's label on the map.
 *
 * @param props - The point.
 * @param props.point - It.
 * @returns The label.
 */
function PointLabelOf(props: { readonly point: MapPoint }) {
  const label = useLabel(props.point);

  return <MapLabel label={{ ...label, isStrong: props.point.kind !== 'device' }} />;
}

/**
 * The words a point is labelled with on the map, and the colour of the second line.
 *
 * @param point - The point.
 * @returns Its name, and what it is or how it reaches the house.
 */
function useLabel(point: MapPoint): { name: string; line: string; tone: string } {
  const { t } = useTranslation();
  const lasted = useLasted();
  const rssi = point.link?.rssi ?? null;
  const dbm = rssi === null ? null : t('brokers.matter.map.dbm', '{{value}} dBm', { value: rssi });

  switch (point.kind) {
    case 'controller': {
      return {
        name: t('brokers.matter.map.hub', 'Nebula Home'),
        line: t('brokers.matter.map.controller', 'Matter controller'),
        tone: 'text-foreground-subtle',
      };
    }

    case 'access-point': {
      const kind = t('brokers.matter.map.accessPoint', 'Wi-Fi access point');

      return point.ssid === null
        ? { name: kind, line: point.point?.bssid ?? '', tone: 'text-cyan' }
        : { name: point.ssid, line: kind, tone: 'text-cyan' };
    }

    case 'thread-router': {
      return {
        name: t('brokers.matter.map.threadRouter', 'Thread router'),
        line: point.networkName ?? t('brokers.matter.map.otherFabric', 'Not on this fabric'),
        tone: 'text-thread',
      };
    }

    case 'device': {
      const name = point.row?.name ?? point.id;
      const offlineSince = point.row?.node.offlineSince ?? null;

      if (point.isOffline) {
        return {
          name,
          line:
            offlineSince === null
              ? t('brokers.matter.offline', 'Offline')
              : t('brokers.matter.map.offlineFor', 'Offline · {{for}}', {
                  for: lasted(offlineSince),
                }),
          tone: 'text-danger',
        };
      }

      const line = point.isBehindBridge
        ? t('brokers.matter.map.behindTheBridge', 'Behind the bridge')
        : point.point?.isBridge === true
          ? [t('brokers.matter.map.bridge', 'Bridge'), dbm].filter(Boolean).join(' · ')
          : isThreadRouter(point)
            ? t('brokers.matter.map.threadRouter', 'Thread router')
            : (dbm ?? '');

      return { name, line, tone: 'text-foreground-subtle' };
    }
  }
}

/**
 * Whether a device also routes Thread for others.
 *
 * @param point - The device.
 * @returns True for a Thread router or leader.
 */
function isThreadRouter(point: MapPoint): boolean {
  return (
    point.network === 'thread' && (point.point?.role === 'router' || point.point?.role === 'leader')
  );
}

/**
 * A point's shape: the house's mark, a router's square, a device's circle.
 *
 * @param props - The point, the icons, and whether it is selected.
 * @param props.point - It.
 * @param props.icons - The devices' icons.
 * @param props.isSelected - Whether it is selected.
 * @returns The shape.
 */
function PointShape(props: {
  readonly point: MapPoint;
  readonly icons: DeviceIcons;
  readonly isSelected: boolean;
}) {
  const { point, icons, isSelected } = props;

  if (point.kind === 'controller') {
    return (
      <span className="flex rounded-panel shadow-[0_0_0_10px_color-mix(in_oklab,var(--color-violet)_7%,transparent),0_0_60px_color-mix(in_oklab,var(--color-violet)_25%,transparent)]">
        <BrokerMark size={72} isLit />
      </span>
    );
  }

  if (point.kind !== 'device') {
    const isWifi = point.kind === 'access-point';

    return (
      <span
        className={cn(
          'flex size-13 items-center justify-center rounded-card border-[1.5px] ring-6',
          isWifi
            ? 'border-cyan/70 bg-cyan/14 text-cyan ring-cyan/6'
            : 'border-thread/70 bg-thread/14 text-thread ring-thread/6',
          isSelected && 'outline-2 outline-offset-3 outline-primary',
        )}
      >
        <AppIcon id={isWifi ? 'wifi' : 'router'} size={24} />
      </span>
    );
  }

  const view = point.row?.view;
  const isLight = point.row?.device.identity.deviceTypes.some((type) => LIGHT_TYPES.has(type));

  return (
    <span
      className={cn(
        'relative flex size-11 items-center justify-center rounded-full border-[1.5px] bg-surface-raised',
        point.isOffline
          ? 'border-danger opacity-75'
          : point.isBehindBridge
            ? 'border-foreground-subtle/60'
            : point.network === 'wifi'
              ? 'border-cyan/60'
              : point.network === 'thread'
                ? 'border-thread/60'
                : 'border-border-strong',
        isSelected && 'border-primary ring-5 ring-primary/18',
        isLight === true ? 'text-lamp' : 'text-foreground-muted',
      )}
    >
      <DeviceIcon
        icon={view?.icon == null ? undefined : icons.get(view.icon)}
        {...(view === undefined ? {} : { device: view })}
        size={20}
      />
      {isThreadRouter(point) ? (
        <span className="absolute -right-1.5 -bottom-1 flex size-5 items-center justify-center rounded-[7px] border-[1.5px] border-thread/80 bg-surface text-thread">
          <AppIcon id="router" size={11} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * A hardware address the way a router's page writes it: a Thread extended address comes bare.
 *
 * @param value - The address, with colons or without.
 * @returns `F4:12:FA:3C:88:01`, or null for none.
 */
function macText(value: string | null | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }

  return (value.includes(':') ? value : (value.match(/.{1,2}/gu) ?? []).join(':')).toUpperCase();
}

/**
 * A node id the way Matter tools write it.
 *
 * @param nodeId - In decimal.
 * @returns `0x0C`.
 */
function nodeHex(nodeId: string): string {
  try {
    return `0x${BigInt(nodeId).toString(16).toUpperCase().padStart(2, '0')}`;
  } catch {
    return nodeId;
  }
}

/**
 * A device's card: who it is, and how it reaches the house.
 *
 * @param props - The device and the icons.
 * @param props.point - It.
 * @param props.icons - The devices' icons.
 * @returns The card's content.
 */
function DeviceCard(props: { readonly point: MapPoint; readonly icons: DeviceIcons }) {
  const { t } = useTranslation();
  const { point, icons } = props;
  const row = point.row;
  const view = row?.view;
  const unknown = t('brokers.matter.map.unknown', 'Unknown');
  const mac = macText(row?.device.identity.macAddresses[0] ?? point.point?.extAddress);
  const network =
    point.network === 'wifi'
      ? t('brokers.matter.map.wifi', 'Wi-Fi')
      : point.network === 'thread'
        ? t('brokers.matter.map.thread', 'Thread')
        : point.network === 'ethernet'
          ? t('brokers.matter.map.ethernet', 'Ethernet')
          : unknown;
  const role = roleWords(t, point.point?.role ?? null);
  const { lqi = null, rssi = null } = point.link ?? {};
  const quality = [
    lqi === null ? null : t('brokers.matter.map.lqi', 'LQI {{value}}', { value: lqi }),
    rssi === null ? null : t('brokers.matter.map.dbm', '{{value}} dBm', { value: rssi }),
  ].filter((part): part is string => part !== null);
  const nodeId = row?.node.nodeId ?? point.point?.nodeId ?? null;
  const endpoint = row?.device.identity.endpoint ?? null;

  const head = (
    <>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised',
          row?.device.identity.deviceTypes.some((type) => LIGHT_TYPES.has(type)) === true
            ? 'text-lamp'
            : 'text-foreground-muted',
        )}
      >
        <DeviceIcon
          icon={view?.icon == null ? undefined : icons.get(view.icon)}
          {...(view === undefined ? {} : { device: view })}
          size={16}
        />
      </span>
      <span className="flex min-w-0 grow flex-col gap-px">
        <span className="inline-flex items-center gap-1.5 truncate text-ui font-medium text-foreground">
          {row?.name ?? point.id}
          {view === undefined ? null : (
            <AppIcon id="external-link" size={13} className="shrink-0 text-primary" />
          )}
        </span>
        <span className="truncate text-caption text-foreground-muted">
          {view?.model ?? row?.device.identity.productName ?? ''}
        </span>
      </span>
      <Pill tone={point.isOffline ? 'danger' : 'success'}>
        {point.isOffline
          ? t('brokers.matter.offline', 'Offline')
          : t('brokers.matter.online', 'Online')}
      </Pill>
    </>
  );

  return (
    <>
      {view === undefined ? (
        <span className="flex items-center gap-2.5">{head}</span>
      ) : (
        <Link
          to={devicePath(view.id)}
          className="flex items-center gap-2.5 rounded-field focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
        >
          {head}
        </Link>
      )}
      <div className="flex flex-col gap-1.75 border-t border-border pt-2.5">
        <CardRow label={t('brokers.matter.map.mac', 'MAC')} isMuted={mac === null}>
          {mac ?? t('brokers.matter.map.notShared', 'Not shared')}
        </CardRow>
        <CardRow
          label={t('brokers.matter.map.lastCall', 'Last call')}
          isMuted={view?.lastUpdatedAt == null}
        >
          {view?.lastUpdatedAt == null ? unknown : relativeTime(view.lastUpdatedAt)}
        </CardRow>
        <CardRow label={t('brokers.matter.map.transport', 'Transport')}>
          {point.isBehindBridge ? (
            t('brokers.matter.map.behindTheBridge', 'Behind the bridge')
          ) : (
            <>
              <span
                className={cn(
                  point.network === 'wifi' && 'text-cyan',
                  point.network === 'thread' && 'text-thread',
                )}
              >
                {network}
              </span>
              {role === null ? null : ` · ${role}`}
            </>
          )}
        </CardRow>
        <CardRow
          label={t('brokers.matter.map.quality', 'Link quality')}
          isMuted={quality.length === 0}
        >
          {quality.length === 0 ? unknown : quality.join(' · ')}
        </CardRow>
        {nodeId === null ? null : (
          <CardRow label={t('brokers.matter.map.node', 'Node')}>
            {endpoint === null
              ? nodeHex(nodeId)
              : t('brokers.matter.map.nodeEndpoint', '{{node}} · EP {{endpoint}}', {
                  node: nodeHex(nodeId),
                  endpoint,
                })}
          </CardRow>
        )}
      </div>
    </>
  );
}

/**
 * A router's card: the network it carries, and that the house knows no more of it.
 *
 * @param props - The router.
 * @param props.point - It.
 * @returns The card's content.
 */
function RouterCard(props: { readonly point: MapPoint }) {
  const { t } = useTranslation();
  const { point } = props;
  const { name } = useLabel(point);
  const isWifi = point.kind === 'access-point';
  const notShared = t('brokers.matter.map.notShared', 'Not shared');
  const icon: UiIconId = isWifi ? 'wifi' : 'router';
  const carried = isWifi ? point.ssid : point.networkName;
  const mac = macText(isWifi ? point.point?.bssid : point.point?.extAddress);

  return (
    <>
      <span className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-field',
            isWifi ? 'bg-cyan/14 text-cyan' : 'bg-thread/14 text-thread',
          )}
        >
          <AppIcon id={icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-ui font-medium text-foreground">{name}</span>
          <span className={cn('text-caption', isWifi ? 'text-cyan' : 'text-thread')}>
            {isWifi
              ? t('brokers.matter.map.accessPoint', 'Wi-Fi access point')
              : t('brokers.matter.map.otherFabric', 'Not on this fabric')}
          </span>
        </span>
      </span>
      <div className="flex flex-col gap-1.75 border-t border-border pt-2.5">
        <CardRow
          label={
            isWifi
              ? t('brokers.matter.map.wifiNetwork', 'Wi-Fi network')
              : t('brokers.matter.map.threadNetwork', 'Thread network')
          }
          isMuted={carried === null}
        >
          {carried === null
            ? t('brokers.matter.map.unknown', 'Unknown')
            : point.channel === null
              ? carried
              : t('brokers.matter.map.onChannel', '{{name}} · ch {{channel}}', {
                  name: carried,
                  channel: point.channel,
                })}
        </CardRow>
        <CardRow label={t('brokers.matter.map.through', 'Devices through it')}>
          {point.through}
        </CardRow>
        <CardRow label={t('brokers.matter.map.mac', 'MAC')} isMuted={mac === null}>
          {mac ?? notShared}
        </CardRow>
        <CardRow label={t('brokers.matter.map.lastCall', 'Last call')} isMuted>
          {notShared}
        </CardRow>
      </div>
      <p className="flex gap-2 text-caption leading-normal text-foreground-muted">
        <AppIcon id="info" size={14} className="mt-px shrink-0 text-foreground-subtle" />
        {isWifi
          ? t(
              'brokers.matter.map.apNote',
              'Not a Matter device: the house knows only what its devices say about it.',
            )
          : t(
              'brokers.matter.map.threadNote',
              'Not a Matter device of this house: it knows only what Thread says about it.',
            )}
      </p>
    </>
  );
}

/**
 * A role in words.
 *
 * @param t - Translates.
 * @param role - As the controller names it.
 * @returns The words, or null for none.
 */
function roleWords(t: ReturnType<typeof useTranslation>['t'], role: string | null): string | null {
  switch (role) {
    case 'leader': {
      return t('brokers.matter.map.role.leader', 'leader');
    }

    case 'router': {
      return t('brokers.matter.map.role.router', 'router');
    }

    case 'reed':
    case 'end_device': {
      return t('brokers.matter.map.role.endDevice', 'end device');
    }

    case 'sleepy_end_device': {
      return t('brokers.matter.map.role.sleepy', 'sleepy end device');
    }

    default: {
      return null;
    }
  }
}
