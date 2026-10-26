/**
 * The house's Modbus broker, as the hub runs it and the Brokers page shows it.
 *
 * Modbus is one of the platform's brokers: the hub is the house's Modbus TCP client. Every
 * gateway - a Modbus TCP device, or a transparent RS485 adapter carrying RTU frames over TCP - is
 * reached through one connection, one request at a time, whoever's devices are behind it. A
 * gateway answers one client; two of them asking at once is how a dongle stops answering both.
 *
 * Modbus says nothing about what a register means, so a device is read through a **template**: its
 * entities, each capability mapped to the register it is read from and the command it is written
 * with. The owner writes templates of their own; an integration ships its own as drivers of kind
 * `modbus`. A device is a template at an address - host, port, unit - and becomes a device of the
 * house through the platform's own `modbus` vendor, or of the integration whose template it is.
 *
 * The broker recognises nothing on its own. A server found on the network is named only by an
 * integration whose `discovery.json` `modbus` rules read it and match.
 */
import { z } from 'zod';

import { BROKER_STATES } from './brokers.js';
import { integrationIdSchema, integrationKindIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { timestampSchema } from './timestamp.js';

/** The platform transport every Modbus device is reached through. */
export const MODBUS_TRANSPORT = 'modbus';

/** The platform's own vendor: the devices read through the owner's templates. */
export const MODBUS_VENDOR = 'modbus';

/** The driver of the platform's own vendor, which reads a device through its template. */
export const MODBUS_GENERIC_KIND = `${MODBUS_VENDOR}/generic`;

/** The TCP port Modbus servers listen on unless told otherwise. */
export const MODBUS_PORT = 502;

/** Where the broker stands. */
export const HUB_MODBUS_STATUS_METHOD = 'modbus_status';

/** The house's Modbus devices, with how each answers. */
export const HUB_MODBUS_DEVICES_METHOD = 'modbus_devices';

/** Saves a device, new or changed. */
export const HUB_MODBUS_DEVICE_SAVE_METHOD = 'modbus_device_save';

/** Removes a device. */
export const HUB_MODBUS_DEVICE_REMOVE_METHOD = 'modbus_device_remove';

/** The owner's templates, and those integrations ship. */
export const HUB_MODBUS_TEMPLATES_METHOD = 'modbus_templates';

/** Saves one of the owner's templates, new or changed. */
export const HUB_MODBUS_TEMPLATE_SAVE_METHOD = 'modbus_template_save';

/** Removes one of the owner's templates no device uses. */
export const HUB_MODBUS_TEMPLATE_REMOVE_METHOD = 'modbus_template_remove';

/** Saves the owner's settings, which starts a search when it is on. */
export const HUB_MODBUS_SETTINGS_METHOD = 'modbus_settings';

/** Starts a search of the network now. */
export const HUB_MODBUS_SEARCH_METHOD = 'modbus_search';

/** The servers the last searches found that are not devices yet, and those the owner ignores. */
export const HUB_MODBUS_FOUND_METHOD = 'modbus_found';

/** Ignores a server found on the network, or stops ignoring it. */
export const HUB_MODBUS_IGNORE_METHOD = 'modbus_ignore';

/** Asks a server whether it answers, and which integrations recognise it. */
export const HUB_MODBUS_IDENTIFY_METHOD = 'modbus_identify';

/** Reads one capability of a template from a server, as the editor's test does. */
export const HUB_MODBUS_TEST_READ_METHOD = 'modbus_test_read';

/** Sends one command of a template to a server, as the editor's test does. */
export const HUB_MODBUS_TEST_WRITE_METHOD = 'modbus_test_write';

/** Reads every entity of a template from a server once. */
export const HUB_MODBUS_TEST_TEMPLATE_METHOD = 'modbus_test_template';

/** How frames travel: Modbus TCP, or RTU frames carried over TCP by a transparent adapter. */
export const MODBUS_FRAMINGS = ['tcp', 'rtu'] as const;

/** How frames travel. */
export type ModbusFraming = (typeof MODBUS_FRAMINGS)[number];

/** The function codes a value is read with: coils, discrete inputs, holding and input registers. */
export const MODBUS_READ_FUNCTIONS = [1, 2, 3, 4] as const;

/** The function codes a value is written with: one coil, one register, coils, registers. */
export const MODBUS_WRITE_FUNCTIONS = [5, 6, 15, 16] as const;

/** A read function code. */
export type ModbusReadFunction = (typeof MODBUS_READ_FUNCTIONS)[number];

/** A write function code. */
export type ModbusWriteFunction = (typeof MODBUS_WRITE_FUNCTIONS)[number];

/** How registers hold a value: one or two registers as integers or a float, or ASCII text. */
export const MODBUS_VALUE_TYPES = ['u16', 's16', 'u32', 's32', 'f32', 'string'] as const;

/** How registers hold a value. */
export type ModbusValueType = (typeof MODBUS_VALUE_TYPES)[number];

/** The domains a template's entity can be. */
export const MODBUS_DOMAINS = [
  'sensor',
  'binary_sensor',
  'switch',
  'light',
  'number',
  'select',
  'button',
] as const;

/** A domain a template's entity can be. */
export type ModbusDomain = (typeof MODBUS_DOMAINS)[number];

/** The capabilities a template maps. */
export const MODBUS_CAPABILITIES = [
  'sensor_numeric',
  'sensor_text',
  'sensor_binary',
  'on_off',
  'level',
  'number',
  'select',
  'button',
] as const;

/** A capability a template maps. */
export type ModbusCapability = (typeof MODBUS_CAPABILITIES)[number];

/**
 * The capabilities each domain takes: those it must have, and those it may add.
 *
 * A sensor is a number or a text; a light switches and may dim.
 */
export const MODBUS_DOMAIN_CAPABILITIES: Readonly<
  Record<
    ModbusDomain,
    { readonly oneOf: readonly ModbusCapability[]; readonly may: readonly ModbusCapability[] }
  >
> = {
  sensor: { oneOf: ['sensor_numeric', 'sensor_text'], may: [] },
  binary_sensor: { oneOf: ['sensor_binary'], may: [] },
  switch: { oneOf: ['on_off'], may: [] },
  light: { oneOf: ['on_off'], may: ['level'] },
  number: { oneOf: ['number'], may: [] },
  select: { oneOf: ['select'], may: [] },
  button: { oneOf: ['button'], may: [] },
};

/** The capabilities whose value is on or off, read from a bit. */
const BOOLEAN_CAPABILITIES: ReadonlySet<ModbusCapability> = new Set(['sensor_binary', 'on_off']);

/** The capabilities only read, never written. */
const READ_ONLY_CAPABILITIES: ReadonlySet<ModbusCapability> = new Set([
  'sensor_numeric',
  'sensor_text',
  'sensor_binary',
]);

/** A register's address or a 16-bit word: 0 to 65535, or written as `0x` and up to four hex digits. */
export const modbusWordSchema = z.union([
  z.int().min(0).max(0xffff),
  z.string().regex(/^0x[0-9a-fA-F]{1,4}$/u, 'A number from 0 to 65535, or 0x0000 to 0xFFFF'),
]);

/** A register's address or a word, as written. */
export type ModbusWord = z.output<typeof modbusWordSchema>;

/**
 * The number an address or a word is, however it was written.
 *
 * @param word - As the template says it.
 * @returns The number.
 */
export function modbusWordOf(word: ModbusWord): number {
  return typeof word === 'number' ? word : Number.parseInt(word.slice(2), 16);
}

/**
 * How many registers a value of a type takes.
 *
 * @param type - How the registers hold it.
 * @param count - How many a text takes.
 * @returns Two for 32 bits, `count` for text, one otherwise.
 */
export function modbusRegistersOf(type: ModbusValueType, count = 1): number {
  return type === 'string' ? count : type === 'u32' || type === 's32' || type === 'f32' ? 2 : 1;
}

/** Where a capability's value is read from, and how it is turned into one. */
export const modbusReadSchema = z.strictObject({
  function: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  address: modbusWordSchema,

  /** How the registers hold it; one unsigned register unless said. Not for coils and inputs. */
  type: z.enum(MODBUS_VALUE_TYPES).optional(),

  /** How many registers a text takes. */
  count: z.int().min(1).max(64).optional(),

  /** The bit of a register an on/off value is, 0 the lowest. */
  bit: z.int().min(0).max(15).optional(),

  /** What the raw number is multiplied by: 0.1 for tenths. */
  scale: z
    .number()
    .refine((scale) => scale !== 0, 'Not zero')
    .optional(),
  unit: z.string().trim().max(16).optional(),

  /** What each raw number means, for a choice or a text: `{ "0": "Off", "1": "Eco" }`. */
  options: z
    .record(z.string().regex(/^-?\d{1,10}$/u, 'A whole number'), z.string().trim().min(1).max(64))
    .optional(),
});

/** Where a capability's value is read from. */
export type ModbusRead = z.output<typeof modbusReadSchema>;

/** What a capability's command writes, and within what. */
export const modbusWriteSchema = z.strictObject({
  function: z.union([z.literal(5), z.literal(6), z.literal(15), z.literal(16)]),

  /** Where; the read's address when left out, if the read's table can be written. */
  address: modbusWordSchema.optional(),

  /** The words on and off are written as; 0xFF00 and 0 for a coil, 1 and 0 for a register. */
  on: modbusWordSchema.optional(),
  off: modbusWordSchema.optional(),

  /** The values a number may be set to; a value outside them never reaches the device. */
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),

  /** The word a button writes when pressed. */
  value: modbusWordSchema.optional(),
});

