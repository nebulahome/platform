/**
 * Sending one command to the entity it is for: forwarded to the owning adapter, or applied here
 * for a stored alias helper.
 *
 * `core` knows which adapter owns each entity, so a caller does not have to. The command is
 * validated against the target capability, forwarded as a bus request to the owning adapter,
 * and acknowledged **only when the adapter confirms**. A timeout produces a
 * `DeviceUnavailableError` rather than a silent failure (ARCHITECTURE.md 4.1).
 *
 * Stored alias helpers are the exception: their state lives in `core`, so the command is applied
 * here and never forwarded to a hub. Calculated aliases reject every command.
 *
 * One function for every sender inside `core` - the command subject's router, the scene engine,
 * the automation engine - so a command an automation sends is checked exactly as one a person
 * sends, without a round trip through the broker to reach the process it started in.
 *
 * The forward is a service call, `nebula.v1.svc.<packageId>.command`, and not a republish of the
 * command subject: there is one command subject in the taxonomy and `core` is subscribed to it,
 * so republishing would route the command straight back here.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  adapterAckSchema,
  ADAPTER_COMMAND_METHOD,
  busSubjects,
  ValidationError,
  type CapabilityName,
  type ChangeContext,
  type CommandAck,
  type EntityId,
  type JsonObject,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import { isStoredAlias, type AliasCatalog } from '../domain/alias-catalog.js';
import type { ChangeAttribution } from '../domain/change-attribution.js';
import { validateCommand } from '../domain/command-validation.js';
import type { EntityDirectory } from '../domain/entity-directory.js';
import type { PackageTypes } from '../domain/package-types.js';

import type { AliasEngine } from './alias-engine.js';

/** What sending a command needs. */
export type CommandDispatchOptions = {
  /** The bus client to forward through. */
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

  /**
   * Where a command's cause is written down for the change it produces. Optional: without it
   * nothing is attributed, which is what the unit tests of the router alone want.
   */
  readonly attribution?: ChangeAttribution;
};

/** One send. */
export type DispatchRequest = {
  readonly entityId: EntityId;
  readonly capability: CapabilityName;

  /** The command body, `{ command: 'set_level', level: 40 }`. */
  readonly command: JsonObject;

  /** What caused it, carried to the change it produces. */
  readonly context?: ChangeContext | undefined;

  /** The unit of work it belongs to. */
  readonly traceId: string;

  /** Where to say what happened. */
  readonly logger: PlatformLogger;
};

/** Sends commands. */
export type CommandDispatcher = {
  /**
   * Sends one command and waits for it to be accepted.
   *
   * @param request - The entity, the capability, the command and its cause.
   * @returns The acknowledgement.
   * @throws {ValidationError} When the command is not something this entity can be asked to do.
   * @throws {NotFoundError} When the entity is not registered.
   * @throws {DeviceUnavailableError} When the owning adapter does not answer in time.
   */
  readonly dispatch: (request: DispatchRequest) => Promise<CommandAck>;
};

/**
 * Builds the one way `core` sends a command.
 *
 * @param options - The bus, the directory, the aliases, the timeout and the attribution.
 * @returns The dispatcher.
 */
export function createCommandDispatcher(options: CommandDispatchOptions): CommandDispatcher {
  return {
    /**
     * Sends one command and waits for it to be accepted.
     *
     * @param request - The entity, the capability, the command and its cause.
     * @returns The acknowledgement.
     */
    dispatch: async (request: DispatchRequest): Promise<CommandAck> => {
      const { entityId, capability, context, logger } = request;
      const record = options.directory.require(entityId);
      const alias = options.aliases.getByEntity(entityId);

      if (alias !== undefined) {
        if (!isStoredAlias(alias)) {
          throw new ValidationError(`Calculated alias ${entityId} rejects every command`, {
            details: { entityId },
          });
        }

        options.aliasEngine.applyStoredCommand(entityId, capability, request.command, context);
        logger.debug({ entityId, capability }, 'Command applied to stored alias in core');

        return { entityId, capability, acceptedAt: new Date() };
      }

      if (record.source === 'derived' || record.source === 'system') {
        // A derived entity without an alias row has no place to hold commanded state.
        throw new ValidationError(
          `Entity ${entityId} is ${record.source} and has no adapter to command`,
          { details: { entityId, source: record.source } },
        );
      }

      const command = validateCommand(record, capability, request.command, options.packageTypes);

      if (context !== undefined) {
        // Before the request, not after: a fast device can report before its adapter's
        // acknowledgement has made it back here.
        options.attribution?.note(entityId, context);
      }

      await options.client.request(
        busSubjects.service(record.source, ADAPTER_COMMAND_METHOD),
        { entityId, capability, command },
        adapterAckSchema,
        { traceId: request.traceId, timeoutMs: options.commandTimeoutMs },
      );

      logger.debug(
        { entityId, capability, adapter: record.source },
        'Command accepted by the owning adapter',
      );

      return { entityId, capability, acceptedAt: new Date() };
    },
  };
}
