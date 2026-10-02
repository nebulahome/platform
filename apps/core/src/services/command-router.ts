/**
 * Routing a command to the adapter that owns the entity, or applying it locally for a stored
 * alias helper.
 *
 * `core` knows which adapter owns each entity, so a caller does not have to. It validates the
 * command against the target capability, forwards it as a bus request to the owning adapter, and
 * acknowledges **only when the adapter confirms**. A timeout produces a `DeviceUnavailableError`
 * rather than a silent failure (ARCHITECTURE.md 4.1).
 *
 * Stored alias helpers are the exception: their state lives in `core`, so the command is applied
 * here and never forwarded to a hub. Calculated aliases reject every command.
 *
 * The forward is a service call, `nebula.v1.svc.<packageId>.command`, and not a republish of the
 * command subject: there is one command subject in the taxonomy and `core` is subscribed to it,
 * so republishing would route the command straight back here.
 */
import type { BusClient, BusSubscription, MessageContext } from '@nebulahome/bus';
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
} from '@nebulahome/contracts';

import { isStoredAlias, type AliasCatalog } from '../domain/alias-catalog.js';
import { validateCommand } from '../domain/command-validation.js';
import type { EntityDirectory } from '../domain/entity-directory.js';
import type { PackageTypes } from '../domain/package-types.js';

import type { AliasEngine } from './alias-engine.js';

/** What the command router needs. */
export type CommandRouterOptions = {
  /** The bus client to serve on and forward through. */
  readonly client: BusClient;

  /** Configured entities, consulted for ownership and declared capabilities. */
  readonly directory: EntityDirectory;

  /** Alias definitions, consulted before forwarding derived-entity commands. */
  readonly aliases: AliasCatalog;

  /** Applies commands to stored helpers locally. */
  readonly aliasEngine: AliasEngine;

  /** How long an adapter has to accept a command. */
  readonly commandTimeoutMs: number;

  /** The packages' entity types, which a command to a `custom` entity is checked against. */
  readonly packageTypes?: PackageTypes;
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

      const record = options.directory.require(target.entityId);
      const alias = options.aliases.getByEntity(target.entityId);

      if (alias !== undefined) {
        if (!isStoredAlias(alias)) {
          throw new ValidationError(`Calculated alias ${target.entityId} rejects every command`, {
            details: { entityId: target.entityId },
          });
        }

        options.aliasEngine.applyStoredCommand(target.entityId, target.capability, request.command);

        context.logger.debug(
          { entityId: target.entityId, capability: target.capability },
          'Command applied to stored alias in core',
        );

        return {
          entityId: target.entityId,
          capability: target.capability,
          acceptedAt: new Date(),
        };
      }

      if (record.source === 'derived' || record.source === 'system') {
        // A derived entity without an alias row has no place to hold commanded state.
        throw new ValidationError(
          `Entity ${target.entityId} is ${record.source} and has no adapter to command`,
          { details: { entityId: target.entityId, source: record.source } },
        );
      }

      const command = validateCommand(
        record,
        target.capability,
        request.command,
        options.packageTypes,
      );

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

    // Each command waits on the one device it is for, for up to the command timeout. Handled one
    // at a time, a light that does not answer would hold every other command in the house
    // behind it; the adapter keeps a device's own commands in order.
    { concurrency: COMMAND_CONCURRENCY },
  );
}