/** What a capability's command writes. */
export type ModbusWrite = z.output<typeof modbusWriteSchema>;

/** One capability of an entity: where it is read, and what its command writes. */
export const modbusCapabilityMapSchema = z.strictObject({
  read: modbusReadSchema.optional(),
  write: modbusWriteSchema.optional(),
});

/** One capability of an entity. */
export type ModbusCapabilityMap = z.output<typeof modbusCapabilityMapSchema>;

/** An entity's own part of its identifier: what stays when it is renamed. */
export const MODBUS_ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,39}$/u;

/**
 * The identifier an entity of that name is given: lower case, words joined by `_`.
 *
 * @param name - The entity's name.
 * @returns Its identifier, `entity` when the name has no letter or digit.
 */
export function modbusEntityIdOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 40)
    .replace(/_+$/u, '');

  return slug === '' ? 'entity' : slug;
}

/** One entity of a template. */
export const modbusEntitySchema = z.strictObject({
  /** What it stays when renamed; given from the name when saved. */
  id: z.string().regex(MODBUS_ENTITY_ID_PATTERN, 'Lower-case letters, digits and _').optional(),
  name: z.string().trim().min(1, 'Needed: a name').max(64),
  domain: z.enum(MODBUS_DOMAINS),
  capabilities: z.partialRecord(z.enum(MODBUS_CAPABILITIES), modbusCapabilityMapSchema),
});

