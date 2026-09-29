/**
 * Versions and version ranges, as manifests write them.
 *
 * A version is SemVer 2.0: `major.minor.patch`, optionally a prerelease and build suffix. A range
 * is npm's grammar - `^1.2.0`, `~1.4`, `>=1.0.0 <2.0.0`, `1.x || 2.x` - checked here only for its
 * shape: what satisfies it is decided where versions are compared, by the `semver` package the
 * services already carry, so there is one implementation of the rules and not two that disagree.
 */
import { z } from 'zod';

/** A released version: `major.minor.patch`, optionally with a prerelease and build suffix. */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;

/** A released version. */
export const semverSchema = z.string().regex(SEMVER_PATTERN, 'Must be a semantic version');

/** One part of a version in a range: a number, or a wildcard. */
const PART = String.raw`(?:0|[1-9]\d*|[xX*])`;

/** A version in a range: whole or partial, `1`, `1.2`, `1.x`, with a prerelease or a build. */
const VERSIONISH = String.raw`${PART}(?:\.${PART}){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;

/** One comparison: an operator, or none, and a version. */
const COMPARATOR = String.raw`(?:(?:\^|~|>=|<=|>|<|=)?\s*${VERSIONISH})`;

/** A set of comparisons all of which hold, or a hyphen range. */
const COMPARATOR_SET = String.raw`(?:${VERSIONISH}\s+-\s+${VERSIONISH}|${COMPARATOR}(?:\s+${COMPARATOR})*)`;

/** What a range is: sets of comparisons, any one of which holds, joined by `||`. */
const RANGE_PATTERN = new RegExp(
  String.raw`^\s*${COMPARATOR_SET}(?:\s*\|\|\s*${COMPARATOR_SET})*\s*$`,
  'u',
);

/** A version range, npm's grammar: `^1.2.0`, `>=1.0.0 <2.0.0`, `1.x || 2.x`. */
export const semverRangeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(RANGE_PATTERN, 'Must be a version range, such as ^1.0.0');

/** Says whether a version is inside a range: `semver.satisfies`, handed in. */
export type SatisfiesRange = (version: string, range: string) => boolean;
