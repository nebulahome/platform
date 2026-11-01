/**
 * One integration instance's presence on the bus.
 *
 * Two services and one publication, which together are the whole of what `core` knows about an
 * adapter: it sends commands, it asks for a resynchronisation, and it receives state reports.
 *
 * The subjects are **per instance**, not one pair for the whole service. That is deliberate and
 * it is about a property of the bus rather than about tidiness: a subscription handles one
 * request at a time, in arrival order, so a single `svc.hub.command` would serialise every
 * command in the house behind whichever device was slowest to answer. One unreachable relay would
 * hold up the lights in another room for the length of its timeout.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  ADAPTER_COMMAND_METHOD,
  AdapterError,
  adapterCommandSchema,
  busSubjects,
  ConflictError,
  DeviceUnavailableError,
  NotFoundError,
  resyncRequestSchema,
  type AdapterAck,
  type AdapterCommand,
  type JsonObject,
  type ResyncReply,
  type StateReport,
} from '@nebulahome/contracts';
import {
  MAX_COMMAND_STEPS,
  type Integration,
  type TransportConnection,
  type TransportRequest,
} from '@nebulahome/package-runtime';

import type { DeviceBook } from '../domain/devices.js';

/** What one instance's bus presence needs. */
export type InstanceServicesOptions = {
  /** The instance id, which is both the entity `source` and the subject token. */
  readonly instanceId: string;

  /** The owner's settings for this instance. */
  readonly options: JsonObject;

  readonly integration: Integration;
  readonly book: DeviceBook;
  readonly client: BusClient;
  readonly connection: TransportConnection;

  /** How long a device has to accept a command before it is treated as unreachable. */
  readonly commandTimeoutMs: number;
};

/**
 * Publishes state reports.
 *
 * @param client - The bus client to publish through.
 * @param reports - What to publish.
 */
export function publishReports(client: BusClient, reports: readonly StateReport[]): void {
  for (const report of reports) {
    client.publish(busSubjects.stateReport(report.entityId), report);
  }
}

/**
 * Sends one request of a command, a deadline it misses said as one: the device may still carry it
 * out, so `core` does not send it another way.
 *
 * @param connection - The transport's connection.
 * @param request - The request.
 * @param deadline - The command's deadline, and how long it was.
 * @param deadline.signal - Aborts at the deadline.
 * @param deadline.timeoutMs - How long it was.
 * @param entityId - The entity it is for.
 * @returns What the transport answered.
 * @throws {DeviceUnavailableError} When the deadline passed.
 */
async function sendWithin(
  connection: TransportConnection,
  request: TransportRequest,
  { signal, timeoutMs }: { readonly signal: AbortSignal; readonly timeoutMs: number },
  entityId: string,
): Promise<unknown> {
  try {
    return await connection.send(request, signal);
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new DeviceUnavailableError(`${entityId} did not answer in time`, {
        cause: error,
        details: { entityId, timeoutMs },
      });
    }

    throw error;
  }
}

/**
 * Serves the two subjects `core` addresses this instance on.
 *
 * @param options - The instance, its integration, its devices and its connection.
 * @returns The subscriptions, to unsubscribe when the instance stops.
 */
export function startInstanceServices(options: InstanceServicesOptions): BusSubscription[] {
  return [
    options.client.serve(
      busSubjects.service(options.instanceId, ADAPTER_COMMAND_METHOD),
      adapterCommandSchema,

      /**
       * Performs one command.
       *
       * @param command - The entity, the capability and what to do, already validated by `core`.
       * @returns The acknowledgement, once the device has accepted it.
       * @throws {NotFoundError} When this instance does not own the entity. `core` routes on
       * `source`, so this means the registry and what `hub` has adopted disagree - which is worth
       * an error the caller sees rather than an acknowledgement for something that went nowhere.
       */
      async (command: AdapterCommand): Promise<AdapterAck> => {
        const binding = options.book.byEntityId(command.entityId);

        if (binding === undefined) {
          throw new NotFoundError(`${options.instanceId} does not own ${command.entityId}`, {
            details: { instanceId: options.instanceId, entityId: command.entityId },
          });
        }

        // A device fetching its firmware still offers it until it reboots, and asked again it
        // may start over - which an automation installing whatever is offered would do every
        // time the offer is seen. So an install while one is under way is refused here, for
        // every vendor, rather than left to each device to shrug off.
        if (
          command.capability === 'update' &&
          options.book.replay(command.entityId)?.state.update?.isInstalling === true
        ) {
          throw new ConflictError(`${command.entityId} is already installing its firmware`, {
            details: { entityId: command.entityId },
          });
        }

        const target = {
          entityId: command.entityId,
          capability: command.capability,
          command: command.command,
        };
        const context = options.book.contextFor(binding, options.options);
        const deadline = {
          signal: AbortSignal.timeout(options.commandTimeoutMs),
          timeoutMs: options.commandTimeoutMs,
        };
        let request: TransportRequest | null = options.integration.toCommand(target, context);

        // A device spoken to in a conversation: each answer may call for another request.
        for (let index = 0; request !== null; index += 1) {
          if (index === MAX_COMMAND_STEPS) {
            throw new AdapterError(
              `${options.instanceId} asked for more than ${String(MAX_COMMAND_STEPS)} requests`,
              { details: { entityId: command.entityId } },
            );
          }

          // eslint-disable-next-line no-await-in-loop -- each request waits for the one before
          const answer = await sendWithin(options.connection, request, deadline, command.entityId);

          request =
            options.integration.continueCommand?.(target, { request, answer, index }, context) ??
            null;
        }

        return { acceptedAt: new Date() };
      },
    ),

    options.client.serve(
      busSubjects.stateResync(options.instanceId),
      resyncRequestSchema,

      /**
       * Republishes what every entity last said.
       *
       * @returns How many entities were republished. Only the ones that have reported since this
       * instance started: inventing a state for a device that has not answered would tell `core`
       * something nobody knows, and `core` marks the silent ones unavailable itself.
       */
      (): ResyncReply => {
        const reports = options.book
          .known()
          .map((entityId) => options.book.replay(entityId))
          .filter((report): report is StateReport => report !== undefined);

        publishReports(options.client, reports);

        return { entityCount: reports.length };
      },
    ),
  ];
}