/** One entity of a template. */
export type ModbusEntity = z.output<typeof modbusEntitySchema>;

/**
 * A template's fields, before the rules that tie them together: what the editor reads a file with
 * to show a refused template's problems on its blocks.
 */
export const modbusTemplateFieldsSchema = z.strictObject({
  name: z.string().trim().min(1, 'Needed: a name').max(64),

  /** The device it is for, as its maker names it. */
  device: z.string().trim().max(128).default(''),

  /** Where such a device usually listens, offered when one is added. */
  port: z.int().min(1).max(65_535).default(MODBUS_PORT),
  unitId: z.int().min(1).max(247).default(1),

  /** Which register of a 32-bit value holds the high word: the first, or the second. */
  wordOrder: z.enum(['high', 'low']).default('high'),

  /** How often the device is read. */
  pollSeconds: z.int().min(1).max(3600).default(10),
  entities: z.array(modbusEntitySchema).min(1, 'Add at least one entity').max(256),
});

/**
 * Says what is wrong with one capability's mapping, or nothing.
 *
 * @param capability - The capability.
 * @param map - Its read and write.
 * @param add - Reports a problem at a path below the capability.
 */
function checkCapability(
  capability: ModbusCapability,
  map: ModbusCapabilityMap,
  add: (path: readonly (string | number)[], message: string) => void,
): void {
  const { read, write } = map;
  const isBoolean = BOOLEAN_CAPABILITIES.has(capability);

  if (read === undefined && capability !== 'button' && capability !== 'level') {
    add(['read'], 'Needed: where the value is read from');
  }

  if (read !== undefined) {
    const isBitTable = read.function === 1 || read.function === 2;

    if (capability === 'button') {
      add(['read'], 'A button is only pressed: leave the read out');
    } else if (isBitTable && !isBoolean) {
      add(
        ['read', 'function'],
        capability === 'sensor_text'
          ? 'A text is read from registers: use 03 or 04'
          : 'A number is read from registers: use 03 or 04',
      );
    }

    if (isBitTable && read.type !== undefined) {
      add(['read', 'type'], 'Coils and inputs are bits: leave the type out');
    }

    if (read.bit !== undefined && (isBitTable || !isBoolean)) {
      add(['read', 'bit'], 'A bit is read from a register, for an on/off value');
    }

    if (read.type === 'string' && read.count === undefined) {
      add(['read', 'count'], 'Needed: how many registers the text takes');
    }

    if (read.count !== undefined && read.type !== 'string') {
      add(['read', 'count'], 'Only a text takes several registers');
    }

    if (read.type === 'string' && capability !== 'sensor_text') {
      add(['read', 'type'], 'Only a text sensor reads a string');
    }

    if (capability === 'sensor_text' && read.type !== 'string' && read.options === undefined) {
      add(['read', 'type'], 'A text is a string, or a number with options');
    }

    if (capability === 'select' && read.options === undefined) {
      add(['read', 'options'], 'Needed: what each value means');
    }
  }

  if (write === undefined) {
    if (capability === 'button' || capability === 'number' || capability === 'select') {
      add(['write'], 'Needed: what the command writes');
    }

    if (capability === 'level' && read === undefined) {
      add(['read'], 'Needed: where the value is read from, or what is written');
    }

    return;
  }

  if (READ_ONLY_CAPABILITIES.has(capability)) {
    add(['write'], 'A sensor is only read: leave the write out');

    return;
  }

  const isCoilWrite = write.function === 5 || write.function === 15;

  if (isCoilWrite && !isBoolean && capability !== 'button') {
    add(['write', 'function'], 'A number is written to registers: use 06 or 16');
  }

  if (write.address === undefined) {
    if (read === undefined) {
      add(['write', 'address'], 'Needed: there is no read to take it from');
    } else if (read.function === 2 || read.function === 4) {
      add(
        ['write', 'address'],
        `Needed: function 0${String(read.function)} reads a table that cannot be written`,
      );
    } else if (read.function === 1 && !isCoilWrite) {
      add(['write', 'function'], 'The read is a coil: write it with 05 or 15');
    } else if (read.function === 3 && isCoilWrite) {
      add(['write', 'function'], 'The read is a register: write it with 06 or 16');
    }
  }

  const type = read?.type ?? 'u16';

  if (write.function === 6 && modbusRegistersOf(type) === 2) {
    add(['write', 'function'], 'A 32-bit value takes two registers: use 16');
  }

  if (capability === 'number') {
    if (write.min === undefined) {
      add(['write', 'min'], 'Needed: the lowest value');
    }

    if (write.max === undefined) {
      add(['write', 'max'], 'Needed: the highest value');
    }

    if (write.min !== undefined && write.max !== undefined && write.min >= write.max) {
      add(['write', 'max'], 'Must be above min');
    }
  } else if (write.min !== undefined && write.max !== undefined && write.min >= write.max) {
    add(['write', 'max'], 'Must be above min');
  }
}

