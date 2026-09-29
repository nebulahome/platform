/**
 * Hands a vendor's transport the account its configuration names when it scans or probes, as the
 * connection pool does when it connects.
 *
 * A device reached through a cloud account remembers the account (`config.account`), and a
 * transport cannot look for it, or test it, without the account's session: identification scans
 * with the device's configuration, and a probe tests it. Neither caller knows about accounts, so
 * the transport is wrapped once, when its vendor is loaded, and the account is looked up here.
 */
import type { JsonObject } from '@nebula-home/contracts';
import type {
  AccountHandle,
  Discovered,
  Transport,
  TransportLookContext,
} from '@nebula-home/package-runtime';

/** Finds one of a vendor's accounts. */
export type AccountLookup = (
  vendorId: string,
  accountId: string,
) => Promise<AccountHandle | undefined>;

/**
 * The vendor a transport belongs to: what comes before the slash of its id.
 *
 * @param transportId - `ecovacs/cloud`.
 * @returns `ecovacs`, or null for a platform transport.
 */
export function vendorOfTransport(transportId: string): string | null {
  const slash = transportId.indexOf('/');

  return slash === -1 ? null : transportId.slice(0, slash);
}

/**
 * The account a configuration names, as a scan or a probe is handed it.
 *
 * @param transportId - The transport.
 * @param config - Its configuration.
 * @param accountOf - Finds an account.
 * @returns The context; empty when the configuration names no account of the vendor.
 */
async function contextOf(
  transportId: string,
  config: unknown,
  accountOf: AccountLookup,
): Promise<TransportLookContext> {
  const vendorId = vendorOfTransport(transportId);
  const accountId =
    typeof config === 'object' && config !== null ? (config as JsonObject)['account'] : undefined;

  if (vendorId === null || typeof accountId !== 'string') {
    return {};
  }

  const account = await accountOf(vendorId, accountId);

  return account === undefined ? {} : { account };
}

/**
 * The same transport, its scans and probes handed the account their configuration names.
 *
 * @param transport - The vendor's transport.
 * @param accountOf - Finds an account.
 * @returns The transport, wrapped.
 */
export function withAccountLookups(transport: Transport, accountOf: AccountLookup): Transport {
  /**
   * Scans with the account.
   *
   * @param config - The configuration.
   * @param terms - The search terms.
   * @param signal - Ends the scan.
   * @param context - What the caller handed, which wins.
   * @yields {Discovered} What the transport found.
   */
  async function* scan(
    config: unknown,
    terms: JsonObject,
    signal: AbortSignal,
    context?: TransportLookContext,
  ): AsyncGenerator<Discovered> {
    yield* transport.scan(
      config,
      terms,
      signal,
      context?.account === undefined ? await contextOf(transport.id, config, accountOf) : context,
    );
  }

  return {
    ...transport,
    scan,

    /**
     * Probes with the account.
     *
     * @param config - The configuration.
     * @param signal - Gives up.
     * @param context - What the caller handed, which wins.
     * @returns What the transport said worked.
     */
    probe: async (
      config: unknown,
      signal: AbortSignal,
      context?: TransportLookContext,
    ): Promise<string> =>
      transport.probe(
        config,
        signal,
        context?.account === undefined ? await contextOf(transport.id, config, accountOf) : context,
      ),
  };
}
