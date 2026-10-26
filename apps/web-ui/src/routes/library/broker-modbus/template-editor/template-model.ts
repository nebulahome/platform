/**
 * The template editor's model: a template as the blocks edit it, the file it is written as, and
 * what is wrong with it.
 *
 * The blocks hold every field as it was typed - an address as `0x000A` or `10`, a scale as `0.1`
 * - so typing is never fought; the document is made from them when it is checked, written or
 * saved, and the blocks are made back from a file that parses. Every rule is the contract's
 * (`modbusTemplateSchema`): the editor, the file and the hub refuse the same template with the
 * same words, each problem shown where its field is.
 */
import {
  MODBUS_DOMAIN_CAPABILITIES,
  modbusEntityIdOf,
  modbusTemplateFieldsSchema,
  modbusTemplateSchema,
  type ModbusCapability,
  type ModbusDomain,
  type ModbusTemplate,
} from '@nebulahome/contracts';

/** A read as the blocks hold it: every field as typed. */
export type ReadDraft = {
  readonly function: number;
  readonly address: string;
  readonly type: string;
  readonly count: string;
  readonly bit: string;
  readonly scale: string;
  readonly unit: string;

  /** What each raw number means, as typed: `0=Off, 1=Eco`. */
  readonly options: string;
};

/** A write as the blocks hold it. */
export type WriteDraft = {
  readonly function: number;

  /** Empty for the read's own address. */
  readonly address: string;
  readonly on: string;
  readonly off: string;
  readonly min: string;
  readonly max: string;
  readonly step: string;
  readonly value: string;
};

/** One capability: its read and its write, each there or not. */
export type CapabilityDraft = {
  readonly read: ReadDraft | null;
  readonly write: WriteDraft | null;
};

/** One entity as a block holds it. */
export type EntityDraft = {
  /** A key for the list, never saved. */
  readonly key: string;

  /** The id it stays when renamed; null until it is saved once. */
  readonly id: string | null;
  readonly name: string;
  readonly domain: ModbusDomain;
  readonly capabilities: Partial<Record<ModbusCapability, CapabilityDraft>>;
};

/** A template as the editor holds it. */
export type TemplateDraft = {
  readonly name: string;
  readonly device: string;
  readonly port: string;
  readonly unitId: string;
  readonly wordOrder: 'high' | 'low';
  readonly pollSeconds: string;
  readonly entities: readonly EntityDraft[];
};

/**
 * A read of a function, its other fields blank unless given.
 *
 * @param fn - The function code.
 * @param fields - The fields given.
 * @returns The read.
 */
export function readOf(fn: number, fields: Partial<ReadDraft> = {}): ReadDraft {
  return {
    function: fn,
    address: '0x0000',
    type: '',
    count: '',
    bit: '',
    scale: '',
    unit: '',
    options: '',
    ...fields,
  };
}

/**
 * A write of a function, its other fields blank unless given.
 *
 * @param fn - The function code.
 * @param fields - The fields given.
 * @returns The write.
 */
export function writeOf(fn: number, fields: Partial<WriteDraft> = {}): WriteDraft {
  return {
    function: fn,
    address: '',
    on: '',
    off: '',
    min: '',
    max: '',
    step: '',
    value: '',
    ...fields,
  };
}

/** How many entities have been made in this page, for keys. */
let made = 0;

/**
 * A key no other block has.
 *
 * @returns The key.
 */
export function newKey(): string {
  made += 1;

  return `entity-${String(made)}`;
}

/**
 * What a capability starts as: the function codes most devices use for it.
 *
 * @param capability - The capability.
 * @returns Its read and write.
 */
export function capabilityDefaults(capability: ModbusCapability): CapabilityDraft {
  switch (capability) {
    case 'sensor_numeric':
      return { read: readOf(4), write: null };
    case 'sensor_text':
      return { read: readOf(3, { type: 'string', count: '8' }), write: null };
    case 'sensor_binary':
      return { read: readOf(2), write: null };
    case 'on_off':
      return { read: readOf(1), write: writeOf(5) };
    case 'level':
      return { read: readOf(3), write: writeOf(6, { min: '0', max: '100' }) };
    case 'number':
      return { read: readOf(3), write: writeOf(6, { min: '0', max: '100' }) };
    case 'select':
      return { read: readOf(3, { options: '0=Off, 1=On' }), write: writeOf(6) };
    case 'button':
      return { read: null, write: writeOf(5, { address: '0x0000' }) };
  }
}

