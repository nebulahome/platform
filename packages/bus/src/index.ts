/**
 * Public entry point of the `@nebula-home/bus` package.
 *
 * The typed NATS client every service talks through. Nothing here knows what a light or an
 * automation is: it knows subjects, envelopes, schemas and delivery guarantees, and it refuses
 * to hand a handler anything that has not been validated first.
 *
 * The subject taxonomy itself lives in `@nebula-home/contracts`, because both ends of every
 * subject have to agree on it and only one of them uses this package.
 */

export * from './backoff.js';
export * from './client.js';
export * from './codec.js';
export * from './connection.js';
export * from './error-mapping.js';
export * from './telemetry-stream.js';
export * from './transport.js';
export * from './ulid.js';
