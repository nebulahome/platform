/**
 * The transport layer: the only place in an integration where I/O happens.
 *
 * A transport owns connections - a broker session, an HTTP client and its mDNS browser, a radio.
 * It knows how to reach a device and nothing about what the device means. That split is what
 * lets three integrations share one MQTT connection instead of each growing its own reconnection
 * logic, one of which will have a bug the other two do not.
 *
 * It is also what makes the layer above pure, and therefore what makes a declarative bundle
 * possible at all: if a mapper could open a socket, no profile could ever stand in for one.
 */
import type { z } from 'zod';

import type { JsonObject } from '@nebulahome/contracts';

import type { AccountHandle } from './account.js';
import type { BundleLogger } from './sdk.js';

/** What an integration asks a transport to do, expressed as data. */
export type TransportRequest = {
  /** Which device, in whatever way this transport identifies one. */
  readonly deviceKey: string;

  /** The transport's own verb: `get` and `post` for HTTP, `publish` for MQTT. */
  readonly op: string;

  /** The verb's arguments, in the transport's own vocabulary. */
  readonly args: JsonObject;
};

/**
 * A standing interest an integration has in what a connection carries.
 *
 * No `deviceKey`: a subscription is usually broader than one device - a topic filter, a polling
 * schedule - and the transport reports which device a message came from when it arrives.
 */
export type TransportSubscription = {
  readonly op: string;
  readonly args: JsonObject;
};

/** Something a connection delivered without being asked. */
export type TransportInbound = {
  readonly connectionKey: string;
  readonly deviceKey: string;

  /** Raw, as it arrived. Making sense of it is the integration's job. */
  readonly payload: unknown;
};

/** Something a scan found, before any integration has claimed it. */
export type Discovered = {
  readonly deviceKey: string;

  /**
   * What the scan saw.
   *
   * The blob an integration decides on and, if it claims the device, describes it from. Keeping
   * it raw is what lets `describe` be a pure function of it.
   */
  readonly payload: unknown;
};

/** Whether a connection is currently usable. */
export type TransportStatus = 'up' | 'down';

/**
 * What a transport is given when it opens a connection.
 *
 * The transport **calls** these. It is the one holding the socket, so it is the one that knows
 * when something arrived and when the connection dropped; `hub` cannot poll for either.
 */
export type TransportContext = {
  readonly logger: BundleLogger;

  /** Called for every message the connection delivered without being asked. */
  deliver: (message: TransportInbound) => void;

  /** Called when the connection comes up or goes down. */
  report: (status: TransportStatus) => void;

  /**
   * The account the connection is for, when its configuration names one
   * (`config.account`) of the transport's own vendor - the session to use, and how to keep a
   * renewed one or say the owner must sign in again. Absent otherwise.
   */
  readonly account?: AccountHandle;
};

/**
 * What a scan or a probe is handed beside its arguments - the account its
 * configuration names (`config.account`), as a connection is handed it. Absent otherwise.
 */
export type TransportLookContext = {
  readonly account?: AccountHandle;
};

/** One live connection, shared by every instance whose configuration resolves to it. */
export type TransportConnection = {
  /** What this connection is shared under. */
  readonly key: string;

  /**
   * Performs one request.
   *
   * @param request - What to do.
   * @param signal - Cancels the request.
   * @returns Whatever the device answered, raw.
   */
  send: (request: TransportRequest, signal: AbortSignal) => Promise<unknown>;

  /**
   * Replaces the set of standing subscriptions.
   *
   * Replaces rather than adds, so that `hub` can recompute the whole set when an instance is
   * added or removed and apply it without tracking what it asked for last time.
   *
   * @param subscriptions - Everything this connection should now carry.
   * @returns A promise that settles once the transport has applied them.
   */
  apply: (subscriptions: readonly TransportSubscription[]) => Promise<void>;

  /**
   * Closes the connection.
   *
   * @returns A promise that settles once it is closed.
   */
  close: () => Promise<void>;
};

/**
 * How a kind of connection is opened, scanned and spoken to.
 *
 * Configuration arrives as `unknown` because this is what a registry holds, and a registry holds
 * transports of every shape. Each one narrows its own with {@link defineTransport}, which is also
 * the single place the settings an owner typed are validated.
 *
 * The alternative - a generic `Transport<TConfig>` - does not survive being put in a collection:
 * a `Transport<HttpConfig>` is not a `Transport<JsonObject>`, because a function taking the
 * narrower type cannot stand in for one taking the wider. Erasing the parameter here and
 * restoring it in the helper keeps both ends honest without a cast anywhere.
 */
