/**
 * Sending a command to a device.
 *
 * The only place `api` writes anything that reaches a device, and it does so by asking `core`
 * rather than by acting: `core` owns the registry, validates the command against the target
 * capability's schema, and routes it to the adapter that owns the entity (ARCHITECTURE.md 7.2).
 * `api` decides whether the caller is allowed to ask.
 *
 * Failures arrive as the class the far side threw, rebuilt by the bus's error mapping, so a
 * `DeviceUnavailableError` from an adapter that did not answer becomes a `503` here without this
 * file knowing anything about statuses.
 */
import type { BusClient } from '@nebula-home/bus';
import {
  busSubjects,
  commandAckSchema,
  type CapabilityName,
  type ChangeContext,
  type CommandAck,
  type EntityId,
  type Identity,
  type JsonObject,
} from '@nebula-home/contracts';

/** What sending one command needs. */
export type CommandOptions = {
  /** The bus client. */
  readonly client: BusClient;

  /** The entity being commanded. */
  readonly entityId: EntityId;

  /** Which of its capabilities. */
  readonly capability: CapabilityName;

  /** The command and its arguments, validated by `core` against the capability. */
  readonly command: JsonObject;

  /** Who asked. */
  readonly identity: Identity;

  /** The request's trace id, propagated so the whole hop chain shares one. */
  readonly traceId: string;

  /** How long to wait for the acknowledgement. */
  readonly timeoutMs: number;

  /**
   * What caused the command. Defaults to the authenticated user. Scene apply passes a scene
   * context so history attributes the change to the scene rather than to the person who pressed
   * Apply.
   */
  readonly context?: ChangeContext;
};

/**
 * Asks `core` to command an entity.
 *
 * The context defaults to the authenticated user and is not taken from a request body. A client
 * may say *what* caused a command only through a trusted path such as scene apply; letting the
 * body claim a different actor would make the audit trail a suggestion.
 *
 * @param options - The client, the target, the command and who is asking.
 * @returns The acknowledgement, once the owning adapter has accepted it.
 * @throws {NebulaError} Whatever `core` threw: a validation failure for a command the capability
 * does not accept, a not-found for an unregistered entity, or device unavailability when the
 * adapter did not answer in time.
 */
export async function sendCommand(options: CommandOptions): Promise<CommandAck> {
  return options.client.request(
    busSubjects.command(options.entityId, options.capability),
    {
      command: options.command,
      context: options.context ?? { type: 'user', id: options.identity.userId },
    },
    commandAckSchema,
    { traceId: options.traceId, timeoutMs: options.timeoutMs },
  );
}

/**
 * Capabilities whose commands are recorded in the audit log.
 *
 * ARCHITECTURE.md 12.4 requires manual commands that affect locks or security devices to be
 * audited. Auditing every command instead would fill the table with somebody dimming a lamp,
 * and a trail nobody can read is a trail nobody reads.
 */
const AUDITED_CAPABILITIES = new Set<CapabilityName>(['lock']);

/**
 * Says whether a command has to be recorded.
 *
 * @param capability - What is being commanded.
 * @returns True when the audit log must carry it.
 */
export function isAuditedCapability(capability: CapabilityName): boolean {
  return AUDITED_CAPABILITIES.has(capability);
}
