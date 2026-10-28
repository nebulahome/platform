/**
 * The Thread broker's Network tab: the mesh, on the network maps' canvas and the radial layout the
 * Matter map uses.
 *
 * This server's border router in the middle, lit; the other border routers of the same network
 * on the first ring; the routers round it; each end device hung off its parent; the line coloured
 * by the link's quality (3 strong, 2 fair, 1 or 0 weak). The data is the border router's own view
 * of the mesh - the Thread broker's devices, unknown nodes too - rather than the Matter fabric's,
 * so a node the house does not have is on the map as well.
 */
import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ThreadBorderRouter, ThreadDevice } from '@nebulahome/contracts';
import { AppIcon, cn, Pill } from '@nebulahome/ui';

import { ThreadLogo } from '@/components/brand-logos';
import { relativeTime } from '@/lib/format-time';
import { devicePath } from '@/routes/library/device/device-path';
import { threadRoleName } from '@/routes/library/device/transport-facts';
import {
  CardRow,
  MapCanvas,
  MapLabel,
  type CanvasPoint,
} from '@/routes/library/network-map/map-canvas';
import { radialLayout } from '@/routes/library/network-map/radial-layout';

/** The middle of the map. */
const SELF_ID = 'border-router';

/** How a link is drawn. */
type ThreadLinkLook = 'border' | 'strong' | 'fair' | 'weak' | 'unknown';

/** How each link is drawn. */
const LINK_STYLES: Record<ThreadLinkLook, CSSProperties> = {
  border: {
    stroke: 'var(--color-thread)',
    strokeWidth: 1.5,
    opacity: 0.6,
    strokeDasharray: '5 5',
  },
  strong: { stroke: 'var(--color-thread)', strokeWidth: 2.4, opacity: 0.9 },
  fair: { stroke: 'var(--color-thread)', strokeWidth: 1.6, opacity: 0.5 },
  weak: { stroke: 'var(--color-warning)', strokeWidth: 1.6, opacity: 0.8 },
  unknown: { stroke: 'var(--color-foreground-subtle)', strokeWidth: 1.4, opacity: 0.6 },
};

/** One point of the mesh. */
export type ThreadPoint = CanvasPoint & {
  readonly kind: 'self' | 'border-router' | 'device';
  readonly name: string;
  readonly device: ThreadDevice | undefined;
  readonly borderRouter: ThreadBorderRouter | undefined;
};

/** A point while the tree is built. */
type Branch = Omit<ThreadPoint, 'x' | 'y'> & {
  readonly look: ThreadLinkLook;
  readonly children: Branch[];
};

/**
 * The look of a link of so much quality.
 *
 * @param quality - The link quality, 0 to 3; null when not known.
 * @returns The look.
 */
function lookOf(quality: number | null): ThreadLinkLook {
  return quality === null ? 'unknown' : quality >= 3 ? 'strong' : quality === 2 ? 'fair' : 'weak';
}

/**
 * Lays the mesh out round this server's border router.
 *
 * @param devices - The nodes the border router sees.
 * @param borderRouters - The border routers heard.
 * @returns The points and their links.
 */
export function threadMapOf(
  devices: readonly ThreadDevice[],
  borderRouters: readonly ThreadBorderRouter[],
): {
  readonly points: ThreadPoint[];
  readonly links: { id: string; source: string; target: string; look: ThreadLinkLook }[];
} {
  /**
   * A node and the end devices hung off it.
   *
   * @param device - The node.
   * @returns Its branch.
   */
  const branchOf = (device: ThreadDevice): Branch => ({
    id: device.extAddress,
    kind: 'device',
    name: device.name ?? device.extAddress,
    device,
    borderRouter: undefined,
    look: lookOf(device.linkQuality),
    children: devices
      .filter((each) => each.parentExtAddress === device.extAddress)
      .map((each) => branchOf(each)),
  });
  const known = new Set(devices.map((device) => device.extAddress));
  const roots: Branch[] = [
    ...borderRouters
      .filter((each) => each.isSameNetwork && !each.isThisServer)
      .map((each): Branch => ({
        id: `br:${each.id}`,
        kind: 'border-router',
        name: each.name,
        device: undefined,
        borderRouter: each,
        look: 'border',
        children: [],
      })),
    // Routers, and anything whose parent the border router does not list, hang on the middle.
    ...devices
      .filter((device) => device.parentExtAddress === null || !known.has(device.parentExtAddress))
      .map((device) => branchOf(device)),
  ];
  const self = borderRouters.find((each) => each.isThisServer);
  const laidOut = radialLayout(roots, SELF_ID, {
    firstRing: 300,

    /**
     * How far a router's end devices sit from it.
     *
     * @param branch - The router.
     * @returns The distance.
     */
    distanceOf: (branch) => Math.max(200, branch.children.length * 48),
  });

  return {
    points: [
      {
        id: SELF_ID,
        kind: 'self',
        name: self?.name ?? 'Border router',
        device: undefined,
        borderRouter: self,
        x: 0,
        y: 0,
      },
      ...laidOut.map(({ branch, x, y }) => ({
        id: branch.id,
        kind: branch.kind,
        name: branch.name,
        device: branch.device,
        borderRouter: branch.borderRouter,
        x,
        y,
      })),
    ],
    links: laidOut.map(({ branch, parent }) => ({
      id: `${parent}->${branch.id}`,
      source: parent,
      target: branch.id,
      look: branch.look,
    })),
  };
}

