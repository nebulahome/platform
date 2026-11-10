/**
 * What the alias pages work out from an alias: its type and parts in words, a part's value in
 * the alias's state, where a part takes its value from, how the alias is doing, and how the list
 * narrows and groups.
 *
 * Pure, so the pages' behaviour is testable without a page. Types and parts come in English from
 * contracts (`alias-types.ts`); their names are translated here by key.
 */
import {
  ALIAS_TYPES,
  aliasType,
  aliasTypeParts,
  checkCode,
  type AliasCustomField,
  type AliasHealth,
  type AliasListItem,
  type AliasPartConfig,
  type AliasPartDef,
  type AliasRule,
  type AliasSource,
  type AliasTypeDef,
  type AliasTypeGroup,
  type AliasTypeId,
} from '@nebulahome/contracts';
import { UI_ICON_IDS, type StatusDotTone, type UiIconId } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { text, translate } from '@/i18n/messages';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';
import {
  GROUP_LABELS,
  PART_GROUP_LABELS,
  PART_LABELS,
  RULE_LABELS,
  SOURCE_LABELS,
  TYPE_LABELS,
  TYPE_PLURALS,
} from '@/library/alias-words';
import { NO_READING } from '@/library/entity-reading';

/** The interface's own icons, by id. */
const UI_ICONS: ReadonlySet<string> = new Set(UI_ICON_IDS);

/**
 * An icon the interface can draw: the one asked for when it has it, else a fallback.
 *
 * @param id - The icon a type or a part names.
 * @param fallback - What to draw instead.
 * @returns The icon.
 */
export function uiIcon(id: string | null | undefined, fallback: UiIconId = 'circle'): UiIconId {
  return id !== null && id !== undefined && UI_ICONS.has(id) ? (id as UiIconId) : fallback;
}

/** What `part.` is written as before a part's key: code, never translated. */
export const PART_PREFIX = 'part.';

/**
 * The entity ids a code reads, whatever the house has.
 *
 * @param code - The code.
 * @param partKeys - The alias's parts.
 * @returns The ids.
 */
export function codeEntityReads(code: string, partKeys: readonly string[]): readonly string[] {
  if (code.trim() === '') {
    return [];
  }

  return checkCode(code, {
    parts: [],
    /**
     * Takes every entity as known: only the ids are wanted.
     *
     * @returns True.
     */
    knownEntity: () => true,
    partKeys,
  }).reads.entityIds;
}

/**
 * A type's name, translated.
 *
 * @param type - The type.
 * @returns Its name.
 */
export function typeLabel(type: AliasTypeDef): string {
  return text(TYPE_LABELS[type.id]);
}

/**
 * A type's name for a group of its aliases.
 *
 * @param type - The type.
 * @returns The plural.
 */
export function typePlural(type: AliasTypeDef): string {
  return text(TYPE_PLURALS[type.id]);
}

/**
 * A group of the type picker, translated.
 *
 * @param group - The group.
 * @returns Its name.
 */
export function groupLabel(group: AliasTypeGroup): string {
  return text(GROUP_LABELS[group]);
}

/**
 * A part's name, translated; a custom type's fields keep the package's own names.
 *
 * @param def - The part.
 * @returns Its name.
 */
export function partLabel(def: AliasPartDef): string {
  const message = def.capability === 'custom' ? undefined : PART_LABELS[def.key];

  return message === undefined ? def.label : text(message);
}

/**
 * The name of parts added together, or of a part on its own.
 *
 * @param def - The part.
 * @returns The group's name, or the part's.
 */
export function partGroupLabel(def: AliasPartDef): string {
  const message = def.group === undefined ? undefined : PART_GROUP_LABELS[def.group];

  return message === undefined ? partLabel(def) : text(message);
}

/**
 * The type of an alias.
 *
 * @param behavesAs - What it behaves as.
 * @returns The type.
 */
export function typeOf(behavesAs: AliasTypeId): AliasTypeDef {
  return aliasType(behavesAs);
}

/**
 * The parts an alias's type has.
 *
 * @param behavesAs - What it behaves as.
 * @param customFields - For a custom type, its package entity type's fields.
 * @returns The parts, required first.
 */
export function aliasDefs(
  behavesAs: AliasTypeId,
  customFields?: readonly AliasCustomField[],
): readonly AliasPartDef[] {
  return aliasTypeParts(aliasType(behavesAs), customFields);
}

/**
 * Whether a value is a plain object.
 *
 * @param value - The value.
 * @returns True for an object that is not an array.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A part's value in an entity's state, the way `core` writes it.
 *
 * @param def - The part.
 * @param state - The alias entity's state, by capability.
 * @returns The value, or undefined when the state has none.
 */