/**
 * A template: the device's entities, each capability mapped to the register it is read from and
 * the command it is written with.
 *
 * Every rule that ties fields together is here, so the editor's blocks, its file and the hub
 * refuse the same templates with the same words.
 */
export const modbusTemplateSchema = modbusTemplateFieldsSchema.superRefine((template, context) => {
  const ids = new Set<string>();

  template.entities.forEach((entity, index) => {
    /**
     * Reports a problem of this entity.
     *
     * @param path - Where, below the entity.
     * @param message - What, in a sentence.
     */
    const add = (path: readonly (string | number)[], message: string): void => {
      context.addIssue({ code: 'custom', path: ['entities', index, ...path], message });
    };
    const id = entity.id ?? modbusEntityIdOf(entity.name);

    if (ids.has(id)) {
      add([entity.id === undefined ? 'name' : 'id'], 'Another entity has the same id');
    }

    ids.add(id);

    const rule = MODBUS_DOMAIN_CAPABILITIES[entity.domain];
    const mapped = Object.keys(entity.capabilities) as ModbusCapability[];
    const required = mapped.filter((capability) => rule.oneOf.includes(capability));

    if (required.length !== 1) {
      add(['capabilities'], `A ${entity.domain} has ${rule.oneOf.join(' or ')}`);
    }

    for (const capability of mapped) {
      if (!rule.oneOf.includes(capability) && !rule.may.includes(capability)) {
        add(['capabilities', capability], `A ${entity.domain} has no ${capability}`);

        continue;
      }

      const map = entity.capabilities[capability];

      if (map !== undefined) {
        checkCapability(capability, map, (path, message) => {
          add(['capabilities', capability, ...path], message);
        });
      }
    }
  });
});

