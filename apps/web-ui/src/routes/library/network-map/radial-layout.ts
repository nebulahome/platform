/**
 * A tree laid out round a middle, as the network maps draw one.
 *
 * The middle is at the origin. What hangs on it shares the first ring, each branch taking a slice
 * of the circle as wide as how much ends under it, the first facing left, the way the map's box
 * is widest; what hangs on a branch fans out away from the middle, around it; a lone child turns
 * a little from the way its parent faces, so a chain does not run straight. The Matter, Bluetooth
 * and Thread maps lay out their own trees with it.
 */

/** One branch of the tree: an id, and what hangs on it. */
export type RadialBranch<TBranch> = {
  readonly id: string;
  readonly children: readonly TBranch[];
};

/** A branch where the layout put it. */
export type PlacedBranch<TBranch> = {
  readonly branch: TBranch;

  /** What it hangs on: the middle's id, or a branch's. */
  readonly parent: string;

  /** Its centre. */
  readonly x: number;
  readonly y: number;
};

/** How the tree is spread. */
export type RadialOptions<TBranch> = {
  /** How far the first ring is from the middle. */
  readonly firstRing: number;

  /** How far a branch's children sit from it. */
  readonly distanceOf: (branch: TBranch) => number;

  /** How much wider than tall the map is laid out; 1.5 when not said. */
  readonly wide?: number;
};

/** How far apart, in degrees, the children of one branch are spread. */
const FAN_STEP = 40;

/** How far a lone child turns from the way its parent faces. */
const BEND = 32;

/**
 * Lays a tree out round the middle.
 *
 * @param roots - What hangs on the middle.
 * @param middle - The middle's id, which the roots hang on.
 * @param options - See {@link RadialOptions}.
 * @returns Every branch where it goes, each before what hangs on it.
 */
export function radialLayout<TBranch extends RadialBranch<TBranch>>(
  roots: readonly TBranch[],
  middle: string,
  options: RadialOptions<TBranch>,
): PlacedBranch<TBranch>[] {
  const { firstRing, distanceOf, wide = 1.5 } = options;
  const placed: PlacedBranch<TBranch>[] = [];

  /**
   * How many points end a branch: what its share of the circle is weighed by.
   *
   * @param branch - The branch.
   * @returns The count; one for a point nothing hangs on.
   */
  const leavesOf = (branch: TBranch): number =>
    branch.children.length === 0
      ? 1
      : branch.children.reduce((sum, child) => sum + leavesOf(child), 0);

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
    branch: TBranch,
    parent: string,
    x: number,
    y: number,
    angle: number,
    sector: number,
  ): void => {
    placed.push({ branch, parent, x: x * wide, y });

    const count = branch.children.length;
    const spread = Math.min(sector, (count - 1) * FAN_STEP);
    const distance = distanceOf(branch);

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
      middle,
      Math.cos(radians) * firstRing,
      Math.sin(radians) * firstRing,
      angle,
      Math.min(sector, 160),
    );
    start += sector;
  }

  return placed;
}