/** What the tab needs. */
export type ThreadNetworkViewProps = {
  readonly devices: readonly ThreadDevice[] | undefined;
  readonly borderRouters: readonly ThreadBorderRouter[];
  readonly roomOf: (areaId: string | null) => string | null;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link ThreadNetworkViewProps}.
 * @returns The map.
 */
export function ThreadNetworkView(props: ThreadNetworkViewProps) {
  const { t } = useTranslation();
  const laid = useMemo(
    () => threadMapOf(props.devices ?? [], props.borderRouters),
    [props.devices, props.borderRouters],
  );
  const links = useMemo(
    () => laid.links.map((link) => ({ ...link, style: LINK_STYLES[link.look] })),
    [laid],
  );

  return (
    <MapCanvas
      points={laid.points}
      links={links}
      layoutKey="thread"
      label={t('brokers.thread.map.label', 'The Thread mesh')}
      emptyText={
        props.devices === undefined
          ? t('brokers.thread.map.reading', 'Reading the mesh…')
          : t('brokers.thread.map.empty', 'No device on the network yet.')
      }
      shapeOf={(point, isSelected) => <PointShape point={point} isSelected={isSelected} />}
      labelOf={(point) => <PointLabel point={point} />}
      cardOf={(point) =>
        point.kind === 'self' ? null : <PointCard point={point} roomOf={props.roomOf} />
      }
      legend={[
        { label: t('brokers.thread.map.strong', 'Link quality 3'), style: LINK_STYLES.strong },
        { label: t('brokers.thread.map.fair', 'Link quality 2'), style: LINK_STYLES.fair },
        { label: t('brokers.thread.map.weak', 'Link quality 1 or 0'), style: LINK_STYLES.weak },
        {
          label: t('brokers.thread.map.otherBorder', 'Another border router'),
          style: LINK_STYLES.border,
        },
      ]}
    />
  );
}

/**
 * A point's shape: this border router's lit mark, another's square, a device's circle with a
 * router's badge.
 *
 * @param props - The point, and whether it is selected.
 * @param props.point - It.
 * @param props.isSelected - Whether it is selected.
 * @returns The shape.
 */
