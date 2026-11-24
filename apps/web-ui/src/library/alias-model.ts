/**
 * What the alias pages work out from an alias: its type and parts in words, a part's value in
 * the alias's state, where a part takes its value from, how the alias is doing, and how the list
 * narrows, groups and sorts.
 *
 * Pure, so the pages' behaviour is testable without a page. Types and parts come in English from
 * contracts (`alias-types.ts`); their names are translated here by key.
 */
import {
  ALIAS_HEALTHS,
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

import { collator, numberFormat } from '@/i18n/formatters';
import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';
import type { SortDirection } from '@/lib/use-paging';
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

/** What each health is called, in the list's value column and its Status facet. */
export const HEALTH_LABELS: Readonly<Record<AliasHealth, Message>> = {
  ok: defineMessage('library.aliases.ok', 'OK'),
  failing: defineMessage('library.aliases.failing', 'Failing'),
  unavailable: defineMessage('library.aliases.unavailable', 'Unavailable'),
  off: defineMessage('common.off', 'Off'),
};

/**
 * Whether an alias has a problem worth a warning under its name.
 *
 * @param item - The alias.
 * @returns True when it is failing or unavailable.
 */
export function hasProblem(item: Pick<AliasListItem, 'health'>): boolean {
  return item.health === 'failing' || item.health === 'unavailable';
}

/** Which devices: any, virtual ones, or real ones. */
export const ALIAS_DEVICE_KINDS = ['any', 'virtual', 'existing'] as const;

/** Which devices. */
export type AliasDeviceKind = (typeof ALIAS_DEVICE_KINDS)[number];

/** What the list has been narrowed to. */
export type AliasListFilter = {
  /** What was typed: every word must be found in the alias's name, id, area or what it reads. */
  readonly search: string;

  /** Only aliases doing so: any of them. None means any health. */
  readonly statuses: readonly AliasHealth[];

  /** One type, or blank for any. */
  readonly type: string;

  readonly device: AliasDeviceKind;

  /** One area by key, or blank for any. */
  readonly area: string;
};

/** Nothing set: every alias shows. */
export const OPEN_ALIAS_LIST_FILTER: AliasListFilter = {
  search: '',
  statuses: [],
  type: '',
  device: 'any',
  area: '',
};

/** How the list's filter lives in the address. */
export const ALIAS_LIST_CODEC: ListCodec<AliasListFilter> = {
  keys: ['q', 'status', 'type', 'device', 'area'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    statuses: (params.get('status') ?? '')
      .split(',')
      .flatMap((value) => ALIAS_HEALTHS.filter((health) => health === value)),
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
      q: [filter.search, ''],
      status: [filter.statuses.join(','), ''],
      type: [filter.type, ''],
      device: [filter.device, 'any'],
      area: [filter.area, ''],
    }),
};

/**
 * How many facets of the filter sheet are set, for its badge.
 *
 * @param filter - The filter.
 * @returns The count; the search has its own field.
 */
export function aliasFacetCount(filter: AliasListFilter): number {
  return (
    Number(filter.statuses.length > 0) +
    Number(filter.type !== '') +
    Number(filter.device !== 'any') +
    Number(filter.area !== '')
  );
}

/**
 * Whether one alias belongs in the list.
 *
 * @param item - The alias.
 * @param filter - The filter.
 * @returns True when the search and every facet admit it.
 */
export function matchesAliasList(item: AliasListItem, filter: AliasListFilter): boolean {
  if (filter.statuses.length > 0 && !filter.statuses.includes(item.health)) {
    return false;
  }

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

/** The aliases of one type, as the list groups them. */
export type AliasGroup<TItem> = {
  readonly type: AliasTypeDef;
  readonly items: readonly TItem[];
};

/**
 * The aliases grouped by type, in the types' order, each group in the order given.
 *
 * @param items - The aliases, already sorted (`sortAliasLines`).
 * @returns The groups that have any.
 */
export function groupAliases<TItem extends Pick<AliasListItem, 'behavesAs'>>(
  items: readonly TItem[],
): AliasGroup<TItem>[] {
  return ALIAS_TYPES.map((type) => ({
    type,
    items: items.filter((item) => item.behavesAs === type.id),
  })).filter((group) => group.items.length > 0);
}

/** The columns the list sorts by; the first is the order it opens in. */
export const ALIAS_SORTS = ['name', 'device', 'now', 'enabled'] as const;

/** One column to sort by. */
export type AliasSort = (typeof ALIAS_SORTS)[number];

/** A row of the list: the alias and its value now, as the Now column shows it. */
export type AliasLine = {
  readonly item: AliasListItem;
  readonly value: string;
};

/**
 * The name the Device column shows: the shared virtual device as Aliases.
 *
 * @param item - The alias.
 * @returns The device's name.
 */
function aliasDeviceName(item: Pick<AliasListItem, 'device'>): string {
  return item.device.isShared
    ? translate('library.aliases.aliasesDevice', 'Aliases')
    : item.device.name;
}

/**
 * Puts the rows in the order of a column. Now goes by health first, the healthiest first (the order
 * of `ALIAS_HEALTHS`), then by the value shown; Enabled puts the enabled ones first. A device with
 * no name or a value not known puts the row last, whichever way the column sorts; ties go by name.
 *
 * @param lines - The rows.
 * @param sort - The column.
 * @param direction - Which way.
 * @returns A sorted copy.
 */
export function sortAliasLines<TLine extends AliasLine>(
  lines: readonly TLine[],
  sort: AliasSort,
  direction: SortDirection,
): TLine[] {
  const names = collator({ numeric: true });
  const sign = direction === 'asc' ? 1 : -1;

  /**
   * Puts the one lacking a value after the one that has it.
   *
   * @param left - One value.
   * @param right - The other.
   * @returns The comparison; 0 when both or neither lack it.
   */
  const lackingLast = (left: string, right: string): number =>
    Number(left === '' || left === NO_READING) - Number(right === '' || right === NO_READING);

  return lines.toSorted(({ item: left, value: leftValue }, { item: right, value: rightValue }) => {
    const byName = names.compare(left.name, right.name);

    switch (sort) {
      case 'name':
        return sign * byName;
      case 'device': {
        const leftDevice = aliasDeviceName(left);
        const rightDevice = aliasDeviceName(right);

        return (
          lackingLast(leftDevice, rightDevice) ||
          sign * names.compare(leftDevice, rightDevice) ||
          byName
        );
      }
      case 'now':
        return (
          sign * (ALIAS_HEALTHS.indexOf(left.health) - ALIAS_HEALTHS.indexOf(right.health)) ||
          lackingLast(leftValue, rightValue) ||
          sign * names.compare(leftValue, rightValue) ||
          byName
        );
      case 'enabled':
        return sign * (Number(right.isEnabled) - Number(left.isEnabled)) || byName;
    }
  });
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
