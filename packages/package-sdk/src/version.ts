/**
 * The SDK's own version, read from its `package.json` when it is built.
 *
 * What a package records in its manifest's `sdk` range, and what the platform says it implements:
 * the two are compared before a package is installed or started (PACKAGES_DOCS.md 11).
 */
import manifest from '../package.json' with { type: 'json' };

/** The SDK's own version: `1.0.0`, or a prerelease of it. */
export const SDK_VERSION: string = manifest.version;
