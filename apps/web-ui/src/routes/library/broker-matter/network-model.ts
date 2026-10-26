/**
 * The Matter fabric's network as a map: what is drawn where, and how each link looks.
 *
 * The controller - the house - is the middle. Around it what the nodes reach the house through:
 * Wi-Fi access points, Thread routers that are not on this fabric (a HomePod, a Nest hub: border
 * routers, for a house that has no Thread radio of its own), and nodes on Ethernet. Around each,
 * the devices that go through it, then theirs - a Thread router's end devices - and a bridge's
 * devices behind it. That tree is laid out radially: each thing fans out away from the middle,
 * its devices around it. A link the tree does not use (a Thread mesh's other neighbours) is still
 * drawn. Nothing of it is kept: the map is worked out afresh from the fabric each time.
 */
import type { MatterNetwork, MatterNetworkLink, MatterNetworkNode } from '@nebulahome/contracts';

import type { MatterRow } from '@/routes/library/broker-matter/matter-rows';

/** The controller's id on the map. */
export const CONTROLLER_ID = 'controller';

/** How far the first ring is from the middle, and how far a device sits from what it hangs on. */
const FIRST_RING = 270;
const BRANCH = 195;
const BEHIND_BRIDGE = 160;

/** How far apart, in degrees, the devices hanging on one thing are spread. */
const FAN_STEP = 40;

/** How far a lone device turns from the way its parent faces, so a chain does not run straight. */
const BEND = 32;

/** How much wider than tall the map is laid out: it is drawn in a wide box. */
const WIDE = 1.5;

/** What a point on the map is. */
export type PointKind = 'controller' | 'access-point' | 'thread-router' | 'device';

/** How a link is drawn. */
export type LinkLook = 'controller' | 'wifi' | 'thread' | 'bridge' | 'offline';

/** The networks the map can show alone. */
export type NetworkFilter = 'all' | 'wifi' | 'thread';

/** One point on the map. */
export type MapPoint = {
  readonly id: string;
  readonly kind: PointKind;
  readonly network: MatterNetworkNode['network'];

  /** What the controller says of it; undefined for the controller and a device behind a bridge. */
  readonly point: MatterNetworkNode | undefined;

  /** The device of the house it is, for a device. */
  readonly row: MatterRow | undefined;
  readonly isOffline: boolean;
  readonly isBehindBridge: boolean;

  /** The link it hangs on, for how good it is. */
  readonly link: MatterNetworkLink | undefined;

  /** How many devices reach the house through it. */
  readonly through: number;

  /** For a router, what its devices say of the network: its name, channel and SSID. */
  readonly networkName: string | null;
  readonly channel: number | null;
  readonly ssid: string | null;

  /** Its centre. */
  readonly x: number;
  readonly y: number;
};

/** One link on the map. */
export type MapLink = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly look: LinkLook;
};

/** The map. */
export type NetworkMap = {
  readonly points: readonly MapPoint[];
  readonly links: readonly MapLink[];
};

/** A point while the tree is built, before it is laid out. */
type Branch = Omit<MapPoint, 'x' | 'y' | 'through' | 'networkName' | 'channel' | 'ssid'> & {
  readonly children: Branch[];
};

/**
 * The key a pair of points is known by, either way round.
 *
 * @param one - A point.
 * @param other - The other.
 * @returns The key.
 */
function pairKey(one: string, other: string): string {
  return one < other ? `${one}\n${other}` : `${other}\n${one}`;
}

/**
 * Builds the map.
 *
 * @param network - The fabric's network, as the controller works it out.
 * @param rows - The fabric's devices as the Devices tab lists them, a bridge's behind it.
 * @param filter - Which network to show; `all` for every one.
 * @returns What is drawn, laid out round the middle.
 */