/**
 * A new entity of a domain, named and mapped the way most devices are.
 *
 * @param domain - What it is.
 * @param name - What it is called.
 * @returns The entity.
 */
export function entityOf(domain: ModbusDomain, name: string): EntityDraft {
  const rule = MODBUS_DOMAIN_CAPABILITIES[domain];
  const capabilities = [...rule.oneOf.slice(0, 1), ...rule.may];

  return {
    key: newKey(),
    id: null,
    name,
    domain,
    capabilities: Object.fromEntries(
      capabilities.map((capability) => [capability, capabilityDefaults(capability)]),
    ),
  };
}

/**
 * A new template: no entity yet, the port and unit most devices use.
 *
 * @returns The blocks.
 */
export function emptyTemplate(): TemplateDraft {
  return {
    name: '',
    device: '',
    port: '502',
    unitId: '1',
    wordOrder: 'high',
    pollSeconds: '10',
    entities: [],
  };
}

/**
 * What an entity's id is or will be.
 *
 * @param entity - The entity.
 * @returns Its own part of the identifier.
 */
export function idOfEntity(entity: EntityDraft): string {
  return entity.id ?? modbusEntityIdOf(entity.name);
}

/**
 * A number typed, or what was typed when it is not one - so the contract says what is wrong.
 *
 * @param text - What was typed.
 * @returns The number, or the text.
 */
function numberOf(text: string): number | string {
  const trimmed = text.trim();
  const value = Number(trimmed);

  return trimmed !== '' && Number.isFinite(value) ? value : trimmed;
}

/**
 * An address or a word typed: `0x…` as written, a decimal as a number.
 *
 * @param text - What was typed.
 * @returns The address.
 */
function wordOf(text: string): number | string {
  const trimmed = text.trim();

  return /^0x/iu.test(trimmed) ? `0x${trimmed.slice(2).toUpperCase()}` : numberOf(trimmed);
}

/**
 * The options typed, as the file writes them.
 *
 * @param text - `0=Off, 1=Eco`.
 * @returns `{ "0": "Off", "1": "Eco" }`.
 */
function optionsOf(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(',')
      .map((part) => part.split('='))
      .filter((pair) => pair.length === 2 && (pair[0]?.trim() ?? '') !== '')
      .map(([key = '', label = '']) => [key.trim(), label.trim()]),
  );
}

/**
 * The fields typed, without those left blank.
 *
 * @param fields - Each field and its value.
 * @returns Only those with a value.
 */
function filled(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) =>
        value !== '' &&
        value !== undefined &&
        !(typeof value === 'object' && value !== null && Object.keys(value).length === 0),
    ),
  );
}

/**
 * The document the blocks make, as it is checked, written and saved.
 *
 * @param draft - The blocks.
 * @returns The template file's object.
 */
export function documentOf(draft: TemplateDraft): TemplateDocument {
  return {
    name: draft.name.trim(),
    device: draft.device.trim(),
    port: numberOf(draft.port),
    unitId: numberOf(draft.unitId),
    wordOrder: draft.wordOrder,
    pollSeconds: numberOf(draft.pollSeconds),
    entities: draft.entities.map((entity) => ({
      ...(entity.id === null ? {} : { id: entity.id }),
      name: entity.name,
      domain: entity.domain,
      capabilities: Object.fromEntries(
        Object.entries(entity.capabilities).map(([capability, map]) => [
          capability,
          filled({
            read:
              map.read === null
                ? undefined
                : filled({
                    function: map.read.function,
                    address: wordOf(map.read.address),
                    type: map.read.type,
                    count: map.read.count === '' ? '' : numberOf(map.read.count),
                    bit: map.read.bit === '' ? '' : numberOf(map.read.bit),
                    scale: map.read.scale === '' ? '' : numberOf(map.read.scale),
                    unit: map.read.unit.trim(),
                    options: optionsOf(map.read.options),
                  }),
            write:
              map.write === null
                ? undefined
                : filled({
                    function: map.write.function,
                    address: map.write.address.trim() === '' ? '' : wordOf(map.write.address),
                    on: map.write.on.trim() === '' ? '' : wordOf(map.write.on),
                    off: map.write.off.trim() === '' ? '' : wordOf(map.write.off),
                    min: map.write.min === '' ? '' : numberOf(map.write.min),
                    max: map.write.max === '' ? '' : numberOf(map.write.max),
                    step: map.write.step === '' ? '' : numberOf(map.write.step),
                    value: map.write.value.trim() === '' ? '' : wordOf(map.write.value),
                  }),
          }),
        ]),
      ),
    })),
  };
}

