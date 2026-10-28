/**
 * The Bluetooth broker's Map tab: who hears what, on the network maps' canvas.
 *
 * This server in the middle, lit; around it the scanners - its own adapter, and the proxies,
 * linked to it over Wi-Fi by a dashed line - and each device of the house hung on the scanner
 * that hears it best, the line coloured by how well: strong, fair, weak, or connected for one the
 * adapter holds a link to. Selecting a device opens a panel in the map's corner: who hears it
 * and how loud, and, when even the best hears it weakly, that a proxy nearer it would help.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { BluetoothDevice, BluetoothMap } from '@nebulahome/contracts';
import { AppIcon, Button, cn, IconButton, Note } from '@nebulahome/ui';

import { BluetoothLogo } from '@/components/brand-logos';
import { relativeTime } from '@/lib/format-time';
import { rssiBars, SignalBars } from '@/routes/library/broker-parts';
import { devicePath } from '@/routes/library/device/device-path';
import { MapCanvas, MapLabel, type CanvasPoint } from '@/routes/library/network-map/map-canvas';
import { radialLayout } from '@/routes/library/network-map/radial-layout';

/** The middle of the map. */
const SERVER_ID = 'server';

/** How a link is drawn. */
export type BluetoothLinkLook = 'adapter' | 'wifi' | 'strong' | 'fair' | 'weak' | 'connected';

/** How each link is drawn. */
const LINK_STYLES: Record<BluetoothLinkLook, CSSProperties> = {
  adapter: { stroke: '#5b9dff', strokeWidth: 2.2, opacity: 0.9 },
  wifi: { stroke: 'var(--color-cyan)', strokeWidth: 1.5, opacity: 0.7, strokeDasharray: '5 5' },
  strong: { stroke: '#5b9dff', strokeWidth: 2.2, opacity: 0.9 },
  fair: { stroke: '#5b9dff', strokeWidth: 1.5, opacity: 0.45 },
  weak: { stroke: 'var(--color-warning)', strokeWidth: 1.5, opacity: 0.8 },
  connected: { stroke: '#5b9dff', strokeWidth: 3, opacity: 1 },
};

/** One point of the map. */
export type BluetoothPoint = CanvasPoint & {
  readonly kind: BluetoothMap['nodes'][number]['kind'];
  readonly name: string;
  readonly deviceId: string | null;
  readonly isOnline: boolean;
  readonly rssi: number | null;
};

/** A point while the tree is built. */
type Branch = Omit<BluetoothPoint, 'x' | 'y'> & { readonly children: Branch[] };

/**
 * Lays the map out: the scanners round this server, each device on the scanner that hears it
 * best.
 *
 * @param map - Who hears what, as the broker says.
 * @param devices - The house's devices, for which are connected.
 * @returns The points and their links.
 */
