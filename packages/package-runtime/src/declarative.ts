/**
 * A declarative bundle, standing in for a written one.
 *
 * This is the whole point of insisting that {@link Integration} is pure. Nothing here is a
 * special case in the runtime: `hub` registers what this returns exactly as it registers a code
 * bundle, and cannot tell the difference. A mapper allowed to perform I/O could not have been
 * substituted this way, and the declarative tier would have stayed a plan.
 *
 * What it covers is deliberately narrow - a device whose entities are known in advance, whose
 * state is field-to-field, whose commands are request templates. Everything else is a code
 * bundle. See `profile.ts` for where that line is drawn and why.
 */
import {
  capabilityStateSchema,
  jsonObjectSchema,
  ValidationError,
  type CapabilityState,
  type EntityId,
  type JsonObject,
  type StateReport,
} from '@nebula-home/contracts';

import type { BundleManifest } from './bundle.js';
import { resolvePath } from './evaluate.js';
import type {
  Claim,
  CommandTarget,
  DeviceDescriptor,
  EntityDescriptor,
  Integration,
  MappingContext,
} from './integration.js';
import type {
  ClaimCondition,
  EntityProfile,
  IntegrationProfile,
  RequestTemplate,
  StateValue,
  TemplateValue,
} from './profile.js';
import type {
  Discovered,
  TransportInbound,
  TransportRequest,
  TransportSubscription,
} from './transport.js';

/** The key an entity without an `objectId` is held under, since a device may have only one. */
const SOLE_ENTITY = '';

/**
 * Decides whether one condition holds.
 *
 * @param condition - What to check.
 * @param payload - What the scan or probe returned.
 * @returns True when it holds.
 */
function holds(condition: ClaimCondition, payload: unknown): boolean {
  const value = resolvePath(payload, condition.path);

  return 'exists' in condition ? value !== undefined && value !== null : value === condition.equals;
}

/**
 * Fills in a request template.
 *
 * Literals pass through; `{ "$": "path" }` is replaced by what the path names in `source`. A
 * path naming nothing yields `null` rather than being dropped, because a request missing an
 * argument silently is harder to diagnose than one carrying an obviously empty one.
 *
 * Arrays are filled element by element, which is what lets a transport accept a topic as a list
 * of segments with one of them taken from the device.
 *
 * @param value - The template.
 * @param source - What paths are resolved against.
 * @returns The filled-in value.
 */
function fill(value: TemplateValue, source: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => fill(item, source));
  }

  if (typeof value === 'object' && value !== null) {
    const marker = (value as Record<string, unknown>)['$'];

    if (typeof marker === 'string' && Object.keys(value).length === 1) {
      return resolvePath(source, marker) ?? null;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fill(item, source)]),
    );
  }

  return value;
}

/**
 * Fills in a template's arguments.
 *
 * @param template - What to fill in.
 * @param source - What paths are resolved against.
 * @returns The arguments, ready for the transport.
 */
function fillArgs(template: RequestTemplate, source: unknown): JsonObject {
  return Object.fromEntries(
    Object.entries(template.args).map(([key, value]) => [key, fill(value, source)]),
  ) as JsonObject;
}

/**
 * The key an entity profile's identifier is held under in {@link MappingContext.entities}.
 *
 * @param entity - The entity profile.
 * @returns Its key.
 */
function keyOf(entity: EntityProfile): string {
  return entity.objectId ?? SOLE_ENTITY;
}

/**
 * Reads one state field.
 *
 * @param value - Where the profile says the field comes from.
 * @param payload - What arrived.
 * @returns The value, or the result of the comparison, or undefined when the path names nothing.
 * Absence stays absence either way: a comparison against a field the report did not carry must
 * not become `false`, or every partial report would switch every light off.
 */
function readStateValue(value: StateValue, payload: unknown): unknown {
  if (typeof value === 'string') {
    return resolvePath(payload, value);
  }

  const found = resolvePath(payload, value.path);

  return found === undefined ? undefined : found === value.equals;
}

/**
 * Builds one entity's state from a payload.
 *
 * @param entity - What the profile says the entity is.
 * @param payload - What arrived.
 * @returns The state, or undefined when the payload said nothing this entity understands, or
 * said something the capability cannot hold. Firmware lies, and a malformed value must neither
 * reach the registry nor stop the rest of the payload being read.
 */
