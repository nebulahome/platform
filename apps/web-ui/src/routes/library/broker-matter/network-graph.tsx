/**
 * The Matter broker's Network tab: the fabric as a map to move around.
 *
 * Nebula Home in the middle; around it the Wi-Fi access points and the Thread routers its nodes
 * reach the house through, each a rounded square in its network's colour; around those the
 * devices, round, with their icon and name - a device that is also a Thread router carries a
 * badge - and a bridge's devices behind it on dotted links. Links are straight and coloured by
 * the network, Wi-Fi cyan and Thread magenta, dashed red to a device that does not answer.
 *
 * Every point can be dragged, and the map zoomed and fitted; nothing of it is kept, so a page
 * opened again lays it out afresh. Hovering a point - or focusing it, or clicking it, which keeps
 * it open - shows a card: a device's (its name opens its page) with its MAC, last call,
 * transport and role, link quality and node; a router's with its network and channel and how many
 * devices go through it, saying that it is not a Matter device and so shares no more.
 */
import '@xyflow/react/dist/base.css';

import {
  Background,
  BackgroundVariant,
  Handle,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { MatterNetwork } from '@nebulahome/contracts';
import { AppIcon, cn, IconButton, Pill, Segmented, type UiIconId } from '@nebulahome/ui';

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

/** How long a card stays once the pointer left, for it to reach the card. */
const CARD_GRACE_MS = 160;

/** How long after another network is shown the map is fitted to it: its points measured. */
const FIT_AFTER_MS = 60;

/** How each link is drawn. */
const LINK_STYLES: Record<LinkLook, CSSProperties> = {
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

/** Where the links meet a point: its centre, unseen and not to be dragged from. */
const HANDLE =
  'top-1/2! left-1/2! size-px! min-h-0! min-w-0! -translate-1/2! border-0! opacity-0! pointer-events-none!';

/** A point, as the map holds it. */
type PointNode = Node<{ readonly point: MapPoint; readonly icons: DeviceIcons }, 'point'>;

/** Which point's card is open on hover, and how a point opens and closes it. */
type CardControl = {
  readonly hovered: string | null;
  readonly show: (id: string) => void;
  readonly hide: () => void;
};

/** No card at all, outside a map. */
const NO_CARD: CardControl = {
  hovered: null,

  /**
   * Opens nothing.
   *
   * @returns Nothing.
   */
  show: () => undefined,

  /**
   * Closes nothing.
   *
   * @returns Nothing.
   */
  hide: () => undefined,
};

const CardContext = createContext<CardControl>(NO_CARD);

/** The map's one kind of point, drawn by what it is. */
const NODE_TYPES = { point: MapPointNode };

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
  return (
    <ReactFlowProvider>
      <NetworkMapView {...props} />
    </ReactFlowProvider>
  );
}

/**
 * The tab, inside the map's provider.
 *
 * @param props - See {@link NetworkGraphProps}.
 * @returns The filter, the map and its controls.
 */
function NetworkMapView(props: NetworkGraphProps) {
  const { t } = useTranslation();
  const { network, rows, icons } = props;
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const [filter, setFilter] = useState<NetworkFilter>('all');
  const map = useMemo(
    () => networkMapOf(network ?? { collectedAt: null, nodes: [], links: [] }, rows, filter),
    [network, rows, filter],
  );

  /**
   * The map's points, where they were dragged to kept, the new ones where the layout puts them.
   *
   * @param before - The points as they are.
   * @returns The points.
   */
  const pointsOf = (before: readonly PointNode[]): PointNode[] => {
    const was = new Map(before.map((node) => [node.id, node]));

    return map.points.map((point) => ({
      id: point.id,
      type: 'point',
      position: was.get(point.id)?.position ?? { x: point.x, y: point.y },
      selected: was.get(point.id)?.selected ?? false,
      data: { point, icons },
    }));
  };

  const [nodes, setNodes, onNodesChange] = useNodesState<PointNode>(pointsOf([]));

  useEffect(() => {
    setNodes(pointsOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- laid out again when the map changes
  }, [map, icons, setNodes]);

  // Another network shown: the map is fitted to it once its points are the ones drawn, and they
  // have been measured - a moment later.
  const fitted = useRef(filter);

  useEffect(() => {
    const isDrawn =
      nodes.length === map.points.length &&
      nodes.every((node, index) => node.id === map.points[index]?.id);

    if (fitted.current === filter || !isDrawn) {
      return;
    }

    fitted.current = filter;
    setTimeout(() => {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 300 });
    }, FIT_AFTER_MS);
  }, [nodes, map, filter, fitView]);

  const edges = useMemo(
    (): Edge[] =>
      map.links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        type: 'straight',
        style: LINK_STYLES[link.look],
        selectable: false,
        focusable: false,
      })),
    [map],
  );

  const [hovered, setHovered] = useState<string | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const card = useMemo(
    (): CardControl => ({
      hovered,

      /**
       * Opens a point's card.
       *
       * @param id - The point.
       */
      show: (id) => {
        clearTimeout(closing.current);
        setHovered(id);
      },

      /** Closes the card a moment later, unless the pointer reaches it. */
      hide: () => {
        clearTimeout(closing.current);
        closing.current = setTimeout(() => {
          setHovered(null);
        }, CARD_GRACE_MS);
      },
    }),
    [hovered],
  );

  useEffect(
    () => () => {
      clearTimeout(closing.current);
    },
    [],
  );

  const isEmpty = map.points.length <= 1;

  return (
    <div className="relative h-[min(680px,75vh)] overflow-hidden rounded-panel border border-border bg-canvas">
      <CardContext.Provider value={card}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeMouseEnter={(event, node) => {
            card.show(node.id);
          }}
          onNodeMouseLeave={() => {
            card.hide();
          }}
          nodeOrigin={[0.5, 0.5]}
          nodesConnectable={false}
          selectNodesOnDrag={false}
          edgesFocusable={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          aria-label={t('brokers.matter.map.label', 'The Matter network')}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.2}
            color="var(--color-border)"
            bgColor="var(--color-canvas)"
          />
        </ReactFlow>
      </CardContext.Provider>
      {isEmpty ? (
        <p className="pointer-events-none absolute inset-x-6 top-6 text-center text-ui text-foreground-subtle">
          {network === undefined
            ? t('brokers.matter.map.reading', 'Reading the network…')
            : t(
                'brokers.matter.map.empty',
                'No node has said how it is connected yet. Its routes show here once it does.',
              )}
        </p>
      ) : null}
      <Legend />
      <Segmented
        label={t('brokers.matter.show', 'Show')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('brokers.matter.map.all', 'All') },
          { value: 'wifi', label: t('brokers.matter.map.wifi', 'Wi-Fi') },
          { value: 'thread', label: t('brokers.matter.map.thread', 'Thread') },
        ]}
        className="absolute top-3.5 right-3.5 z-10 bg-surface/90 shadow-popover backdrop-blur-sm"
      />
      <div className="absolute right-3.5 bottom-3.5 flex flex-col gap-1 rounded-tile border border-border-strong bg-surface-raised p-1">
        <IconButton
          label={t('brokers.matter.map.zoomIn', 'Zoom in')}
          title={t('brokers.matter.map.zoomIn', 'Zoom in')}
          onClick={() => {
            void zoomIn({ duration: 200 });
          }}
        >
          <AppIcon id="plus" size={16} />
        </IconButton>
        <IconButton
          label={t('brokers.matter.map.zoomOut', 'Zoom out')}
          title={t('brokers.matter.map.zoomOut', 'Zoom out')}
          onClick={() => {
            void zoomOut({ duration: 200 });
          }}
        >
          <AppIcon id="minus" size={16} />
        </IconButton>
        <IconButton
          label={t('brokers.matter.map.fit', 'Fit')}
          title={t('brokers.matter.map.fit', 'Fit')}
          onClick={() => {
            void fitView({ padding: 0.2, maxZoom: 1, duration: 300 });
          }}
        >
          <AppIcon id="maximize" size={16} />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * What the links' colours and dashes mean.
 *
 * @returns The legend, at the map's foot.
 */
