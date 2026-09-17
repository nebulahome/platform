/**
 * The HTTP transport.
 *
 * The awkward one, because HTTP has no connection and no notifications. A device does not tell you
 * it changed; you ask it, on a schedule. So what this calls a connection is really a set of
 * polling timers and an HTTP client, and what it calls a subscription is "ask this device this
 * question every so often".
 *
 * **A device is a host.** `deviceKey` is the authority - `192.168.1.40`, or `shelly.local:8080` -
 * and a request template supplies the path. That split is what lets one profile describe a kind of
 * device while the instance says which one it is.
 *
 * Identifying the device is a probe of the one host an owner configured. Finding devices without
 * being told where to look needs mDNS and SSDP, which are their own piece of work; asking an
 * owner for an address is what the interface would fall back to anyway when a device does not
 * announce itself.
 */
import { z } from 'zod';

import type { JsonObject } from '@nebula-home/contracts';
import { defineTransport } from '@nebula-home/package-runtime';
import type {
  Discovered,
  TransportConnection,
  TransportContext,
  TransportRequest,
  TransportSubscription,
} from '@nebula-home/package-runtime';

/** How often a poll may run at most, so a profile cannot melt a device with a one-millisecond loop. */
const MIN_POLL_MS = 250;

/** What an owner configures to reach a device. */
export const httpConfigSchema = z.object({
  /** The device this instance reaches, as `host` or `host:port`. One instance is one device. */
  host: z.string().min(1).max(256),

  /** Whether to speak TLS to them. */
  isSecure: z.boolean().default(false),

  /** How long a request has before it is treated as unreachable. */
  timeoutMs: z.coerce.number().int().min(100).max(60_000).default(4000),

  username: z.string().max(128).optional(),
  password: z.string().max(512).optional(),
});

/** What an owner configures to reach a device. */
export type HttpConfig = z.output<typeof httpConfigSchema>;

/**
 * Renders one query value as text.
 *
 * @param value - Whatever the template produced.
 * @returns Its text form. Objects and arrays are serialised rather than stringified, because
 * `[object Object]` in a query parameter is a bug that reaches the device and comes back as a
 * puzzling 400.
 */
function asText(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * Builds the URL for one request.
 *
 * @param config - The connection settings, which say http or https.
 * @param deviceKey - The host.
 * @param args - The request arguments, which carry the path and any query.
 * @returns The URL to fetch.
 */
function urlFor(config: HttpConfig, deviceKey: string, args: JsonObject): URL {
  const path = typeof args['path'] === 'string' ? args['path'] : '/';
  const url = new URL(path, `${config.isSecure ? 'https' : 'http'}://${deviceKey}`);
  const query = args['query'];

  if (typeof query === 'object' && query !== null && !Array.isArray(query)) {
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, asText(value));
    }
  }

  return url;
}

/**
 * The headers every request carries.
 *
 * @param config - The connection settings.
 * @returns The headers, including basic auth when the owner supplied credentials. Credentials
 * live here rather than in a profile, which is what keeps a mapper pure and a profile shareable.
 */
function headersFor(config: HttpConfig): Record<string, string> {
  if (config.username === undefined) {
    return { accept: 'application/json' };
  }

  const credentials = Buffer.from(`${config.username}:${config.password ?? ''}`).toString('base64');

  return { accept: 'application/json', authorization: `Basic ${credentials}` };
}

/**
 * Performs one request and reads whatever came back.
 *
 * @param config - The connection settings.
 * @param deviceKey - The host.
 * @param args - The path and any query.
 * @param signal - Cancels the request.
 * @returns The decoded JSON, or the text when it is not JSON.
 * @throws {Error} When the device answered with a status that is not a success.
 */