/** A template, as written. */
export type ModbusTemplateInput = z.input<typeof modbusTemplateSchema>;

/** A template, checked. */
export type ModbusTemplate = z.output<typeof modbusTemplateSchema>;

/**
 * The template with every entity's id filled in from its name, as it is saved: renaming an entity
 * afterwards keeps its id, so the entity of the house it is stays the same.
 *
 * @param template - The template.
 * @returns The same, every entity with an id.
 */
export function withModbusEntityIds(template: ModbusTemplate): ModbusTemplate {
  return {
    ...template,
    entities: template.entities.map((entity) =>
      entity.id === undefined ? { ...entity, id: modbusEntityIdOf(entity.name) } : entity,
    ),
  };
}

/** The widest network a range may name: a /16. */
const NARROWEST_PREFIX = 16;

/** The most addresses one range may hold, and all of them together. */
export const MODBUS_SEARCH_MAXIMUM = 65_536;

/**
 * The number an IPv4 address is.
 *
 * @param text - Dotted, `192.168.1.7`.
 * @returns The number, or null for anything that is not an address.
 */
function ipv4Of(text: string): number | null {
  const parts = text.trim().split('.');

  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) {
    return null;
  }

  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}

/**
 * The addresses a range the owner wrote names.
 *
 * @param text - A network `10.0.0.0/24` (a /16 to a /32), a span `10.0.0.20-10.0.0.40` of at most
 * 65536 addresses, or one address.
 * @returns The first and last address as numbers, or null when it is none of those.
 */
