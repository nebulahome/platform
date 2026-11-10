/**
 * The aliases file: the whole setup of one alias or many, as JSON.
 *
 * One format for Export, Import, Copy and the File tab: `{ format: 'nebula-home/aliases',
 * version: 1, aliases: [...] }`. An entry is an alias's setup without what the house adds to it
 * (ids, health, its code's memory): what it is called, what it behaves as, where it is, its parts,
 * its code as lines and its cases. A file read back is checked twice: its shape here, and against
 * the house (entities that are not in it) by the caller, which knows the house.
 */
import { z } from 'zod';

import {
  ALIAS_FALLBACK_POLICIES,
  aliasCaseSchema,
  aliasCustomTypeSchema,
  aliasDisplaySchema,
  aliasObjectIdSchema,
  type AliasView,
} from './alias-api.js';
import { aliasExpressionNames } from './alias-expression.js';
import {
  aliasPartEntities,
  aliasPartIssues,
  aliasPartsSchema,
  type AliasParts,
} from './alias-parts.js';
import { ALIAS_TYPE_IDS, aliasType, type AliasCustomField } from './alias-types.js';
import { ENTITY_ID_PATTERN, entityIdSchema } from './entity-id.js';
import { iconIdSchema } from './icons.js';
import type { JsonValue } from './json.js';

/** The format name an aliases file carries. */
export const ALIASES_FORMAT = 'nebula-home/aliases';

/** The version of the format this platform writes and reads. */
export const ALIASES_FILE_VERSION = 1;

/**
 * Which device an alias in a file goes on: `"aliases"` (the shared one), a virtual device by
 * name, or a real device by name (matched on import, or replaced when it is not in the house).
 */
export const aliasFileDeviceSchema = z.union([
  z.literal('aliases'),
  z.object({ virtual: z.string().trim().min(1).max(120) }),
  z.object({ device: z.string().trim().min(1).max(120) }),
]);

/** Which device an alias in a file goes on. */
export type AliasFileDevice = z.output<typeof aliasFileDeviceSchema>;

/** One alias in a file. */
export const aliasFileEntrySchema = z.object({
  key: aliasObjectIdSchema,
  name: z.string().trim().min(1).max(120),
  icon: iconIdSchema.nullable().default(null),
  behavesAs: z.enum(ALIAS_TYPE_IDS),
  customType: aliasCustomTypeSchema.nullable().default(null),
  area: z.string().max(64).nullable().default(null),
  device: aliasFileDeviceSchema.default('aliases'),
  isEnabled: z.boolean().default(true),
  ifOneStops: z.enum(ALIAS_FALLBACK_POLICIES).default('unavailable'),
  debounceMs: z.int().min(0).max(3_600_000).default(0),
  display: aliasDisplaySchema.default({ deviceClass: null, unit: null, precision: null }),
  parts: aliasPartsSchema,

  /** The code, one string per line, so a file stays readable and diffs line by line. */
  code: z.array(z.string().max(1_000)).max(2_000).default([]),
  cases: z.array(aliasCaseSchema).max(64).default([]),
});

/** One alias in a file. */
export type AliasFileEntry = z.output<typeof aliasFileEntrySchema>;

/** A whole aliases file. */
export const aliasFileSchema = z.object({
  format: z.literal(ALIASES_FORMAT),
  version: z.literal(ALIASES_FILE_VERSION),
  aliases: z
    .array(aliasFileEntrySchema)
    .max(500)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.key)).size === entries.length,
      'Each key is there once',
    ),
});

/** A whole aliases file. */
export type AliasFile = z.output<typeof aliasFileSchema>;

/**
 * An alias's entry in a file.
 *
 * @param alias - The alias.
 * @param areaKey - Its room's key, or null.
 * @returns The entry.
 */
export function aliasFileEntry(alias: AliasView, areaKey: string | null): AliasFileEntry {
  const device: AliasFileDevice = alias.device.isShared
    ? 'aliases'
    : alias.device.isVirtual
      ? { virtual: alias.device.name }
      : { device: alias.device.name };

  return {
    key: alias.key,
    name: alias.name,
    icon: alias.icon,
    behavesAs: alias.behavesAs,
    customType: alias.customType,
    area: areaKey,
    device,
    isEnabled: alias.isEnabled,
    ifOneStops: alias.ifOneStops,
    debounceMs: alias.debounceMs,
    display: alias.display,
    parts: alias.parts,
    code: alias.code === '' ? [] : alias.code.replace(/\n$/u, '').split('\n'),
    cases: alias.cases,
  };
}