export function partValueOf(def: AliasPartDef, state: unknown): unknown {
  const capability = isRecord(state) ? state[def.capability] : undefined;

  if (!isRecord(capability)) {
    return undefined;
  }

  // A package entity type keeps its fields under `values`.
  const holder = def.capability === 'custom' ? capability['values'] : capability;

  if (!isRecord(holder)) {
    return undefined;
  }

  if (def.kind === 'color') {
    const [hueField = 'hue', saturationField = 'saturation'] = def.fields;
    const hue = holder[hueField];
    const saturation = holder[saturationField];

    return typeof hue === 'number' && typeof saturation === 'number'
      ? { hue, saturation }
      : undefined;
  }

  const [field] = def.fields;

  return field === undefined ? undefined : holder[field];
}

/**
 * A word with its first letter in capitals and underscores as spaces: `fan_only` → `Fan only`.
 *
 * @param word - The word.
 * @returns It, readable.
 */
export function readable(word: string): string {
  const spaced = word.replaceAll('_', ' ');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A part's value in words.
 *
 * @param def - The part.
 * @param value - Its value.
 * @param unit - The alias's own unit, for a reading without one of its own.
 * @returns The words, or a dash for none.
 */
export function formatPartValue(def: AliasPartDef, value: unknown, unit?: string | null): string {
  if (value === undefined || value === null) {
    return NO_READING;
  }

  switch (def.kind) {
    case 'number': {
      if (typeof value !== 'number') {
        return JSON.stringify(value);
      }

      // Colour temperature is kept in mireds and read in kelvin.
      if (def.key === 'color_temp') {
        return `${numberFormat({ maximumFractionDigits: 0 }).format(1_000_000 / value)} K`;
      }

      const shown = numberFormat({ maximumFractionDigits: 2 }).format(value);
      const suffix = def.unit ?? unit ?? null;

      return suffix === null || suffix === '' ? shown : `${shown} ${suffix}`;
    }
    case 'boolean': {
      if (def.key === 'on') {
        return value === true ? translate('common.on', 'On') : translate('common.off', 'Off');
      }

      return value === true ? translate('common.yes', 'Yes') : translate('common.no', 'No');
    }
    case 'color': {
      return isRecord(value)
        ? `${String(value['hue'])}° · ${String(value['saturation'])} %`
        : NO_READING;
    }
    case 'picture': {
      return translate('library.aliases.picture', 'Picture');
    }
    case 'rooms': {
      return Array.isArray(value)
        ? translate('library.aliases.rooms', {
            count: value.length,
            defaultValue_one: '{{count}} room',
            defaultValue_other: '{{count}} rooms',
          })
        : NO_READING;
    }
    case 'press': {
      return translate('library.aliases.ready', 'Ready');
    }
    case 'enum': {
      return typeof value === 'string' ? readable(value) : NO_READING;
    }
    case 'text': {
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
}

/**
 * A rule in words, for its select.
 *
 * @param rule - The rule.
 * @returns Its name.
 */
export function ruleLabel(rule: AliasRule): string {
  return text(RULE_LABELS[rule]);
}

/**
 * A source's name.
 *
 * @param source - The source.
 * @returns Its name.
 */
export function sourceLabel(source: AliasSource): string {
  return text(SOURCE_LABELS[source]);
}

/** Where a part takes its value from, as the chip under its name shows it. */
export type SourceChip = {
  readonly icon: UiIconId;

  /** The glyph's colour. */
  readonly tone: string;

  readonly text: string;

  /** Whether the text is code: a formula or a function. */
  readonly isMono: boolean;
};

/**
 * The chip of a part's source.
 *
 * @param config - The part's configuration.
 * @param nameOf - An entity's name, by id.
 * @returns The chip.
 */
export function sourceChip(
  config: AliasPartConfig,
  nameOf: (entityId: string) => string,
): SourceChip {
  switch (config.from) {
    case 'stored': {
      return {
        icon: 'database',
        tone: 'text-primary',
        text: sourceLabel('stored'),
        isMono: false,
      };
    }
    case 'entity': {
      return { icon: 'link-2', tone: 'text-cyan', text: nameOf(config.entity), isMono: false };
    }
    case 'entities': {
      return {
        icon: 'layers',
        tone: 'text-cyan',
        text: translate('library.aliasPage.entitiesChip', 'Entities · {{rule}} of {{count}}', {
          rule: ruleLabel(config.rule).toLowerCase(),
          count: config.entities.length,
        }),
        isMono: false,
      };
    }
    case 'formula': {
      return { icon: 'sigma', tone: 'text-violet', text: config.formula, isMono: true };
    }
    case 'code': {
      return { icon: 'braces', tone: 'text-success', text: `${config.function}()`, isMono: true };
    }
  }
}

/** The tone a health is shown in: colours only ever say how something is doing. */
export const HEALTH_TONE: Readonly<Record<AliasHealth, StatusDotTone>> = {
  ok: 'success',
  failing: 'danger',
  unavailable: 'warning',
  off: 'neutral',
};

/**
 * Whether an alias has a problem worth the Problems filter.
 *
 * @param item - The alias.
 * @returns True when it is failing or unavailable.
 */
export function hasProblem(item: Pick<AliasListItem, 'health'>): boolean {
  return item.health === 'failing' || item.health === 'unavailable';
}

/** What the list shows: all of them, or those with a problem. */
export const ALIAS_SHOWS = ['all', 'problems'] as const;

/** What the list shows. */
export type AliasShow = (typeof ALIAS_SHOWS)[number];

/** Which devices: any, virtual ones, or real ones. */
export const ALIAS_DEVICE_KINDS = ['any', 'virtual', 'existing'] as const;

/** Which devices. */
export type AliasDeviceKind = (typeof ALIAS_DEVICE_KINDS)[number];

/** What the list has been narrowed to. */
export type AliasListFilter = {
  readonly show: AliasShow;

  /** What was typed: every word must be found in the alias's name, id, area or what it reads. */
  readonly search: string;

  /** One type, or blank for any. */
  readonly type: string;

  readonly device: AliasDeviceKind;

  /** One area by key, or blank for any. */
  readonly area: string;
};

/** Nothing set: every alias shows. */
export const OPEN_ALIAS_LIST_FILTER: AliasListFilter = {
  show: 'all',
  search: '',
  type: '',
  device: 'any',
  area: '',
};

/** How the list's filter lives in the address. */
export const ALIAS_LIST_CODEC: ListCodec<AliasListFilter> = {
  keys: ['show', 'q', 'type', 'device', 'area'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    show: readChoice(params, 'show', ALIAS_SHOWS, 'all'),
    search: params.get('q') ?? '',
    type: params.get('type') ?? '',
    device: readChoice(params, 'device', ALIAS_DEVICE_KINDS, 'any'),
    area: params.get('area') ?? '',
  }),

  /**
   * Writes what differs from an open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({
      show: [filter.show, 'all'],
      q: [filter.search, ''],
      type: [filter.type, ''],
      device: [filter.device, 'any'],
      area: [filter.area, ''],
    }),
};

/**
 * How many facets of the filter sheet are set, for its badge.
 *
 * @param filter - The filter.
 * @returns The count; the search and the Show switch have their own controls.
 */
export function aliasFacetCount(filter: AliasListFilter): number {
  return Number(filter.type !== '') + Number(filter.device !== 'any') + Number(filter.area !== '');
}

/**
 * Whether one alias belongs in the list, the Show switch aside.
 *
 * @param item - The alias.
 * @param filter - The filter.
 * @returns True when the search and every facet admit it.
 */
export function matchesAliasFacets(item: AliasListItem, filter: AliasListFilter): boolean {
  if (filter.type !== '' && item.behavesAs !== filter.type) {
    return false;
  }

  if (filter.device === 'virtual' && !item.device.isVirtual) {
    return false;
  }

  if (filter.device === 'existing' && item.device.isVirtual) {
    return false;
  }

  if (filter.area !== '' && item.area?.key !== filter.area) {
    return false;
  }

  return matchesQuery(
    [item.name, item.entityId, item.area?.name, item.device.name, ...item.reads],
    filter.search,
  );
}

/**
 * Whether one alias belongs in the list.
 *
 * @param item - The alias.
 * @param filter - The filter.
 * @returns True when it is shown.
 */
export function matchesAliasList(item: AliasListItem, filter: AliasListFilter): boolean {
  return (filter.show === 'all' || hasProblem(item)) && matchesAliasFacets(item, filter);
}

/** The aliases of one type, as the list groups them. */
export type AliasGroup<TItem> = {
  readonly type: AliasTypeDef;
  readonly items: readonly TItem[];
};

/**
 * The aliases grouped by type, in the types' order, each group by name.
 *
 * @param items - The aliases.
 * @returns The groups that have any.
 */
export function groupAliases<TItem extends Pick<AliasListItem, 'behavesAs' | 'name'>>(
  items: readonly TItem[],
): AliasGroup<TItem>[] {
  return ALIAS_TYPES.map((type) => ({
    type,
    items: items
      .filter((item) => item.behavesAs === type.id)
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The types that match a search in the type picker: by name, or by one of their words.
 *
 * @param query - What was typed.
 * @returns The types, with the word that matched when the name did not.
 */
export function searchTypes(
  query: string,
): { readonly type: AliasTypeDef; readonly word: string | null }[] {
  const wanted = query.trim().toLowerCase();

  return ALIAS_TYPES.flatMap(
    (type): { readonly type: AliasTypeDef; readonly word: string | null }[] => {
      if (wanted === '' || typeLabel(type).toLowerCase().includes(wanted)) {
        return [{ type, word: null }];
      }

      const word = type.words.split(' ').find((candidate) => candidate.includes(wanted));

      return word === undefined ? [] : [{ type, word }];
    },
  );
}