export function ipv4RangeOf(
  text: string,
): { readonly first: number; readonly last: number } | null {
  const trimmed = text.trim();
  const network = /^([\d.]+)\/(\d{1,2})$/u.exec(trimmed);

  if (network !== null) {
    const base = ipv4Of(network[1] ?? '');
    const prefix = Number(network[2]);

    if (base === null || prefix < NARROWEST_PREFIX || prefix > 32) {
      return null;
    }

    const size = 2 ** (32 - prefix);
    const first = base - (base % size);

    return { first, last: first + size - 1 };
  }

  const span = /^([\d.]+)\s*-\s*([\d.]+)$/u.exec(trimmed);

  if (span !== null) {
    const first = ipv4Of(span[1] ?? '');
    const last = ipv4Of(span[2] ?? '');

    return first === null ||
      last === null ||
      last < first ||
      last - first + 1 > MODBUS_SEARCH_MAXIMUM
      ? null
      : { first, last };
  }

  const single = ipv4Of(trimmed);

  return single === null ? null : { first: single, last: single };
}

/**
 * The dotted address a number is.
 *
 * @param address - The number.
 * @returns `192.168.1.7`.
 */
export function ipv4Text(address: number): string {
  return [24, 16, 8, 0].map((shift) => String(Math.floor(address / 2 ** shift) % 256)).join('.');
}

/** The owner's settings: whether and where the network is searched, and how often. */
export const modbusSettingsSchema = z
  .object({
    isSearchEnabled: z.boolean().default(false),

    /** Where to search; the networks the hub is on, up to a /22 each, when there is none. */
    ranges: z
      .array(
        z
          .string()
          .trim()
          .max(64)
          .refine(
            (range) => ipv4RangeOf(range) !== null,
            'Not a range: write 10.0.0.0/24, 10.0.0.20-10.0.0.40 or 10.0.0.7',
          ),
      )
      .max(16)
      .default([]),
    intervalMinutes: z.int().min(15).max(1440).default(120),
  })
  .refine(
    (settings) =>
      settings.ranges.reduce((total, range) => {
        const span = ipv4RangeOf(range);

        return total + (span === null ? 0 : span.last - span.first + 1);
      }, 0) <= MODBUS_SEARCH_MAXIMUM,
    { message: `At most ${String(MODBUS_SEARCH_MAXIMUM)} addresses in all`, path: ['ranges'] },
  );

/** The owner's settings. */
export type ModbusSettings = z.output<typeof modbusSettingsSchema>;

/** A host: an IPv4 address or a name. */
const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/u, 'An address or a host name');

/** Where a server is: its host and port, and how frames travel to it. */
export const modbusServerSchema = z.object({
  host: hostSchema,
  port: z.int().min(1).max(65_535).default(MODBUS_PORT),
  framing: z.enum(MODBUS_FRAMINGS).default('tcp'),
});

/** Where a server is. */
export type ModbusServer = z.output<typeof modbusServerSchema>;

/** One device behind a server: the server, and its unit. */
export const modbusTargetSchema = modbusServerSchema.extend({
  unitId: z.int().min(1).max(247).default(1),
});

/** One device behind a server. */
export type ModbusTarget = z.output<typeof modbusTargetSchema>;

/** One search of the network, as it ended. */
export const modbusSearchRunSchema = z.object({
  at: timestampSchema,
  durationMs: z.int().min(0),

  /** How many addresses it knocked on, and how many answered on the port. */
  addresses: z.int().min(0),
  answered: z.int().min(0),
});

/** One search of the network. */
export type ModbusSearchRun = z.output<typeof modbusSearchRunSchema>;

