/**
 * The next release's version, from the tags already made (docs/releases-and-updates.md 3).
 *
 * CalVer `YYYY.M.N`, the month without a leading zero, `N` from 0 each month; a beta is
 * `YYYY.M.N-beta.K`. A beta is open while its version has no stable tag yet: the next beta goes
 * on counting it, and the next stable promotes it. Pure: the tags and the day come in.
 */

/** Which kind of release. */
export type Channel = 'beta' | 'stable';

/** A release tag, read. */
type Release = {
  readonly year: number;
  readonly month: number;
  readonly patch: number;

  /** The beta's number, or null for a stable release. */
  readonly beta: number | null;
};

/** `v2026.11.0` or `v2026.11.0-beta.1`; other tags (the SDKs') are not the product's. */
const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

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

  const [, year, month, patch, beta] = match;

  return {
    year: Number(year),
    month: Number(month),
    patch: Number(patch),
    beta: beta === undefined ? null : Number(beta),
  };
}

/**
 * Orders two releases, a beta below its stable.
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
    (left.beta ?? Number.POSITIVE_INFINITY) - (right.beta ?? Number.POSITIVE_INFINITY)
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

  return release.beta === null ? base : `${base}-beta.${String(release.beta)}`;
}

/**
 * Works out the next version.
 *
 * @param tags - Every tag of the repository.
 * @param channel - Beta or stable.
 * @param today - The day of the release; its UTC year and month are used.
 * @returns The version, without the `v`.
 * @throws {Error} When the day is before the newest release, so the version would go backwards.
 */
export function nextVersion(tags: readonly string[], channel: Channel, today: Date): string {
  const releases = tags.map(parse).filter((release) => release !== null);
  const newest = releases.sort(compare).at(-1);
  const open = newest?.beta === null ? undefined : newest;

  if (open !== undefined) {
    return channel === 'beta'
      ? format({ ...open, beta: (open.beta ?? 0) + 1 })
      : format({ ...open, beta: null });
  }

  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const thisMonth = releases.filter((release) => release.year === year && release.month === month);
  const patch = thisMonth.length === 0 ? 0 : Math.max(...thisMonth.map((r) => r.patch)) + 1;
  const next: Release = { year, month, patch, beta: channel === 'beta' ? 1 : null };

  if (newest !== undefined && compare(next, newest) <= 0) {
    throw new Error(`${format(next)} would not be newer than ${format(newest)}: check the clock`);
  }

  return format(next);
}
