/**
 * Routing a command to the adapter that owns the entity.
 *
 * `core` knows which adapter owns each entity, so a caller does not have to. It validates the
 * command against the target capability, forwards it as a bus request to the owning adapter, and
 * acknowledges **only when the adapter confirms**. A timeout produces a `DeviceUnavailableError`
 * rather than a silent failure (ARCHITECTURE.md 4.1).
 *
 * The forward is a service call, `nebula.v1.svc.<packageId>.command`, and not a republish of the
 * command subject: there is one command subject in the taxonomy and `core` is subscribed to it,
 * so republishing would route the command straight back here.
 */
import type { BusClient, BusSubscription, MessageContext } from '@nebula-home/bus';
import {
  adapterAckSchema,
  ADAPTER_COMMAND_METHOD,
  busSubjects,
  BUS_PATTERNS,
  capabilityCommandRequestSchema,
  parseCommandSubject,
  ValidationError,
  type CapabilityCommandRequest,
  type CommandAck,
} from '@nebula-home/contracts';

import { validateCommand } from '../domain/command-validation.js';
import type { EntityDirectory } from '../domain/entity-directory.js';

/** What the command router needs. */
export type CommandRouterOptions = {
  /** The bus client to serve on and forward through. */
  readonly client: BusClient;

  /** Configured entities, consulted for ownership and declared capabilities. */
  readonly directory: EntityDirectory;

  /** How long an adapter has to accept a command. */
  readonly commandTimeoutMs: number;
};

/**
 * Serves every entity command and forwards it to the owning adapter.
 *
 * @param options - The bus client, the directory and the timeout.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startCommandRouter(options: CommandRouterOptions): BusSubscription {
  return options.client.serve(
    BUS_PATTERNS.allCommands,
    capabilityCommandRequestSchema,

    /**
     * Validates one command and forwards it.
     *
     * @param request - The command and what caused it.
     * @param context - The subject it arrived on, which names the entity and the capability.
     * @returns The acknowledgement, once the adapter has accepted it.
     * @throws {ValidationError} When the subject is unreadable, or the command is not something
     * this entity can be asked to do.
     * @throws {NotFoundError} When the entity is not registered.
     * @throws {DeviceUnavailableError} When the owning adapter does not answer in time.
     */
    async (request: CapabilityCommandRequest, context: MessageContext): Promise<CommandAck> => {
      const target = parseCommandSubject(context.subject);

      if (target === null) {
        throw new ValidationError(`Subject ${context.subject} is not a command subject`, {
          details: { subject: context.subject },
        });
      }

      const record = options.directory.require(target.entityId);

      if (record.source === 'derived' || record.source === 'system') {
        // A derived entity is computed from its sources; commanding it would mean writing a
        // value the next recomputation immediately overwrites. The command belongs on whichever
        // source entity actually drives it.
        throw new ValidationError(
          `Entity ${target.entityId} is ${record.source} and has no adapter to command`,
          { details: { entityId: target.entityId, source: record.source } },
        );
      }

      const command = validateCommand(record, target.capability, request.command);

      await options.client.request(
        busSubjects.service(record.source, ADAPTER_COMMAND_METHOD),
        { entityId: target.entityId, capability: target.capability, command },
        adapterAckSchema,
        { traceId: context.header.traceId, timeoutMs: options.commandTimeoutMs },
      );

      context.logger.debug(
        { entityId: target.entityId, capability: target.capability, adapter: record.source },
        'Command accepted by the owning adapter',
      );

      return {
        entityId: target.entityId,
        capability: target.capability,
        acceptedAt: new Date(),
      };
    },
  );
}
