/**
 * How a Modbus device is read and commanded through its template: pure.
 *
 * A template says, for each capability of each entity, the register its value is read from and
 * the command its changes are written with. This module plans the reads into blocks, turns what
 * the registers hold into canonical state, and turns a canonical command into the words to
 * write. It is the one interpreter of templates: the platform's own `modbus/generic` driver and
 * every integration driver of kind `modbus` are this, so an integration's template and the owner's
 * mean the same thing.
 *
 * The template travels in the claim: the broker hands each device over with its template
 * resolved, so the blocks a device is polled for and the way they are read are always the same
 * template's.
 */
import { z } from 'zod';

import {
  jsonObjectSchema,
  MODBUS_FRAMINGS,
  MODBUS_TRANSPORT,
  modbusEntityIdOf,
  modbusRegistersOf,
  modbusTemplateSchema,
  modbusWordOf,
  ValidationError,
  type CapabilityState,
  type DeclaredCapabilities,
  type JsonObject,
  type ModbusCapability,
  type ModbusCapabilityMap,
  type ModbusEntity,
  type ModbusRead,
  type ModbusReadFunction,
  type ModbusTemplate,
  type ModbusWriteFunction,
} from '@nebulahome/contracts';

import type {
  CommandTarget,
  EntityDescriptor,
  Integration,
  MappingContext,
  ReportedState,
} from './integration.js';
import type { Discovered, TransportInbound, TransportRequest } from './transport.js';

/** How many registers or bits one read may ask for. */
const MAXIMUM_BLOCK = 100;

/** How many unread addresses between two reads still go in one block. */
const MAXIMUM_GAP = 16;

/** Which register of a 32-bit value holds the high word. */
export type ModbusWordOrder = 'high' | 'low';

/** A Modbus device as the broker hands it over: where it is, how often, and its template. */
export const modbusDeviceSnapshotSchema = z.object({
  /** The device's external id: `modbus-<row id>`. */
  deviceKey: z.string().min(1).max(160),

  /** The driver it is read as: `modbus/generic`, or an integration's. */
  kind: z.string().min(1).max(160),
  name: z.string().min(1).max(128),
  host: z.string().min(1).max(253),
  port: z.int().min(1).max(65_535),
  unitId: z.int().min(1).max(247),
  framing: z.enum(MODBUS_FRAMINGS),
  pollSeconds: z.int().min(1).max(3600),
  template: modbusTemplateSchema,
});

/** A Modbus device as the broker hands it over. */
export type ModbusDeviceSnapshot = z.output<typeof modbusDeviceSnapshotSchema>;

/** One read the transport makes: a run of registers or bits of one table. */
export type ModbusBlock = {
  readonly function: ModbusReadFunction;
  readonly start: number;
  readonly count: number;
};

/** Where one capability's value starts, and how many units it takes. */
type Span = {
  readonly function: ModbusReadFunction;
  readonly start: number;
  readonly size: number;
};

/**
 * How many registers or bits a read takes.
 *
 * @param read - The read.
 * @returns One bit for a coil or an input; the type's registers otherwise.
 */
export function modbusSizeOf(read: ModbusRead): number {
  return read.function === 1 || read.function === 2
    ? 1
    : modbusRegistersOf(read.type ?? 'u16', read.count);
}

/**
 * Every read of a template, each once.
 *
 * @param template - The template.
 * @returns The reads, in the template's order.
 */
function readsOf(template: ModbusTemplate): ModbusRead[] {
  return template.entities.flatMap((entity) =>
    Object.values(entity.capabilities).flatMap((map) => (map.read === undefined ? [] : [map.read])),
  );
}

/**
 * Plans the reads of a template into as few requests as the device takes.
 *
 * Reads of one table go together while what lies between them is a short run of unread addresses,
 * and no request asks for more than a hundred units: a gateway that answers 125 registers on paper
 * often answers fewer.
 *
 * @param template - The template.
 * @returns The blocks, each table in address order.
 */