async function fetchFrom(
  config: HttpConfig,
  deviceKey: string,
  args: JsonObject,
  signal: AbortSignal,
): Promise<unknown> {
  const url = urlFor(config, deviceKey, args);
  const response = await fetch(url, { headers: headersFor(config), signal });

  if (!response.ok) {
    throw new Error(`${deviceKey} answered ${String(response.status)} for ${url.pathname}`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * What two configurations must agree on to share one set of timers.
 *
 * @param config - The connection settings.
 * @returns The key. HTTP shares no socket, so this is only about not running two identical
 * polling loops when an owner configures the same devices twice.
 */
function connectionKey(config: HttpConfig): string {
  return `http:${JSON.stringify([config.host, config.isSecure, config.username ?? ''])}`;
}

/**
 * Starts a client and the polling timers its subscriptions ask for.
 *
 * @param config - The connection settings.
 * @param context - Where polled responses and status changes go.
 * @returns The connection.
 */
function open(config: HttpConfig, context: TransportContext): Promise<TransportConnection> {
  const key = connectionKey(config);
  const timers = new Map<string, NodeJS.Timeout>();

  context.report('up');

  return Promise.resolve({
    key,

    /**
     * Asks one device something.
     *
     * @param request - The device, the verb and the path.
     * @param signal - Cancels the request.
     * @returns Whatever the device answered.
     */
    send: async (request: TransportRequest, signal: AbortSignal): Promise<unknown> =>
      fetchFrom(config, request.deviceKey, request.args, signal),

    /**
     * Replaces the set of polling timers.
     *
     * @param subscriptions - Everything this connection should now poll.
     * @returns A promise that settles once the timers match.
     */
    apply: (subscriptions: readonly TransportSubscription[]): Promise<void> => {
      const wanted = new Map<string, TransportSubscription>();

      for (const subscription of subscriptions) {
        if (subscription.op === 'poll' && typeof subscription.args['deviceKey'] === 'string') {
          wanted.set(JSON.stringify(subscription), subscription);
        }
      }

      for (const [id, timer] of timers) {
        if (!wanted.has(id)) {
          clearInterval(timer);
          timers.delete(id);
        }
      }

      for (const [id, subscription] of wanted) {
        if (timers.has(id)) {
          continue;
        }

        const wanted = subscription.args['deviceKey'];
        const deviceKey = typeof wanted === 'string' ? wanted : '';
        const everyMs = Math.max(Number(subscription.args['everyMs'] ?? 5000), MIN_POLL_MS);

        const timer = setInterval(() => {
          // Deliberately not awaited: a poll that hangs must not delay the next one for a
          // different device, and the request has its own timeout.
          void fetchFrom(
            config,
            deviceKey,
            subscription.args,
            AbortSignal.timeout(config.timeoutMs),
          )
            .then((payload) => {
              context.deliver({ connectionKey: key, deviceKey, payload });
            })
            .catch((error: unknown) => {
              // A device that is off is the normal case for a house, not an incident. It is
              // logged at debug and the entity goes stale, which is what `core` reads as
              // unavailable.
              context.logger.debug({ err: error, deviceKey }, 'Poll failed');
            });
        }, everyMs);

        timer.unref();
        timers.set(id, timer);
      }

      return Promise.resolve();
    },

    /**
     * Stops every timer.
     *
     * @returns A promise that settles once nothing is left running.
     */
    close: (): Promise<void> => {
      for (const timer of timers.values()) {
        clearInterval(timer);
      }

      timers.clear();

      return Promise.resolve();
    },
  });
}

/**
 * Probes the host an owner configured.
 *
 * @param config - The connection settings, which carry the host.
 * @param terms - The integration's search terms, whose `probe` says what to ask it.
 * @param signal - Ends the scan.
 * @yields {Discovered} The host, when it answered the probe.
 */
async function* scan(
  config: HttpConfig,
  terms: JsonObject,
  signal: AbortSignal,
): AsyncGenerator<Discovered> {
  const probe = terms['probe'];
  const args =
    typeof probe === 'object' && probe !== null && !Array.isArray(probe)
      ? (probe['args'] as JsonObject | undefined)
      : undefined;

  if (signal.aborted) {
    return;
  }

  try {
    const payload = await fetchFrom(
      config,
      config.host,
      args ?? { path: '/' },
      AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
    );

    yield { deviceKey: config.host, payload };
  } catch {
    // A host that does not answer is nothing to report: an address with nothing behind it is
    // the ordinary outcome of a typo, or of a device that is off, and the instance keeps asking.
  }
}

/**
 * Why one address did not answer, in the words an owner can act on.
 *
 * @param error - What `fetch` threw.
 * @returns `ECONNREFUSED`, `ENOTFOUND`, `timed out` - the cause, rather than the "fetch failed"
 * that wraps it.
 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'timed out';
    }

    const cause = error.cause;

    if (cause instanceof Error) {
      return 'code' in cause && typeof cause.code === 'string' ? cause.code : cause.message;
    }

    return error.message;
  }

  return String(error);
}

/**
 * Tries the address once.
 *
 * Any HTTP answer counts, a 404 or a 401 included: something at that address speaks HTTP, which
 * is what the owner is checking. Whether it is the right device is identification's question,
 * and whether the password is right is answered by the first poll. What fails here is an address
 * with nothing behind it.
 *
 * @param config - The connection settings.
 * @param signal - Gives up.
 * @returns That the address answered.
 * @throws {Error} When it did not - naming it and why.
 */
async function probe(config: HttpConfig, signal: AbortSignal): Promise<string> {
  try {
    await fetch(urlFor(config, config.host, { path: '/' }), {
      headers: headersFor(config),
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
    });
  } catch (error: unknown) {
    throw new Error(`${config.host} did not answer: ${reasonOf(error)}`, { cause: error });
  }

  return `${config.host} answered`;
}

/** Devices reached by asking them, on a schedule. */
export const httpTransport = defineTransport({
  id: 'http',
  configSchema: httpConfigSchema,
  connectionKey,
  connect: open,
  scan,
  probe,
});
