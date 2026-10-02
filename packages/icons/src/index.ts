/**
 * Public entry point of the `@nebulahome/icons` package: the icons that ship with the
 * platform, the catalogue that lays the owner's rows over them, and the reader that turns an
 * uploaded SVG into a drawing. The reader is also served on its own, at `./svg`, for the
 * browser, which needs nothing else from here.
 */

export * from './builtin.js';
export * from './catalogue.js';
export * from './svg.js';
