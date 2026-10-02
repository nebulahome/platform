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
 * **The verb is the template's.** `op` is `get`, `post`, `put`, `patch` or `delete`, and a body in
 * the template goes out as JSON: a Sonoff in DIY mode answers only a POST, a Nanoleaf takes its
 * state as a PUT. A poll names its verb in `method`.
 *
 * **What authenticates a request is the owner's, never the profile's.** A password goes out as
 * basic auth; a token goes in the header the bundle names (`X-Plex-Token`, `hue-application-key`),
 * or into the path where the bundle's `pathPrefix` puts `{token}` (`/api/v1/{token}`, as a Nanoleaf
 * wants). All of it is configuration a `setup.json` fills, so a profile stays shareable and never
 * sees a secret. A device that signs its own certificate - a Hue bridge, a NAS - is reached with
 * `shouldVerifyCertificate: false`, which the bundle sets for the devices it knows do.
 *
 * Identifying the device is a probe of the one host an owner configured, or of the address a
 * device announced itself at; the listening is discovery's, not this transport's.
 */
import { createHash } from 'node:crypto';

import { Agent, fetch } from 'undici';
import { z } from 'zod';

import type { JsonObject } from '@nebulahome/contracts';
import { defineTransport } from '@nebulahome/package-runtime';
import type {
  Discovered,
  TransportConnection,
  TransportContext,
  TransportRequest,
  TransportSubscription,
} from '@nebulahome/package-runtime';

/** How often a poll may run at most, so a profile cannot melt a device with a one-millisecond loop. */
const MIN_POLL_MS = 250;

/**
 * How long after a command the device is read again. Long enough for a relay to have switched and
 * a lamp to have started its fade, short enough that the row follows the tap.
 */
const COMMAND_FOLLOW_UP_MS = 300;

/** The verbs a template may name. */
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** A verb a template may name. */
type Method = (typeof METHODS)[number];

/** Where a path prefix puts the token. */
const TOKEN_PLACEHOLDER = '{token}';

