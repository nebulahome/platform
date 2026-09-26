/**
 * The MQTT transport.
 *
 * One session per broker, shared by every integration configured against it - which is the whole
 * reason transports and integrations are separate layers. zigbee2mqtt, Tasmota and a generic
 * topic mapping all sit here, and without the split each would have grown its own connection and
 * its own reconnection logic.
 *
 * **A device is a topic.** `deviceKey` is the topic a message arrived on, because that is the only
 * thing MQTT gives you to tell publishers apart. The payload an integration sees is
 * `{ topic, segments, message }` rather than the message alone: a profile frequently needs the
 * topic - it is where zigbee2mqtt puts the device's name, and where a Bambu Lab printer puts its
 * serial - and hiding it would force every integration on this transport to be written in code.
 * `segments` is the topic split on `/`, because a path can index a list and cannot split a string.
 *
 * **A topic may be written as a list of segments.** Anywhere this transport takes a topic or a
 * filter it also takes `["device", "SN123", "request"]`, joined with `/`. That is how a profile
 * addresses a device whose topic contains something only the scan knew: a request template fills
 * an array element by element, so the serial lands between two literals.
 *
 * **A subscription may be a publish.** `{ op: "publish" }` in the subscription set means "send
 * this whenever the session comes up, and every `everyMs` after", which is what a device that only
 * reports changes needs to be asked for a full picture, and what a bridge needs to be asked to list
 * its devices.
 *
 * **A command may be several messages.** `payloads` in place of `payload` publishes each, in
 * order, on the one topic: a device whose one switch is two nodes to its firmware - a Bambu H2D's
 * two chamber lights - is switched by one command, and a profile has no way to send two.
 *
 * Reconnection is the client's own, with a bounded period. A broker restart must not need `hub` to
 * restart, and the subscriptions - and the announcements - are reapplied on every reconnect
 * because a fresh session starts with none.
 */
import { connect, connectAsync, type MqttClient } from 'mqtt';
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

/** How long the client waits before trying the broker again. */
const RECONNECT_PERIOD_MS = 5000;

/**
 * How long a session may take to come up.
 *
 * mqtt.js waits thirty seconds by default. A broker that accepts the socket and never answers
 * the connect packet - a wrong port on a live host, a firewall that drops rather than refuses -
 * would hold an instance in `starting` for that long, and a probe well past the interface's
 * patience.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/** What an owner configures to reach a broker. */
export const mqttConfigSchema = z.object({
  /** `mqtt://host:1883`, or `mqtts://` for a broker behind TLS. */
  url: z.string().min(1).max(512),

  username: z.string().max(128).optional(),
  password: z.string().max(512).optional(),

  /**
   * Whether a TLS broker's certificate must chain to an authority this machine trusts.
   *
   * On unless turned off, and turning it off is for a broker that signs its own certificate and
   * is reached by address - a Bambu Lab printer in LAN mode is exactly that, and there is nothing
   * its certificate could be checked against. What is given up is the guarantee that the thing
   * on that address is the thing it claims to be; what is kept is that the bytes are encrypted.
   * On a home network that is the right trade, and the setting says which trade was made.
   */
  shouldVerifyCertificate: z.boolean().default(true),
});

/** What an owner configures to reach a broker. */
export type MqttConfig = z.output<typeof mqttConfigSchema>;

/**
 * Reads a payload the way a profile will want to path into it.
 *
 * @param raw - What arrived on the wire.
 * @returns The decoded JSON, or the text when it is not JSON. Devices publish both, and refusing
 * the second would exclude every switch that reports `ON`.
 */
function decode(raw: Buffer): unknown {
  const text = raw.toString('utf8');

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Reads a topic, or a topic filter, however it was written.
 *
 * @param value - A string, or a list of segments to join with `/`.
 * @returns The topic, or undefined when the value is neither.
 */
function topicOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }

  if (Array.isArray(value) && value.length > 0 && value.every((s) => typeof s === 'string')) {
    return value.join('/');
  }

  return undefined;
}