export function bluetoothMapOf(
  map: BluetoothMap,
  devices: readonly BluetoothDevice[],
): {
  readonly points: BluetoothPoint[];
  readonly links: { id: string; source: string; target: string; look: BluetoothLinkLook }[];
} {
  const connected = new Set(
    devices.filter((device) => device.link === 'connected').map((device) => device.address),
  );
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  const looks = new Map<string, BluetoothLinkLook>();
  const placed = new Set<string>([SERVER_ID]);

  /**
   * A point and what hangs on it, from the links that leave it.
   *
   * @param link - The link it hangs on.
   * @returns The branch, or null for a point the broker did not list, or one already placed.
   */
  const branchOf = (link: BluetoothMap['links'][number]): Branch | null => {
    const node = nodes.get(link.target);

    if (node === undefined || placed.has(node.id)) {
      return null;
    }

    placed.add(node.id);
    looks.set(
      node.id,
      link.network === 'wifi'
        ? 'wifi'
        : node.kind === 'adapter'
          ? 'adapter'
          : connected.has(node.id)
            ? 'connected'
            : link.strength === 'strong'
              ? 'strong'
              : link.strength === 'medium'
                ? 'fair'
                : 'weak',
    );

    return {
      id: node.id,
      kind: node.kind,
      name: node.name,
      deviceId: node.deviceId,
      isOnline: node.isOnline !== false,
      rssi: link.rssi,
      children: childrenOf(node.id),
    };
  };

  /**
   * What hangs on a point.
   *
   * @param id - The point.
   * @returns Its branches.
   */
  const childrenOf = (id: string): Branch[] =>
    map.links
      .filter((link) => link.source === id)
      .flatMap((link) => {
        const branch = branchOf(link);

        return branch === null ? [] : [branch];
      });
  const rooted = childrenOf(SERVER_ID);
  const laidOut = radialLayout(rooted, SERVER_ID, {
    firstRing: 300,

    /**
     * How far a scanner's devices sit from it: further the more there are.
     *
     * @param branch - The scanner.
     * @returns The distance.
     */
    distanceOf: (branch) => Math.max(200, branch.children.length * 40),
  });
  const server = map.nodes.find((node) => node.id === SERVER_ID);

  return {
    points: [
      {
        id: SERVER_ID,
        kind: 'server',
        name: server?.name ?? 'Nebula Home',
        deviceId: null,
        isOnline: true,
        rssi: null,
        x: 0,
        y: 0,
      },
      ...laidOut.map(({ branch, x, y }) => ({
        id: branch.id,
        kind: branch.kind,
        name: branch.name,
        deviceId: branch.deviceId,
        isOnline: branch.isOnline,
        rssi: branch.rssi,
        x,
        y,
      })),
    ],
    links: laidOut.map(({ branch, parent }) => ({
      id: `${parent}->${branch.id}`,
      source: parent,
      target: branch.id,
      look: looks.get(branch.id) ?? 'fair',
    })),
  };
}

/** What the tab needs. */
export type BluetoothMapViewProps = {
  readonly map: BluetoothMap | undefined;
  readonly devices: readonly BluetoothDevice[];
  readonly roomOf: (areaId: string | null) => string | null;

  /** Opens Add proxy; absent when the person may not. */
  readonly onAddProxy?: (() => void) | undefined;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link BluetoothMapViewProps}.
 * @returns The map.
 */
export function BluetoothMapView(props: BluetoothMapViewProps) {
  const { t } = useTranslation();
  const { map, devices } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const laid = useMemo(
    () => bluetoothMapOf(map ?? { collectedAt: null, nodes: [], links: [] }, devices),
    [map, devices],
  );
  const links = useMemo(
    () => laid.links.map((link) => ({ ...link, style: LINK_STYLES[link.look] })),
    [laid],
  );
  const device = devices.find((each) => each.address === selected);

  return (
    <div className="flex flex-col gap-3">
      {map?.collectedAt == null ? null : (
        <span className="flex items-center justify-end gap-1.5 text-caption text-foreground-subtle">
          <AppIcon id="refresh-cw" size={12} />
          {t('brokers.bluetooth.map.updated', 'Updated {{when}}', {
            when: relativeTime(map.collectedAt),
          })}
        </span>
      )}
      <MapCanvas
        points={laid.points}
        links={links}
        layoutKey="all"
        label={t('brokers.bluetooth.map.label', 'Who hears what')}
        emptyText={
          map === undefined
            ? t('brokers.bluetooth.map.reading', 'Reading who hears what…')
            : t('brokers.bluetooth.map.empty', 'No scanner hears anything yet.')
        }
        onSelect={(id) => {
          setSelected(id);
        }}
        shapeOf={(point, isSelected) => <PointShape point={point} isSelected={isSelected} />}
        labelOf={(point) => <PointLabel point={point} devices={devices} />}
        legend={[
          {
            label: t('brokers.bluetooth.map.connected', 'Connected'),
            style: LINK_STYLES.connected,
          },
          { label: t('brokers.bluetooth.map.strong', 'Strong'), style: LINK_STYLES.strong },
          { label: t('brokers.bluetooth.map.fair', 'Fair'), style: LINK_STYLES.fair },
          { label: t('brokers.bluetooth.map.weak', 'Weak'), style: LINK_STYLES.weak },
          {
            label: t('brokers.bluetooth.map.overWifi', 'Proxy to server, over Wi-Fi'),
            style: LINK_STYLES.wifi,
          },
        ]}
        panel={
          device === undefined ? undefined : (
            <DevicePanel
              device={device}
              room={props.roomOf(device.areaId)}
              onClose={() => {
                setSelected(null);
              }}
              onAddProxy={props.onAddProxy}
            />
          )
        }
      />
    </div>
  );
}

