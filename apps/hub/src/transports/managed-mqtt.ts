/**
 * An MQTT session the hub keeps up on a bundle's behalf.
 *
 * For a vendor whose devices report through a broker of the vendor's own rather than one the
 * owner runs - a cloud's message bus reached with a client certificate. The platform's `mqtt`
 * transport is for the owner's broker and is configured by the owner; this is the session a
 * bundle's code opens itself, with the reconnection and the resubscription every long-lived
 * session needs, so that no vendor grows its own.
 *
 * Messages are handed over as bytes: what they mean is the vendor's business.
 */
import { connect, type IClientOptions, type MqttClient } from 'mqtt';

import type { ManagedMqtt, ManagedMqttOptions } from '@nebulahome/package-runtime';

/** How long the client waits before trying the broker again. */
const RECONNECT_PERIOD_MS = 5000;

/** How long a session may take to come up; see the `mqtt` transport for why not thirty. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Opens a managed MQTT session.
 *
 * @param options - Where to connect, as whom, and what to call.
 * @returns The session, connecting in the background.
 */
export function openMqtt(options: ManagedMqttOptions): ManagedMqtt {
  const { url, logger, onConnect, onMessage, onClose } = options;
  const topics = new Set<string>();
  const clientOptions: IClientOptions = {
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    resubscribe: false,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.username === undefined ? {} : { username: options.username }),
    ...(options.password === undefined ? {} : { password: options.password }),
    ...(options.tls?.pfx === undefined ? {} : { pfx: options.tls.pfx }),
    ...(options.tls?.passphrase === undefined ? {} : { passphrase: options.tls.passphrase }),
    rejectUnauthorized: options.tls?.rejectUnauthorized ?? true,
  };
  const client: MqttClient = connect(url, clientOptions);
  let isClosed = false;

  // Said at warn once per reason, so a broker that refuses the session is in the log, and one
  // that keeps refusing it every five seconds is not the whole log.
  let lastError = '';

  client.on('connect', () => {
    lastError = '';

    // Every session starts with nothing subscribed: what the bundle asked for is asked again.
    for (const topic of topics) {
      client.subscribe(topic, { qos: 0 });
    }

    onConnect?.();
  });

  client.on('message', (topic, payload) => {
    try {
      onMessage(topic, payload);
    } catch (error: unknown) {
      logger.warn({ err: error, topic }, 'A bundle failed on an MQTT message');
    }
  });

  client.on('close', () => {
    if (!isClosed) {
      onClose?.('closed');
    }
  });

  client.on('error', (error) => {
    if (error.message === lastError) {
      logger.debug({ err: error, url }, 'MQTT session error');
    } else {
      lastError = error.message;
      logger.warn({ err: error, url }, 'An MQTT session failed; it is tried again every 5 s');
    }

    if (!isClosed) {
      onClose?.(error.message);
    }
  });

  return {
    /**
     * Whether the session is up now.
     *
     * @returns True while connected.
     */
    get isConnected(): boolean {
      return client.connected;
    },

    /**
     * Subscribes, now when connected and again on every reconnect.
     *
     * @param topic - The topic or filter.
     */
    subscribe: (topic: string): void => {
      topics.add(topic);

      if (client.connected) {
        client.subscribe(topic, { qos: 0 });
      }
    },

    /**
     * Stops hearing a topic.
     *
     * @param topic - The topic or filter.
     */
    unsubscribe: (topic: string): void => {
      topics.delete(topic);

      if (client.connected) {
        client.unsubscribe(topic);
      }
    },

    /**
     * Publishes one message, at most once.
     *
     * @param topic - Where.
     * @param payload - What.
     * @returns A promise that settles once it is handed to the socket.
     */
    publish: async (topic: string, payload: string | Buffer): Promise<void> => {
      if (!client.connected) {
        throw new Error('The MQTT session is not up');
      }

      await client.publishAsync(topic, payload, { qos: 0 });
    },

    /**
     * Closes for good.
     *
     * @returns A promise that settles once the session is ended.
     */
    close: async (): Promise<void> => {
      isClosed = true;
      await client.endAsync(true);
    },
  };
}