export function planModbusBlocks(template: ModbusTemplate): ModbusBlock[] {
  const spans: Span[] = readsOf(template).map((read) => ({
    function: read.function,
    start: modbusWordOf(read.address),
    size: modbusSizeOf(read),
  }));
  const blocks: ModbusBlock[] = [];

  for (const table of [1, 2, 3, 4] as const) {
    const sorted = spans
      .filter((span) => span.function === table)
      .sort((left, right) => left.start - right.start);
    let start = -1;
    let end = -1;

    for (const span of sorted) {
      const spanEnd = Math.min(span.start + span.size - 1, 0xffff);

      if (
        start >= 0 &&
        span.start - (end + 1) <= MAXIMUM_GAP &&
        Math.max(end, spanEnd) - start + 1 <= MAXIMUM_BLOCK
      ) {
        end = Math.max(end, spanEnd);

        continue;
      }

      if (start >= 0) {
        blocks.push({ function: table, start, count: end - start + 1 });
      }

      start = span.start;
      end = spanEnd;
    }

    if (start >= 0) {
      blocks.push({ function: table, start, count: end - start + 1 });
    }
  }

  return blocks;
}

/** What one table holds at one address: a register's word or a bit, as the transport read it. */
export type ModbusRegisters = Readonly<Record<string, number>>;

/**
 * Where a unit read lands in what the transport delivers.
 *
 * @param fn - The table's read function.
 * @param address - The address.
 * @returns `3:16`.
 */
export function modbusKeyOf(fn: ModbusReadFunction, address: number): string {
  return `${String(fn)}:${String(address)}`;
}

/**
 * What a read's registers hold, before scale and meaning: a bit, a number or a text.
 *
 * @param read - The read.
 * @param wordOrder - Which register of a 32-bit value holds the high word.
 * @param registers - What the transport read.
 * @returns The raw value, or undefined when a register it needs was not read.
 */
export function modbusRawOf(
  read: ModbusRead,
  wordOrder: ModbusWordOrder,
  registers: ModbusRegisters,
): number | boolean | string | undefined {
  const address = modbusWordOf(read.address);
  const words: number[] = [];

  for (let offset = 0; offset < modbusSizeOf(read); offset += 1) {
    const word = registers[modbusKeyOf(read.function, address + offset)];

    if (word === undefined) {
      return undefined;
    }

    words.push(word & 0xffff);
  }

  const [first = 0, second = 0] = words;

  if (read.function === 1 || read.function === 2) {
    return first !== 0;
  }

  if (read.bit !== undefined) {
    return ((first >> read.bit) & 1) === 1;
  }

  switch (read.type ?? 'u16') {
    case 'u16':
      return first;
    case 's16':
      return first >= 0x8000 ? first - 0x10000 : first;
    case 'string':
      return String.fromCharCode(...words.flatMap((word) => [word >> 8, word & 0xff]))
        .replaceAll('\0', '')
        .trim();
    default: {
      const [high, low] = wordOrder === 'high' ? [first, second] : [second, first];
      const view = new DataView(new ArrayBuffer(4));

      view.setUint16(0, high);
      view.setUint16(2, low);

      return read.type === 'u32'
        ? view.getUint32(0)
        : read.type === 's32'
          ? view.getInt32(0)
          : view.getFloat32(0);
    }
  }
}

/**
 * A raw number times the read's scale, without the float noise the multiplication leaves.
 *
 * @param raw - The raw number.
 * @param read - The read, for its scale.
 * @returns The value.
 */
function scaled(raw: number, read: ModbusRead): number {
  return Number((raw * (read.scale ?? 1)).toPrecision(12));
}

/**
 * The value a capability reads as a test shows it: a number scaled, a choice's or a text's
 * meaning, on or off.
 *
 * @param capability - The capability.
 * @param map - Its read and write.
 * @param raw - What {@link modbusRawOf} read.
 * @returns The value.
 */
export function modbusValueOf(
  capability: ModbusCapability,
  map: ModbusCapabilityMap,
  raw: number | boolean | string,
): number | boolean | string {
  const { read } = map;

  if (read === undefined || typeof raw === 'string') {
    return raw;
  }

  if (typeof raw === 'boolean') {
    return raw;
  }

  switch (capability) {
    case 'sensor_binary':
    case 'on_off':
      // A register switched by writing two words reads off when it holds the off word.
      return map.write?.off === undefined ? raw !== 0 : raw !== modbusWordOf(map.write.off);
    case 'sensor_text':
    case 'select':
      return read.options?.[String(raw)] ?? String(raw);
    default:
      return scaled(raw, read);
  }
}