/**
 * A point's shape: this server's lit mark, a scanner's square, a device's circle.
 *
 * @param props - The point, and whether it is selected.
 * @param props.point - It.
 * @param props.isSelected - Whether it is selected.
 * @returns The shape.
 */
function PointShape(props: { readonly point: BluetoothPoint; readonly isSelected: boolean }) {
  const { point, isSelected } = props;

  if (point.kind === 'server') {
    return (
      <span className="flex size-18 items-center justify-center rounded-panel border border-border-strong bg-surface-raised bluetooth-glow shadow-[0_0_0_10px_color-mix(in_oklab,#5b9dff_7%,transparent),0_0_60px_color-mix(in_oklab,#5b9dff_25%,transparent)]">
        <BluetoothLogo width={32} height={32} />
      </span>
    );
  }

  if (point.kind === 'adapter' || point.kind === 'proxy') {
    return (
      <span
        className={cn(
          'flex size-13 items-center justify-center rounded-card border-[1.5px] font-mono text-mono-ui ring-6',
          point.kind === 'adapter'
            ? 'border-[#5b9dff]/70 bg-[#5b9dff]/14 text-[#5b9dff] ring-[#5b9dff]/6'
            : point.isOnline
              ? 'border-cyan/60 bg-cyan/12 text-cyan ring-cyan/6'
              : 'border-warning/60 bg-warning/12 text-warning ring-warning/6',
          isSelected && 'outline-2 outline-offset-3 outline-primary',
        )}
      >
        {point.kind === 'adapter' ? (
          <AppIcon id="cpu" size={22} />
        ) : (
          point.name.slice(0, 1).toUpperCase()
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex size-11 items-center justify-center rounded-full border-[1.5px] bg-surface-raised text-foreground-muted',
        rssiBars(point.rssi) <= 1 ? 'border-warning/60' : 'border-[#5b9dff]/55',
        isSelected && 'border-primary ring-5 ring-primary/18',
      )}
    >
      <AppIcon id="bluetooth" size={18} />
    </span>
  );
}

/**
 * The label under a point.
 *
 * @param props - The point, and the house's devices for how many hear it.
 * @param props.point - It.
 * @param props.devices - The house's devices.
 * @returns The label.
 */
function PointLabel(props: {
  readonly point: BluetoothPoint;
  readonly devices: readonly BluetoothDevice[];
}) {
  const { t } = useTranslation();
  const { point } = props;
  const device = props.devices.find((each) => each.address === point.id);
  const others = Math.max(0, (device?.heardBy.length ?? 0) - 1);
  const dbm =
    point.rssi === null ? '' : t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi: point.rssi });

  return (
    <MapLabel
      label={
        point.kind === 'server'
          ? {
              name: point.name,
              line: t('brokers.bluetooth.map.thisServer', 'This server'),
              tone: 'text-[#5b9dff]',
              isStrong: true,
            }
          : point.kind === 'adapter'
            ? {
                name: point.name,
                line: t('brokers.bluetooth.map.adapter', 'Local adapter'),
                tone: 'text-[#5b9dff]',
                isStrong: true,
              }
            : point.kind === 'proxy'
              ? {
                  name: point.name,
                  line: t('brokers.bluetooth.map.proxy', 'Proxy'),
                  tone: point.isOnline ? 'text-cyan' : 'text-warning',
                  isStrong: true,
                }
              : {
                  name: point.name,
                  line:
                    device?.link === 'connected'
                      ? t('brokers.bluetooth.map.connectedAt', 'Connected · {{dbm}}', { dbm })
                      : others === 0
                        ? dbm
                        : `${dbm} · +${String(others)}`,
                  tone: rssiBars(point.rssi) <= 1 ? 'text-warning' : 'text-foreground-subtle',
                  isStrong: false,
                }
      }
    />
  );
}