function Legend() {
  const { t } = useTranslation();
  const items: readonly { readonly look: LinkLook; readonly label: string }[] = [
    { look: 'wifi', label: t('brokers.matter.map.wifi', 'Wi-Fi') },
    { look: 'thread', label: t('brokers.matter.map.thread', 'Thread') },
    { look: 'bridge', label: t('brokers.matter.map.behindBridge', 'Behind a bridge') },
    { look: 'offline', label: t('brokers.matter.map.notAnswering', 'Not answering') },
  ];

  return (
    <ul className="absolute bottom-3.5 left-4 hidden flex-wrap items-center gap-x-4.5 gap-y-1 rounded-field border border-border bg-surface px-3 py-2 sm:flex">
      {items.map((item) => (
        <li key={item.look} className="flex items-center gap-2 text-caption text-foreground-muted">
          <svg aria-hidden="true" width="26" height="8" className="shrink-0">
            <line
              x1="1"
              y1="4"
              x2="25"
              y2="4"
              /* eslint-disable-next-line react/forbid-dom-props -- the link's own look. */
              style={{ ...LINK_STYLES[item.look], opacity: 1 }}
            />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
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
 * One point of the map, drawn by what it is, with its label under it and its card beside it.
 *
 * @param props - The point, and whether it is selected.
 * @returns The point.
 */
function MapPointNode(props: NodeProps<PointNode>) {
  const { data, selected, positionAbsoluteX } = props;
  const { point, icons } = data;
  const card = useContext(CardContext);
  const label = useLabel(point);
  const isOpen = point.kind !== 'controller' && (selected || card.hovered === point.id);

  // The card opens on the side with room: the map's box cuts off what passes its edge.
  const isOnRight = useStore(
    (state) => positionAbsoluteX * state.transform[2] + state.transform[0] > state.width / 2,
  );

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Top} isConnectable={false} className={HANDLE} />
      <PointShape point={point} icons={icons} isSelected={selected} />
      <span className="pointer-events-none absolute top-full left-1/2 mt-2 flex -translate-x-1/2 flex-col items-center rounded-[7px] bg-canvas/88 px-1.75 py-0.5 whitespace-nowrap">
        <span
          className={cn(
            'text-ui-sm text-foreground',
            point.kind === 'device' ? 'font-normal' : 'font-medium',
          )}
        >
          {label.name}
        </span>
        {label.line === '' ? null : (
          <span className={cn('text-label tracking-normal', label.tone)}>{label.line}</span>
        )}
      </span>
      <NodeToolbar
        isVisible={isOpen}
        position={isOnRight ? Position.Left : Position.Right}
        offset={18}
      >
        <div
          role="tooltip"
          className="flex w-75 flex-col gap-2.5 rounded-inner border border-border-strong bg-surface-high px-4 py-3.5 shadow-[0_24px_50px_-16px_rgb(0_0_0/0.95)]"
          onMouseEnter={() => {
            card.show(point.id);
          }}
          onMouseLeave={card.hide}
        >
          {point.kind === 'device' ? (
            <DeviceCard point={point} icons={icons} />
          ) : (
            <RouterCard point={point} name={label.name} />
          )}
        </div>
      </NodeToolbar>
    </div>
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
 * One line of a card.
 *
 * @param props - What it says.
 * @param props.label - The fact.
 * @param props.children - Its value.
 * @param props.isMuted - Whether the value is one the house does not have.
 * @returns The line.
 */
function CardRow(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly isMuted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 text-caption">
      <span className="text-foreground-muted">{props.label}</span>
      <span
        className={cn(
          'text-right font-mono',
          props.isMuted === true ? 'text-foreground-muted' : 'text-foreground',
        )}
      >
        {props.children}
      </span>
    </div>
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
 * @param props - The router and what it is called on the map.
 * @param props.point - It.
 * @param props.name - Its name.
 * @returns The card's content.
 */
function RouterCard(props: { readonly point: MapPoint; readonly name: string }) {
  const { t } = useTranslation();
  const { point, name } = props;
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
