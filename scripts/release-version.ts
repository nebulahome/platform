/**
 * The next release's version, from the tags already made (docs/releases-and-updates.md 3).
 *
 * CalVer `YYYY.M.N`, the month without a leading zero, `N` from 0 each month; a dev build is
 * `YYYY.M.N-alpha.K`, a beta `YYYY.M.N-beta.K` (SemVer orders alpha < beta < release). A version is
 * open while it has no stable tag yet: the next build of its channel goes on counting it, a later
 * channel promotes it, and an earlier channel - an alpha after a beta - starts the next version,
 * since it would sort below what is out. Pure: the tags and the day come in.
 */

/** Which kind of release. */
export type Channel = 'dev' | 'beta' | 'stable';

/** A prerelease's kind, in SemVer's order. */
type Stage = 'alpha' | 'beta';

/** A release tag, read. */
type Release = {
  readonly year: number;
  readonly month: number;
  readonly patch: number;

  /** The prerelease, or null for a stable release. */
  readonly pre: { readonly stage: Stage; readonly number: number } | null;
};

/** `v2026.11.0`, `v2026.11.0-beta.1`, `v2026.11.0-alpha.3`; other tags (the SDKs') are not ours. */
const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/;

/** Each channel's prerelease stage; stable has none. */
const STAGE: Readonly<Record<Channel, Stage | null>> = { dev: 'alpha', beta: 'beta', stable: null };

/** Where a release sorts within its version: alpha, then beta, then the release. */
const RANK: Readonly<Record<Stage | 'release', number>> = { alpha: 0, beta: 1, release: 2 };

/**
 * Reads one tag.
 *
 * @param tag - The tag.
 * @returns The release, or null when it is not a product release tag.
 */
function parse(tag: string): Release | null {
  const match = TAG.exec(tag.trim());

  if (match === null) {
    return null;
  }

  const [, year, month, patch, stage, number] = match;

  return {
    year: Number(year),
    month: Number(month),
    patch: Number(patch),
    pre:
      stage === undefined
        ? null
        : { stage: stage === 'alpha' ? 'alpha' : 'beta', number: Number(number) },
  };
}

/**
 * Orders two releases: by version, then alpha, beta, release.
 *
 * @param left - One.
 * @param right - The other.
 * @returns Negative, zero or positive.
 */
function compare(left: Release, right: Release): number {
  return (
    left.year - right.year ||
    left.month - right.month ||
    left.patch - right.patch ||
    RANK[left.pre?.stage ?? 'release'] - RANK[right.pre?.stage ?? 'release'] ||
    (left.pre?.number ?? 0) - (right.pre?.number ?? 0)
  );
}

/**
 * Writes a version without its `v`.
 *
 * @param release - The release.
 * @returns `2026.11.0` or `2026.11.0-beta.1`.
 */
function format(release: Release): string {
  const base = `${String(release.year)}.${String(release.month)}.${String(release.patch)}`;

  return release.pre === null ? base : `${base}-${release.pre.stage}.${String(release.pre.number)}`;
}

/**
 * The next version after every tag: this month's next patch, or the month's first.
 *
 * @param releases - Every release.
 * @param today - The day.
 * @param stage - The prerelease it starts as, or null.
 * @returns It.
 */
function nextOf(releases: readonly Release[], today: Date, stage: Stage | null): Release {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const thisMonth = releases.filter((release) => release.year === year && release.month === month);
  const patch = thisMonth.length === 0 ? 0 : Math.max(...thisMonth.map((r) => r.patch)) + 1;

  return { year, month, patch, pre: stage === null ? null : { stage, number: 1 } };
}

/**
 * Works out the next version.
 *
 * @param tags - Every tag of the repository.
 * @param channel - Dev, beta or stable.
 * @param today - The day of the release; its UTC year and month are used.
 * @returns The version, without the `v`.
 * @throws {Error} When the day is before the newest release, so the version would go backwards.
 */
export function nextVersion(tags: readonly string[], channel: Channel, today: Date): string {
  const releases = tags.map(parse).filter((release) => release !== null);
  const newest = releases.sort(compare).at(-1);
  const stage = STAGE[channel];
  const open = newest?.pre == null ? undefined : { ...newest, pre: newest.pre };

  if (open !== undefined) {
    if (stage === null) {
      return format({ ...open, pre: null });
    }

    if (stage === open.pre.stage) {
      return format({ ...open, pre: { stage, number: open.pre.number + 1 } });
    }

    if (RANK[stage] > RANK[open.pre.stage]) {
      return format({ ...open, pre: { stage, number: 1 } });
    }
  }

  const next = nextOf(releases, today, stage);

  if (newest !== undefined && compare(next, newest) <= 0) {
    throw new Error(`${format(next)} would not be newer than ${format(newest)}: check the clock`);
  }

  return format(next);
}