/**
 * The value a read gives on its own, as a discovery rule matches it: a bit, a text, an option's
 * meaning or a number scaled.
 *
 * @param read - The read.
 * @param wordOrder - Which register of a 32-bit value holds the high word.
 * @param registers - What the transport read.
 * @returns The value, or null when its registers were not read.
 */
export function modbusReadValueOf(
  read: ModbusRead,
  wordOrder: ModbusWordOrder,
  registers: ModbusRegisters,
): number | boolean | string | null {
  const raw = modbusRawOf(read, wordOrder, registers);

  if (raw === undefined) {
    return null;
  }

  return typeof raw === 'number' ? (read.options?.[String(raw)] ?? scaled(raw, read)) : raw;
}

/**
 * The range a level is spread over, in the read's units: the write's min and max, 0 to 100 unless
 * said.
 *
 * @param map - The level's read and write.
 * @returns The lowest and highest value.
 */
function levelRangeOf(map: ModbusCapabilityMap): { readonly min: number; readonly max: number } {
  return { min: map.write?.min ?? 0, max: map.write?.max ?? 100 };
}

/**
 * One capability's state from what the registers hold.
 *
 * @param capability - The capability.
 * @param map - Its read and write.
 * @param wordOrder - Which register of a 32-bit value holds the high word.
 * @param registers - What the transport read.
 * @returns The capability's state, or undefined when its registers were not read.
 */
function capabilityStateOf(
  capability: ModbusCapability,
  map: ModbusCapabilityMap,
  wordOrder: ModbusWordOrder,
  registers: ModbusRegisters,
): JsonObject | undefined {
  if (capability === 'button') {
    return {};
  }

  if (map.read === undefined) {
    return undefined;
  }

  const raw = modbusRawOf(map.read, wordOrder, registers);

  if (raw === undefined) {
    return undefined;
  }

  const value = modbusValueOf(capability, map, raw);

  switch (capability) {
    case 'sensor_binary':
    case 'on_off':
      return { isOn: value === true };
    case 'sensor_numeric':
    case 'number':
      return typeof value === 'number' ? { value } : undefined;
    case 'sensor_text':
      return { value: String(value).slice(0, 512) };
    case 'select':
      return typeof raw === 'number' ? { option: String(raw) } : undefined;
    case 'level': {
      if (typeof value !== 'number') {
        return undefined;
      }

      const { min, max } = levelRangeOf(map);
      const level = ((value - min) / (max - min)) * 100;

      return { level: Math.round(Math.min(100, Math.max(0, level)) * 10) / 10 };
    }
    default:
      return undefined;
  }
}

/**
 * An entity's identifier within its device: what stays when it is renamed.
 *
 * @param entity - The entity.
 * @returns Its id, or the one its name gives.
 */
export function modbusObjectIdOf(entity: ModbusEntity): string {
  return entity.id ?? modbusEntityIdOf(entity.name);
}

/**
 * What a capability declares to the house: a number's limits, a choice's options.
 *
 * @param capability - The capability.
 * @param map - Its read and write.
 * @returns Its params.
 */
function paramsOf(capability: ModbusCapability, map: ModbusCapabilityMap): JsonObject {
  switch (capability) {
    case 'level':
      return { hasTransition: false };
    case 'on_off':
      return { hasTransition: false };
    case 'number':
      return { min: map.write?.min ?? 0, max: map.write?.max ?? 1, step: map.write?.step ?? 1 };
    case 'select':
      return {
        options: Object.entries(map.read?.options ?? {}).map(([value, label]) => ({
          value,
          label,
        })),
      };
    default:
      return {};
  }
}

/**
 * An entity of a template as the house registers it.
 *
 * @param entity - The template's entity.
 * @returns Its descriptor.
 */
export function modbusEntityDescriptorOf(entity: ModbusEntity): EntityDescriptor {
  const capabilities = Object.fromEntries(
    Object.entries(entity.capabilities).map(([capability, map]) => [
      capability,
      paramsOf(capability as ModbusCapability, map),
    ]),
  ) as DeclaredCapabilities;
  const unit = (entity.capabilities.sensor_numeric ?? entity.capabilities.number)?.read?.unit;

  return {
    domain: entity.domain,
    objectId: modbusObjectIdOf(entity),
    name: entity.name,
    capabilities,
    ...(unit === undefined || unit === '' ? {} : { unitOfMeasurement: unit }),
  };
}

