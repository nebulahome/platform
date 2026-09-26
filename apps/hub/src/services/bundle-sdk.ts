/**
 * The SDK the hub hands a bundle's own code.
 *
 * Built here, once per load, from the hub's own pieces: the same zod the runtime validates
 * with, the same `defineTransport`, the managed sockets. A bundle imports none of it, which is
 * what lets one be installed on a hub that has never heard of its vendor.
 *
 * The UDP opener is the vendor's own, handed in by the loader, so that every socket a vendor
 * opens is closed with the vendor.
 */
import { z } from 'zod';

import type { PlatformLogger } from '@nebula-home/logging';
import {
  defineStreamSource,
  defineTransport,
  type BundleSdk,
  type OpenUdpSocket,
} from '@nebula-home/package-runtime';

import { openMqtt } from '../transports/managed-mqtt.js';
import { openWebSocket } from '../transports/managed-socket.js';
import { openRtsp } from '../transports/rtsp.js';

/**
 * Builds the SDK.
 *
 * @param options - The runtime version, the logger bundle code may write to, and the vendor's
 * UDP sockets.
 * @param options.version - The runtime version the bundle's `sdk` range was matched against.
 * @param options.logger - The hub's logger.
 * @param options.openUdpSocket - Opens a UDP socket tracked as the vendor's.
 * @returns The SDK.
 */
export function createBundleSdk(options: {
  readonly version: string;
  readonly logger: PlatformLogger;
  readonly openUdpSocket: OpenUdpSocket;
}): BundleSdk {
  return {
    version: options.version,
    z,
    logger: options.logger,
    defineTransport,
    openWebSocket,
    openUdpSocket: options.openUdpSocket,
    openMqtt,
    defineStreamSource,
    openRtsp,
  };
}
