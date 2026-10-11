/**
 * The SDK's own version, read from its `package.json` when it is built.
 *
 * It is also the version of the integration contract: what `hub` says it implements, and what a
 * bundle's `sdk` range is checked against before the bundle loads (INTEGRATIONS_DOCS.md 11). A
 * bundle built with this SDK says `^<major>.<minor>.0`.
 */
import manifest from '../package.json' with { type: 'json' };

/** The SDK's own version: `1.8.0`, or a prerelease of it. */
export const SDK_VERSION: string = manifest.version;

/**
 * The runtime range a bundle built with this SDK declares: this version's major and minor, so a
 * platform with the same contract or a later one of the same major loads it.
 *
 * @param version - The SDK's version.
 * @returns The range, `^1.8.0`.
 */
export function sdkRangeOf(version: string): string {
  const [major = '0', minor = '0'] = version.split('-')[0]?.split('.') ?? [];

  return `^${major}.${minor}.0`;
}