/**
 * Every capability's state of an entity from what the registers hold.
 *
 * A capability whose registers were not read - its block refused - keeps the state it had.
 *
 * @param entity - The entity.
 * @param wordOrder - Which register of a 32-bit value holds the high word.
 * @param registers - What the transport read.
 * @param previous - The entity's last state.
 * @returns Its state, or undefined when nothing of it was read and nothing was known.
 */
export function modbusEntityStateOf(
  entity: ModbusEntity,
  wordOrder: ModbusWordOrder,
  registers: ModbusRegisters,
  previous: CapabilityState | undefined,
): CapabilityState | undefined {
  const state: Record<string, unknown> = {};
  let isRead = false;

  for (const [capability, map] of Object.entries(entity.capabilities) as [
    ModbusCapability,
    ModbusCapabilityMap,
  ][]) {
    const read = capabilityStateOf(capability, map, wordOrder, registers);
    const kept = (previous as Record<string, unknown> | undefined)?.[capability];

    if (read !== undefined) {
      state[capability] = read;
      isRead ||= capability !== 'button';
    } else if (kept !== undefined) {
      state[capability] = kept;
    }
  }

  return isRead || previous !== undefined ? state : undefined;
}

/** What a command writes: the function, the address and the words or bits. */
export type ModbusWriteRequest = {
  readonly function: ModbusWriteFunction;
  readonly address: number;

  /** The word for 05 and 06, the bits for 15, the registers for 16. */
  readonly values: readonly number[];
};

/**
 * The words a raw number is written as, in the read's type.
 *
 * @param raw - The raw number.
 * @param type - How the registers hold it.
 * @param wordOrder - Which register of a 32-bit value holds the high word.
 * @returns The words.
 * @throws {ValidationError} When the number does not fit the type.
 */
function wordsOf(
  raw: number,
  type: 'u16' | 's16' | 'u32' | 's32' | 'f32',
  wordOrder: ModbusWordOrder,
): number[] {
  const view = new DataView(new ArrayBuffer(4));
  const limits = {
    u16: [0, 0xffff],
    s16: [-0x8000, 0x7fff],
    u32: [0, 0xffff_ffff],
    s32: [-0x8000_0000, 0x7fff_ffff],
    f32: [-Infinity, Infinity],
  }[type];

  if (raw < (limits[0] ?? 0) || raw > (limits[1] ?? 0)) {
    throw new ValidationError(`${String(raw)} does not fit a ${type} register`, {
      details: { raw, type },
    });
  }

  if (type === 'u16' || type === 's16') {
    return [raw & 0xffff];
  }

  if (type === 'f32') {
    view.setFloat32(0, raw);
  } else if (type === 'u32') {
    view.setUint32(0, raw);
  } else {
    view.setInt32(0, raw);
  }

  const high = view.getUint16(0);
  const low = view.getUint16(2);

  return wordOrder === 'high' ? [high, low] : [low, high];
}

/**
 * The words or bits a register write carries, for 05, 06, 15 or 16.
 *
 * @param fn - The write function.
 * @param word - The word: what 05 or 06 writes.
 * @param words - Every register, for 16.
 * @returns What goes in the request.
 */
function valuesFor(fn: ModbusWriteFunction, word: number, words: readonly number[]): number[] {
  return fn === 15 ? [word === 0 ? 0 : 1] : fn === 16 ? [...words] : [word];
}

/**
 * The number a command sets, checked against what the template allows.
 *
 * @param value - The value commanded.
 * @param map - The capability's read and write.
 * @returns The raw number to write.
 * @throws {ValidationError} When it is outside min and max.
 */
function rawOfValue(value: number, map: ModbusCapabilityMap): number {
  const { write, read } = map;

  if (
    (write?.min !== undefined && value < write.min) ||
    (write?.max !== undefined && value > write.max)
  ) {
    throw new ValidationError(
      `${String(value)} is outside ${String(write.min ?? '-∞')} to ${String(write.max ?? '∞')}`,
      { details: { value, min: write.min ?? null, max: write.max ?? null } },
    );
  }

  const raw = value / (read?.scale ?? 1);

  return read?.type === 'f32' ? raw : Math.round(raw);
}

/**
 * Turns a canonical command into the write that performs it.
 *
 * Refuses a value outside the capability's min and max here, so it never reaches the device.
 *
 * @param entity - The entity.
 * @param capability - The capability commanded.
 * @param command - The command, already checked against the capability.
 * @param wordOrder - Which register of a 32-bit value holds the high word.
 * @param previous - The entity's last state, for a toggle.
 * @returns The write.
 * @throws {ValidationError} When the capability is not written, or the value is refused.
 */