export type Transport = {
  /** `http`, `mqtt`, `esphome`. */
  readonly id: string;

  /** Validates the connection settings an owner supplied. */
  readonly configSchema: z.ZodType;

  /**
   * What two configurations must agree on to share one connection.
   *
   * Derived from the configuration rather than declared, because the answer is the transport's:
   * two MQTT instances share a connection when the broker matches, two HTTP ones never do.
   *
   * @param config - The connection settings.
   * @returns The key this configuration's connection is shared under.
   */
  connectionKey: (config: unknown) => string;

  /**
   * Opens a connection.
   *
   * @param config - The connection settings.
   * @param context - Where inbound messages and status changes go.
   * @returns The connection, once it is usable.
   */
  connect: (config: unknown, context: TransportContext) => Promise<TransportConnection>;

  /**
   * Looks for devices this transport can reach.
   *
   * @param config - The connection settings.
   * @param scan - The integration's search terms, in this transport's vocabulary.
   * @param signal - Ends the scan.
   * @param context - The account the configuration names.
   * @returns Candidates as they are found, rather than a list once the scan is over: a scan of a
   * house takes long enough that the interface should be filling in while it runs.
   */
  scan: (
    config: unknown,
    scan: JsonObject,
    signal: AbortSignal,
    context?: TransportLookContext,
  ) => AsyncIterable<Discovered>;

  /**
   * Tries the settings against the world and lets go again.
   *
   * What "Test" in the interface does before an owner saves: open whatever the transport opens
   * - a broker session, a request to each address - then close it, keeping nothing. Resolves
   * with one sentence saying what worked, so the interface can show it; rejects with an error
   * whose message names what did not, in the transport's own words, because "Not authorized"
   * and "ECONNREFUSED" send an owner to different places.
   *
   * @param config - What the owner typed, complete and in the clear.
   * @param signal - Gives up: a host that never answers must not hold the form open.
   * @param context - The account the configuration names.
   */
  probe: (config: unknown, signal: AbortSignal, context?: TransportLookContext) => Promise<string>;
};

/** A transport as its author writes it, with its own configuration type. */
export type TransportSpec<TConfig> = {
  readonly id: string;
  readonly configSchema: z.ZodType<TConfig>;
  connectionKey: (config: TConfig) => string;
  connect: (config: TConfig, context: TransportContext) => Promise<TransportConnection>;
  scan: (
    config: TConfig,
    scan: JsonObject,
    signal: AbortSignal,
    context?: TransportLookContext,
  ) => AsyncIterable<Discovered>;
  probe: (config: TConfig, signal: AbortSignal, context?: TransportLookContext) => Promise<string>;
};

/**
 * Turns a transport written against its own configuration into one a registry can hold.
 *
 * Validation happens here and only here. Everything above receives whatever an owner put in a
 * `jsonb` column and passes it straight through, so a wrong setting fails once, with the
 * transport's own message, instead of being parsed in every caller that happens to remember to.
 *
 * @param spec - The transport, written against the configuration it understands.
 * @returns The same transport, with its configuration parameter erased.
 */
export function defineTransport<TConfig>(spec: TransportSpec<TConfig>): Transport {
  return {
    id: spec.id,
    configSchema: spec.configSchema,

    /**
     * Validates the settings, then asks the transport what they share.
     *
     * @param config - What the owner configured.
     * @returns The connection key.
     */
    connectionKey: (config: unknown): string => spec.connectionKey(spec.configSchema.parse(config)),

    /**
     * Validates the settings, then opens the connection.
     *
     * @param config - What the owner configured.
     * @param context - Where inbound messages and status changes go.
     * @returns The connection.
     */
    connect: async (config: unknown, context: TransportContext): Promise<TransportConnection> =>
      spec.connect(spec.configSchema.parse(config), context),

    /**
     * Validates the settings, then scans.
     *
     * @param config - What the owner configured.
     * @param scan - The integration's search terms.
     * @param signal - Ends the scan.
     * @param context - The account the configuration names.
     * @returns Candidates as they are found.
     */
    scan: (
      config: unknown,
      scan: JsonObject,
      signal: AbortSignal,
      context?: TransportLookContext,
    ): AsyncIterable<Discovered> =>
      spec.scan(spec.configSchema.parse(config), scan, signal, context),

    /**
     * Validates the settings, then tries them.
     *
     * @param config - What the owner typed.
     * @param signal - Gives up.
     * @param context - The account the configuration names.
     * @returns What the transport said worked.
     */
    probe: async (
      config: unknown,
      signal: AbortSignal,
      context?: TransportLookContext,
    ): Promise<string> => spec.probe(spec.configSchema.parse(config), signal, context),
  };
}
