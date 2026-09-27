/**
 * Which version an image is, and which newer one is on offer.
 *
 * Two kinds of tag, told apart by their shape. A tag with three numbers - `2.14.1`, `v1.27.3`,
 * `16.4.0-alpine` - **pins** a release: a newer one is another tag, the highest of the same shape
 * (the same prefix and the same suffix, so `-alpine` is never offered a Debian image). Anything
 * else - `latest`, `2`, `stable` - **follows** releases: a newer one is the same tag pointing at
 * another image, which only the registry's digest can tell.
 *
 * The version an image *is* comes from its `org.opencontainers.image.version` label when it has
 * one, and from a pinning tag otherwise; an image following `latest` with no label has no version
 * anybody can name, and is shown by its digest.
 */
import { compare, valid } from 'semver';

/** The label an image states its version in. */
export const VERSION_LABEL = 'org.opencontainers.image.version';

/** A pinning tag: an optional `v`, three numbers, an optional suffix after a dash. */
const PINNED = /^(v?)(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

/** A pinning tag, taken apart. */
type Pinned = {
  readonly prefix: string;
  readonly numbers: readonly [number, number, number];
  readonly suffix: string;
};

/**
 * Takes a pinning tag apart.
 *
 * @param tag - The tag.
 * @returns Its parts, or null for a tag that follows releases.
 */
function pinnedOf(tag: string): Pinned | null {
  const match = PINNED.exec(tag);

  if (match === null) {
    return null;
  }

  const [, prefix = '', major = '0', minor = '0', patch = '0', suffix = ''] = match;

  return { prefix, numbers: [Number(major), Number(minor), Number(patch)], suffix };
}

/**
 * Whether a tag pins one release rather than following them.
 *
 * @param tag - The tag.
 * @returns True for `2.14.1` and its kin.
 */
export function isPinnedTag(tag: string): boolean {
  return pinnedOf(tag) !== null;
}

/**
 * Compares two pinned tags' numbers.
 *
 * @param left - One.
 * @param right - The other.
 * @returns Negative, zero or positive as `left` is older, the same or newer.
 */
function compareNumbers(left: Pinned, right: Pinned): number {
  for (const index of [0, 1, 2] as const) {
    const difference = left.numbers[index] - right.numbers[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * The newest tag of the same shape as the one a container runs.
 *
 * @param current - The pinned tag the container runs.
 * @param tags - Every tag the registry has.
 * @returns The newest of the same prefix and suffix, which may be `current` itself; null when
 * `current` does not pin a release.
 */
export function newestOfShape(current: string, tags: readonly string[]): string | null {
  const pinned = pinnedOf(current);

  if (pinned === null) {
    return null;
  }

  let newest = { tag: current, parts: pinned };

  for (const tag of tags) {
    const parts = pinnedOf(tag);

    if (
      parts !== null &&
      parts.prefix === pinned.prefix &&
      parts.suffix === pinned.suffix &&
      compareNumbers(parts, newest.parts) > 0
    ) {
      newest = { tag, parts };
    }
  }

  return newest.tag;
}

/**
 * The tag an integration's container is installed at: the newest plain release at or above the
 * minimum, in the minimum's major version - a new major is a new contract, and the integration
 * says when it speaks one by raising its minimum.
 *
 * @param minVersion - The oldest release the integration works with.
 * @param tags - Every tag the registry has.
 * @returns The tag, or null when the registry has none that fits.
 */
export function newestSatisfying(minVersion: string, tags: readonly string[]): string | null {
  const floor = pinnedOf(minVersion);

  if (floor === null) {
    return null;
  }

  let best: { tag: string; parts: Pinned } | null = null;

  for (const tag of tags) {
    const parts = pinnedOf(tag);

    if (
      parts?.suffix !== '' ||
      parts.numbers[0] !== floor.numbers[0] ||
      compareNumbers(parts, floor) < 0
    ) {
      continue;
    }

    if (best === null || compareNumbers(parts, best.parts) > 0) {
      best = { tag, parts };
    }
  }

  return best?.tag ?? null;
}

/**
 * Whether a version meets a minimum.
 *
 * @param version - What is installed, as a version or a pinned tag.
 * @param minVersion - The minimum.
 * @returns True when it is at least the minimum; false when it is older or cannot be read.
 */
export function satisfiesMinimum(version: string | null, minVersion: string): boolean {
  if (version === null) {
    return false;
  }

  const installed = valid(version.replace(/^v/, ''));
  const floor = valid(minVersion);

  return installed !== null && floor !== null && compare(installed, floor) >= 0;
}

/**
 * The version an image is.
 *
 * @param labels - The image's labels.
 * @param tag - The tag the container was created from.
 * @returns The label's version, the tag when it pins one, or null.
 */
export function versionOf(labels: Readonly<Record<string, string>>, tag: string): string | null {
  const label = labels[VERSION_LABEL]?.trim();

  if (label !== undefined && label.length > 0 && label.length <= 64) {
    return label;
  }

  return isPinnedTag(tag) ? tag : null;
}

/**
 * A digest as short as a person reads it.
 *
 * @param digest - `sha256:…`.
 * @returns The first twelve characters after the algorithm.
 */
export function shortDigest(digest: string): string {
  const colon = digest.indexOf(':');

  return digest.slice(colon + 1, colon + 13);
}