/**
 * Reads the topic filter out of a subscription or a scan's search terms.
 *
 * @param args - What the integration asked for.
 * @returns The filter, or undefined when there is not one to use.
 */
function filterOf(args: JsonObject): string | undefined {
  return topicOf(args['filter']);
}

/**
 * Shapes an inbound message the way a profile will want to path into it.
 *
 * @param topic - Where it arrived.
 * @param raw - What arrived.
 * @returns The topic, its segments, and the decoded message.
 */
function inbound(
  topic: string,
  raw: Buffer,
): { topic: string; segments: string[]; message: unknown } {
  return { topic, segments: topic.split('/'), message: decode(raw) };
}

/** Something to publish whenever the session is up, taken from the subscription set. */
type Announcement = {
  readonly topic: string;
  readonly payload: unknown;
  readonly isRetained: boolean;

  /** How often to repeat it while connected, or undefined for only on connect. */
  readonly everyMs: number | undefined;
};

/**
 * Reads the announcements out of a subscription set.
 *
 * @param subscriptions - Everything the connection should carry.
 * @returns The publishes among them, with their schedule.
 */
function announcementsOf(subscriptions: readonly TransportSubscription[]): Announcement[] {
  const found: Announcement[] = [];

  for (const subscription of subscriptions) {
    const topic = topicOf(subscription.args['topic']);
    const everyMs = subscription.args['everyMs'];

    if (subscription.op === 'publish' && topic !== undefined) {
      found.push({
        topic,
        payload: subscription.args['payload'],
        isRetained: subscription.args['retain'] === true,
        everyMs: typeof everyMs === 'number' && everyMs > 0 ? everyMs : undefined,
      });
    }
  }

  return found;
}

/**
 * The options every session is opened with.
 *
 * @param config - Where the broker is and how to be let in.
 * @returns What the client needs, with nothing set that the owner did not.
 */
function clientOptions(config: MqttConfig): Parameters<typeof connectAsync>[1] {
  return {
    ...(config.username === undefined ? {} : { username: config.username }),
    ...(config.password === undefined ? {} : { password: config.password }),
    rejectUnauthorized: config.shouldVerifyCertificate,
  };
}

/**
 * Opens a session and keeps the desired subscription set applied to it.
 *
 * @param config - Where the broker is.
 * @param context - Where messages and status changes go.
 * @returns The connection.
 */