/** Where the broker stands, as the Brokers page shows it. */
export const modbusStatusSchema = z.object({
  state: z.enum(BROKER_STATES),
  error: z.string().max(2048).nullable(),
  startedAt: timestampSchema.nullable(),
  settings: modbusSettingsSchema,

  search: z.object({
    isRunning: z.boolean(),
    lastRun: modbusSearchRunSchema.nullable(),

    /** When the next one starts; null while searching is off. */
    nextAt: timestampSchema.nullable(),
  }),

  devices: z.object({ total: z.int().min(0), online: z.int().min(0) }),

  /** How many servers the hub holds a connection to. */
  gateways: z.int().min(0),

  /** Requests in the last minute, and how long they took on average; null before any. */
  requestsPerMinute: z.int().min(0),
  averageMs: z.number().min(0).nullable(),
});

/** Where the broker stands. */
export type ModbusStatus = z.output<typeof modbusStatusSchema>;

/** How a device answers: it does, it does not, or it has not been read yet. */
export const MODBUS_DEVICE_STATES = ['online', 'offline', 'waiting'] as const;

/** A device, as the owner adds it: a template at an address. */
export const modbusDeviceInputSchema = modbusTargetSchema.extend({
  /** Its id; a new one is given one. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(128),

  /** The template it is read with: one of the owner's, by id, or an integration's driver. */
  template: z.union([z.uuid(), integrationKindIdSchema]),

  /** How often it is read, instead of what the template says; null for the template's. */
  pollSeconds: z.int().min(1).max(3600).nullable().default(null),
});

/** A device, as the owner adds it. */
export type ModbusDeviceInput = z.output<typeof modbusDeviceInputSchema>;

/** A device of the house, with how it answers. */
export const modbusDeviceSchema = modbusDeviceInputSchema.extend({
  id: z.uuid(),

  /** The template's name; null when it is gone - an integration removed. */
  templateName: z.string().max(64).nullable(),

  /** The integration whose template it is; null for one of the owner's. */
  vendorId: z.string().regex(VENDOR_ID_PATTERN).nullable(),

  /** How often it is read now. */
  everySeconds: z.int().min(1),
  state: z.enum(MODBUS_DEVICE_STATES),
  lastReadAt: timestampSchema.nullable(),

  /** Why the last read failed, in a sentence; null when it did not. */
  lastError: z.string().max(512).nullable(),

  /** The device added for it; null until it is. */
  deviceId: integrationIdSchema.nullable(),
});

/** A device of the house. */
export type ModbusDevice = z.output<typeof modbusDeviceSchema>;

/** Every device, by name. */
export const modbusDevicesReplySchema = z.object({ items: z.array(modbusDeviceSchema) });

/** Removes a device. */
export const modbusIdRequestSchema = z.object({ id: z.uuid() });

/** Whether there was such a thing. */
export const modbusRemoveReplySchema = z.object({ isRemoved: z.boolean() });

/** A template, with whose it is and who uses it. */
export const modbusTemplateRecordSchema = z.object({
  /** One of the owner's by uuid, or an integration's by its driver: `vendor/driver`. */
  id: z.string().min(1).max(160),

  /** The integration that ships it, and its name; null for one of the owner's. */
  vendorId: z.string().regex(VENDOR_ID_PATTERN).nullable(),
  vendorName: z.string().max(128).nullable(),
  document: modbusTemplateSchema,

  /** An integration's is read-only: it is duplicated to be changed. */
  isReadOnly: z.boolean(),
  usedBy: z.int().min(0),
  updatedAt: timestampSchema.nullable(),
});

/** A template, with whose it is. */
export type ModbusTemplateRecord = z.output<typeof modbusTemplateRecordSchema>;

/** Every template: the owner's, then the integrations'. */
export const modbusTemplatesReplySchema = z.object({ items: z.array(modbusTemplateRecordSchema) });

/** Saves one of the owner's templates. */
export const modbusTemplateSaveRequestSchema = z.object({
  id: z.uuid().optional(),
  document: modbusTemplateSchema,
});

/** An integration that recognises a server, and the driver it would read it with. */
export const modbusClaimSchema = z.object({
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  vendorName: z.string().max(128),

  /** The driver it would be added as; null when the integration has no template for it. */
  kind: integrationKindIdSchema.nullable(),
  model: z.string().max(128).nullable(),
  unitId: z.int().min(1).max(247),
});