export function encodeModbusWrite(
  entity: ModbusEntity,
  capability: ModbusCapability,
  command: JsonObject,
  wordOrder: ModbusWordOrder,
  previous?: CapabilityState,
): ModbusWriteRequest {
  const map = entity.capabilities[capability];
  const write = map?.write;

  if (map === undefined || write === undefined) {
    throw new ValidationError(`${entity.name} cannot be commanded: ${capability} is only read`, {
      details: { entity: entity.name, capability },
    });
  }

  const fn = write.function;
  const isCoil = fn === 5 || fn === 15;
  const address = modbusWordOf(write.address ?? map.read?.address ?? 0);
  const type = map.read?.type === undefined || map.read.type === 'string' ? 'u16' : map.read.type;

  /**
   * The write of one raw number, in the type the register holds.
   *
   * @param raw - The raw number.
   * @returns The write.
   */
  const ofRaw = (raw: number): ModbusWriteRequest => {
    const words = wordsOf(raw, fn === 6 ? (type === 's16' ? 's16' : 'u16') : type, wordOrder);

    return { function: fn, address, values: valuesFor(fn, words[0] ?? 0, words) };
  };

  switch (capability) {
    case 'on_off': {
      const isOn =
        command['command'] === 'toggle'
          ? previous?.on_off?.isOn !== true
          : command['command'] === 'turn_on';
      const word = isOn
        ? modbusWordOf(write.on ?? (fn === 5 ? 0xff00 : 1))
        : modbusWordOf(write.off ?? 0);

      return { function: fn, address, values: valuesFor(fn, word, [word]) };
    }
    case 'button': {
      const word = modbusWordOf(write.value ?? (isCoil ? 0xff00 : 1));

      return { function: fn, address, values: valuesFor(fn, word, [word]) };
    }
    case 'level': {
      const { min, max } = levelRangeOf(map);
      const level = Number(command['level']);

      return ofRaw(
        rawOfValue(min + (Math.min(100, Math.max(0, level)) / 100) * (max - min), {
          ...map,
          write: { ...write, min, max },
        }),
      );
    }
    case 'number':
      return ofRaw(rawOfValue(Number(command['value']), map));
    case 'select': {
      const option = typeof command['option'] === 'string' ? command['option'] : '';

      if (map.read?.options?.[option] === undefined) {
        throw new ValidationError(`${entity.name} has no option ${option}`, {
          details: { entity: entity.name, option },
        });
      }

      return ofRaw(Number(option));
    }
    default:
      throw new ValidationError(`${entity.name} cannot be commanded: ${capability} is only read`, {
        details: { entity: entity.name, capability },
      });
  }
}

/** What the transport delivers for one poll: the registers read, or why none were. */
const inboundSchema = z.union([
  z.object({ registers: z.record(z.string(), z.number()) }),
  z.object({ error: z.string() }),
]);

/**
 * The device a claim was made for.
 *
 * @param descriptor - The claim's descriptor.
 * @returns The device, or undefined for anything that is not one.
 */
function snapshotOf(descriptor: unknown): ModbusDeviceSnapshot | undefined {
  const parsed = modbusDeviceSnapshotSchema.safeParse(descriptor);

  return parsed.success ? parsed.data : undefined;
}

/**
 * What a poll of a device asks the transport: where it is, how often, and the blocks.
 *
 * @param device - The device.
 * @returns The poll's arguments.
 */
export function modbusPollOf(device: ModbusDeviceSnapshot): JsonObject {
  return {
    deviceKey: device.deviceKey,
    host: device.host,
    port: device.port,
    unitId: device.unitId,
    framing: device.framing,
    everyMs: device.pollSeconds * 1000,
    blocks: planModbusBlocks(device.template).map((block) => ({ ...block })),
  };
}

/**
 * Builds the Modbus driver of a vendor: the platform's own, or one whose `driver.json` says
 * `"kind": "modbus"`.
 *
 * @param manifest - The driver's.
 * @param manifest.id - Its kind, `vendor/driver`.
 * @returns The integration.
 */
