/**
 * The SDK the hub hands a bundle's own code.
 *
 * Built here, once per load, from the hub's own pieces: the same zod the runtime validates
 * with, the same `defineTransport`, the managed socket. A bundle imports none of it, which is
 * what lets one be installed on a hub that has never heard of its vendor.
 */
import { z } from 'zod';

import type { PlatformLogger } from '@nebula-home/logging';
import { defineTransport, type BundleSdk } from '@nebula-home/package-runtime';

import { openWebSocket } from '../transports/managed-socket.js';

/**
 * Builds the SDK.
 *
 * @param options - The runtime version and the logger bundle code may write to.
 * @param options.version - The runtime version the bundle's `sdk` range was matched against.
 * @param options.logger - The hub's logger.
 * @returns The SDK.
 */
export function createBundleSdk(options: {
  readonly version: string;
  readonly logger: PlatformLogger;
}): BundleSdk {
  return {
    version: options.version,
    z,
    logger: options.logger,
    defineTransport,
    openWebSocket,
  };
}