async function open(config: MqttConfig, context: TransportContext): Promise<TransportConnection> {
  const key = connectionKey(config);

  const client: MqttClient = await connectAsync(config.url, {
    ...clientOptions(config),
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });

  let applied: string[] = [];
  let announcements: Announcement[] = [];
  let timers: NodeJS.Timeout[] = [];

  /**
   * Publishes one announcement, reporting rather than throwing when the broker refuses.
   *
   * @param announcement - What to send.
   */
  const announce = (announcement: Announcement): void => {
    client
      .publishAsync(
        announcement.topic,
        typeof announcement.payload === 'string'
          ? announcement.payload
          : JSON.stringify(announcement.payload ?? {}),
        { retain: announcement.isRetained },
      )
      .catch((error: unknown) => {
        context.logger.warn(
          { err: error, topic: announcement.topic },
          'An announcement could not be published',
        );
      });
  };

  /**
   * Sends every announcement now and starts the repeating ones over.
   *
   * Called on connect and on every re-apply, so the timers are always the current set's: a
   * repeating publish from a subscription set that has since been replaced must not keep going.
   */
  const announceAll = (): void => {
    for (const timer of timers) {
      clearInterval(timer);
    }

    timers = [];

    for (const announcement of announcements) {
      announce(announcement);

      if (announcement.everyMs !== undefined) {
        timers.push(
          setInterval(() => {
            announce(announcement);
          }, announcement.everyMs),
        );
      }
    }
  };

  client.on('message', (topic, raw) => {
    context.deliver({ connectionKey: key, deviceKey: topic, payload: inbound(topic, raw) });
  });

  client.on('connect', () => {
    context.report('up');

    // A reconnect gives a fresh session with no subscriptions, so what was applied has to be
    // applied again. Doing it here rather than tracking the reconnect elsewhere keeps the one
    // place that knows the desired set in charge of restoring it. The announcements go with
    // them: a device that only reports changes has to be asked again for the full picture.
    if (applied.length > 0) {
      client.subscribe(applied);
    }

    announceAll();
  });

  client.on('close', () => {
    context.report('down');
  });

  client.on('error', (error) => {
    context.logger.warn({ err: error, broker: config.url }, 'MQTT session reported an error');
  });

  return {
    key,

    /**
     * Publishes what an integration asked to send.
     *
     * @param request - The topic and the payload, or the payloads, sent in order.
     * @returns Nothing: MQTT has no reply, and pretending otherwise would invite a mapper to
     * wait for one.
     * @throws {Error} When asked for anything but a publish.
     */
    send: async (request: TransportRequest): Promise<unknown> => {
      const topic = topicOf(request.args['topic']);

      if (request.op !== 'publish' || topic === undefined) {
        throw new Error(`The mqtt transport cannot perform ${request.op}`);
      }

      const several = request.args['payloads'];
      const payloads = Array.isArray(several) ? several : [request.args['payload']];

      for (const payload of payloads) {
        // In order, one after the other: the device reads them in the order they were written.
        // eslint-disable-next-line no-await-in-loop -- see above
        await client.publishAsync(
          topic,
          typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
          { retain: request.args['retain'] === true },
        );
      }

      return null;
    },

    /**
     * Replaces the set of topic filters this session carries.
     *
     * @param subscriptions - Everything this connection should now receive.
     * @returns A promise that settles once the broker has been told.
     */
    apply: async (subscriptions: readonly TransportSubscription[]): Promise<void> => {
      const wanted = [
        ...new Set(
          subscriptions
            .filter((subscription) => subscription.op === 'topic')
            .map((subscription) => filterOf(subscription.args))
            .filter((filter): filter is string => filter !== undefined),
        ),
      ];

      const added = wanted.filter((filter) => !applied.includes(filter));
      const removed = applied.filter((filter) => !wanted.includes(filter));
      applied = wanted;

      if (added.length > 0) {
        await client.subscribeAsync(added);
      }

      if (removed.length > 0) {
        await client.unsubscribeAsync(removed);
      }

      // Announced after subscribing, so an answer the device sends straight back is not missed.
      announcements = announcementsOf(subscriptions);

      if (client.connected) {
        announceAll();
      }
    },

    /**
     * Ends the session.
     *
     * @returns A promise that settles once the broker has been told.
     */
    close: async (): Promise<void> => {
      for (const timer of timers) {
        clearInterval(timer);
      }

      timers = [];
      await client.endAsync();
    },
  };
}

/**
 * What two configurations must agree on to share one session.
 *
 * @param config - The connection settings.
 * @returns The key. The broker and the identity used to reach it: same broker, different
 * credentials means a different session, because the two see different topics.
 */
function connectionKey(config: MqttConfig): string {
  return `mqtt:${config.url}:${config.username ?? ''}`;
}

/**
 * Watches a topic filter and reports everything published on it as a candidate.
 *
 * This is what discovery means on MQTT. zigbee2mqtt announces its devices by publishing them on
 * `zigbee2mqtt/bridge/devices`, so a scan is a subscription that ends when the pass does.
 *
 * @param config - Where the broker is.
 * @param terms - The integration's search terms, which must carry a topic filter.
 * @param signal - Ends the scan.
 * @yields {Discovered} One candidate per message published on the filter, as it arrives.
 */
