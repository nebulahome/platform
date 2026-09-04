/**
 * Public entry point of the `@nebula-home/contracts` package.
 *
 * Everything that crosses a boundary between two NebulaHome processes - errors, exit codes,
 * bus envelopes, entity shapes, API payloads - is declared here and nowhere else, so that both
 * sides of every boundary read the same definition.
 */

export * from './errors.js';
export * from './exit-codes.js';
export * from './log-level.js';
