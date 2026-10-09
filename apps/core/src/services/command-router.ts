/**
 * Serving the command subject: every entity command anyone sends over the bus.
 *
 * The subject names the entity and the capability; the request carries the command and what
 * caused it. Everything else - who owns the entity, whether it can be asked this, the forward to
 * the adapter or the local apply for a stored helper - is the dispatcher's, which the engines
 * inside `core` call directly.
 */
import type { BusSubscription, MessageContext } from '@nebulahome/bus';
import {
  BUS_PATTERNS,
  capabilityCommandRequestSchema,
  parseCommandSubject,
  ValidationError,
  type CapabilityCommandRequest,
  type CommandAck,
} from '@nebulahome/contracts';

import {
  createCommandDispatcher,
  type CommandDispatcher,
  type CommandDispatchOptions,
} from './command-dispatch.js';

/** What the command router needs. */
export type CommandRouterOptions = CommandDispatchOptions & {
  /** The dispatcher to send through. Built from the options when absent. */
  readonly dispatcher?: CommandDispatcher;
};

/** How many commands may be waiting on their devices at once. */
const COMMAND_CONCURRENCY = 32;

/**
 * Serves every entity command and forwards it to the owning adapter, or applies it on a stored
 * alias.
 *
 * @param options - The bus client, the directory, the alias catalogue and the timeout.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startCommandRouter(options: CommandRouterOptions): BusSubscription {
  const dispatcher = options.dispatcher ?? createCommandDispatcher(options);

  return options.client.serve(
    BUS_PATTERNS.allCommands,
    capabilityCommandRequestSchema,

    /**
     * Validates one command and forwards or applies it.
     *
     * @param request - The command and what caused it.
     * @param context - The subject it arrived on, which names the entity and the capability.
     * @returns The acknowledgement, once the adapter has accepted it or core has applied it.
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

      return dispatcher.dispatch({
        entityId: target.entityId,
        capability: target.capability,
        command: request.command,
        context: request.context,
        traceId: context.header.traceId,
        logger: context.logger,
      });
    },

    // Each command waits on the one device it is for, for up to the command timeout. Handled one
    // at a time, a light that does not answer would hold every other command in the house
    // behind it; the adapter keeps a device's own commands in order.
    { concurrency: COMMAND_CONCURRENCY },
  );
}
