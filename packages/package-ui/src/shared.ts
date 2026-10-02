/**
 * The modules the interface shares with every package: what the Vite preset leaves out of a
 * package's build, and what the interface puts on `globalThis.__nebula.modules` before loading one.
 * One list for both, so neither can name a module the other does not.
 */
export const SHARED_MODULES = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@nebulahome/ui',
  '@nebulahome/package-ui',
] as const;

/** A module the interface shares. */
export type SharedModule = (typeof SHARED_MODULES)[number];
