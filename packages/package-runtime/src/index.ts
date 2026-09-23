/**
 * Public entry point of the `@nebula-home/package-runtime` package.
 *
 * The contract an integration is written against, in two layers: a {@link Transport} owns
 * connections and is the only place I/O happens, and an {@link Integration} owns meaning and is
 * pure throughout. A bundle implements the second, either as code or as a profile the runtime
 * reads, and never has to reimplement the first - unless its devices speak a protocol the
 * platform does not, in which case it ships the transport too, written against the same
 * contract and handed the runtime's pieces through the {@link BundleSdk}.
 */

export * from './bundle.js';
export * from './declarative.js';
export * from './discovery.js';
export * from './evaluate.js';
export * from './expression.js';
export * from './integration.js';
export * from './profile.js';
export * from './registry.js';
export * from './sdk.js';
export * from './transport.js';