/**
 * The selected device: who hears it, how loud, and where a proxy would help.
 *
 * @param props - The device, its room, and what the panel does.
 * @param props.device - It.
 * @param props.room - Its room.
 * @param props.onClose - Closes the panel.
 * @param props.onAddProxy - Opens Add proxy; absent when the person may not.
 * @returns The panel.
 */
function DevicePanel(props: {
  readonly device: BluetoothDevice;
  readonly room: string | null;
  readonly onClose: () => void;
  readonly onAddProxy?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { device, room } = props;
  const [best] = device.heardBy;
  const isWeak = rssiBars(best?.rssi ?? null) <= 1;

  return (
    <div className="flex flex-col gap-3.5 rounded-card border border-border-strong bg-surface-high p-4 shadow-[0_24px_50px_-16px_rgb(0_0_0/0.95)]">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
          <AppIcon id="bluetooth" size={16} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui font-medium text-foreground">{device.name}</span>
          <span className="truncate text-caption text-foreground-muted">
            {[device.address, room].filter(Boolean).join(' · ')}
          </span>
        </span>
        <IconButton label={t('common.close', 'Close')} onClick={props.onClose}>
          <AppIcon id="x" size={15} />
        </IconButton>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-label text-foreground-subtle uppercase">
          {t('brokers.bluetooth.heardBy', 'Heard by')}
        </span>
        {device.heardBy.map((hearing) => (
          <span key={hearing.scannerId} className="flex items-center gap-2 text-ui-sm">
            <span className="grow truncate text-foreground">{hearing.scannerName}</span>
            <SignalBars
              lit={rssiBars(hearing.rssi)}
              label={t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi: hearing.rssi })}
            />
            <span className="w-14 text-right font-mono text-mono-caption text-foreground-muted">
              {t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi: hearing.rssi })}
            </span>
          </span>
        ))}
        <span className="text-caption text-foreground-subtle">
          {device.heardBy.length <= 1
            ? t('brokers.bluetooth.map.nobodyElse', 'Nobody else hears it')
            : t('brokers.bluetooth.map.othersHear', '{{count}} scanners hear it', {
                count: device.heardBy.length,
              })}
          {device.lastHeardAt === null ? '' : ` · ${relativeTime(device.lastHeardAt)}`}
        </span>
      </div>
      {isWeak ? (
        <Note tone="warning">
          {room === null
            ? t(
                'brokers.bluetooth.map.weakNote',
                'Weak: it may drop out. A proxy nearer it would hear it better.',
              )
            : t(
                'brokers.bluetooth.map.weakNoteRoom',
                'Weak: it may drop out. A proxy in the {{room}} would hear it better.',
                { room: room.toLowerCase() },
              )}
        </Note>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={devicePath(device.deviceId)}
          className="press inline-flex h-8 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised px-3 text-ui-sm font-medium text-foreground hover:bg-surface-high"
        >
          <AppIcon id="external-link" size={14} />
          {t('brokers.bluetooth.openDevice', 'Open device')}
        </Link>
        {isWeak && props.onAddProxy !== undefined ? (
          <Button variant="bare" size="compact" onClick={props.onAddProxy}>
            <AppIcon id="plus" size={14} />
            {t('brokers.bluetooth.addProxy', 'Add proxy')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