async function* scan(
  config: MqttConfig,
  terms: JsonObject,
  signal: AbortSignal,
): AsyncGenerator<Discovered> {
  const filter = filterOf(terms);

  if (filter === undefined) {
    // Nothing to listen to. A scan with no filter would otherwise subscribe to everything on the
    // broker and offer every retained message in the house as a candidate.
    return;
  }

  const client = await connectAsync(config.url, { ...clientOptions(config), reconnectPeriod: 0 });

  const pending: Discovered[] = [];
  let wake: (() => void) | undefined;

  client.on('message', (topic, raw) => {
    pending.push({ deviceKey: topic, payload: inbound(topic, raw) });
    wake?.();
  });

  signal.addEventListener('abort', () => wake?.(), { once: true });

  try {
    await client.subscribeAsync(filter);

    while (!signal.aborted) {
      const next = pending.shift();

      if (next !== undefined) {
        yield next;
        continue;
      }

      // Waiting for the next message is what a scan *is*, and it is sequential by nature: there
      // is no other work to overlap it with, which is the case the rule below exists to catch.
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    await client.endAsync();
  }
}

/**
 * Why a session did not come up, in words an owner can act on.
 *
 * @param error - What the client emitted.
 * @returns The client's own message when it has one - `Connection refused: Not authorized`,
 * `connack timeout` - and otherwise the error code: a refused socket on a host with both an IPv6
 * and an IPv4 address arrives as an `AggregateError` with no message at all.
 */
function reasonOf(error: Error): string {
  if (error.message !== '') {
    return error.message;
  }

  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return error.name;
}

/**
 * The sentence for a session that did not come up.
 *
 * A broker that answered the connect packet with a refusal is not one that did not answer, and
 * the two send an owner to different places: `Not authorized` is about the credentials, a
 * socket error is about the address. mqtt.js marks a refusal with the numeric reason code of the
 * connack, and words it `Connection refused: <reason>`; the prefix goes, the reason stays.
 *
 * @param url - The broker the session was for.
 * @param error - What the client raised.
 * @returns One sentence naming the broker and what went wrong.
 */
export function failureOf(url: string, error: Error): string {
  if ('code' in error && typeof error.code === 'number') {
    return `${url} refused the session: ${error.message.replace(/^Connection refused: /u, '')}`;
  }

  return `${url} did not answer: ${reasonOf(error)}`;
}

/**
 * Opens one session and closes it again.
 *
 * The broker answers the connect packet with the verdict on everything the owner typed: the
 * address, the port, the TLS choice, the credentials. A session that came up is a configuration
 * that works, and one that did not says why in the client's own words - `Not authorized`,
 * `ECONNREFUSED`, `self-signed certificate` - which are the words to show.
 *
 * @param config - The connection settings.
 * @param signal - Gives up on a broker that neither answers nor refuses.
 * @returns Where the session was opened, and as whom.
 * @throws {Error} When the session did not come up, with the reason.
 */
async function probe(config: MqttConfig, signal: AbortSignal): Promise<string> {
  const client = connect(config.url, {
    ...clientOptions(config),
    reconnectPeriod: 0,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      /** Stops waiting when the caller does. */
      const onAbort = (): void => {
        reject(new Error(`${config.url} did not answer: timed out`));
      };

      if (signal.aborted) {
        onAbort();

        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });
      client.once('connect', () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
      client.once('error', (error: Error) => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error(failureOf(config.url, error), { cause: error }));
      });
    });
  } finally {
    // Forced: a client still mid-handshake has nothing to say goodbye to, and a polite end would
    // wait for a broker that is the reason we are leaving.
    await client.endAsync(true).catch((): undefined => undefined);
  }

  return `Connected to ${config.url}${config.username === undefined ? '' : ` as ${config.username}`}`;
}

/** One session per broker, shared by every integration configured against it. */
export const mqttTransport = defineTransport({
  id: 'mqtt',
  configSchema: mqttConfigSchema,
  connectionKey,
  connect: open,
  scan,
  probe,
});
