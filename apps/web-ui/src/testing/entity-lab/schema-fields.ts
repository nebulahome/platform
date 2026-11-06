/**
 * Reads a capability's state and params schemas as fields the entity lab can draw a control for.
 *
 * Nothing here names a capability: every field comes from `CAPABILITY_DEFINITIONS` through
 * `z.toJSONSchema`, so a capability added to the contracts - or a field added to one - shows up
 * in the lab with a control of its own, with no edit here.
 */
import { z } from 'zod';

import { CAPABILITY_DEFINITIONS, type CapabilityName } from '@nebulahome/contracts';

/** A JSON schema node, as `z.toJSONSchema` writes one. */
type Node = {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly anyOf?: readonly Node[];
  readonly items?: Node | false;
  readonly prefixItems?: readonly Node[];
  readonly properties?: Readonly<Record<string, Node>>;
  readonly required?: readonly string[];
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly format?: string;
};

/** What a field holds, which decides its control. */
export type FieldKind =
  | { readonly type: 'boolean' }
  | { readonly type: 'enum'; readonly values: readonly string[] }
  | {
      readonly type: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly isInt: boolean;
    }
  | { readonly type: 'string'; readonly format?: string }
  | { readonly type: 'enum-list'; readonly values: readonly string[]; readonly minItems: number }
  | {
      readonly type: 'list';
      readonly item: Node;
      readonly minItems: number;
      readonly maxItems: number;
    }
  | { readonly type: 'json' };

/** One field of a capability's state or params. */
export type SchemaField = {
  /** Its key. */
  readonly key: string;

  /** What it holds. */
  readonly kind: FieldKind;

  /** Whether it must be there: a required field with no default. */
  readonly isRequired: boolean;

  /** Whether it may be null as well as a value. */
  readonly isNullable: boolean;

  /** The default the schema fills in, when it has one. */
  readonly fallback: unknown;

  /** Whether the schema fills it in when it is left out. */
  readonly hasDefault: boolean;
};

/**
 * Says what a node holds.
 *
 * @param node - The node, without its null branch.
 * @returns Its kind.
 */
function kindOf(node: Node): FieldKind {
  if (node.enum !== undefined) {
    return { type: 'enum', values: node.enum.map(String) };
  }

  switch (node.type) {
    case 'boolean': {
      return { type: 'boolean' };
    }
    case 'number':
    case 'integer': {
      return {
        type: 'number',
        ...(node.minimum === undefined ? {} : { min: node.minimum }),
        ...(node.exclusiveMinimum === undefined ? {} : { min: node.exclusiveMinimum }),
        ...(node.maximum === undefined ? {} : { max: node.maximum }),
        isInt: node.type === 'integer',
      };
    }
    case 'string': {
      return { type: 'string', ...(node.format === undefined ? {} : { format: node.format }) };
    }
    case 'array': {
      const item = node.items;

      if (item !== undefined && item !== false && item.enum !== undefined) {
        return { type: 'enum-list', values: item.enum.map(String), minItems: node.minItems ?? 0 };
      }

      if (item !== undefined && item !== false && node.prefixItems === undefined) {
        return {
          type: 'list',
          item,
          minItems: node.minItems ?? 0,
          maxItems: node.maxItems ?? 64,
        };
      }

      return { type: 'json' };
    }
    default: {
      return { type: 'json' };
    }
  }
}

/**
 * Reads the fields of one schema.
 *
 * @param schema - A capability's state or params schema.
 * @returns Its fields, in the schema's order.
 */
function fieldsOf(schema: z.ZodType): SchemaField[] {
  const root = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Node;
  const required = new Set(root.required ?? []);

  return Object.entries(root.properties ?? {}).map(([key, node]) => {
    const nonNull = node.anyOf?.filter((branch) => branch.type !== 'null');
    const isNullable = node.anyOf?.some((branch) => branch.type === 'null') ?? false;
    const inner = nonNull?.length === 1 && nonNull[0] !== undefined ? nonNull[0] : node;
    const hasDefault = 'default' in node;

    return {
      key,
      kind: kindOf(inner),
      isRequired: required.has(key) && !hasDefault,
      isNullable,
      fallback: node.default,
      hasDefault,
    };
  });
}

/** A capability's fields: what it reports, and the device's own limits. */
export type CapabilityFields = {
  readonly state: readonly SchemaField[];
  readonly params: readonly SchemaField[];
};

/** The fields read once per capability: the schemas never change while the page is open. */
const cache = new Map<CapabilityName, CapabilityFields>();

/**
 * Reads a capability's fields.
 *
 * @param capability - The capability.
 * @returns Its state and params fields.
 */
export function capabilityFields(capability: CapabilityName): CapabilityFields {
  const known = cache.get(capability);

  if (known !== undefined) {
    return known;
  }

  const definition = CAPABILITY_DEFINITIONS[capability];
  const fields = { state: fieldsOf(definition.state), params: fieldsOf(definition.params) };

  cache.set(capability, fields);

  return fields;
}

/** A node of a list's items, for the sample values of its members. */
export type ItemNode = Node;