/** An integration that recognises a server. */
export type ModbusClaim = z.output<typeof modbusClaimSchema>;

/** A server the network search found that is not a device of the house. */
export const modbusFoundSchema = z.object({
  host: z.string().max(253),
  port: z.int().min(1).max(65_535),
  foundAt: timestampSchema,
  claims: z.array(modbusClaimSchema).max(16),
});

/** A server found on the network. */
export type ModbusFound = z.output<typeof modbusFoundSchema>;

/** A server the owner ignores: it is never offered again. */
export const modbusIgnoredSchema = z.object({
  host: z.string().max(253),
  port: z.int().min(1).max(65_535),
  at: timestampSchema,
});

/** The servers found, and those ignored. */
export const modbusFoundReplySchema = z.object({
  items: z.array(modbusFoundSchema),
  ignored: z.array(modbusIgnoredSchema),
});

/** Ignores a server, or stops ignoring it. */
export const modbusIgnoreRequestSchema = z.object({
  host: hostSchema,
  port: z.int().min(1).max(65_535),
  isIgnored: z.boolean(),
});

/** How many servers are ignored now. */
export const modbusIgnoreReplySchema = z.object({ count: z.int().min(0) });

/** Asks a device whether it answers, and who recognises it. */
export const modbusIdentifyRequestSchema = z.object({ target: modbusTargetSchema });

/** Whether it answered, how fast, and the integrations whose rules match it. */
export const modbusIdentifyReplySchema = z.object({
  isAnswering: z.boolean(),
  ms: z.int().min(0).nullable(),

  /** Why it did not answer, or the exception it answered with, in a sentence. */
  error: z.string().max(512).nullable(),
  claims: z.array(modbusClaimSchema).max(16),
});

/** What a test read or write sent and got back. */
const exchangeShape = {
  /** The request's PDU, hex: `01 00 00 00 01`. */
  request: z.string().max(1024),

  /** The answer's PDU, hex; null when none came. */
  response: z.string().max(1024).nullable(),

  /** Why it failed, in a sentence; null when it did not. */
  error: z.string().max(512).nullable(),
  ms: z.int().min(0),
};

/** A value as a test shows it. */
const testValueSchema = z.union([z.number(), z.string(), z.boolean()]).nullable();

/** Reads one capability of an entity from a device. */
export const modbusTestReadRequestSchema = z.object({
  target: modbusTargetSchema,
  wordOrder: z.enum(['high', 'low']).default('high'),
  read: modbusReadSchema,
});

/** What was read, raw and as the capability's value. */
export const modbusTestReadReplySchema = z.object({
  ...exchangeShape,
  raw: z.array(z.int()).max(128).nullable(),
  value: testValueSchema,
});

/** Sends one command of an entity to a device. */
export const modbusTestWriteRequestSchema = z.object({
  target: modbusTargetSchema,
  wordOrder: z.enum(['high', 'low']).default('high'),
  entity: modbusEntitySchema,
  capability: z.enum(MODBUS_CAPABILITIES),
  command: z.record(z.string(), z.unknown()),
});

/** What was sent and what came back. */
export const modbusTestWriteReplySchema = z.object(exchangeShape);

/** Reads every entity of a template from a device once. */
export const modbusTestTemplateRequestSchema = z.object({
  target: modbusTargetSchema,
  document: modbusTemplateSchema,
});

/** Every capability's value, or why it could not be read. */
export const modbusTestTemplateReplySchema = z.object({
  at: timestampSchema,
  ms: z.int().min(0),
  values: z.array(
    z.object({
      entity: z.int().min(0),
      capability: z.enum(MODBUS_CAPABILITIES),
      value: testValueSchema,
      error: z.string().max(512).nullable(),
    }),
  ),
});
