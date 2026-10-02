/**
 * The modules a package's interface shares with the interface itself: React, in every entry
 * point a build imports. Each import of one becomes a read of the interface's own copy on
 * `globalThis.__nebula.modules`, written as CommonJS so the bundler lets any named import
 * through - so a package's components run in the interface's React, with its hooks and context.
 *
 * The SDK's own `/ui` and `/components` are not among them: they are bundled as the small
 * forwarders they are, which read the interface's implementation themselves.
 */

/** What the interface lends a package's interface, by import specifier. */
export const SHARED_MODULES = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
] as const;

/** The prefix of a shared module's id in the build. */
export const SHARED_PREFIX = '\0nebula-shared:';

/**
 * Says whether an import is of a shared module.
 *
 * @param source - The import's specifier.
 * @returns True when the interface lends it.
 */
export function isSharedModule(source: string): boolean {
  return SHARED_MODULES.some((shared) => shared === source);
}

/**
 * The code that stands for a shared module: the interface's copy.
 *
 * @param source - The module.
 * @returns The CommonJS module that reads it.
 */
export function sharedModuleCode(source: string): string {
  const key = JSON.stringify(source);

  return [
    'const nebula = globalThis.__nebula;',
    `if (nebula === undefined || nebula.modules === undefined || !(${key} in nebula.modules)) {`,
    `  throw new Error('A package is drawn inside the NebulaHome interface, which lends it ' + ${key});`,
    '}',
    `module.exports = nebula.modules[${key}];`,
  ].join('\n');
}
