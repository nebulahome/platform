/**
 * How a remote the house learned is a device: pure.
 *
 * A remote is a device of the platform's own `infrared` vendor (driver `infrared/remote`), reached
 * over the platform transport `infrared` with the device key `infrared-<remoteId>`. Each learned
 * button is a `button` entity, by the button's id so a rename keeps it, with the button's name and
 * icon; pressing it asks the transport to `press` that button, and the Infrared broker sends the
 * button's code through the remote's blaster. A remote whose blaster is gone or offline keeps its
 * buttons, unavailable.
 *
 * The remote travels in the claim, as a Modbus device's template does: the broker hands each one
 * over with its buttons, so what a device describes and what a press sends are the same remote's.
 */
import { z } from 'zod';

import {
  iconIdSchema,
  INFRARED_MAXIMUM_BUTTONS,
  INFRARED_TRANSPORT,
  jsonObjectSchema,
  ValidationError,
} from '@nebulahome/contracts';

import type {
  EntityDescriptor,
  Integration,
  MappingContext,
  ReportedState,
} from './integration.js';
import type { Discovered, TransportInbound } from './transport.js';

/** A remote as the Infrared broker hands it over: its device key, name and buttons. */
export const infraredRemoteSnapshotSchema = z.object({
  /** `infrared-<remoteId>`. */
  deviceKey: z.string().min(1).max(160),

  /** The driver it is read as: `infrared/remote`. */
  kind: z.string().min(1).max(160),
  name: z.string().min(1).max(128),
  buttons: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(64),
        icon: iconIdSchema.nullable(),
      }),
    )
    .max(INFRARED_MAXIMUM_BUTTONS),
});

/** A remote as the Infrared broker hands it over. */
export type InfraredRemoteSnapshot = z.output<typeof infraredRemoteSnapshotSchema>;

/** What the transport delivers for a remote: whether its blaster can send now. */
const inboundSchema = z.object({ isAvailable: z.boolean() });

/**
 * The remote a claim was made for.
 *
 * @param descriptor - The claim's descriptor.
 * @returns The remote, or undefined for anything that is not one.
 */
function snapshotOf(descriptor: unknown): InfraredRemoteSnapshot | undefined {
  const parsed = infraredRemoteSnapshotSchema.safeParse(descriptor);

  return parsed.success ? parsed.data : undefined;
}

/**
 * A button of a remote as the house registers it.
 *
 * @param button - The button.
 * @returns Its descriptor.
 */
function buttonDescriptorOf(button: InfraredRemoteSnapshot['buttons'][number]): EntityDescriptor {
  return {
    domain: 'button',
    objectId: button.id,
    name: button.name,
    capabilities: { button: {} },
    ...(button.icon === null ? {} : { icon: button.icon }),
  };
}

/**
 * Builds the driver of the platform's remotes: `infrared/remote`.
 *
 * @param manifest - The driver's.
 * @param manifest.id - Its kind, `vendor/driver`.
 * @returns The integration.
 */
export function createInfraredIntegration(manifest: { readonly id: string }): Integration {
  /**
   * The remote a claim was made for.
   *
   * @param context - The instance's mapping context.
   * @returns The remote.
   * @throws {ValidationError} When the claim holds no remote - which identification never makes.
   */
  const claimed = (context: MappingContext): InfraredRemoteSnapshot => {
    const remote = snapshotOf(context.claim.descriptor);

    if (remote === undefined) {
      throw new ValidationError(`${manifest.id} holds a claim that is not a remote`, {
        details: { integration: manifest.id },
      });
    }

    return remote;
  };

  return {
    id: manifest.id,
    transport: INFRARED_TRANSPORT,
    optionsSchema: jsonObjectSchema,
    discovery: {},

    /**
     * Claims a remote the broker hands over as this driver's.
     *
     * @param discovered - What the transport handed over.
     * @returns The claim, or null for anything that is not one of this driver's remotes.
     */
    claim: (discovered: Discovered) => {
      const remote = snapshotOf(discovered.payload);

      return remote?.kind !== manifest.id
        ? null
        : { deviceKey: remote.deviceKey, externalId: remote.deviceKey, descriptor: remote };
    },

    /**
     * Asks the transport for nothing: it says each remote's availability on its own.
     *
     * @returns No subscription.
     */
    subscriptions: () => [],

    /**
     * Describes the remote: a button entity per learned button.
     *
     * @param claim - The claim.
     * @returns The device.
     * @throws {ValidationError} When the claim holds no remote.
     */
    describe: (claim) => {
      const remote = snapshotOf(claim.descriptor);

      if (remote === undefined) {
        throw new ValidationError(`${manifest.id} cannot describe a claim with no remote`, {
          details: { integration: manifest.id },
        });
      }

      return {
        externalId: claim.externalId,
        name: remote.name,
        entities: remote.buttons.map(buttonDescriptorOf),
      };
    },

    /**
     * Turns whether the remote's blaster can send into a report per button.
     *
     * @param message - What the transport delivered.
     * @param context - The identifiers the hub assigned.
     * @returns The reports.
     */
    toState: (message: TransportInbound, context: MappingContext): ReportedState[] => {
      const parsed = inboundSchema.safeParse(message.payload);
      const remote = snapshotOf(context.claim.descriptor);

      if (!parsed.success || remote === undefined) {
        return [];
      }

      return remote.buttons.flatMap((button): ReportedState[] => {
        const entityId = context.entities.get(button.id);

        return entityId === undefined
          ? []
          : [
              {
                entityId,
                state: { button: {} },
                attributes: {},
                isAvailable: parsed.data.isAvailable,
              },
            ];
      });
    },

    /**
     * Turns a press into the button the broker sends.
     *
     * @param target - The entity, the capability and the command.
     * @param context - The claim.
     * @returns The request.
     * @throws {ValidationError} When the entity is no button of the remote.
     */
    toCommand: (target, context) => {
      const remote = claimed(context);
      const button = remote.buttons.find(
        (candidate) => context.entities.get(candidate.id) === target.entityId,
      );

      if (button === undefined || target.capability !== 'button') {
        throw new ValidationError(`${manifest.id} has no button ${target.entityId}`, {
          details: { integration: manifest.id, entityId: target.entityId },
        });
      }

      return { deviceKey: remote.deviceKey, op: 'press', args: { buttonId: button.id } };
    },
  };
}