export function createModbusIntegration(manifest: { readonly id: string }): Integration {
  /**
   * The device a claim was made for.
   *
   * @param context - The instance's mapping context.
   * @returns The device.
   * @throws {ValidationError} When the claim holds no device - which identification never makes.
   */
  const claimed = (context: MappingContext): ModbusDeviceSnapshot => {
    const device = snapshotOf(context.claim.descriptor);

    if (device === undefined) {
      throw new ValidationError(`${manifest.id} holds a claim that is not a Modbus device`, {
        details: { integration: manifest.id },
      });
    }

    return device;
  };

  return {
    id: manifest.id,
    transport: MODBUS_TRANSPORT,
    optionsSchema: jsonObjectSchema,
    discovery: {},

    /**
     * Claims a device the broker hands over as this driver's.
     *
     * @param discovered - What the transport handed over.
     * @returns The claim, or null for anything that is not one of this driver's devices.
     */
    claim: (discovered: Discovered) => {
      const device = snapshotOf(discovered.payload);

      return device?.kind !== manifest.id
        ? null
        : { deviceKey: device.deviceKey, externalId: device.deviceKey, descriptor: device };
    },

    /**
     * Polls each device at its pace, for the blocks its template reads.
     *
     * @param claims - The devices.
     * @returns One poll per device.
     */
    subscriptions: (claims) =>
      claims.flatMap((claim) => {
        const device = snapshotOf(claim.descriptor);

        return device === undefined ? [] : [{ op: 'poll', args: modbusPollOf(device) }];
      }),

    /**
     * Describes the device and its entities, from its template.
     *
     * @param claim - The claim.
     * @returns The device.
     * @throws {ValidationError} When the claim holds no Modbus device.
     */
    describe: (claim) => {
      const device = snapshotOf(claim.descriptor);

      if (device === undefined) {
        throw new ValidationError(`${manifest.id} cannot describe a claim with no Modbus device`, {
          details: { integration: manifest.id },
        });
      }

      const { template } = device;

      return {
        externalId: claim.externalId,
        name: device.name,
        model: (template.device === '' ? template.name : template.device).slice(0, 128),
        entities: template.entities.map(modbusEntityDescriptorOf),
      };
    },

    /**
     * Turns what a poll read into reports, one per entity; every entity unavailable when the
     * device did not answer.
     *
     * @param message - What the transport delivered.
     * @param context - The identifiers the hub assigned, and the last states.
     * @returns The reports.
     */
    toState: (message: TransportInbound, context: MappingContext): ReportedState[] => {
      const parsed = inboundSchema.safeParse(message.payload);
      const device = snapshotOf(context.claim.descriptor);

      if (!parsed.success || device === undefined) {
        return [];
      }

      return device.template.entities.flatMap((entity): ReportedState[] => {
        const entityId = context.entities.get(modbusObjectIdOf(entity));

        if (entityId === undefined) {
          return [];
        }

        const previous = context.lastState(entityId);

        if ('error' in parsed.data) {
          return [{ entityId, state: previous ?? {}, attributes: {}, isAvailable: false }];
        }

        const state = modbusEntityStateOf(
          entity,
          device.template.wordOrder,
          parsed.data.registers,
          previous,
        );

        return state === undefined ? [] : [{ entityId, state, attributes: {}, isAvailable: true }];
      });
    },

    /**
     * Turns a command into the write that performs it.
     *
     * @param target - The entity, the capability and the command.
     * @param context - The claim and the last states.
     * @returns The request.
     * @throws {ValidationError} When the entity does not take the command, or the value is
     * outside its min and max.
     */
    toCommand: (target: CommandTarget, context: MappingContext): TransportRequest => {
      const device = claimed(context);
      const entity = device.template.entities.find(
        (candidate) => context.entities.get(modbusObjectIdOf(candidate)) === target.entityId,
      );

      if (entity === undefined) {
        throw new ValidationError(`${manifest.id} has no entity ${target.entityId}`, {
          details: { integration: manifest.id, entityId: target.entityId },
        });
      }

      const write = encodeModbusWrite(
        entity,
        target.capability as ModbusCapability,
        target.command,
        device.template.wordOrder,
        context.lastState(target.entityId),
      );

      return {
        deviceKey: device.deviceKey,
        op: 'write',
        args: {
          host: device.host,
          port: device.port,
          unitId: device.unitId,
          framing: device.framing,
          function: write.function,
          address: write.address,
          values: [...write.values],
        },
      };
    },
  };
}