function stateFrom(entity: EntityProfile, payload: unknown): CapabilityState | undefined {
  const built: Record<string, Record<string, unknown>> = {};

  for (const [capability, fields] of Object.entries(entity.state)) {
    const values: Record<string, unknown> = {};

    for (const [field, source] of Object.entries(fields)) {
      const value = readStateValue(source, payload);

      if (value !== undefined) {
        values[field] = value;
      }
    }

    if (Object.keys(values).length > 0) {
      built[capability] = values;
    }
  }

  // Validated one capability at a time, so a relay reporting `on` as the string "yes" loses its
  // on/off state and keeps its brightness, rather than losing the whole report.
  const kept: Record<string, unknown> = {};

  for (const [capability, values] of Object.entries(built)) {
    if (capabilityStateSchema.safeParse({ [capability]: values }).success) {
      kept[capability] = values;
    }
  }

  if (Object.keys(kept).length === 0) {
    return undefined;
  }

  return capabilityStateSchema.parse(kept);
}

/**
 * Builds an integration out of a bundle that carries a profile instead of code.
 *
 * @param manifest - What the bundle says about itself.
 * @param profile - What the bundle describes.
 * @returns An integration, indistinguishable to `hub` from one somebody wrote.
 */
export function createDeclarativeIntegration(
  manifest: BundleManifest,
  profile: IntegrationProfile,
): Integration {
  const { identity } = profile.discovery;

  /**
   * Finds the entity profile an identifier belongs to.
   *
   * @param entityId - The entity being addressed.
   * @param context - Where the identifiers `hub` assigned are recorded.
   * @returns Its profile.
   * @throws {ValidationError} When this device has no such entity.
   */
  const entityFor = (entityId: EntityId, context: MappingContext): EntityProfile => {
    const found = profile.entities.find(
      (entity) => context.entities.get(keyOf(entity)) === entityId,
    );

    if (found === undefined) {
      throw new ValidationError(`${manifest.id} has no entity ${entityId} on this device`, {
        details: { integration: manifest.id, entityId },
      });
    }

    return found;
  };

  return {
    id: manifest.id,
    transport: manifest.transport,
    optionsSchema: jsonObjectSchema,
    // The probe travels with the search terms because it is the transport that performs it. A
    // scan finds a host; deciding whether the thing at that host is a Shelly means asking it
    // something, and only the transport knows how to ask.
    discovery: {
      ...profile.discovery.scan,
      ...(profile.discovery.probe === undefined ? {} : { probe: profile.discovery.probe }),
    },

    /**
     * Decides whether a discovered device is this integration's.
     *
     * @param discovered - What the scan found.
     * @returns The claim, or null when it is not this integration's device.
     */
    claim: (discovered: Discovered): Claim | null => {
      if (!profile.discovery.claim.every((condition) => holds(condition, discovered.payload))) {
        return null;
      }

      const externalId = resolvePath(discovered.payload, identity.externalId);

      if (typeof externalId !== 'string' || externalId.length === 0) {
        // Without an identifier there is nothing to make this the same device next time, so
        // adopting it would create a fresh row on every scan.
        return null;
      }

      return { deviceKey: discovered.deviceKey, externalId, descriptor: discovered.payload };
    },

    /**
     * States what the transport must carry for these devices.
     *
     * @param claims - The devices this instance owns.
     * @returns One subscription per device and template, with duplicates collapsed.
     */
    subscriptions: (claims: readonly Claim[]): TransportSubscription[] => {
      const rendered = new Map<string, TransportSubscription>();

      for (const each of claims) {
        for (const template of profile.subscriptions) {
          // `deviceKey` is added rather than written in the profile: a profile describes a kind
          // of device, and a polling transport has to know which one it is polling.
          const subscription = {
            op: template.op,
            args: { deviceKey: each.deviceKey, ...fillArgs(template, each.descriptor) },
          };

          rendered.set(JSON.stringify(subscription), subscription);
        }
      }

      return [...rendered.values()];
    },

    /**
     * Says what a claimed device is and what it exposes.
     *
     * @param claimed - The device.
     * @returns Its identity and its entities.
     */
    describe: (claimed: Claim): DeviceDescriptor => {
      /**
       * Reads one optional identity field.
       *
       * @param path - Where to look, when the profile named a place at all.
       * @returns The value, when it is a string.
       */
      const text = (path: string | undefined): string | undefined => {
        const value = path === undefined ? undefined : resolvePath(claimed.descriptor, path);

        return typeof value === 'string' ? value : undefined;
      };

      // Read once into constants rather than called inside each spread: with
      // `exactOptionalPropertyTypes`, TypeScript narrows a constant but cannot narrow across two
      // calls to the same function, so the inline form widens every field back to `| undefined`.
      const name = text(identity.name);

      // The bundle already says who made the device, so a payload that does not is no reason
      // to show nothing. A path in the profile still wins, for a driver covering several makes.
      const manufacturer = text(identity.manufacturer) ?? manifest.vendor.name;
      const model = text(identity.model);
      const swVersion = text(identity.swVersion);
      const hwVersion = text(identity.hwVersion);

      const entities = profile.entities.map((entity): EntityDescriptor => ({
        domain: entity.domain,
        ...(entity.objectId === undefined ? {} : { objectId: entity.objectId }),
        name: entity.name ?? name ?? claimed.externalId,
        capabilities: entity.capabilities,
        ...(entity.unitOfMeasurement === undefined
          ? {}
          : { unitOfMeasurement: entity.unitOfMeasurement }),
        ...(entity.deviceClass === undefined ? {} : { deviceClass: entity.deviceClass }),
        ...(entity.stateClass === undefined ? {} : { stateClass: entity.stateClass }),
        ...(entity.displayPrecision === undefined
          ? {}
          : { displayPrecision: entity.displayPrecision }),
      }));

      return {
        externalId: claimed.externalId,
        name: name ?? claimed.externalId,
        manufacturer,
        ...(model === undefined ? {} : { model }),
        ...(swVersion === undefined ? {} : { swVersion }),
        ...(hwVersion === undefined ? {} : { hwVersion }),
        entities,
      };
    },

    /**
     * Turns something the device sent into canonical state.
     *
     * @param message - What arrived.
     * @param context - The identifiers `hub` assigned to this device.
     * @returns One report per entity the message says something about.
     */
    toState: (message: TransportInbound, context: MappingContext): StateReport[] => {
      const reports: StateReport[] = [];

      for (const entity of profile.entities) {
        const entityId = context.entities.get(keyOf(entity));
        const state = entityId === undefined ? undefined : stateFrom(entity, message.payload);

        if (entityId !== undefined && state !== undefined) {
          reports.push({ entityId, state, attributes: {}, isAvailable: true });
        }
      }

      return reports;
    },

    /**
     * Turns a canonical command into something the transport can perform.
     *
     * @param target - The entity, the capability and the command.
     * @param context - The claim and the last known state.
     * @returns The request.
     * @throws {ValidationError} When the entity is not this device's, or the profile describes
     * no such command.
     */
    toCommand: (target: CommandTarget, context: MappingContext): TransportRequest => {
      const entity = entityFor(target.entityId, context);
      const name = target.command['command'];

      if (typeof name !== 'string') {
        throw new ValidationError(`${manifest.id} received a command with no name`, {
          details: { integration: manifest.id, entityId: target.entityId },
        });
      }

      const key = `${target.capability}.${name}`;
      const template = entity.commands[key];

      if (template === undefined) {
        // Better than building a request out of nothing: `core` turns the failure into an error
        // the caller sees, rather than acknowledging something that never happened.
        throw new ValidationError(`${manifest.id} does not describe the ${key} command`, {
          details: { integration: manifest.id, command: key },
        });
      }

      return {
        deviceKey: context.claim.deviceKey,
        op: template.op,
        // `device` is what the device was claimed from, so a command can be addressed to it. On
        // MQTT that is the only way to name a per-device topic - the serial is in the topic the
        // scan saw and nowhere a literal could put it.
        args: fillArgs(template, {
          command: target.command,
          state: context.lastState(target.entityId),
          device: context.claim.descriptor,
        }),
      };
    },
  };
}
