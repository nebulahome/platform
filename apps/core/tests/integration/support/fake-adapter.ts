/**
 * A protocol adapter with no protocol behind it.
 *
 * It speaks exactly the half of the adapter contract that `core` interacts with over the bus -
 * report state, answer a resynchronisation, accept a command - and nothing else. That is the
 * half worth having a double for: `core` cannot be exercised end to end without something on the
 * other side of every request it makes, and a real adapter would drag in a broker protocol and a
 * device to be a test fixture.
 *
 * It also acts like a device in the one way that matters: a command it accepts is followed by a
 * state report, because a device that acknowledged a command and then never reported the result
 * is a device the interface shows as stuck.
 */
import { BusClient, type BusSubscription, type BusTransport } from '@nebulahome/bus';
import {
  adapterCommandSchema,
  ADAPTER_COMMAND_METHOD,
  busSubjects,
  resyncRequestSchema,
  type AdapterAck,
  type AdapterCommand,
  type CapabilityState,
  type EntityId,
  type ResyncReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** One entity the fake adapter owns. */
export type FakeEntity = {
  /** Its identifier. */
  readonly entityId: EntityId;

  /** Its current state, which a command mutates. */
  state: CapabilityState;
};

/** How the fake adapter is built. */
export type FakeAdapterOptions = {
  /** The transport to attach to. */
  readonly transport: BusTransport;

  /** The package id it publishes under, which must match what the registry says owns its entities. */
  readonly packageId: string;

  /** Its logger. */
  readonly logger: PlatformLogger;

  /** The entities it owns. */
  readonly entities: readonly FakeEntity[];
};

/** A protocol adapter with no protocol behind it. */
export class FakeAdapter {
  readonly #client: BusClient;
  readonly #options: FakeAdapterOptions;
  readonly #entities = new Map<EntityId, FakeEntity>();
  readonly #received: AdapterCommand[] = [];

  #subscriptions: BusSubscription[] = [];
  #resyncCount = 0;

  /**
   * Builds the adapter without starting it.
   *
   * @param options - Transport, identity, logger and the entities it owns.
   */
  public constructor(options: FakeAdapterOptions) {
    this.#options = options;
    this.#client = new BusClient({
      transport: options.transport,
      source: options.packageId,
      logger: options.logger,
      requestTimeoutMs: 2000,
    });

    for (const entity of options.entities) {
      this.#entities.set(entity.entityId, { ...entity });
    }
  }

  /**
   * Every command the adapter has accepted.
   *
   * @returns The commands, oldest first.
   */
  public get received(): readonly AdapterCommand[] {
    return this.#received;
  }

  /**
   * How many times `core` has asked it to resynchronise.
   *
   * @returns The count.
   */
  public get resyncCount(): number {
    return this.#resyncCount;
  }

  /** Starts answering commands and resynchronisation requests. */
  public start(): void {
    this.#subscriptions = [
      this.#client.serve(
        busSubjects.service(this.#options.packageId, ADAPTER_COMMAND_METHOD),
        adapterCommandSchema,

        /**
         * Accepts a command and reports the state it produced.
         *
         * @param command - What `core` forwarded.
         * @returns The acknowledgement.
         */
        (command: AdapterCommand): AdapterAck => {
          this.#received.push(command);
          this.#applyCommand(command);

          return { acceptedAt: new Date() };
        },
      ),

      this.#client.serve(
        busSubjects.stateResync(this.#options.packageId),
        resyncRequestSchema,

        /**
         * Republishes everything it owns.
         *
         * @returns How many entities are about to be reported.
         */
        (): ResyncReply => {
          this.#resyncCount += 1;

          for (const entity of this.#entities.values()) {
            this.report(entity.entityId, entity.state);
          }

          return { entityCount: this.#entities.size };
        },
      ),
    ];
  }

  /**
   * Publishes a state report, as a device doing something unprompted would.
   *
   * @param entityId - The entity that reported.
   * @param state - What it reported.
   * @param observedAt - When, if the adapter knows.
   */
  public report(entityId: EntityId, state: CapabilityState, observedAt?: Date): void {
    const entity = this.#entities.get(entityId);

    if (entity !== undefined) {
      entity.state = { ...entity.state, ...state };
    }

    this.#client.publish(busSubjects.stateReport(entityId), {
      entityId,
      state,
      ...(observedAt === undefined ? {} : { observedAt }),
    });
  }

  /**
   * Publishes a numeric reading to the durable telemetry stream.
   *
   * @param entityId - The entity that measured it.
   * @param value - The measurement.
   * @param observedAt - When it was taken.
   */
  public publishTelemetry(entityId: EntityId, value: number, observedAt: Date): void {
    this.#client.publish(busSubjects.telemetry(entityId), { entityId, value, observedAt });
  }

  /** Stops answering. */
  public stop(): void {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }

    this.#subscriptions = [];
  }

  /**
   * Moves an entity to the state a command asks for.
   *
   * Only the capabilities the tests exercise. A real adapter translates into a protocol; this one
   * translates into the state the device would end up in, which is the part `core` observes.
   *
   * @param command - The command that was accepted.
   */
  #applyCommand(command: AdapterCommand): void {
    const entity = this.#entities.get(command.entityId);

    if (entity === undefined) {
      return;
    }

    const name = command.command['command'];

    if (command.capability === 'on_off') {
      const isOn = name === 'turn_on' || (name === 'toggle' && entity.state.on_off?.isOn !== true);

      this.report(command.entityId, { on_off: { isOn } });
    }

    if (command.capability === 'level' && name === 'set_level') {
      this.report(command.entityId, { level: { level: Number(command.command['level']) } });
    }
  }
}