export function networkMapOf(
  network: MatterNetwork,
  rows: readonly MatterRow[],
  filter: NetworkFilter = 'all',
): NetworkMap {
  const byId = new Map(network.nodes.map((point) => [point.id, point]));
  const rowOf = new Map<string, MatterRow>();

  for (const row of rows) {
    if (!rowOf.has(row.node.nodeId)) {
      rowOf.set(row.node.nodeId, row);
    }
  }

  const neighbours = new Map<string, { id: string; link: MatterNetworkLink }[]>();
  const linkOf = new Map<string, MatterNetworkLink>();

  for (const link of network.links) {
    if (!byId.has(link.source) || !byId.has(link.target)) {
      continue;
    }

    linkOf.set(pairKey(link.source, link.target), link);
    neighbours.set(link.source, [
      ...(neighbours.get(link.source) ?? []),
      { id: link.target, link },
    ]);
    neighbours.set(link.target, [
      ...(neighbours.get(link.target) ?? []),
      { id: link.source, link },
    ]);
  }

  /**
   * Whether a point is on the network shown.
   *
   * @param point - The point.
   * @returns True to draw it.
   */
  const isKept = (point: MatterNetworkNode): boolean =>
    filter === 'all' || point.network === filter;

  /**
   * A point of the controller's, as a branch of the tree.
   *
   * @param point - It.
   * @param link - The link it hangs on.
   * @returns The branch, with no children yet.
   */
  const branchOf = (point: MatterNetworkNode, link: MatterNetworkLink | undefined): Branch => {
    const row = point.nodeId === null ? undefined : rowOf.get(point.nodeId);

    return {
      id: point.id,
      kind:
        point.kind === 'wifi_ap'
          ? 'access-point'
          : point.kind === 'matter'
            ? 'device'
            : 'thread-router',
      network: point.network,
      point,
      row,
      isOffline: point.isAvailable === false,
      isBehindBridge: false,
      link,
      children: (row?.children ?? []).map((child): Branch => ({
        id: `${point.id}:${String(child.device.identity.endpoint)}`,
        kind: 'device',
        network: point.network,
        point: undefined,
        row: child,
        isOffline: point.isAvailable === false,
        isBehindBridge: true,
        link: undefined,
        children: [],
      })),
    };
  };

  // What hangs on the controller itself: access points, Thread routers of other fabrics, and
  // whatever reaches the house no other way the controller knows of.
  const kept = network.nodes.filter(isKept);
  const placed = new Set<string>();
  const roots: Branch[] = [];
  const queue: Branch[] = [];

  /**
   * Hangs a point on the controller.
   *
   * @param point - It.
   */
  const hangOnController = (point: MatterNetworkNode): void => {
    const branch = branchOf(point, undefined);

    placed.add(point.id);
    roots.push(branch);
    queue.push(branch);
  };

  for (const point of kept) {
    if (point.kind !== 'matter') {
      hangOnController(point);
    }
  }

  /** Walks out from what is placed, each point taking the neighbours nobody took yet. */
  const walk = (): void => {
    for (let branch = queue.shift(); branch !== undefined; branch = queue.shift()) {
      for (const next of neighbours.get(branch.id) ?? []) {
        const point = byId.get(next.id);

        if (point === undefined || placed.has(next.id) || !isKept(point)) {
          continue;
        }

        const child = branchOf(point, next.link);

        placed.add(next.id);
        branch.children.push(child);
        queue.push(child);
      }
    }
  };

  walk();

  // A Thread mesh no outside router was heard on hangs on its leader; anything still left - a
  // node on Ethernet, one whose tables are empty - straight on the controller.
  /**
   * The points nothing took yet.
   *
   * @returns Them.
   */
  const leftOver = (): MatterNetworkNode[] => kept.filter((point) => !placed.has(point.id));
  /**
   * Which of a mesh's points it hangs on first: its leader, then a router, then anything.
   *
   * @param point - A point.
   * @returns Its rank, lowest first.
   */
  const ranked = (point: MatterNetworkNode): number =>
    point.role === 'leader' ? 0 : point.role === 'router' ? 1 : 2;

  for (let rest = leftOver(); rest.length > 0; rest = leftOver()) {
    const [first] = [...rest].sort((one, other) => ranked(one) - ranked(other));

    if (first === undefined) {
      break;
    }

    hangOnController(first);
    walk();
  }

  // Laid out: the first ring shares the circle by how much hangs on each; the rest fan out.
  const points: MapPoint[] = [];
  const links: MapLink[] = [];
  const treeLinks = new Set<string>();
  /**
   * How many points end a branch: what its share of the circle is weighed by.
   *
   * @param branch - The branch.
   * @returns The count; one for a point nothing hangs on.
   */
  const leavesOf = (branch: Branch): number =>
    branch.children.length === 0
      ? 1
      : branch.children.reduce((sum, child) => sum + leavesOf(child), 0);
  /**
   * How many devices reach the house through a point.
   *
   * @param branch - The point.
   * @returns The count.
   */
  const devicesUnder = (branch: Branch): number =>
    branch.children.reduce(
      (sum, child) => sum + (child.kind === 'device' ? 1 : 0) + devicesUnder(child),
      0,
    );

  /**
   * What a router's devices say of the network it carries.
   *
   * @param branch - The router.
   * @returns The first name, channel and SSID one of its devices reports.
   */
  const aboutOf = (branch: Branch): Pick<MapPoint, 'networkName' | 'channel' | 'ssid'> => {
    const own = branch.point;

    if (branch.kind === 'device') {
      return {
        networkName: own?.networkName ?? null,
        channel: own?.channel ?? null,
        ssid: own?.ssid ?? null,
      };
    }

    const heard = branch.children.flatMap((child) =>
      child.point === undefined ? [] : [child.point],
    );

    return {
      networkName:
        own?.networkName ?? heard.find((each) => each.networkName !== null)?.networkName ?? null,
      channel: heard.find((each) => each.channel !== null)?.channel ?? null,
      ssid: heard.find((each) => each.ssid !== null)?.ssid ?? null,
    };
  };

  /**
   * How a link to a point looks.
   *
   * @param branch - The point the link goes to.
   * @param isFromController - Whether it comes from the controller.
   * @returns The look.
   */
  const lookOf = (branch: Branch, isFromController: boolean): LinkLook => {
    if (branch.isOffline) {
      return 'offline';
    }

    if (branch.isBehindBridge) {
      return 'bridge';
    }

    if (isFromController) {
      return 'controller';
    }

    return branch.network === 'wifi' ? 'wifi' : 'thread';
  };

  /**
   * Places a branch and what hangs on it.
   *
   * @param branch - It.
   * @param parent - What it hangs on.
   * @param x - Its centre.
   * @param y - Its centre.
   * @param angle - The way out from the middle, in degrees.
   * @param sector - How wide a fan it may take, in degrees.
   */
  const place = (
    branch: Branch,
    parent: string,
    x: number,
    y: number,
    angle: number,
    sector: number,
  ): void => {
    points.push({
      ...branch,
      through: devicesUnder(branch),
      ...aboutOf(branch),
      x: x * WIDE,
      y,
    });
    links.push({
      id: `${parent}->${branch.id}`,
      source: parent,
      target: branch.id,
      look: lookOf(branch, parent === CONTROLLER_ID),
    });
    treeLinks.add(pairKey(parent, branch.id));

    const count = branch.children.length;
    const spread = Math.min(sector, (count - 1) * FAN_STEP);
    const distance = branch.children.every((child) => child.isBehindBridge)
      ? BEHIND_BRIDGE
      : Math.max(BRANCH, count * 34);

    branch.children.forEach((child, index) => {
      const childAngle =
        count === 1 ? angle + BEND : angle - spread / 2 + (spread * index) / (count - 1);
      const radians = (childAngle * Math.PI) / 180;

      place(
        child,
        branch.id,
        x + Math.cos(radians) * distance,
        y + Math.sin(radians) * distance,
        childAngle,
        Math.max(spread / Math.max(count, 1), 50),
      );
    });
  };

  const total = roots.reduce((sum, root) => sum + leavesOf(root), 0);
  const [first] = roots;

  // The first branch faces left, the way the box is widest; the others follow round.
  let start = 180 - (first === undefined ? 0 : (180 * leavesOf(first)) / Math.max(total, 1));

  for (const root of roots) {
    const sector = (360 * leavesOf(root)) / Math.max(total, 1);
    const angle = start + sector / 2;
    const radians = (angle * Math.PI) / 180;

    place(
      root,
      CONTROLLER_ID,
      Math.cos(radians) * FIRST_RING,
      Math.sin(radians) * FIRST_RING,
      angle,
      Math.min(sector, 160),
    );
    start += sector;
  }

  // The mesh's other links: two routers that hear each other, a device heard by two.
  const shown = new Set(points.map((point) => point.id));

  for (const link of network.links) {
    const key = pairKey(link.source, link.target);

    if (treeLinks.has(key) || !shown.has(link.source) || !shown.has(link.target)) {
      continue;
    }

    treeLinks.add(key);
    links.push({
      id: `${link.source}--${link.target}`,
      source: link.source,
      target: link.target,
      look:
        byId.get(link.source)?.isAvailable === false || byId.get(link.target)?.isAvailable === false
          ? 'offline'
          : link.network,
    });
  }

  return {
    points: [
      {
        id: CONTROLLER_ID,
        kind: 'controller',
        network: 'unknown',
        point: undefined,
        row: undefined,
        isOffline: false,
        isBehindBridge: false,
        link: undefined,
        through: points.filter((point) => point.kind === 'device').length,
        networkName: null,
        channel: null,
        ssid: null,
        x: 0,
        y: 0,
      },
      ...points,
    ],
    links,
  };
}