/**
 * A file holding these aliases.
 *
 * @param entries - The aliases' entries.
 * @returns The file.
 */
export function aliasesFile(entries: readonly AliasFileEntry[]): AliasFile {
  return { format: ALIASES_FORMAT, version: ALIASES_FILE_VERSION, aliases: [...entries] };
}

/**
 * The code of an entry as one text.
 *
 * @param entry - The entry.
 * @returns The code, with a newline at the end when there is any.
 */
export function aliasEntryCode(entry: AliasFileEntry): string {
  return entry.code.length === 0 ? '' : `${entry.code.join('\n')}\n`;
}

/** One problem with a file: where (a JSON path), and what. */
export type AliasFileProblem = {
  readonly path: string;
  readonly message: string;

  /** For an entity that is not in the house: its id, so a replacement can be picked. */
  readonly entityId?: string;

  /** The alias the problem is in, by key. */
  readonly alias?: string;
};

/** A file read back: the file, or why it cannot be. */
export type AliasFileRead =
  | { readonly ok: true; readonly file: AliasFile }
  | { readonly ok: false; readonly problems: readonly AliasFileProblem[] };

/**
 * Reads a file's text: JSON, then its shape, then each alias against its type.
 *
 * @param text - What was pasted or dropped.
 * @param customFieldsOf - For a custom alias, the fields of its package entity type.
 * @returns The file, or its problems.
 */
export function readAliasFile(
  text: string,
  customFieldsOf?: (packageId: string, type: string) => readonly AliasCustomField[] | undefined,
): AliasFileRead {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      problems: [{ path: '', message: error instanceof Error ? error.message : 'Not JSON' }],
    };
  }

  const parsed = aliasFileSchema.safeParse(json);

  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  }

  const problems: AliasFileProblem[] = [];

  parsed.data.aliases.forEach((entry, index) => {
    const custom =
      entry.customType === null
        ? undefined
        : customFieldsOf?.(entry.customType.packageId, entry.customType.type);

    for (const issue of aliasPartIssues(aliasType(entry.behavesAs), entry.parts, custom)) {
      problems.push({
        path: `aliases.${String(index)}.parts${issue.part === null ? '' : `.${issue.part}`}`,
        message: issue.message,
        alias: entry.key,
      });
    }
  });

  return problems.length === 0 ? { ok: true, file: parsed.data } : { ok: false, problems };
}

/**
 * The entity ids an entry's parts name: their entities and the ids in their formulas. What its
 * code reads is worked out by the code's checker, which the caller runs.
 *
 * @param parts - The parts.
 * @returns The ids, each once.
 */
export function aliasPartsReads(parts: AliasParts): string[] {
  const ids = new Set<string>();

  for (const config of Object.values(parts)) {
    for (const id of aliasPartEntities(config)) {
      ids.add(id);
    }

    if (config.from === 'formula') {
      for (const name of aliasExpressionNames(config.formula)) {
        const id = name.split('.').slice(0, 2).join('.');

        if (ENTITY_ID_PATTERN.test(id)) {
          ids.add(id);
        }
      }
    }
  }

  return [...ids].sort();
}

/**
 * Puts another entity in the place of one an entry names: in its parts' entities and formulas,
 * and in its code. What Import does with "Keep the old one" or a replacement.
 *
 * @param entry - The entry.
 * @param from - The id that is not in the house.
 * @param to - The id to use instead.
 * @returns The entry with the id replaced.
 */
export function replaceAliasEntity(
  entry: AliasFileEntry,
  from: string,
  to: string,
): AliasFileEntry {
  const pattern = new RegExp(`(?<![a-z0-9_.])${from.replace('.', '\\.')}(?![a-z0-9_])`, 'gu');
  const replacement = entityIdSchema.parse(to);
  const parts: AliasParts = {};

  for (const [key, config] of Object.entries(entry.parts)) {
    switch (config.from) {
      case 'entity':
        parts[key] = {
          ...config,
          entity: config.entity === from ? replacement : config.entity,
        };
        break;
      case 'entities':
        parts[key] = {
          ...config,
          entities: config.entities.map((id) => (id === from ? replacement : id)),
        };
        break;
      case 'formula':
        parts[key] = { ...config, formula: config.formula.replace(pattern, to) };
        break;
      default:
        parts[key] = config;
    }
  }

  return { ...entry, parts, code: entry.code.map((line) => line.replace(pattern, to)) };
}

