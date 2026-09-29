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
import { createHash } from 'node:crypto';

import {
  capabilityStateSchema,
  jsonObjectSchema,
  pollIntervalMsOf,
  resolveCanonicalUnit,
  resolveStateClass,
  toCanonical,
  ValidationError,
  type CapabilityState,
  type EntityId,
  type JsonObject,
} from '@nebula-home/contracts';

import type { BundleManifest } from './bundle.js';
import { conditionHolds, resolvePath, resolvePresence } from './evaluate.js';
import type {
  Claim,
  CommandTarget,
  DeviceDescriptor,
  DeviceInfo,
  EntityDescriptor,
  Integration,
  MappingContext,
  ReportedState,
  StreamRequest,
} from './integration.js';
import type {
  EntityProfile,
  IntegrationProfile,
  RequestTemplate,
  StateSource,
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
 * @param value - Where the profile says the field comes from: one place, or several tried in
 * order.
 * @param payload - What arrived.
 * @returns The first place's value that is not undefined, or undefined when none has one.
 */
function readStateValue(value: StateValue, payload: unknown): unknown {
  if (!Array.isArray(value)) {
    return readStateSource(value, payload);
  }

  for (const source of value) {
    const found = readStateSource(source, payload);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/**
 * Reads one place a state field comes from.
 *
 * @param value - The place.
 * @param payload - What arrived.
 * @returns The value, the result of the comparison, whether the value is present, or the
 * table's entry - and undefined when the path names nothing, or the table has no entry and no
 * default. Absence stays absence either way: a comparison against a field the report did not
 * carry must not become `false`, or every partial report would switch every light off. `present`
 * alone reads a missing value as `false`, and only where its holder was reported.
 */
function readStateSource(value: StateSource, payload: unknown): unknown {
  if (typeof value === 'string') {
    return resolvePath(payload, value);
  }

  if ('present' in value) {
    return resolvePresence(payload, value.path);
  }

  const resolved = resolvePath(payload, value.path);
  const found =
    resolved === undefined || (value.bits === undefined && value.base === undefined)
      ? resolved
      : numberOf(resolved, value.bits, value.base ?? 10);

  if (found === undefined) {
    return undefined;
  }

  if ('map' in value) {
    const key =
      typeof found === 'string' || typeof found === 'number' || typeof found === 'boolean'
        ? String(found)
        : undefined;
    const mapped = key === undefined ? undefined : value.map[key];

    return mapped ?? value.default;
  }

  if ('equals' in value) {
    return found === value.equals;
  }

  return found;
}

/**
 * Reads a number, or part of one.
 *
 * @param value - The number, or text holding one.
 * @param bits - `[shift, width]`, the lowest bit first; absent, the whole number.
 * @param base - How text is read: 10, or 16.
 * @returns The number, or its bits unsigned; undefined when the value is no number, or no integer
 * where bits are read.
 */
function numberOf(
  value: unknown,
  bits: readonly [number, number] | undefined,
  base: number,
): number | undefined {
  const text = typeof value === 'string' ? value.trim() : undefined;
  const number =
    typeof value === 'number'
      ? value
      : text === undefined || text === ''
        ? Number.NaN
        : base === 16
          ? /^[0-9a-f]+$/iu.test(text)
            ? Number.parseInt(text, 16)
            : Number.NaN
          : Number(text);

  if (!Number.isFinite(number)) {
    return undefined;
  }

  if (bits === undefined) {
    return number;
  }

  if (!Number.isInteger(number)) {
    return undefined;
  }

  const [shift, width] = bits;
  // Unsigned throughout: a flags word with its top bit set arrives as a negative number.
  const shifted = number >>> shift;

  return width === 32 ? shifted >>> 0 : (shifted & ((1 << width) - 1)) >>> 0;
}

/**
 * The report of an image entity: which picture it is, and the picture beside it for the hub.
 *
 * @param entityId - The entity.
 * @param image - Where the picture is, and what it is.
 * @param payload - What arrived.
 * @returns The report, or undefined when the payload holds no picture.
 */
function imageReportOf(
  entityId: EntityId,
  image: NonNullable<EntityProfile['image']>,
  payload: unknown,
): ReportedState | undefined {
  const content = resolvePath(payload, image.path);

  if (typeof content !== 'string' || content === '') {
    return undefined;
  }

  const data = image.encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  const revision = createHash('sha256').update(data).digest('hex').slice(0, 16);

  return {
    entityId,
    state: { image: { contentType: image.contentType, revision } },
    attributes: {},
    isAvailable: true,
    blob: { contentType: image.contentType, data, minIntervalMs: image.minIntervalMs },
  };
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

  // A button has nothing to report but that it is there to be pressed, which anything the
  // device says proves: it is available exactly when the device is.
  if ('button' in entity.capabilities) {
    built['button'] = {};
  }

  // Validated one capability at a time, so a relay reporting `on` as the string "yes" loses its
  // on/off state and keeps its brightness, rather than losing the whole report.
  const kept: Record<string, unknown> = {};

  for (const [capability, values] of Object.entries(built)) {
    if (capabilityStateSchema.safeParse({ [capability]: values }).success) {
      kept[capability] = values;
    }
  }

  // The profile's unitOfMeasurement is the device's native unit. Catalogue classes publish in
  // the canonical unit so the number matches what `describe` registers on the entity.
  const numeric = kept['sensor_numeric'];

  if (
    numeric !== undefined &&
    typeof numeric === 'object' &&
    numeric !== null &&
    entity.deviceClass !== undefined &&
    entity.unitOfMeasurement !== undefined &&
    typeof (numeric as { value?: unknown }).value === 'number'
  ) {
    const converted = toCanonical(
      entity.deviceClass,
      (numeric as { value: number }).value,
      entity.unitOfMeasurement,
    );

    if (converted !== undefined) {
      kept['sensor_numeric'] = { ...(numeric as Record<string, unknown>), value: converted };
    }
  }

  if (Object.keys(kept).length === 0) {
    return undefined;
  }

  return capabilityStateSchema.parse(kept);
}

/**
 * Measurement fields as they are registered: canonical unit and default state class when the
 * profile names a catalogue class. The profile's unit stays the native one for {@link stateFrom}.
 *
 * @param entity - The entity profile.
 * @returns Fields to put on the descriptor.
 */
function registeredMeasurement(entity: EntityProfile): {
  unitOfMeasurement?: string;
  deviceClass?: string;
  stateClass?: NonNullable<EntityProfile['stateClass']>;
} {
  const canonical = resolveCanonicalUnit(entity.deviceClass);
  const unitOfMeasurement = canonical ?? entity.unitOfMeasurement;
  const stateClass = resolveStateClass(entity.deviceClass, entity.stateClass);

  return {
    ...(unitOfMeasurement === undefined ? {} : { unitOfMeasurement }),
    ...(entity.deviceClass === undefined ? {} : { deviceClass: entity.deviceClass }),
    ...(stateClass === undefined ? {} : { stateClass }),
  };
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
      if (
        !profile.discovery.claim.every((condition) => conditionHolds(condition, discovered.payload))
      ) {
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
     * @param options - The instance's settings: `pollInterval`, when the owner chose one.
     * @returns One subscription per device and template, with duplicates collapsed.
     */
    subscriptions: (claims: readonly Claim[], options: JsonObject): TransportSubscription[] => {
      const rendered = new Map<string, TransportSubscription>();
      const everyMs = pollIntervalMsOf(options);

      for (const each of claims) {
        for (const template of profile.subscriptions) {
          // `deviceKey` is added rather than written in the profile: a profile describes a kind
          // of device, and a polling transport has to know which one it is polling.
          const args: JsonObject = {
            deviceKey: each.deviceKey,
            ...fillArgs(template, each.descriptor),
          };

          // The owner's interval replaces the profile's wherever the profile reads on a timer.
          // A subscription without `everyMs` - a topic, a push - is not a read and keeps its own.
          if (everyMs !== undefined && 'everyMs' in args) {
            args['everyMs'] = everyMs;
          }

          const subscription = { op: template.op, args };

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

      const entities = profile.entities.map((entity): EntityDescriptor => {
        const measurement = registeredMeasurement(entity);

        return {
          domain: entity.domain,
          ...(entity.objectId === undefined ? {} : { objectId: entity.objectId }),
          name: entity.name ?? name ?? claimed.externalId,
          ...(entity.icon === undefined ? {} : { icon: entity.icon }),
          capabilities: entity.capabilities,
          ...measurement,
          ...(entity.displayPrecision === undefined
            ? {}
            : { displayPrecision: entity.displayPrecision }),
        };
      });

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
    toState: (message: TransportInbound, context: MappingContext): ReportedState[] => {
      const reports: ReportedState[] = [];

      for (const entity of profile.entities) {
        const entityId = context.entities.get(keyOf(entity));

        if (entityId !== undefined && entity.image !== undefined) {
          const report = imageReportOf(entityId, entity.image, message.payload);

          if (report !== undefined) {
            reports.push(report);
          }

          continue;
        }

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

    /**
     * Says how a camera entity's picture is read, from its profile.
     *
     * @param entityId - The entity.
     * @param context - The identifiers `hub` assigned to this device.
     * @returns The stream source and its arguments, or undefined for an entity with none.
     */
    streamOf: (entityId: EntityId, context: MappingContext): StreamRequest | undefined => {
      const entity = profile.entities.find(
        (candidate) => context.entities.get(keyOf(candidate)) === entityId,
      );

      return entity?.stream === undefined
        ? undefined
        : { source: entity.stream.source, args: entity.stream.args };
    },

    ...(profile.device === undefined
      ? {}
      : {
          /**
           * Reads the firmware the device says it runs now, where the profile says it is.
           *
           * @param message - What arrived.
           * @returns The versions the message carries; undefined when it carries neither.
           */
          deviceInfo: (message: TransportInbound): DeviceInfo | undefined => {
            const mapping = profile.device;
            const swVersion = firstText(message.payload, mapping?.swVersion);
            const hwVersion = firstText(message.payload, mapping?.hwVersion);

            if (swVersion === undefined && hwVersion === undefined) {
              return undefined;
            }

            return {
              ...(swVersion === undefined ? {} : { swVersion }),
              ...(hwVersion === undefined ? {} : { hwVersion }),
            };
          },
        }),
  };
}

/**
 * Reads the first non-empty string among some paths.
 *
 * @param payload - Where to read.
 * @param paths - A path, a list of them tried in order, or nothing.
 * @returns The string, or undefined when no path names one.
 */
function firstText(
  payload: unknown,
  paths: string | readonly string[] | undefined,
): string | undefined {
  for (const path of paths === undefined ? [] : typeof paths === 'string' ? [paths] : paths) {
    const value = resolvePath(payload, path);

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}
