/**
 * Which entities of two ways into one device read the same thing.
 *
 * Linking a device links its readings, in three passes, each taking only what the one before left:
 *
 * 1. **Declared.** An entity whose bundle says where its reading sits in Matter is linked to the
 *    Matter entity that sits there, whatever it is - a relay as much as a meter.
 * 2. **Alike, one each.** A sensor is linked to the one sensor of the other way that reads the
 *    same thing - the same domain, capabilities, class, unit and accumulation - when each is the
 *    only one of its kind on its side.
 * 3. **Alike, told apart by what they read.** When several sensors of a kind are on both sides, a
 *    pair is linked only when what they read now tells them apart clearly. Never a control: two
 *    relays that both read "off" are not told apart, and a wrong guess switches the wrong one.
 *
 * What is left alike but unlinked - and what the owner unlinked, which no pass links again - is
 * what the device's Sensors list suggests linking by hand.
 */
import type { LinkOrigin, MatterReference } from '@nebulahome/contracts';

/** One entity, as linking compares it. */
export type MatchEntity = {
  readonly rowId: string;
  readonly entityId: string;
  readonly domain: string;
  readonly capabilities: readonly string[];
  readonly deviceClass: string | null;
  readonly unit: string | null;
  readonly stateClass: string | null;

  /** Its own place in Matter, for a Matter entity; for another, its Matter twin's. */
  readonly matter: MatterReference | null;

  /** Whether it is reached through Matter. */
  readonly isMatter: boolean;

  /** What it reads now, for a numeric sensor that has said. */
  readonly value: number | null;
};

/** Two entities that read the same thing. */
export type MatchedPair = {
  readonly a: MatchEntity;
  readonly b: MatchEntity;
  readonly origin: Exclude<LinkOrigin, 'manual'>;
};

/** What linking finds. */
export type MatchResult = {
  readonly pairs: readonly MatchedPair[];

  /** Pairs alike and left unlinked, to suggest. */
  readonly suggested: readonly (readonly [MatchEntity, MatchEntity])[];
};

/** How much two readings must differ, at least, to tell two pairs apart. */
const CLEAR_RATIO = 0.2;
const CLEAR_ABSOLUTE = 1;

/**
 * Whether an entity only reads: a sensor, which a wrong link cannot make do anything.
 *
 * @param entity - The entity.
 * @returns True for one whose every capability is a sensor's.
 */
export function isSensor(entity: MatchEntity): boolean {
  return (
    entity.capabilities.length > 0 &&
    entity.capabilities.every((capability) => capability.startsWith('sensor_'))
  );
}

/**
 * What an entity reads, in words two entities read alike share.
 *
 * @param entity - The entity.
 * @returns Its signature.
 */
export function signatureOf(entity: MatchEntity): string {
  return [
    entity.domain,
    [...entity.capabilities].sort().join('+'),
    entity.deviceClass ?? '',
    entity.unit ?? '',
    entity.stateClass ?? '',
  ].join('|');
}

/**
 * Whether two places in Matter are the same.
 *
 * @param a - One.
 * @param b - The other.
 * @returns True when the endpoint, the cluster and the attribute agree.
 */
function samePlace(a: MatterReference, b: MatterReference): boolean {
  return a.endpoint === b.endpoint && a.cluster === b.cluster && a.attribute === b.attribute;
}

/**
 * Whether two readings differ clearly.
 *
 * @param a - One.
 * @param b - The other.
 * @returns True when they are far enough apart, as numbers go, to tell apart.
 */