/** One difference between two setups of an alias, as the review and the History show it. */
export type AliasChange = {
  /** Added, removed, or changed. */
  readonly sign: '+' | '-' | '~';

  /** Where: a field (`name`), a part (`preset`), or a part's setting (`target_temperature.min`). */
  readonly path: string;

  readonly before?: JsonValue;
  readonly after?: JsonValue;
};

/**
 * The differences between two setups of one alias.
 *
 * A part added or removed is one change; a part changed is one change per setting that differs,
 * its source included. The code is one change saying how many lines differ.
 *
 * @param before - The setup saved, or null for a new alias.
 * @param after - The setup proposed, or null for one removed.
 * @returns The changes, fields first, then parts in key order, then the code.
 */
export function diffAliasEntry(
  before: AliasFileEntry | null,
  after: AliasFileEntry | null,
): AliasChange[] {
  if (before === null || after === null) {
    return before === after
      ? []
      : [{ sign: before === null ? '+' : '-', path: (after ?? before)?.key ?? '' }];
  }

  const changes: AliasChange[] = [];
  const fields = [
    'name',
    'icon',
    'area',
    'device',
    'isEnabled',
    'ifOneStops',
    'debounceMs',
    'display',
  ] as const;

  for (const field of fields) {
    if (!same(before[field], after[field])) {
      changes.push({
        sign: '~',
        path: field,
        before: before[field],
        after: after[field],
      });
    }
  }

  const keys = [...new Set([...Object.keys(before.parts), ...Object.keys(after.parts)])].sort();

  for (const key of keys) {
    const was = before.parts[key];
    const now = after.parts[key];

    if (was === undefined && now !== undefined) {
      changes.push({ sign: '+', path: key, after: now as JsonValue });
      continue;
    }

    if (now === undefined && was !== undefined) {
      changes.push({ sign: '-', path: key, before: was as JsonValue });
      continue;
    }

    const settings = [...new Set([...Object.keys(was ?? {}), ...Object.keys(now ?? {})])];

    for (const setting of settings) {
      const left = (was as Record<string, unknown> | undefined)?.[setting];
      const right = (now as Record<string, unknown> | undefined)?.[setting];

      if (!same(left, right)) {
        changes.push({
          sign: left === undefined ? '+' : right === undefined ? '-' : '~',
          path: `${key}.${setting}`,
          ...(left === undefined ? {} : { before: left as JsonValue }),
          ...(right === undefined ? {} : { after: right as JsonValue }),
        });
      }
    }
  }

  const lines = changedLines(before.code, after.code);

  if (lines > 0) {
    changes.push({ sign: '~', path: 'code', after: lines });
  }

  if (!same(before.cases, after.cases)) {
    changes.push({
      sign: '~',
      path: 'cases',
      before: before.cases.length,
      after: after.cases.length,
    });
  }

  return changes;
}

/**
 * How many lines differ between two versions of a code, by a longest-common-subsequence count.
 *
 * @param before - The lines before.
 * @param after - The lines after.
 * @returns The lines added plus the lines removed.
 */
export function changedLines(before: readonly string[], after: readonly string[]): number {
  const previous = new Array<number>(after.length + 1).fill(0);

  for (const line of before) {
    let diagonal = 0;

    for (let j = 1; j <= after.length; j += 1) {
      const above = previous[j] ?? 0;
      previous[j] = line === after[j - 1] ? diagonal + 1 : Math.max(above, previous[j - 1] ?? 0);
      diagonal = above;
    }
  }

  const common = previous[after.length] ?? 0;
  return before.length - common + (after.length - common);
}

/**
 * Whether two JSON-like values are the same.
 *
 * @param left - One.
 * @param right - The other.
 * @returns True when they serialise alike with their keys sorted.
 */
function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

/**
 * A value as JSON with its object keys sorted, so key order never counts as a change.
 *
 * @param value - The value.
 * @returns The text.
 */
function stable(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
