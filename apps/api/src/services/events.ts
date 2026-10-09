/**
 * The live channel's plumbing: one set of bus subscriptions, fanned out to every open socket.
 *
 * Subscribed once per process rather than once per socket. A hundred browsers watching a house
 * is a hundred sockets, not a hundred NATS subscriptions - and with a subscription each, one
 * state change would be decoded a hundred times before anybody could decide who is allowed to
 * see it.
 *
 * Which sockets get which event is decided here too. `core` fans out every change to everyone
 * on the bus; deciding who may see one is `api`'s job and nobody else's.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  automationEventSchema,
  backupEventSchema,
  BUS_PATTERNS,
  busSubjects,
  containerEventSchema,
  deviceEventSchema,
  discoveryEventSchema,
  isDeviceEvent,
  jsonObjectSchema,
  stateChangedEventSchema,
  type JsonObject,
  type WsServerMessage,
  integrationEventSchema,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** One open socket, as the fan-out sees it. */
export type Subscriber = {
  /** Which entity identifiers this socket may be told about. */
  readonly canRead: (entityId: string) => boolean;

  /** Which topics it asked for. */
  readonly topics: Set<string>;

  /** Sends one message. */
  readonly send: (message: WsServerMessage) => void;
};

/** Fans bus events out to the sockets that are allowed to see them. */
export class EventFanout {
  /** Every open socket. */
  readonly #subscribers = new Set<Subscriber>();

  /** The bus subscriptions, kept so they can be closed on shutdown. */
  readonly #subscriptions: BusSubscription[] = [];

  /** Where a failed dispatch is reported. */
  readonly #logger: PlatformLogger;

  /**
   * Creates the fan-out.
   *
   * @param logger - Where failures are reported.
   */
  public constructor(logger: PlatformLogger) {
    this.#logger = logger;
  }

  /**
   * Starts listening to the bus.
   *
   * @param client - The bus client to subscribe on.
   */
  public start(client: BusClient): void {
    this.#subscriptions.push(
      client.subscribe(
        BUS_PATTERNS.allStateChanges,
        stateChangedEventSchema,

        /**
         * Forwards one state change to whoever may see it.
         *
         * @param event - The change `core` published.
         */
        (event): void => {
          this.#dispatch('state', event.entityId, {
            type: 'state_changed',
            entityId: event.entityId,

            // Capability state is JSON by construction - it has just been decoded from the
            // bus - but its type has optional keys, which an index signature cannot accept.
            state: event.current.state as JsonObject,
            attributes: event.current.attributes,
            isAvailable: event.current.isAvailable,
            changedAt: event.current.lastChanged,
            ...(event.current.context === undefined ? {} : { context: event.current.context }),
          });
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        BUS_PATTERNS.allDeviceEvents,
        deviceEventSchema,

        /**
         * Forwards one device lifecycle event.
         *
         * @param payload - What was published.
         * @param context - The subject, whose last token names the event.
         */
        (payload, context): void => {
          const event = context.subject.split('.').pop() ?? '';

          if (isDeviceEvent(event)) {
            this.#dispatch('devices', null, { type: 'device_event', event, payload });
          }
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        BUS_PATTERNS.allDiscoveryEvents,
        discoveryEventSchema,

        /**
         * Tells the sockets watching discovery that the proposals changed.
         *
         * Only the count travels: whoever wants the list reads it with the permission it takes,
         * and a socket that shows a badge needs nothing more.
         *
         * @param payload - How many devices the hub proposes now.
         * @param context - The subject, whose last token names the event.
         */
        (payload, context): void => {
          if (context.subject.split('.').pop() === 'changed') {
            this.#dispatch('discovery', null, {
              type: 'discovery_event',
              event: 'changed',
              count: payload.count,
            });
          }
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        busSubjects.integrationEvent(),
        integrationEventSchema,

        /**
         * Tells the sockets watching discovery that something an integration's page shows
         * changed: an account signed in, out, or asked to sign in again.
         *
         * Only the vendor travels, on the discovery topic its page already watches.
         *
         * @param payload - Which vendor.
         */
        (payload): void => {
          this.#dispatch('discovery', null, {
            type: 'integration_event',
            vendorId: payload.vendorId,
          });
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        busSubjects.containerEvent(),
        containerEventSchema,

        /**
         * Tells the sockets watching the containers that one changed or went away.
         *
         * Only the name travels: the page reads the container again with the permission that
         * takes.
         *
         * @param payload - Which container, and what happened.
         */
        (payload): void => {
          this.#dispatch('containers', null, { type: 'container_event', payload });
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        busSubjects.backupEvent(),
        backupEventSchema,

        /**
         * Tells the sockets watching the backups that a run began, moved on or ended.
         *
         * What travels is the run's id and phase: the page reads the run itself with the
         * permission that takes.
         *
         * @param payload - Which run, and where it stands.
         */
        (payload): void => {
          this.#dispatch('backups', null, { type: 'backup_event', payload });
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        BUS_PATTERNS.allAutomationEvents,
        automationEventSchema,

        /**
         * Tells the sockets watching the automations that a run started or ended, so a list can
         * show its last run and an editor its runs without asking again.
         *
         * @param payload - Which run, and how it ended.
         * @param context - The subject, whose last token names the automation.
         */
        (payload, context): void => {
          const automationId = context.subject.split('.').pop() ?? '';

          this.#dispatch('automations', null, {
            type: 'automation_event',
            automationId,
            payload,
          });
        },
      ),
    );

    this.#subscriptions.push(
      client.subscribe(
        BUS_PATTERNS.allPackageEvents,
        jsonObjectSchema,

        /**
         * Forwards one package lifecycle event.
         *
         * @param payload - What was published.
         * @param context - The subject, whose last token names the event.
         */
        (payload, context): void => {
          const event = context.subject.split('.').pop() ?? '';

          // `routes` also arrives on this pattern and is for `proxy`, not for a browser. It is
          // dropped rather than forwarded as an unknown event.
          if (
            event === 'installed' ||
            event === 'removed' ||
            event === 'started' ||
            event === 'stopped' ||
            event === 'configured'
          ) {
            this.#dispatch('packages', null, { type: 'package_event', event, payload });
          }
        },
      ),
    );
  }

  /**
   * Registers an open socket.
   *
   * @param subscriber - The socket.
   * @returns A function that unregisters it.
   */
  public add(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);

    return (): void => {
      this.#subscribers.delete(subscriber);
    };
  }

  /**
   * How many sockets are open.
   *
   * @returns The count.
   */
  public get size(): number {
    return this.#subscribers.size;
  }

  /** Stops listening to the bus. */
  public stop(): void {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }

    this.#subscriptions.length = 0;
    this.#subscribers.clear();
  }

  /**
   * Sends one message to every socket subscribed to a topic and allowed to see it.
   *
   * @param topic - Which subscription the message belongs to.
   * @param entityId - The entity it concerns, or null when it concerns none.
   * @param message - What to send.
   */
  #dispatch(topic: string, entityId: string | null, message: WsServerMessage): void {
    for (const subscriber of this.#subscribers) {
      if (!subscriber.topics.has(topic)) {
        continue;
      }

      if (entityId !== null && !subscriber.canRead(entityId)) {
        continue;
      }

      try {
        subscriber.send(message);
      } catch (error: unknown) {
        // One socket failing to accept a message must not stop the others receiving it. The
        // socket itself is cleaned up by its own close handler.
        this.#logger.debug({ err: error }, 'Could not deliver to a socket');
      }
    }
  }
}