function differClearly(a: number, b: number): boolean {
  const gap = Math.abs(a - b);

  return gap >= CLEAR_ABSOLUTE && gap >= CLEAR_RATIO * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * Pairs several alike sensors of one side with those of the other by what they read, when every
 * pairing is clear: each one's nearest on the other side is unambiguous both ways.
 *
 * @param left - One side's sensors of a kind.
 * @param right - The other side's.
 * @returns The pairs; none when any one of them is unclear.
 */
function pairByValue(
  left: readonly MatchEntity[],
  right: readonly MatchEntity[],
): [MatchEntity, MatchEntity][] {
  if (left.length !== right.length || left.some((each) => each.value === null)) {
    return [];
  }

  if (right.some((each) => each.value === null)) {
    return [];
  }

  const pairs: [MatchEntity, MatchEntity][] = [];

  for (const one of left) {
    const sorted = [...right].sort(
      (x, y) =>
        Math.abs((x.value ?? 0) - (one.value ?? 0)) - Math.abs((y.value ?? 0) - (one.value ?? 0)),
    );
    const [nearest, next] = sorted;

    if (nearest === undefined) {
      return [];
    }

    // The nearest must be clearly nearer than the next one, or the two are not told apart.
    if (next !== undefined && !differClearly(nearest.value ?? 0, next.value ?? 0)) {
      return [];
    }

    pairs.push([one, nearest]);
  }

  return new Set(pairs.map(([, other]) => other.rowId)).size === pairs.length ? pairs : [];
}

/**
 * Finds which entities of one way into a device read what the other's do.
 *
 * @param left - The entities of one way in, not linked yet.
 * @param right - Those of the other.
 * @param refused - Pairs of rows the owner unlinked, which are never linked again.
 * @returns The pairs, and what to suggest.
 */
export function matchEntities(
  left: readonly MatchEntity[],
  right: readonly MatchEntity[],
  refused: readonly (readonly [string, string])[] = [],
): MatchResult {
  /**
   * Whether the owner unlinked two entities.
   *
   * @param a - One.
   * @param b - The other.
   * @returns True when they were unlinked by hand.
   */
  const isRefused = (a: MatchEntity, b: MatchEntity): boolean =>
    refused.some(([x, y]) => (x === a.rowId && y === b.rowId) || (x === b.rowId && y === a.rowId));
  const taken = new Set<string>();
  const pairs: MatchedPair[] = [];

  /**
   * Links two entities, once each.
   *
   * @param a - One.
   * @param b - The other.
   * @param origin - How.
   */
  const take = (a: MatchEntity, b: MatchEntity, origin: MatchedPair['origin']): void => {
    taken.add(a.rowId);
    taken.add(b.rowId);
    pairs.push({ a, b, origin });
  };

  // 1. Declared: where one side's bundle says the reading sits in Matter, and the other sits there.
  for (const a of left) {
    for (const b of right) {
      if (
        taken.has(a.rowId) ||
        taken.has(b.rowId) ||
        isRefused(a, b) ||
        a.isMatter === b.isMatter
      ) {
        continue;
      }

      const matter = a.isMatter ? b.matter : a.matter;
      const own = a.isMatter ? a.matter : b.matter;

      if (matter !== null && own !== null && samePlace(matter, own) && a.domain === b.domain) {
        take(a, b, 'declared');
      }
    }
  }

  // 2 and 3. Alike: sensors only, by kind.
  const kinds = new Map<string, { left: MatchEntity[]; right: MatchEntity[] }>();

  for (const [side, entities] of [
    ['left', left],
    ['right', right],
  ] as const) {
    for (const entity of entities) {
      if (taken.has(entity.rowId)) {
        continue;
      }

      const kind = kinds.get(signatureOf(entity)) ?? { left: [], right: [] };

      kind[side].push(entity);
      kinds.set(signatureOf(entity), kind);
    }
  }

  const suggested: [MatchEntity, MatchEntity][] = [];

  for (const kind of kinds.values()) {
    const [first] = kind.left;
    const [other] = kind.right;

    if (first === undefined || other === undefined) {
      continue;
    }

    const isSensors = isSensor(first);
    /**
     * Whether two entities may be linked on their own.
     *
     * @param a - One.
     * @param b - The other.
     * @returns True unless the owner unlinked them.
     */
    const free = (a: MatchEntity, b: MatchEntity): boolean => !isRefused(a, b);

    if (isSensors && kind.left.length === 1 && kind.right.length === 1 && free(first, other)) {
      take(first, other, 'auto');
      continue;
    }

    const byValue = isSensors ? pairByValue(kind.left, kind.right) : [];

    if (byValue.length > 0 && byValue.every(([a, b]) => free(a, b))) {
      for (const [a, b] of byValue) {
        take(a, b, 'auto');
      }

      continue;
    }

    // What the owner unlinked is not offered again either.
    for (const a of kind.left) {
      for (const b of kind.right) {
        if (free(a, b)) {
          suggested.push([a, b]);
        }
      }
    }
  }

  return { pairs, suggested };
}