/**
 * A field of the file, as the blocks show it.
 *
 * @param value - What the file says.
 * @returns It, as typed.
 */
function textOf(value: string | number | boolean | null | undefined): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The blocks a template makes.
 *
 * @param template - The template, checked.
 * @returns The blocks.
 */
export function draftOf(template: ModbusTemplate): TemplateDraft {
  return {
    name: template.name,
    device: template.device,
    port: String(template.port),
    unitId: String(template.unitId),
    wordOrder: template.wordOrder,
    pollSeconds: String(template.pollSeconds),
    entities: template.entities.map((entity) => ({
      key: newKey(),
      id: entity.id ?? null,
      name: entity.name,
      domain: entity.domain,
      capabilities: Object.fromEntries(
        Object.entries(entity.capabilities).map(([capability, map]) => [
          capability,
          {
            read:
              map.read === undefined
                ? null
                : readOf(map.read.function, {
                    address: textOf(map.read.address),
                    type: textOf(map.read.type),
                    count: textOf(map.read.count),
                    bit: textOf(map.read.bit),
                    scale: textOf(map.read.scale),
                    unit: textOf(map.read.unit),
                    options: Object.entries(map.read.options ?? {})
                      .map(([key, label]) => `${key}=${label}`)
                      .join(', '),
                  }),
            write:
              map.write === undefined
                ? null
                : writeOf(map.write.function, {
                    address: textOf(map.write.address),
                    on: textOf(map.write.on),
                    off: textOf(map.write.off),
                    min: textOf(map.write.min),
                    max: textOf(map.write.max),
                    step: textOf(map.write.step),
                    value: textOf(map.write.value),
                  }),
          },
        ]),
      ),
    })),
  };
}

/**
 * The template file's object as the blocks make it - what the contract checks, not yet checked:
 * a field typed wrong is in it as typed, for the contract to say what is wrong.
 */
export type TemplateDocument = Record<string, unknown> & {
  readonly entities: readonly (Record<string, unknown> & {
    readonly capabilities: Readonly<
      Record<string, { readonly read?: unknown; readonly write?: unknown }>
    >;
  })[];
};

/** A problem of the template, keyed by where it is: `entities.0.capabilities.on_off.read.address`. */
export type Problems = ReadonlyMap<string, string>;

/**
 * What is wrong with the blocks, by the path of each field.
 *
 * @param draft - The blocks.
 * @returns The problems; empty when the template can be saved.
 */
export function problemsOf(draft: TemplateDraft): Problems {
  const parsed = modbusTemplateSchema.safeParse(documentOf(draft));

  if (parsed.success) {
    return new Map();
  }

  const problems = new Map<string, string>();

  for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join('.');

    if (!problems.has(key)) {
      problems.set(key, issue.message);
    }
  }

  return problems;
}

/**
 * The problem of one field, or of anything below it.
 *
 * @param problems - Every problem.
 * @param path - The field.
 * @returns The first problem there, or undefined.
 */
export function problemAt(problems: Problems, path: string): string | undefined {
  return problems.get(path);
}

/**
 * Says how a manual's numbering maps onto a register, when an address looks like one: a manual
 * writing 40011 means holding register 10, `0x000A`.
 *
 * @param fn - The function read with.
 * @param address - The address typed.
 * @returns The hint, or undefined when the address does not look like a manual's.
 */
export function manualNumberingOf(
  fn: number,
  address: string,
): { readonly typed: string; readonly register: string } | undefined {
  const value = Number(address.trim());
  const base = fn === 3 ? 40_001 : fn === 4 ? 30_001 : fn === 2 ? 10_001 : null;

  if (base === null || !/^\d{5}$/u.test(address.trim()) || value < base || value > base + 9998) {
    return undefined;
  }

  return {
    typed: address.trim(),
    register: `0x${(value - base).toString(16).toUpperCase().padStart(4, '0')}`,
  };
}

/**
 * One value of the file, written on one line.
 *
 * @param value - The value.
 * @returns Its JSON.
 */