/** What an owner configures to reach a device. */
export const httpConfigSchema = z.object({
  /** The device this instance reaches, as `host` or `host:port`. One instance is one device. */
  host: z.string().min(1).max(256),

  /** Whether to speak TLS to them. */
  isSecure: z.boolean().default(false),

  /**
   * Whether to check the device's certificate against the ones the system trusts.
   *
   * False for a device that signs its own - a Hue bridge, a NAS on the LAN - which no authority
   * will ever vouch for. The bundle sets it for the devices it knows do; the owner never sees it.
   */
  shouldVerifyCertificate: z.boolean().default(true),

  /** How long a request has before it is treated as unreachable. */
  timeoutMs: z.coerce.number().int().min(100).max(60_000).default(4000),

  username: z.string().max(128).optional(),
  password: z.string().max(512).optional(),

  /** A token the device takes instead of a password: an API key, an application key. */
  token: z.string().min(1).max(4096).optional(),

  /** The header the token goes in: `X-Plex-Token`, `hue-application-key`, `authorization`. */
  tokenHeader: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, 'Must be a header name')
    .optional(),

  /** What goes in front of the token in its header: `Bearer `. */
  tokenPrefix: z.string().max(32).default(''),

  /**
   * What goes in front of every path, with `{token}` where the token belongs.
   *
   * For the devices that take their token as a path segment: a Nanoleaf answers
   * `/api/v1/<token>/state` and nothing else.
   */
  pathPrefix: z
    .string()
    .regex(/^\/[^?#]*$/, 'Must be a path, starting with /')
    .max(256)
    .optional(),
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
 * Reads the verb a template or a poll names.
 *
 * @param op - What the template said, when it said anything.
 * @returns The verb; `get` when nothing was named.
 * @throws {Error} When the verb is not one HTTP has here - a profile written for another
 * transport, which is better refused at the first request than sent as a GET the device ignores.
 */
function methodOf(op: unknown): Method {
  if (op === undefined) {
    return 'get';
  }

  const found = METHODS.find((method) => method === op);

  if (found === undefined) {
    throw new Error(`http does not speak ${JSON.stringify(op)}; it speaks ${METHODS.join(', ')}`);
  }

  return found;
}

/**
 * The path prefix, with the token in its place.
 *
 * @param config - The connection settings.
 * @returns The prefix, without a trailing slash, or nothing when there is none.
 */
function prefixOf(config: HttpConfig): string {
  if (config.pathPrefix === undefined) {
    return '';
  }

  return config.pathPrefix
    .replaceAll(TOKEN_PLACEHOLDER, encodeURIComponent(config.token ?? ''))
    .replace(/\/$/, '');
}

/**
 * Builds the URL for one request.
 *
 * @param config - The connection settings, which say http or https and what goes in front.
 * @param deviceKey - The host.
 * @param args - The request arguments, which carry the path and any query.
 * @returns The URL to fetch.
 */
function urlFor(config: HttpConfig, deviceKey: string, args: JsonObject): URL {
  const path = typeof args['path'] === 'string' ? args['path'] : '/';
  const url = new URL(
    `${prefixOf(config)}${path}`,
    `${config.isSecure ? 'https' : 'http'}://${deviceKey}`,
  );
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
 * @returns The headers, including basic auth and the token when the owner supplied them.
 * Credentials live here rather than in a profile, which is what keeps a mapper pure and a profile
 * shareable.
 */
function headersFor(config: HttpConfig): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };

  if (config.username !== undefined) {
    const credentials = Buffer.from(`${config.username}:${config.password ?? ''}`).toString(
      'base64',
    );

    headers['authorization'] = `Basic ${credentials}`;
  }

  if (config.token !== undefined && config.tokenHeader !== undefined) {
    headers[config.tokenHeader.toLowerCase()] = `${config.tokenPrefix}${config.token}`;
  }

  return headers;
}

/** Who carries a connection's requests: the default, or one that accepts any certificate. */
type Dispatcher = Agent | undefined;

/**
 * Opens what carries requests to a device that signs its own certificate.
 *
 * @param config - The connection settings.
 * @returns An agent that does not check certificates, when the bundle said so over TLS; none
 * otherwise, and the default checks as it always does.
 */
function dispatcherFor(config: HttpConfig): Dispatcher {
  return config.isSecure && !config.shouldVerifyCertificate
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
}

/**
 * Performs one request, however it is authenticated and whichever verb it is.
 *
 * @param config - The connection settings.
 * @param dispatcher - What carries it.
 * @param deviceKey - The host.
 * @param method - The verb.
 * @param args - The path, any query, and any body.
 * @param signal - Cancels the request.
 * @returns What came back.
 */
async function request(
  config: HttpConfig,
  dispatcher: Dispatcher,
  deviceKey: string,
  method: Method,
  args: JsonObject,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const headers = headersFor(config);
  const body = method === 'get' || args['body'] === undefined ? undefined : args['body'];

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  return fetch(urlFor(config, deviceKey, args), {
    method: method.toUpperCase(),
    headers,
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(dispatcher === undefined ? {} : { dispatcher }),
  });
}

/**
 * Performs one request and reads whatever came back.
 *
 * @param config - The connection settings.
 * @param dispatcher - What carries it.
 * @param deviceKey - The host.
 * @param method - The verb.
 * @param args - The path, any query, and any body.
 * @param signal - Cancels the request.
 * @returns The decoded JSON, or the text when it is not JSON.
 * @throws {Error} When the device answered with a status that is not a success.
 */
async function fetchFrom(
  config: HttpConfig,
  dispatcher: Dispatcher,
  deviceKey: string,
  method: Method,
  args: JsonObject,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await request(config, dispatcher, deviceKey, method, args, signal);

  if (!response.ok) {
    const path = typeof args['path'] === 'string' ? args['path'] : '/';

    throw new Error(`${deviceKey} answered ${String(response.status)} for ${path}`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Runs something with a dispatcher that lives only as long as it does.
 *
 * @param config - The connection settings.
 * @param run - What to do with it.
 * @returns What `run` returned.
 */
async function withDispatcher<T>(
  config: HttpConfig,
  run: (dispatcher: Dispatcher) => Promise<T>,
): Promise<T> {
  const dispatcher = dispatcherFor(config);

  try {
    return await run(dispatcher);
  } finally {
    await dispatcher?.close();
  }
}

/**
 * What two configurations must agree on to share one set of timers.
 *
 * @param config - The connection settings.
 * @returns The key. HTTP shares no socket, so this is only about not running two identical
 * polling loops when an owner configures the same devices twice. The token is in it as a digest,
 * since a key ends up in logs.
 */
function connectionKey(config: HttpConfig): string {
  const token =
    config.token === undefined
      ? ''
      : createHash('sha256').update(config.token).digest('hex').slice(0, 16);

  return `http:${JSON.stringify([
    config.host,
    config.isSecure,
    config.shouldVerifyCertificate,
    config.username ?? '',
    token,
    config.tokenHeader ?? '',
    config.pathPrefix ?? '',
  ])}`;
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
  const polls = new Map<string, { readonly deviceKey: string; readonly poll: () => void }>();
  const dispatcher = dispatcherFor(config);

  context.report('up');

  return Promise.resolve({
    key,

    /**
     * Asks one device something, then reads it again shortly after.
     *
     * A device over HTTP says nothing on its own: without the second read, what a command changed
     * would show only at the next poll - five to fifteen seconds later, depending on the vendor.
     *
     * @param sent - The device, the verb and the path.
     * @param signal - Cancels the request.
     * @returns Whatever the device answered.
     * @throws {Error} When the verb is not one HTTP has here.
     */
    send: async (sent: TransportRequest, signal: AbortSignal): Promise<unknown> => {
      const answer = await fetchFrom(
        config,
        dispatcher,
        sent.deviceKey,
        methodOf(sent.op),
        sent.args,
        signal,
      );

      const followUp = setTimeout(() => {
        for (const each of polls.values()) {
          if (each.deviceKey === sent.deviceKey) {
            each.poll();
          }
        }
      }, COMMAND_FOLLOW_UP_MS);

      followUp.unref();

      return answer;
    },

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
          polls.delete(id);
        }
      }

      for (const [id, subscription] of wanted) {
        if (timers.has(id)) {
          continue;
        }

        const wanted = subscription.args['deviceKey'];
        const deviceKey = typeof wanted === 'string' ? wanted : '';
        const everyMs = Math.max(Number(subscription.args['everyMs'] ?? 5000), MIN_POLL_MS);

        /** Reads the device once and delivers what it said. */
        const poll = (): void => {
          // Deliberately not awaited: a poll that hangs must not delay the next one for a
          // different device, and the request has its own timeout.
          void Promise.resolve()
            .then(async () =>
              fetchFrom(
                config,
                dispatcher,
                deviceKey,
                methodOf(subscription.args['method']),
                subscription.args,
                AbortSignal.timeout(config.timeoutMs),
              ),
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
        };

        const timer = setInterval(poll, everyMs);

        timer.unref();
        timers.set(id, timer);
        polls.set(id, { deviceKey, poll });

        // Read at once rather than a whole interval after the hub started or the device was
        // added: until the first answer the entity has no state to show at all.
        poll();
      }

      return Promise.resolve();
    },

    /**
     * Stops every timer.
     *
     * @returns A promise that settles once nothing is left running.
     */
    close: async (): Promise<void> => {
      for (const timer of timers.values()) {
        clearInterval(timer);
      }

      timers.clear();
      polls.clear();
      await dispatcher?.close();
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
  const asked =
    typeof probe === 'object' && probe !== null && !Array.isArray(probe) ? probe : undefined;
  const args = asked?.['args'];

  if (signal.aborted) {
    return;
  }

  let payload: unknown;

  try {
    payload = await withDispatcher(config, async (dispatcher) =>
      fetchFrom(
        config,
        dispatcher,
        config.host,
        methodOf(asked?.['op']),
        typeof args === 'object' && args !== null && !Array.isArray(args) ? args : { path: '/' },
        AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      ),
    );
  } catch {
    // A host that does not answer is nothing to report: an address with nothing behind it is
    // the ordinary outcome of a typo, or of a device that is off, and the instance keeps asking.
    return;
  }

  yield { deviceKey: config.host, payload };
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
    await withDispatcher(config, async (dispatcher) => {
      const response = await request(
        config,
        dispatcher,
        config.host,
        'get',
        { path: '/' },
        AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      );

      await response.body?.cancel();
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
