/**
 * What a bundle's own code is handed, so that it imports nothing from the platform.
 *
 * A bundle that ships a transport is written against the same contract the platform's own
 * transports are - {@link defineTransport} and the types beside it - but it cannot `import`
 * them: an installed bundle has no `node_modules` of the platform's, and a copy of zod of its
 * own would validate under a different instance than the hub checks against. So the hub hands
 * the pieces over at load, as one object, and the module's default export is a function of it.
 *
 * The managed socket is here for the same reason the transport layer exists: without it every
 * vendor speaking WebSocket would grow its own reconnection, and one of them would have the bug
 * the others do not. The hub owns the socket; the bundle owns what goes through it.
 *
 * The UDP socket is here for the protocols that are datagrams - a Govee light answering a
 * multicast scan, a Broadlink blaster - and for the same reason: the hub binds it, joins the group
 * and closes it when the vendor is unloaded, so a bundle cannot leave a port held behind it.
 */
import type { z } from 'zod';

import type { PlatformLogger } from '@nebula-home/logging';

import type { defineTransport, Transport } from './transport.js';

/** What opening a managed WebSocket takes. */
export type ManagedSocketOptions = {
  /** `ws://host/path` or `wss://…`. */
  readonly url: string;

  readonly logger: PlatformLogger;

  /** Called after every connection, the first and each one after a drop. */
  readonly onOpen: () => void;

  /** Called with each text frame. */
  readonly onMessage: (text: string) => void;

  /** Called when the socket dropped or failed to connect; the helper reconnects by itself. */
  readonly onClose: (reason: string) => void;

  /**
   * How to come back after a drop: doubling from `minMs` (1 s) to `maxMs` (30 s), reset by a
   * connection that opens. `false` is one attempt and no more, for a probe or a scan.
   */
  readonly reconnect?: { readonly minMs?: number; readonly maxMs?: number } | false;
};

/** A WebSocket the hub keeps open on a bundle's behalf. */
export type ManagedSocket = {
  /** Whether a frame can be sent right now. */
  readonly isOpen: boolean;

  /**
   * Sends one text frame.
   *
   * @throws {Error} When the socket is not open.
   */
  send: (text: string) => void;

  /** Drops the socket so the helper reconnects - after a request that timed out. */
  reset: (reason: string) => void;

  /** Closes for good. */
  close: () => Promise<void>;
};

/** Opens a managed WebSocket. */
export type OpenWebSocket = (options: ManagedSocketOptions) => ManagedSocket;

/** Where a datagram came from. */
export type UdpPeer = {
  readonly address: string;
  readonly port: number;
};

/** What opening a managed UDP socket takes. */
export type ManagedUdpSocketOptions = {
  /** The port to listen on; absent, whatever port the system picks. */
  readonly port?: number;

  /** Whether another socket may bind the same port, as a multicast listener must allow. */
  readonly reuseAddr?: boolean;

  /** A multicast group to join, and whether to hear what this host itself sends to it. */
  readonly multicast?: { readonly group: string; readonly loopback?: boolean };

  /** Whether the socket may send to a broadcast address. */
  readonly broadcast?: boolean;

  /** Called with each datagram, as bytes: some protocols are text and some are not. */
  readonly onMessage: (message: Buffer, from: UdpPeer) => void;

  /** Called when the socket fails after it opened. The hub has logged it already. */
  readonly onError?: (error: Error) => void;
};

/** A UDP socket the hub holds on a bundle's behalf. */
export type ManagedUdpSocket = {
  /** The port it is bound to, known once it has opened. */
  readonly port: number;

  /**
   * Sends one datagram.
   *
   * @throws {Error} When the socket is closed or the send fails.
   */
  send: (message: Buffer | string, port: number, address: string) => Promise<void>;

  /** Closes for good, leaving the group. */
  close: () => Promise<void>;
};

/** Opens a managed UDP socket. */
export type OpenUdpSocket = (options: ManagedUdpSocketOptions) => ManagedUdpSocket;

/** What the hub hands a bundle's transport factory. */
export type BundleSdk = {
  /** The runtime version, the same string `manifest.sdk` was matched against. */
  readonly version: string;

  /** The runtime's zod, so a bundle's schemas validate under the one instance the hub uses. */
  readonly z: typeof z;

  /** The hub's logger, for what happens outside a connection: a probe, a scan. */
  readonly logger: PlatformLogger;

  readonly defineTransport: typeof defineTransport;
  readonly openWebSocket: OpenWebSocket;
  readonly openUdpSocket: OpenUdpSocket;
};

/** What a transport module default-exports. */
export type TransportFactory = (sdk: BundleSdk) => Transport;