function inline(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);

    return entries.length === 0
      ? '{}'
      : `{ ${entries.map(([key, each]) => `${JSON.stringify(key)}: ${inline(each)}`).join(', ')} }`;
  }

  return JSON.stringify(value);
}

/**
 * Whether a value is written on one line: an object of plain values, or of options - a read, a
 * write, a set of options.
 *
 * @param value - The value.
 * @returns True when every one of its values is plain or a flat object.
 */
function isLeaf(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(
      ([key, each]) => each === null || typeof each !== 'object' || key === 'options',
    )
  );
}

/**
 * A value of the file, indented, its leaves on one line.
 *
 * @param value - The value.
 * @param indent - The indent of its line.
 * @returns Its JSON.
 */
function block(value: unknown, indent: string): string {
  const inner = `${indent}  `;

  if (Array.isArray(value)) {
    return value.length === 0
      ? '[]'
      : `[\n${value.map((each) => `${inner}${block(each, inner)}`).join(',\n')}\n${indent}]`;
  }

  if (value !== null && typeof value === 'object') {
    if (isLeaf(value) && indent.length >= 8) {
      return inline(value);
    }

    const entries = Object.entries(value);

    return entries.length === 0
      ? '{}'
      : `{\n${entries
          .map(([key, each]) => `${inner}${JSON.stringify(key)}: ${block(each, inner)}`)
          .join(',\n')}\n${indent}}`;
  }

  return JSON.stringify(value);
}

/**
 * The file the blocks write: indented, each read, write and set of options on one line.
 *
 * @param draft - The blocks.
 * @returns The file's text.
 */
export function fileOf(draft: TemplateDraft): string {
  return `${block(documentOf(draft), '')}\n`;
}

/** What reading a file gave: the blocks it makes, or why it makes none. */
export type ParsedFile =
  | { readonly draft: TemplateDraft; readonly error: null }
  | { readonly draft: null; readonly error: string };

/**
 * Reads a file into blocks. A file the contract refuses still makes blocks when it is JSON of the
 * template's shape, so the problems show on the blocks; only a file that is not JSON, or not a
 * template at all, makes none.
 *
 * @param text - The file.
 * @param keep - The blocks it replaces, whose keys an entity in the same place keeps.
 * @returns The blocks, or the error.
 */
export function parseFile(text: string, keep?: TemplateDraft): ParsedFile {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    return {
      draft: null,
      error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const loose = modbusTemplateSchema.safeParse(json);

  if (loose.success) {
    const draft = draftOf(loose.data);

    return { draft: keepKeys(draft, keep), error: null };
  }

  // Refused by a rule but shaped like a template: blocks, with the problems on them.
  const shaped = modbusTemplateFieldsSchema.safeParse(json);

  if (shaped.success) {
    return { draft: keepKeys(draftOf(shaped.data), keep), error: null };
  }

  const [issue] = shaped.error.issues;
  const path = issue?.path ?? [];
  const where =
    path[0] === 'entities' && typeof path[1] === 'number'
      ? `Entity ${String(path[1] + 1)}${nameAt(json, path[1])}: `
      : path.length > 0
        ? `${path.map(String).join('.')}: `
        : '';

  return { draft: null, error: `${where}${issue?.message ?? 'Not a template'}` };
}

/**
 * The name of an entity of a file, for a message.
 *
 * @param json - The file.
 * @param index - The entity.
 * @returns ` (Relay 1)`, or nothing when it has none.
 */
function nameAt(json: unknown, index: number): string {
  const entities = (json as { entities?: unknown } | null)?.entities;
  const name = Array.isArray(entities)
    ? (entities[index] as { name?: unknown } | undefined)?.name
    : undefined;

  return typeof name === 'string' ? ` (${name})` : '';
}

/**
 * Gives the entities of new blocks the keys of the old ones in the same place, so an open test
 * panel stays open across a change in the file.
 *
 * @param draft - The new blocks.
 * @param keep - The old ones.
 * @returns The new blocks, keyed.
 */
function keepKeys(draft: TemplateDraft, keep: TemplateDraft | undefined): TemplateDraft {
  return keep === undefined
    ? draft
    : {
        ...draft,
        entities: draft.entities.map((entity, index) => ({
          ...entity,
          key: keep.entities[index]?.key ?? entity.key,
        })),
      };
}