function PointShape(props: { readonly point: ThreadPoint; readonly isSelected: boolean }) {
  const { point, isSelected } = props;

  if (point.kind === 'self') {
    return (
      <span className="flex size-18 items-center justify-center rounded-panel border border-border-strong bg-surface-raised thread-glow shadow-[0_0_0_10px_color-mix(in_oklab,var(--color-thread)_7%,transparent),0_0_60px_color-mix(in_oklab,var(--color-thread)_25%,transparent)]">
        <ThreadLogo width={32} height={32} />
      </span>
    );
  }

  if (point.kind === 'border-router') {
    return (
      <span
        className={cn(
          'flex size-13 items-center justify-center rounded-card border-[1.5px] border-thread/70 bg-thread/14 text-thread ring-6 ring-thread/6',
          isSelected && 'outline-2 outline-offset-3 outline-primary',
        )}
      >
        <AppIcon id="router" size={22} />
      </span>
    );
  }

  const role = point.device?.role;
  const isRouter = role === 'router' || role === 'leader';

  return (
    <span
      className={cn(
        'relative flex size-11 items-center justify-center rounded-full border-[1.5px] bg-surface-raised',
        point.device?.deviceId === null
          ? 'border-warning/60 text-warning'
          : 'border-thread/60 text-foreground-muted',
        isSelected && 'border-primary ring-5 ring-primary/18',
      )}
    >
      <AppIcon id={point.device?.deviceId === null ? 'circle-dot' : 'waypoints'} size={18} />
      {isRouter ? (
        <span className="absolute -right-1.5 -bottom-1 flex size-5 items-center justify-center rounded-[7px] border-[1.5px] border-thread/80 bg-surface text-thread">
          <AppIcon id="router" size={11} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * The label under a point.
 *
 * @param props - The point.
 * @param props.point - It.
 * @returns The label.
 */
function PointLabel(props: { readonly point: ThreadPoint }) {
  const { t } = useTranslation();
  const { point } = props;

  return (
    <MapLabel
      label={
        point.kind === 'self'
          ? {
              name: t('brokers.thread.map.thisServer', 'This server'),
              line: t('brokers.thread.map.borderRouter', 'Border router'),
              tone: 'text-thread',
              isStrong: true,
            }
          : point.kind === 'border-router'
            ? {
                name: point.name,
                line:
                  point.borderRouter?.model ??
                  t('brokers.thread.map.borderRouter', 'Border router'),
                tone: 'text-thread',
                isStrong: true,
              }
            : {
                name:
                  point.device?.deviceId === null
                    ? t('brokers.thread.unknownNode', 'Unknown Thread node')
                    : point.name,
                line: point.device === undefined ? '' : threadRoleName(point.device.role),
                tone: point.device?.deviceId === null ? 'text-warning' : 'text-foreground-subtle',
                isStrong: false,
              }
      }
    />
  );
}

/**
 * A point's card: what it is on the mesh.
 *
 * @param props - The point and the rooms.
 * @param props.point - It.
 * @param props.roomOf - A room's name.
 * @returns The card's content.
 */
function PointCard(props: {
  readonly point: ThreadPoint;
  readonly roomOf: (areaId: string | null) => string | null;
}) {
  const { t } = useTranslation();
  const { point } = props;
  const device = point.device;
  const router = point.borderRouter;

  if (router !== undefined) {
    return (
      <>
        <span className="flex flex-col gap-px">
          <span className="text-ui font-medium text-foreground">{router.name}</span>
          <span className="text-caption text-thread">
            {[router.vendor, router.model].filter(Boolean).join(' · ')}
          </span>
        </span>
        <div className="flex flex-col gap-1.75 border-t border-border pt-2.5">
          <CardRow label={t('brokers.thread.network', 'Network')}>
            {router.networkName ?? '—'}
          </CardRow>
          <CardRow label={t('brokers.thread.address', 'Address')}>{router.address ?? '—'}</CardRow>
        </div>
      </>
    );
  }

  if (device === undefined) {
    return null;
  }

  return (
    <>
      <span className="flex items-center gap-2.5">
        <span className="flex min-w-0 grow flex-col gap-px">
          {device.deviceId === null ? (
            <span className="text-ui font-medium text-foreground">
              {t('brokers.thread.unknownNode', 'Unknown Thread node')}
            </span>
          ) : (
            <Link
              to={devicePath(device.deviceId)}
              className="inline-flex items-center gap-1.5 text-ui font-medium text-foreground hover:text-primary"
            >
              {device.name}
              <AppIcon id="external-link" size={13} className="text-primary" />
            </Link>
          )}
          <span className="text-caption text-foreground-muted">
            {props.roomOf(device.areaId) ?? device.extAddress}
          </span>
        </span>
        <Pill>{threadRoleName(device.role)}</Pill>
      </span>
      <div className="flex flex-col gap-1.75 border-t border-border pt-2.5">
        <CardRow label={t('brokers.thread.parent', 'Parent')} isMuted={device.parentName === null}>
          {device.parentName ?? '—'}
        </CardRow>
        <CardRow label={t('brokers.thread.link', 'Link')} isMuted={device.linkQuality === null}>
          {device.linkQuality === null
            ? '—'
            : t('brokers.thread.linkOf', '{{quality}} of 3', { quality: device.linkQuality })}
        </CardRow>
        <CardRow label={t('brokers.thread.extAddress', 'Extended address')}>
          {device.extAddress}
        </CardRow>
        <CardRow
          label={t('brokers.thread.lastSeen', 'Last seen')}
          isMuted={device.lastSeenAt === null}
        >
          {device.lastSeenAt === null ? '—' : relativeTime(device.lastSeenAt)}
        </CardRow>
      </div>
    </>
  );
}
