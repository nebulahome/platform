/**
 * Porting Home Assistant automations and scenes into this platform's shape.
 *
 * Reads what `automations.yaml` and `scenes.yaml` hold - or one automation, or the `automation:`
 * and `scene:` sections of a `configuration.yaml` - in both the old syntax (`platform`, `service`)
 * and the one since 2024.10 (`trigger`, `action`). What has an equivalent here is carried over;
 * what has none (templates, devices, zones, scripts, variables) is left out and said so, one note
 * per piece, never guessed at. Entities keep their addresses, which is what Home Assistant calls
 * them too; the ones this house does not have are for the person to point at their own afterwards.
 *
 * The conversion is pure: it does not look at the house. The import flow does that next.
 */
import type { JsonObject, JsonValue } from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';
import { toKey } from '@/library/automation-draft';
import { hexToHs, kelvinToMireds } from '@/library/entity-control';

/** An automation as a file brings it in, before it is checked or sent. */
export type ImportedAutomation = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly mode: 'single' | 'restart' | 'queued' | 'parallel';
  readonly maxRuntimeMs: number;
  readonly isEnabled: boolean;
  readonly definition: JsonObject;
};

/** One member of a scene as a file brings it in: by address, with what it sets. */
export type ImportedSceneMember = {
  readonly entityId: string;
  readonly targetState: JsonObject;
  readonly transitionMs: number | null;
};

/** A scene as a file brings it in. */
export type ImportedScene = {
  readonly key: string;
  readonly name: string;
  readonly icon: string | null;
  readonly areaKey: string | null;
  readonly transitionMs: number;
  readonly rollbackOnPartialFailure: boolean;
  readonly members: readonly ImportedSceneMember[];
};

/** Something the port left out or changed, for the person to know. */
export type ImportNote = {
  /** Which automation or scene, by name. */
  readonly item: string;

  /** What happened. */
  readonly message: string;
};

/** What a conversion produced. */
export type Converted<TItem> = {
  readonly items: TItem[];
  readonly notes: ImportNote[];

  /** What each stand-in address stands for in Home Assistant, for the import's dialog. */
  readonly hints: Readonly<Record<string, string>>;
};

/** A record read from YAML. */
type Raw = Readonly<Record<string, unknown>>;

/** The longest wait the format takes: a week. */
const WEEK_MS = 604_800_000;

/** How long a ported automation may run, as a new one starts. */
const DEFAULT_RUNTIME_MS = 300_000;

/** Home Assistant's day names, as this format writes them. */
const DAYS: Readonly<Record<string, string>> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

/**
 * Whether a value is a record.
 *
 * @param value - Anything.
 * @returns True for a plain object.
 */
function isRaw(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A scalar as text: what YAML read as a number or a word, never an object's `[object Object]`.
 *
 * @param value - Anything.
 * @returns The text; empty for anything that is not a scalar.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

/**
 * A value as a list: a list stays one, nothing is empty, one value is a list of one.
 *
 * @param value - Anything.
 * @returns The list.
 */
function listOf(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/**
 * Whether a value is, or holds, a Jinja template - which this platform has no way to run.
 *
 * @param value - Anything.
 * @returns True when a template is in it anywhere.
 */
export function hasTemplate(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('{{') || value.includes('{%');
  }

  if (Array.isArray(value)) {
    return value.some(hasTemplate);
  }

  return isRaw(value) && Object.values(value).some(hasTemplate);
}

/**
 * The entity addresses a value names: one, a list, or a comma-separated line.
 *
 * @param value - `entity_id` as written.
 * @returns The addresses, lower case and trimmed.
 */
function addressesOf(value: unknown): string[] {
  return listOf(value)
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/**
 * A duration as Home Assistant writes one, in milliseconds: seconds as a number, `HH:MM:SS` or
 * `HH:MM` (with an optional sign and fraction), or `{ hours, minutes, seconds, milliseconds }`.
 *
 * @param value - The duration as written.
 * @returns Milliseconds, or null when it is a template or does not read.
 */
export function durationMsOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 1000);
  }

  if (typeof value === 'string' && !hasTemplate(value)) {
    const match = /^(-)?(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/u.exec(value.trim());

    if (match === null) {
      const seconds = Number(value);

      return value.trim() !== '' && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
    }

    const [, sign, hours, minutes, seconds] = match;
    const ms = (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds ?? '0')) * 1000;

    return Math.round(sign === '-' ? -ms : ms);
  }

  if (isRaw(value)) {
    /**
     * One part of the duration.
     *
     * @param key - `hours`, `minutes`…
     * @returns Its figure; 0 when it is not given.
     */
    const part = (key: string): number => {
      const entry = value[key];

      return typeof entry === 'number' ? entry : 0;
    };

    if (hasTemplate(value)) {
      return null;
    }

    return Math.round(
      ((part('days') * 24 + part('hours')) * 3600 + part('minutes') * 60 + part('seconds')) * 1000 +
        part('milliseconds'),
    );
  }

  return null;
}

/**
 * A time of day as this format writes one.
 *
 * @param value - `07:00`, `07:00:00`.
 * @returns `HH:MM` or `HH:MM:SS`, or null when it is an entity, a template or does not read.
 */
function clockOf(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(value.trim());

  if (match === null) {
    return null;
  }

  const [, hours, minutes, seconds] = match;
  const clock = `${(hours ?? '').padStart(2, '0')}:${minutes ?? '00'}`;

  return seconds === undefined || seconds === '00' ? clock : `${clock}:${seconds}`;
}

/**
 * The days a value names, as this format writes them.
 *
 * @param value - `mon`, or a list of them.
 * @returns The days; an empty list when none reads.
 */
function daysOf(value: unknown): string[] {
  return listOf(value).flatMap((day) => {
    const known = typeof day === 'string' ? DAYS[day.toLowerCase().slice(0, 3)] : undefined;

    return known === undefined ? [] : [known];
  });
}

/**
 * A Home Assistant RGB colour as hue and saturation.
 *
 * @param rgb - `[r, g, b]`, 0–255.
 * @returns The hue and saturation, or null when it does not read.
 */
function hsOfRgb(rgb: unknown): { hue: number; saturation: number } | null {
  if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.every((part) => typeof part === 'number')) {
    return null;
  }

  const hex = `#${rgb
    .slice(0, 3)
    .map((part) =>
      Math.round(Math.min(255, Math.max(0, part)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

  return hexToHs(hex);
}

/**
 * A CIE xy colour as hue and saturation, through the sRGB it stands for at full brightness.
 *
 * @param xy - `[x, y]`.
 * @returns The hue and saturation, or null when it does not read.
 */
function hsOfXy(xy: unknown): { hue: number; saturation: number } | null {
  if (!Array.isArray(xy) || xy.length < 2) {
    return null;
  }

  const [x, y] = xy as [unknown, unknown];

  if (typeof x !== 'number' || typeof y !== 'number' || y <= 0) {
    return null;
  }

  const z = 1 - x - y;
  const big = { x: x / y, y: 1, z: z / y };
  const linear = [
    big.x * 3.2406 - big.y * 1.5372 - big.z * 0.4986,
    -big.x * 0.9689 + big.y * 1.8758 + big.z * 0.0415,
    big.x * 0.0557 - big.y * 0.204 + big.z * 1.057,
  ].map((part) => Math.max(0, part));
  const top = Math.max(...linear, 1e-9);

  return hsOfRgb(linear.map((part) => (part / top) * 255));
}

/**
 * Hue and saturation from whichever colour a light's data gives.
 *
 * @param data - The data or the scene's attributes.
 * @returns The colour, or null when none is given.
 */
function colourOf(data: Raw): { hue: number; saturation: number } | null {
  const hs = data['hs_color'];

  if (Array.isArray(hs) && typeof hs[0] === 'number' && typeof hs[1] === 'number') {
    return { hue: Math.round(hs[0]), saturation: Math.round(hs[1]) };
  }

  return (
    hsOfRgb(data['rgb_color'] ?? data['rgbw_color'] ?? data['rgbww_color']) ??
    hsOfXy(data['xy_color'])
  );
}

/**
 * The colour temperature a light's data gives, in mireds.
 *
 * @param data - The data or the scene's attributes.
 * @returns Mireds, or null when none is given.
 */
function miredsOf(data: Raw): number | null {
  const kelvin = data['color_temp_kelvin'] ?? data['kelvin'];

  if (typeof kelvin === 'number' && kelvin > 0) {
    return kelvinToMireds(kelvin);
  }

  const mireds = data['color_temp'];

  return typeof mireds === 'number' && mireds > 0 ? Math.round(mireds) : null;
}

/**
 * A light's level from its data, in percent.
 *
 * @param data - The data or the scene's attributes.
 * @returns The level, or null when none is given.
 */
function levelOf(data: Raw): number | null {
  const percent = data['brightness_pct'];

  if (typeof percent === 'number') {
    return Math.round(Math.min(100, Math.max(0, percent)));
  }

  const brightness = data['brightness'];

  return typeof brightness === 'number'
    ? Math.round((Math.min(255, Math.max(0, brightness)) / 255) * 100)
    : null;
}

/** Collects the notes of one item, and the stand-ins it hands out. */
class Notebook {
  readonly #item: string;
  readonly #notes: ImportNote[];
  readonly #hints: Map<string, string>;

  /** The entity stand-in of each device whose entity the file named: `domain:device` to it. */
  readonly #devices: Map<string, string>;

  /**
   * Starts the notes of one item.
   *
   * @param item - Its name.
   * @param notes - Where every item's notes go.
   * @param hints - What every stand-in stands for, by its address.
   * @param devices - The file's devices whose entity is known, shared by every item.
   */
  public constructor(
    item: string,
    notes: ImportNote[],
    hints: Map<string, string>,
    devices: Map<string, string>,
  ) {
    this.#item = item;
    this.#notes = notes;
    this.#hints = hints;
    this.#devices = devices;
  }

  /**
   * Remembers that a device's entity of a domain has a stand-in already, so a call aimed at the
   * device later lands on the same one instead of a second.
   *
   * @param domain - The entity's domain.
   * @param device - The device's id.
   * @param address - The entity's stand-in.
   */
  public link(domain: string, device: string, address: string): void {
    if (!this.#devices.has(`${domain}:${device}`)) {
      this.#devices.set(`${domain}:${device}`, address);
    }
  }

  /**
   * An address standing in for something Home Assistant names by its own ids - a device, an
   * area, an entity's registry id - which the person points at an entity of theirs on import.
   * The same thing gets the same address wherever it is named, so it is pointed once.
   *
   * @param domain - What it is: `light`, `binary_sensor`.
   * @param kind - What Home Assistant names.
   * @param id - Home Assistant's id or area.
   * @returns The address.
   */
  public stand(domain: string, kind: 'entity' | 'device' | 'area', id: string): string {
    const linked = kind === 'device' ? this.#devices.get(`${domain}:${id}`) : undefined;

    if (linked !== undefined) {
      return linked;
    }

    const where =
      toKey(domain)
        .replace(/^[^a-z]+/u, '')
        .slice(0, 32) || 'sensor';
    const what =
      kind === 'area'
        ? `area_${toKey(id)}`.slice(0, 64)
        : `ha_${id
            .toLowerCase()
            .replaceAll(/[^a-z0-9]/gu, '')
            .slice(0, 12)}`;
    const address = `${where}.${what}`;

    if (!this.#hints.has(address)) {
      this.#hints.set(
        address,
        kind === 'area'
          ? translate('haImport.hintArea', 'Area "{{id}}" in Home Assistant · {{item}}', {
              id,
              item: this.#item,
            })
          : translate(
              'haImport.hintDevice',
              'A {{domain}} of {{kind}} {{id}}… in Home Assistant · {{item}}',
              {
                domain,
                kind: kind === 'device' ? 'device' : 'entity',
                id: id.slice(0, 8),
                item: this.#item,
              },
            ),
      );
    }

    return address;
  }

  /**
   * Notes one thing.
   *
   * @param message - What happened.
   */
  public add(message: string): void {
    // Three persons coming home are one thing to know, not three.
    if (!this.#notes.some((note) => note.item === this.#item && note.message === message)) {
      this.#notes.push({ item: this.#item, message });
    }
  }
}

/**
 * The name and the on/off of a block as Home Assistant gave them.
 *
 * @param raw - The trigger, condition or action.
 * @returns `name` and `isEnabled`, when it set them.
 */
function metaOf(raw: Raw): JsonObject {
  return {
    ...(typeof raw['alias'] === 'string' && raw['alias'].trim() !== ''
      ? { name: raw['alias'].trim().slice(0, 80) }
      : {}),
    ...(raw['enabled'] === false ? { isEnabled: false } : {}),
  };
}

// --- what Home Assistant names by device, by area, by registry id -----------------------------

/**
 * The domain an entity of one of Home Assistant's purpose-specific triggers and conditions has
 * here: `occupancy.detected` is about a binary sensor, `illuminance.changed` about a sensor.
 */
const FAMILY_DOMAINS: Readonly<Record<string, string>> = {
  occupancy: 'binary_sensor',
  motion: 'binary_sensor',
  presence: 'binary_sensor',
  door: 'binary_sensor',
  window: 'binary_sensor',
  moisture: 'binary_sensor',
  illuminance: 'sensor',
  temperature: 'sensor',
  humidity: 'sensor',
  power: 'sensor',
  energy: 'sensor',
  battery: 'sensor',
  carbon_dioxide: 'sensor',
};

/** The state a purpose-specific trigger's event enters, by its event's name. */
const EVENT_STATES: Readonly<Record<string, string>> = {
  turned_on: 'on',
  turned_off: 'off',
  detected: 'on',
  cleared: 'off',
  opened: 'open',
  closed: 'closed',
  locked: 'locked',
  unlocked: 'unlocked',
  started: 'on',
  stopped: 'off',
};

/** The states a purpose-specific condition checks for, by its check's name. */
const CHECK_STATES: Readonly<Record<string, string>> = {
  is_on: 'on',
  is_off: 'off',
  is_detected: 'on',
  is_not_detected: 'off',
  is_open: 'open',
  is_closed: 'closed',
  is_locked: 'locked',
  is_unlocked: 'unlocked',
};

/**
 * A registry id, a device id: Home Assistant's 32 hex digits, which say nothing about the entity.
 *
 * @param value - An `entity_id` or `device_id` as written.
 * @returns True when it is one.
 */
function isRegistryId(value: string): boolean {
  return /^[0-9a-f]{32}$/u.test(value);
}

/**
 * The entities a block names: addresses as they are, and a stand-in for each registry id, device
 * and area, for the person to point at their own when the import asks.
 *
 * @param raw - The trigger, condition or action.
 * @param domain - What the entities are, for the stand-ins.
 * @param notes - Where the stand-ins are described.
 * @returns The addresses.
 */
function targetsOf(raw: Raw, domain: string, notes: Notebook): string[] {
  const target = isRaw(raw['target']) ? raw['target'] : {};
  const data = isRaw(raw['data']) ? raw['data'] : {};
  const entities = [
    ...listOf(target['entity_id']),
    ...listOf(raw['entity_id']),
    ...listOf(data['entity_id']),
  ].flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []));
  const addresses = entities
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
    .map((entry) => (isRegistryId(entry) ? notes.stand(domain, 'entity', entry) : entry));
  const [first] = addresses;

  // A device trigger, condition or action names the device and its entity: the device is that
  // entity wherever else the file aims at it.
  if (typeof raw['device_id'] === 'string' && first !== undefined) {
    notes.link(domain, raw['device_id'], first);
  }

  for (const device of listOf(
    target['device_id'] ?? (entities.length === 0 ? raw['device_id'] : undefined),
  )) {
    if (typeof device === 'string' && device !== '') {
      addresses.push(notes.stand(domain, 'device', device));
    }
  }

  for (const area of listOf(target['area_id'])) {
    if (typeof area === 'string' && area !== '') {
      addresses.push(notes.stand(domain, 'area', area));
    }
  }

  if (target['floor_id'] !== undefined || target['label_id'] !== undefined) {
    notes.add(
      translate(
        'haImport.floorTarget',
        'A target by floor or label has no equivalent; only the entities, devices and areas it names were kept.',
      ),
    );
  }

  return [...new Set(addresses)];
}

/**
 * A threshold of a purpose-specific trigger or condition, as a comparison.
 *
 * @param threshold - `options.threshold`.
 * @returns The comparisons; none when it compares with an entity or does not read.
 */
function comparisonsOf(threshold: Raw): { operator: string; value: number }[] {
  /**
   * One bound's figure.
   *
   * @param bound - `value`, `value_min` or `value_max` as written.
   * @returns The figure, or null when it is not one.
   */
  const figure = (bound: unknown): number | null => {
    if (typeof bound === 'number') {
      return bound;
    }

    return isRaw(bound) && typeof bound['number'] === 'number' ? bound['number'] : null;
  };
  const type = textOf(threshold['type']);

  if (type === 'between') {
    const low = figure(threshold['value_min'] ?? threshold['min']);
    const high = figure(threshold['value_max'] ?? threshold['max']);

    return [
      ...(low === null ? [] : [{ operator: 'gt', value: low }]),
      ...(high === null ? [] : [{ operator: 'lt', value: high }]),
    ];
  }

  const value = figure(threshold['value']);

  return value === null ? [] : [{ operator: type === 'below' ? 'lt' : 'gt', value }];
}

/**
 * One of Home Assistant's purpose-specific triggers - `light.turned_on`, `occupancy.cleared`,
 * `illuminance.changed` - as entity triggers on what it targets.
 *
 * @param raw - The trigger.
 * @param kind - Its `trigger`: `family.event`.
 * @param notes - Where to say what was left out.
 * @returns The triggers; none when it has no equivalent.
 */
function convertTargetTrigger(raw: Raw, kind: string, notes: Notebook): JsonObject[] {
  const [family = '', event = ''] = kind.split('.');
  const domain = FAMILY_DOMAINS[family] ?? family;
  const options = isRaw(raw['options']) ? raw['options'] : {};
  const forMs = options['for'] === undefined ? null : durationMsOf(options['for']);
  const threshold = isRaw(options['threshold']) ? options['threshold'] : null;
  const meta = metaOf(raw);
  const addresses = targetsOf(raw, domain, notes);
  let change: JsonObject;

  if (threshold !== null) {
    const [first, second] = comparisonsOf(threshold);

    if (first === undefined) {
      notes.add(
        translate(
          'haImport.thresholdEntity',
          'A "{{kind}}" trigger compares with another entity; it was left out.',
          { kind },
        ),
      );

      return [];
    }

    if (second !== undefined) {
      notes.add(
        translate(
          'haImport.thresholdWindow',
          'A "{{kind}}" trigger between two values keeps only its lower bound.',
          { kind },
        ),
      );
    }

    change = { kind: 'numeric', operator: first.operator, value: first.value };
  } else if (event === 'changed') {
    change = { kind: 'state' };
  } else {
    const to = EVENT_STATES[event];

    if (to === undefined) {
      notes.add(
        translate(
          'haImport.triggerKind',
          'A "{{kind}}" trigger has no equivalent here and was left out.',
          { kind },
        ),
      );

      return [];
    }

    change = { kind: 'state', to };
  }

  if (options['behavior'] === 'all' && addresses.length > 1) {
    notes.add(
      translate(
        'haImport.behaviorAll',
        'A "{{kind}}" trigger waited for all of its targets; here any one of them wakes it.',
        { kind },
      ),
    );
  }

  return addresses.map((entityId) => ({
    ...meta,
    type: 'entity',
    entityId,
    change,
    ...(forMs === null || forMs <= 0 ? {} : { forMs }),
  }));
}

/**
 * One of Home Assistant's purpose-specific conditions - `light.is_on`, `occupancy.is_detected`,
 * `temperature.is_value`, `sun.is_set` - as conditions on what it targets.
 *
 * @param raw - The condition.
 * @param kind - Its `condition`: `family.check`.
 * @param notes - Where to say what was left out.
 * @returns The condition, or null when it has no equivalent.
 */
function convertTargetCondition(raw: Raw, kind: string, notes: Notebook): JsonObject | null {
  const [family = '', check = ''] = kind.split('.');
  const meta = metaOf(raw);
  const options = isRaw(raw['options']) ? raw['options'] : {};

  if (family === 'sun') {
    if (check !== 'is_set' && check !== 'is_up') {
      notes.add(
        translate(
          'haImport.conditionKind',
          'A "{{kind}}" condition has no equivalent here and was left out.',
          { kind },
        ),
      );

      return null;
    }

    return {
      ...meta,
      type: 'sun',
      phase: check === 'is_set' ? 'below' : 'above',
      elevation: -0.833,
    };
  }

  const domain = FAMILY_DOMAINS[family] ?? family;
  const addresses = targetsOf(raw, domain, notes);
  const threshold = isRaw(options['threshold']) ? options['threshold'] : null;
  const duration = options['for'] === undefined ? 0 : (durationMsOf(options['for']) ?? 0);

  if (duration > 0) {
    notes.add(
      translate(
        'haImport.conditionFor',
        'A condition\'s "for" has no equivalent; it checks the state alone.',
      ),
    );
  }

  let leaves: JsonObject[];

  if (check === 'is_value' && threshold !== null) {
    const comparisons = comparisonsOf(threshold);

    if (comparisons.length === 0) {
      notes.add(
        translate(
          'haImport.thresholdEntityCondition',
          'A "{{kind}}" condition compares with another entity; it was left out.',
          { kind },
        ),
      );

      return null;
    }

    leaves = addresses.flatMap((entityId) =>
      comparisons.map((comparison) => ({
        type: 'entity',
        entityId,
        match: { kind: 'numeric', ...comparison },
      })),
    );
  } else {
    const state = CHECK_STATES[check];

    if (state === undefined) {
      notes.add(
        translate(
          'haImport.conditionKind',
          'A "{{kind}}" condition has no equivalent here and was left out.',
          { kind },
        ),
      );

      return null;
    }

    leaves = addresses.map((entityId) => ({
      type: 'entity',
      entityId,
      match: { kind: 'state', states: [state] },
    }));
  }

  return grouped(leaves, options['behavior'] === 'any' ? 'or' : 'and', meta);
}

/**
 * The state a device trigger or condition's type stands for: `turned_on`, `is_motion` on,
 * `no_motion`, `is_not_occupied`, `turned_off` off.
 *
 * @param type - The type, with any `is_` taken off.
 * @param domain - The entity's domain.
 * @returns The state, null for any change, undefined when it has no equivalent.
 */
function deviceState(type: string, domain: string): string | null | undefined {
  if (type === 'changed_states') {
    return null;
  }

  if (type === 'turned_on' || type === 'on') {
    return 'on';
  }

  if (type === 'turned_off' || type === 'off') {
    return 'off';
  }

  if (domain === 'binary_sensor') {
    return type.startsWith('no_') || type.startsWith('not_') ? 'off' : 'on';
  }

  return undefined;
}

/**
 * A device trigger (`trigger: device`) as an entity trigger on a stand-in for its entity.
 *
 * @param raw - The trigger.
 * @param notes - Where to say what was left out.
 * @returns The triggers; none when its type has no equivalent.
 */
function convertDeviceTrigger(raw: Raw, notes: Notebook): JsonObject[] {
  const domain = textOf(raw['domain']) || 'sensor';
  const type = textOf(raw['type']);
  const meta = metaOf(raw);
  const forMs = raw['for'] === undefined ? null : durationMsOf(raw['for']);
  const [entityId] = targetsOf(raw, domain, notes);
  const above = raw['above'];
  const below = raw['below'];

  if (entityId === undefined) {
    return [];
  }

  let change: JsonObject;

  if (typeof above === 'number' || typeof below === 'number') {
    change =
      typeof below === 'number'
        ? { kind: 'numeric', operator: 'lt', value: below }
        : { kind: 'numeric', operator: 'gt', value: above as number };
  } else {
    const to = deviceState(type, domain);

    if (to === undefined) {
      notes.add(
        translate(
          'haImport.deviceType',
          'A device {{what}} of type "{{type}}" has no equivalent and was left out.',
          {
            what: translate('haImport.trigger', 'trigger'),
            type,
          },
        ),
      );

      return [];
    }

    change = to === null ? { kind: 'state' } : { kind: 'state', to };
  }

  return [
    {
      ...meta,
      type: 'entity',
      entityId,
      change,
      ...(forMs === null || forMs <= 0 ? {} : { forMs }),
    },
  ];
}

/**
 * A device condition (`condition: device`) as an entity condition on a stand-in for its entity.
 *
 * @param raw - The condition.
 * @param notes - Where to say what was left out.
 * @returns The condition, or null when its type has no equivalent.
 */
function convertDeviceCondition(raw: Raw, notes: Notebook): JsonObject | null {
  const domain = textOf(raw['domain']) || 'sensor';
  const type = textOf(raw['type']).replace(/^is_/u, '');
  const meta = metaOf(raw);
  const [entityId] = targetsOf(raw, domain, notes);

  if (entityId === undefined) {
    return null;
  }

  const comparisons = [
    ...(typeof raw['above'] === 'number' ? [{ operator: 'gt', value: raw['above'] }] : []),
    ...(typeof raw['below'] === 'number' ? [{ operator: 'lt', value: raw['below'] }] : []),
  ];

  if (comparisons.length > 0) {
    return grouped(
      comparisons.map((comparison) => ({
        type: 'entity',
        entityId,
        match: { kind: 'numeric', ...comparison },
      })),
      'and',
      meta,
    );
  }

  const state = deviceState(type, domain);

  if (state === undefined || state === null) {
    notes.add(
      translate(
        'haImport.deviceType',
        'A device {{what}} of type "{{type}}" has no equivalent and was left out.',
        {
          what: translate('haImport.condition', 'condition'),
          type,
        },
      ),
    );

    return null;
  }

  return { ...meta, type: 'entity', entityId, match: { kind: 'state', states: [state] } };
}

/**
 * A device action (`device_id`, `domain`, `type`) as a command, or a notification sent to a phone.
 *
 * @param raw - The step.
 * @param notes - Where to say what was left out.
 * @returns The actions; none when its type has no equivalent.
 */
function convertDeviceAction(raw: Raw, notes: Notebook): JsonObject[] {
  const domain = textOf(raw['domain']);
  const type = textOf(raw['type']);
  const meta = metaOf(raw);

  if (domain === 'mobile_app' && type === 'notify') {
    notes.add(
      translate(
        'haImport.notify',
        'A notification ({{service}}) was kept, but notifications cannot be sent here yet.',
        { service: 'mobile_app' },
      ),
    );

    return [
      {
        ...meta,
        type: 'notify',
        channel: 'mobile_app',
        message: [textOf(raw['title']), textOf(raw['message'])].filter(Boolean).join(' · '),
      },
    ];
  }

  if (type !== 'turn_on' && type !== 'turn_off' && type !== 'toggle') {
    notes.add(
      translate(
        'haImport.deviceType',
        'A device {{what}} of type "{{type}}" has no equivalent and was left out.',
        {
          what: translate('haImport.action', 'action'),
          type: `${domain} ${type}`,
        },
      ),
    );

    return [];
  }

  return commands(targetsOf(raw, domain || 'switch', notes), 'on_off', { command: type }, meta);
}

// --- triggers --------------------------------------------------------------------------------

/**
 * One Home Assistant trigger as this format's triggers - one per entity it names.
 *
 * @param raw - The trigger.
 * @param notes - Where to say what was left out.
 * @returns The triggers; none when it has no equivalent.
 */
function convertTrigger(raw: unknown, notes: Notebook): JsonObject[] {
  if (!isRaw(raw)) {
    notes.add(translate('haImport.triggerUnread', 'A trigger did not read and was left out.'));

    return [];
  }

  const kind = textOf(raw['trigger'] ?? raw['platform']);
  const meta = metaOf(raw);
  const forMs = raw['for'] === undefined ? undefined : durationMsOf(raw['for']);

  if (forMs === null) {
    notes.add(
      translate('haImport.forTemplate', 'A trigger\'s "for" is a template; it was left out.'),
    );
  }

  if (kind === 'device') {
    return convertDeviceTrigger(raw, notes);
  }

  if (kind.includes('.')) {
    return convertTargetTrigger(raw, kind, notes);
  }

  switch (kind) {
    case 'zone': {
      const zone = textOf(raw['zone']);
      const entering = textOf(raw['event']) !== 'leave';

      if (zone !== 'zone.home') {
        notes.add(
          translate(
            'haImport.zoneOther',
            'A trigger on the zone {{zone}} has no equivalent; only home is ported.',
            { zone },
          ),
        );

        return [];
      }

      notes.add(
        translate(
          'haImport.zoneHome',
          "Coming home or leaving is ported as the person's presence turning on or off.",
        ),
      );

      return targetsOf(raw, 'person', notes).map((entityId) => ({
        ...meta,
        type: 'entity',
        entityId,
        change: { kind: 'state', to: entering ? 'on' : 'off' },
      }));
    }
    case 'state': {
      if (raw['attribute'] !== undefined) {
        notes.add(
          translate(
            'haImport.attributeTrigger',
            'A trigger on an attribute ({{attribute}}) has no equivalent and was left out.',
            { attribute: textOf(raw['attribute']) },
          ),
        );

        return [];
      }

      const from = listOf(raw['from']);
      const to = listOf(raw['to']);

      if (from.length > 1 || to.length > 1) {
        notes.add(
          translate(
            'haImport.severalStates',
            'A trigger listed several states; only the first of each was kept.',
          ),
        );
      }

      return targetsOf(raw, 'sensor', notes).map((entityId) => ({
        ...meta,
        type: 'entity',
        entityId,
        change: {
          kind: 'state',
          ...(typeof from[0] === 'string' ? { from: from[0] } : {}),
          ...(typeof to[0] === 'string' ? { to: to[0] } : {}),
        },
        ...(forMs === undefined || forMs === null ? {} : { forMs }),
      }));
    }
    case 'numeric_state': {
      const above = raw['above'];
      const below = raw['below'];

      const isBrightness = raw['attribute'] === 'brightness';

      if (
        raw['value_template'] !== undefined ||
        (raw['attribute'] !== undefined && !isBrightness)
      ) {
        notes.add(
          translate(
            'haImport.numericTemplate',
            'A numeric trigger on a template or an attribute has no equivalent and was left out.',
          ),
        );

        return [];
      }

      if (typeof above === 'number' && typeof below === 'number') {
        notes.add(
          translate(
            'haImport.numericWindow',
            'A trigger between {{above}} and {{below}} keeps only "above {{above}}".',
            { above: String(above), below: String(below) },
          ),
        );
      }

      const operator = typeof above === 'number' ? 'gt' : 'lt';
      const raw255 = typeof above === 'number' ? above : below;
      // A light's brightness is 0-255 there and its level a percentage here.
      const value =
        isBrightness && typeof raw255 === 'number' ? Math.round((raw255 / 255) * 100) : raw255;

      if (isBrightness) {
        notes.add(
          translate(
            'haImport.brightness',
            'A brightness of {{raw}} out of 255 is ported as a level of {{value}}%.',
            { raw: String(raw255), value: String(value) },
          ),
        );
      }

      if (typeof value !== 'number') {
        notes.add(
          translate(
            'haImport.numericEntity',
            'A numeric trigger compares with another entity; it was left out.',
          ),
        );

        return [];
      }

      return targetsOf(raw, 'sensor', notes).map((entityId) => ({
        ...meta,
        type: 'entity',
        entityId,
        change: { kind: 'numeric', operator, value },
        ...(forMs === undefined || forMs === null ? {} : { forMs }),
      }));
    }
    case 'time': {
      const weekdays = daysOf(raw['weekday']);

      return listOf(raw['at']).flatMap((at) => {
        const time = clockOf(at);

        if (time === null) {
          notes.add(
            translate(
              'haImport.timeEntity',
              'A time trigger at {{at}} (an entity or a template) was left out.',
              { at: textOf(at) },
            ),
          );

          return [];
        }

        return [
          {
            ...meta,
            type: 'time',
            at: { kind: 'clock', time, ...(weekdays.length > 0 ? { weekdays } : {}) },
          },
        ];
      });
    }
    case 'time_pattern': {
      return [{ ...meta, type: 'time', at: { kind: 'cron', expression: cronOf(raw) } }];
    }
    case 'sun': {
      const event = raw['event'] === 'sunrise' ? 'sunrise' : 'sunset';
      const offset = raw['offset'] === undefined ? 0 : durationMsOf(raw['offset']);
      const offsetMinutes = offset === null ? 0 : Math.round(offset / 60_000);

      return [
        {
          ...meta,
          type: 'sun',
          event,
          ...(offsetMinutes === 0
            ? {}
            : { offsetMinutes: Math.max(-720, Math.min(720, offsetMinutes)) }),
        },
      ];
    }
    case 'event': {
      notes.add(
        translate(
          'haImport.eventTrigger',
          'An event trigger was kept, but event triggers cannot fire here yet.',
        ),
      );

      return listOf(raw['event_type']).flatMap((event) =>
        typeof event === 'string' && event !== ''
          ? [
              {
                ...meta,
                type: 'event',
                event,
                ...(isRaw(raw['event_data']) ? { match: raw['event_data'] as JsonObject } : {}),
              },
            ]
          : [],
      );
    }
    default: {
      notes.add(
        translate(
          'haImport.triggerKind',
          'A "{{kind}}" trigger has no equivalent here and was left out.',
          { kind: kind === '' ? '?' : kind },
        ),
      );

      return [];
    }
  }
}

/**
 * A `time_pattern` trigger as a cron expression. A part left out repeats when a larger part is
 * given and is 0 when a smaller one is, as Home Assistant reads it.
 *
 * @param raw - The trigger.
 * @returns The expression: five fields, six when it names seconds.
 */
function cronOf(raw: Raw): string {
  const keys = ['seconds', 'minutes', 'hours'] as const;
  const given = keys.map((key) => {
    const value = raw[key];

    if (value === undefined || value === null) {
      return undefined;
    }

    const written = textOf(value).trim();

    return written.startsWith('/') ? `*${written}` : written;
  });
  const smallest = given.findIndex((part) => part !== undefined);
  const [seconds, minutes, hours] = given.map(
    (part, index) => part ?? (smallest !== -1 && index < smallest ? '0' : '*'),
  );

  return seconds === '0'
    ? `${minutes ?? '*'} ${hours ?? '*'} * * *`
    : `${seconds ?? '*'} ${minutes ?? '*'} ${hours ?? '*'} * * *`;
}

// --- conditions ------------------------------------------------------------------------------

/**
 * One Home Assistant condition as this format's condition.
 *
 * @param raw - The condition.
 * @param notes - Where to say what was left out.
 * @returns The condition, or null when it has no equivalent.
 */
function convertCondition(raw: unknown, notes: Notebook): JsonObject | null {
  if (typeof raw === 'string') {
    notes.add(translate('haImport.templateCondition', 'A template condition was left out.'));

    return null;
  }

  if (!isRaw(raw)) {
    return null;
  }

  const kind = textOf(raw['condition']);
  const meta = metaOf(raw);

  if (kind === 'device') {
    return convertDeviceCondition(raw, notes);
  }

  if (kind.includes('.')) {
    return convertTargetCondition(raw, kind, notes);
  }

  switch (kind) {
    case 'state': {
      if (raw['attribute'] !== undefined || hasTemplate(raw['state'])) {
        notes.add(
          translate(
            'haImport.attributeCondition',
            'A condition on an attribute or a template was left out.',
          ),
        );

        return null;
      }

      if (raw['for'] !== undefined) {
        notes.add(
          translate(
            'haImport.conditionFor',
            'A condition\'s "for" has no equivalent; it checks the state alone.',
          ),
        );
      }

      const states = listOf(raw['state'])
        .map(textOf)
        .filter((state) => state !== '')
        .slice(0, 20);
      const leaves = targetsOf(raw, 'sensor', notes).map((entityId) => ({
        type: 'entity',
        entityId,
        match: { kind: 'state', states },
      }));

      return grouped(leaves, raw['match'] === 'any' ? 'or' : 'and', meta);
    }
    case 'numeric_state': {
      const isBrightness = raw['attribute'] === 'brightness';
      /**
       * A bound as this platform compares it: a brightness as the level's percentage.
       *
       * @param bound - The figure as written.
       * @returns The figure.
       */
      const scaled = (bound: number): number =>
        isBrightness ? Math.round((bound / 255) * 100) : bound;

      if (
        raw['value_template'] !== undefined ||
        (raw['attribute'] !== undefined && !isBrightness)
      ) {
        notes.add(
          translate(
            'haImport.numericConditionTemplate',
            'A numeric condition on a template or an attribute was left out.',
          ),
        );

        return null;
      }

      const leaves = targetsOf(raw, 'sensor', notes).flatMap((entityId) =>
        [
          typeof raw['above'] === 'number' ? { operator: 'gt', value: scaled(raw['above']) } : null,
          typeof raw['below'] === 'number' ? { operator: 'lt', value: scaled(raw['below']) } : null,
        ].flatMap((match) =>
          match === null
            ? []
            : [{ type: 'entity', entityId, match: { kind: 'numeric', ...match } }],
        ),
      );

      return grouped(leaves, 'and', meta);
    }
    case 'time': {
      const from = clockOf(raw['after']);
      const to = clockOf(raw['before']);
      const days = daysOf(raw['weekday']);

      if (
        (raw['after'] !== undefined && from === null) ||
        (raw['before'] !== undefined && to === null)
      ) {
        notes.add(
          translate(
            'haImport.timeConditionEntity',
            'A time condition on an entity or a template was left out.',
          ),
        );

        return null;
      }

      if (from === null && to === null && days.length === 0) {
        return null;
      }

      return {
        ...meta,
        type: 'time',
        ...(from === null ? {} : { from }),
        ...(to === null ? {} : { to }),
        ...(days.length === 0 ? {} : { days }),
      };
    }
    case 'sun': {
      const after = raw['after'];
      const before = raw['before'];

      if (raw['after_offset'] !== undefined || raw['before_offset'] !== undefined) {
        notes.add(
          translate(
            'haImport.sunOffset',
            "A sun condition's offset has no equivalent; it checks the sun's height instead.",
          ),
        );
      }

      // Sunset to sunrise is the sun below the horizon, as Home Assistant measures it.
      const isNight = after === 'sunset' || before === 'sunrise';
      const isDay = after === 'sunrise' || before === 'sunset';

      if (isNight === isDay) {
        notes.add(
          translate('haImport.sunCondition', 'A sun condition did not read and was left out.'),
        );

        return null;
      }

      return { ...meta, type: 'sun', phase: isNight ? 'below' : 'above', elevation: -0.833 };
    }
    case 'and':
    case 'or':
    case 'not': {
      const inner = listOf(raw['conditions'])
        .map((condition) => convertCondition(condition, notes))
        .filter((condition): condition is JsonObject => condition !== null);

      if (inner.length === 0) {
        return null;
      }

      // NOT is none of them: an OR turned around.
      return kind === 'not'
        ? { ...meta, type: 'or', conditions: inner, isNot: true }
        : { ...meta, type: kind, conditions: inner };
    }
    default: {
      notes.add(
        translate(
          'haImport.conditionKind',
          'A "{{kind}}" condition has no equivalent here and was left out.',
          { kind: kind === '' ? '?' : kind },
        ),
      );

      return null;
    }
  }
}

/**
 * Several conditions as one: the one alone, or a group of them.
 *
 * @param leaves - The conditions.
 * @param op - How they join.
 * @param meta - The block's name and on/off.
 * @returns The condition, or null when there are none.
 */
function grouped(leaves: JsonObject[], op: 'and' | 'or', meta: JsonObject): JsonObject | null {
  const [only] = leaves;

  if (only === undefined) {
    return null;
  }

  return leaves.length === 1
    ? { ...meta, ...only }
    : { ...meta, type: op, conditions: leaves.slice(0, 20) };
}

/**
 * A list of conditions, as an automation's `condition` or a block's.
 *
 * @param value - One condition or a list.
 * @param notes - Where to say what was left out.
 * @returns The conditions that have an equivalent.
 */
function convertConditions(value: unknown, notes: Notebook): JsonObject[] {
  return listOf(value)
    .map((condition) => convertCondition(condition, notes))
    .filter((condition): condition is JsonObject => condition !== null);
}

// --- actions ---------------------------------------------------------------------------------

/**
 * A command to every entity an action names.
 *
 * @param entityIds - The entities.
 * @param capability - The capability of the command.
 * @param params - The command body.
 * @param meta - The block's name and on/off.
 * @returns One command block per entity.
 */
function commands(
  entityIds: readonly string[],
  capability: string,
  params: JsonObject,
  meta: JsonObject,
): JsonObject[] {
  return entityIds.map((entityId) => ({ ...meta, type: 'command', entityId, capability, params }));
}

/**
 * What a light's `turn_on` sends: on, or its level, colour and white, each as its own command.
 *
 * @param data - The call's data.
 * @returns The commands' capability and body, in order.
 */
function lightCommands(data: Raw): [string, JsonObject][] {
  const transition = durationMsOf(data['transition']);
  const fade =
    transition === null || transition <= 0 ? {} : { transitionMs: Math.min(transition, 600_000) };
  const level = levelOf(data);
  const colour = colourOf(data);
  const mireds = miredsOf(data);
  const sent: [string, JsonObject][] = [];

  if (level === 0) {
    return [['on_off', { command: 'turn_off', ...fade }]];
  }

  if (level !== null) {
    sent.push(['level', { command: 'set_level', level, ...fade }]);
  }

  if (colour !== null) {
    sent.push(['color_hs', { command: 'set_color', ...colour, ...fade }]);
  } else if (mireds !== null) {
    sent.push(['color_temp', { command: 'set_color_temp', mireds, ...fade }]);
  }

  return sent.length === 0 ? [['on_off', { command: 'turn_on', ...fade }]] : sent;
}

/** A thermostat mode as this format names it. */
const HVAC_MODES: Readonly<Record<string, string>> = {
  off: 'off',
  heat: 'heat',
  cool: 'cool',
  auto: 'auto',
  heat_cool: 'auto',
  fan_only: 'fan_only',
  dry: 'dry',
};

/** Services of one domain mapped to a command that takes no data. */
const PLAIN_COMMANDS: Readonly<Record<string, readonly [string, string]>> = {
  'cover.open_cover': ['cover', 'open'],
  'cover.close_cover': ['cover', 'close'],
  'cover.stop_cover': ['cover', 'stop'],
  'media_player.media_play': ['media_player', 'play'],
  'media_player.media_pause': ['media_player', 'pause'],
  'media_player.media_stop': ['media_player', 'stop'],
  'media_player.media_next_track': ['media_player', 'next'],
  'media_player.media_previous_track': ['media_player', 'previous'],
  'vacuum.start': ['vacuum', 'start'],
  'vacuum.pause': ['vacuum', 'pause'],
  'vacuum.stop': ['vacuum', 'stop'],
  'vacuum.return_to_base': ['vacuum', 'dock'],
  'vacuum.locate': ['vacuum', 'locate'],
  'lawn_mower.start_mowing': ['lawn_mower', 'start'],
  'lawn_mower.pause': ['lawn_mower', 'pause'],
  'lawn_mower.dock': ['lawn_mower', 'dock'],
  'button.press': ['button', 'press'],
  'input_button.press': ['button', 'press'],
  'update.install': ['update', 'install'],
  'camera.snapshot': ['camera', 'snapshot'],
  'valve.open_valve': ['on_off', 'turn_on'],
  'valve.close_valve': ['on_off', 'turn_off'],
  'valve.toggle': ['on_off', 'toggle'],
};

/**
 * One service call as this format's actions.
 *
 * @param raw - The step.
 * @param service - `domain.service`.
 * @param notes - Where to say what was left out.
 * @returns The actions; none when it has no equivalent.
 */
function convertService(raw: Raw, service: string, notes: Notebook): JsonObject[] {
  const meta = metaOf(raw);
  const target = isRaw(raw['target']) ? raw['target'] : {};
  const data = isRaw(raw['data'])
    ? raw['data']
    : isRaw(raw['data_template'])
      ? raw['data_template']
      : {};
  const [domain = '', name = ''] = service.split('.');
  const entityIds = targetsOf(raw, domain, notes);

  if (hasTemplate(data) || hasTemplate(target)) {
    notes.add(
      translate('haImport.serviceTemplate', '{{service}} uses a template and was left out.', {
        service,
      }),
    );

    return [];
  }

  const plain = PLAIN_COMMANDS[service];

  if (plain !== undefined) {
    return commands(entityIds, plain[0], { command: plain[1] }, meta);
  }

  if (domain === 'scene' && (name === 'turn_on' || name === 'apply')) {
    if (name === 'apply') {
      notes.add(
        translate('haImport.sceneApply', 'scene.apply sets states written in place; left out.'),
      );

      return [];
    }

    return entityIds.map((entityId) => ({
      ...meta,
      type: 'scene',
      sceneKey: toKey(entityId.slice(entityId.indexOf('.') + 1)),
    }));
  }

  if (domain === 'automation' && name === 'trigger') {
    return entityIds.map((entityId) => ({
      ...meta,
      type: 'automation',
      automationKey: toKey(entityId.slice(entityId.indexOf('.') + 1)),
    }));
  }

  if (domain === 'notify' || service === 'persistent_notification.create') {
    notes.add(
      translate(
        'haImport.notify',
        'A notification ({{service}}) was kept, but notifications cannot be sent here yet.',
        { service },
      ),
    );

    return [
      {
        ...meta,
        type: 'notify',
        channel: name === '' ? 'notify' : name,
        message: typeof data['message'] === 'string' ? data['message'] : '',
      },
    ];
  }

  if (domain === 'climate') {
    const mode = HVAC_MODES[textOf(data['hvac_mode'] ?? (name === 'turn_off' ? 'off' : ''))];
    const sent: JsonObject[] = [];

    if (mode !== undefined) {
      sent.push(...commands(entityIds, 'thermostat', { command: 'set_mode', mode }, meta));
    }

    if (name === 'set_temperature' && typeof data['temperature'] === 'number') {
      sent.push(
        ...commands(
          entityIds,
          'thermostat',
          { command: 'set_target', temperature: data['temperature'] },
          meta,
        ),
      );
    }

    if (sent.length > 0) {
      return sent;
    }
  }

  switch (service) {
    case 'cover.set_cover_position': {
      return commands(
        entityIds,
        'cover',
        { command: 'set_position', position: Number(data['position'] ?? 0) },
        meta,
      );
    }
    case 'cover.set_cover_tilt_position':
    case 'cover.open_cover_tilt':
    case 'cover.close_cover_tilt': {
      const tilt =
        name === 'open_cover_tilt'
          ? 100
          : name === 'close_cover_tilt'
            ? 0
            : Number(data['tilt_position'] ?? 0);

      return commands(entityIds, 'cover', { command: 'set_tilt', tilt }, meta);
    }
    case 'lock.lock':
    case 'lock.unlock': {
      return commands(
        entityIds,
        'lock',
        { command: name, ...(typeof data['code'] === 'string' ? { code: data['code'] } : {}) },
        meta,
      );
    }
    case 'media_player.volume_set': {
      const volume = typeof data['volume_level'] === 'number' ? data['volume_level'] : 0;

      return commands(
        entityIds,
        'media_player',
        { command: 'set_volume', volume: Math.round(volume * 100) },
        meta,
      );
    }
    case 'media_player.volume_mute': {
      return commands(
        entityIds,
        'media_player',
        { command: 'set_mute', isMuted: data['is_volume_muted'] === true },
        meta,
      );
    }
    case 'media_player.select_source': {
      return commands(
        entityIds,
        'media_player',
        { command: 'set_source', source: textOf(data['source']) },
        meta,
      );
    }
    case 'media_player.media_seek': {
      return commands(
        entityIds,
        'media_player',
        { command: 'seek', positionSeconds: Number(data['seek_position'] ?? 0) },
        meta,
      );
    }
    case 'select.select_option':
    case 'input_select.select_option': {
      return commands(
        entityIds,
        'select',
        { command: 'select_option', option: textOf(data['option']) },
        meta,
      );
    }
    case 'number.set_value':
    case 'input_number.set_value': {
      return commands(
        entityIds,
        'number',
        { command: 'set_value', value: Number(data['value'] ?? 0) },
        meta,
      );
    }
    case 'camera.record': {
      const seconds = typeof data['duration'] === 'number' ? data['duration'] : 30;

      return commands(entityIds, 'camera', { command: 'record', durationSeconds: seconds }, meta);
    }
    default: {
      break;
    }
  }

  if (name === 'turn_on' || name === 'turn_off' || name === 'toggle') {
    if (domain === 'light' && name === 'turn_on') {
      return entityIds.flatMap((entityId) =>
        lightCommands(data).flatMap(([capability, params]) =>
          commands([entityId], capability, params, meta),
        ),
      );
    }

    const transition = domain === 'light' ? durationMsOf(data['transition']) : null;
    const fade =
      transition === null || transition <= 0 || name === 'toggle'
        ? {}
        : { transitionMs: Math.min(transition, 600_000) };

    if (domain === 'automation' || domain === 'script') {
      notes.add(
        translate(
          'haImport.automationSwitch',
          '{{service}} turns another automation or script on or off; left out.',
          { service },
        ),
      );

      return [];
    }

    return commands(entityIds, 'on_off', { command: name, ...fade }, meta);
  }

  notes.add(
    translate('haImport.serviceUnknown', '{{service}} has no equivalent here and was left out.', {
      service,
    }),
  );

  return [];
}

/**
 * A list of Home Assistant steps as this format's actions. A `condition` step stops the run when
 * it does not hold, so it becomes an If holding every step after it.
 *
 * @param value - One step or a list.
 * @param notes - Where to say what was left out.
 * @returns The actions.
 */
function convertActions(value: unknown, notes: Notebook): JsonObject[] {
  const steps = listOf(value);
  const converted: JsonObject[] = [];

  for (const [index, step] of steps.entries()) {
    if (
      isRaw(step) &&
      step['condition'] !== undefined &&
      step['service'] === undefined &&
      step['action'] === undefined
    ) {
      const condition = convertCondition(step, notes);
      const rest = convertActions(steps.slice(index + 1), notes);

      if (condition === null) {
        converted.push(...rest);
      } else if (rest.length > 0) {
        converted.push({ type: 'if', conditions: [condition], then: rest });
      }

      return converted;
    }

    converted.push(...convertAction(step, notes));
  }

  return converted;
}

/**
 * One Home Assistant step as this format's actions.
 *
 * @param raw - The step.
 * @param notes - Where to say what was left out.
 * @returns The actions; none when it has no equivalent.
 */
function convertAction(raw: unknown, notes: Notebook): JsonObject[] {
  if (!isRaw(raw)) {
    return [];
  }

  const meta = metaOf(raw);
  const service = raw['action'] ?? raw['service'];

  if (raw['continue_on_error'] !== undefined) {
    notes.add(
      translate(
        'haImport.continueOnError',
        'continue_on_error has no equivalent: a failed step ends the run.',
      ),
    );
  }

  if (typeof service === 'string') {
    if (hasTemplate(service)) {
      notes.add(
        translate('haImport.serviceNameTemplate', 'A service named by a template was left out.'),
      );

      return [];
    }

    return convertService(raw, service, notes);
  }

  if (raw['device_id'] !== undefined && raw['domain'] !== undefined) {
    return convertDeviceAction(raw, notes);
  }

  if (raw['delay'] !== undefined) {
    const durationMs = durationMsOf(raw['delay']);

    if (durationMs === null) {
      notes.add(translate('haImport.delayTemplate', 'A delay written as a template was left out.'));

      return [];
    }

    return [
      { ...meta, type: 'wait_duration', durationMs: Math.min(Math.max(durationMs, 0), WEEK_MS) },
    ];
  }

  if (raw['wait_template'] !== undefined) {
    notes.add(translate('haImport.waitTemplate', 'A wait on a template was left out.'));

    return [];
  }

  if (raw['wait_for_trigger'] !== undefined) {
    const triggers = listOf(raw['wait_for_trigger']).flatMap((trigger) =>
      convertTrigger(trigger, notes),
    );
    const [trigger] = triggers;
    const timeout =
      raw['timeout'] === undefined ? WEEK_MS : (durationMsOf(raw['timeout']) ?? WEEK_MS);

    if (triggers.length > 1) {
      notes.add(
        translate(
          'haImport.waitSeveral',
          'A wait for one of several triggers keeps only the first.',
        ),
      );
    }

    return trigger === undefined
      ? []
      : [{ ...meta, type: 'wait_for_trigger', trigger, timeoutMs: Math.min(timeout, WEEK_MS) }];
  }

  if (raw['choose'] !== undefined) {
    // A chain of If / else: the first option whose conditions hold, or the default.
    const options = listOf(raw['choose']).filter(isRaw);
    let tail: JsonObject[] = convertActions(raw['default'], notes);

    for (const option of [...options].reverse()) {
      const then = convertActions(option['sequence'], notes);

      if (then.length === 0) {
        continue;
      }

      tail = [
        {
          type: 'if',
          conditions: convertConditions(option['conditions'], notes),
          then,
          ...(tail.length === 0 ? {} : { else: tail }),
        },
      ];
    }

    const [first] = tail;

    return first === undefined ? [] : [{ ...meta, ...first }, ...tail.slice(1)];
  }

  if (raw['if'] !== undefined) {
    const then = convertActions(raw['then'], notes);
    const otherwise = convertActions(raw['else'], notes);

    return then.length === 0
      ? []
      : [
          {
            ...meta,
            type: 'if',
            conditions: convertConditions(raw['if'], notes),
            then,
            ...(otherwise.length === 0 ? {} : { else: otherwise }),
          },
        ];
  }

  if (isRaw(raw['repeat'])) {
    const repeat = raw['repeat'];
    const actions = convertActions(repeat['sequence'], notes);

    if (actions.length === 0) {
      return [];
    }

    if (typeof repeat['count'] === 'number') {
      return [
        {
          ...meta,
          type: 'for',
          over: {
            kind: 'count',
            count: Math.max(1, Math.min(10_000, Math.round(repeat['count']))),
          },
          actions,
        },
      ];
    }

    if (repeat['while'] !== undefined) {
      const conditions = convertConditions(repeat['while'], notes);

      return conditions.length === 0 ? [] : [{ ...meta, type: 'while', conditions, actions }];
    }

    if (repeat['until'] !== undefined) {
      const until = convertConditions(repeat['until'], notes);

      // Until they all hold is while not all of them do: an AND turned around.
      return until.length === 0
        ? []
        : [
            {
              ...meta,
              type: 'do_while',
              conditions: [{ type: 'and', conditions: until, isNot: true }],
              actions,
            },
          ];
    }

    notes.add(
      translate(
        'haImport.forEach',
        'A repeat for each item has no equivalent yet and was left out.',
      ),
    );

    return [];
  }

  if (raw['parallel'] !== undefined) {
    const branches = listOf(raw['parallel'])
      .map((branch) =>
        convertActions(
          isRaw(branch) && branch['sequence'] !== undefined ? branch['sequence'] : branch,
          notes,
        ),
      )
      .filter((branch) => branch.length > 0)
      .slice(0, 10);

    return branches.length === 0 ? [] : [{ ...meta, type: 'parallel', branches }];
  }

  if (raw['sequence'] !== undefined) {
    const actions = convertActions(raw['sequence'], notes);

    return actions.length === 0 ? [] : [{ ...meta, type: 'sequence', actions }];
  }

  if (raw['stop'] !== undefined) {
    return [{ ...meta, type: 'stop' }];
  }

  if (raw['scene'] !== undefined) {
    return addressesOf(raw['scene']).map((entityId) => ({
      ...meta,
      type: 'scene',
      sceneKey: toKey(entityId.slice(entityId.indexOf('.') + 1)),
    }));
  }

  const kind = ['event', 'variables', 'device_id', 'set_conversation_response'].find(
    (key) => raw[key] !== undefined,
  );

  notes.add(
    translate('haImport.stepKind', 'A "{{kind}}" step has no equivalent here and was left out.', {
      kind: kind ?? '?',
    }),
  );

  return [];
}

// --- whole documents -------------------------------------------------------------------------

/**
 * What a key is made from: the id Home Assistant gave it when that is a word - the UI writes a
 * timestamp there - and its name otherwise.
 *
 * @param id - Its `id`.
 * @param name - Its name.
 * @returns The text to make the key from.
 */
function keySource(id: unknown, name: string): string {
  return typeof id === 'string' && /[a-z]/iu.test(id) ? id : name;
}

/**
 * A key from what Home Assistant calls an automation or scene, not taken by another.
 *
 * @param wanted - The id or the alias.
 * @param taken - Keys already used, which it is added to.
 * @param fallback - What to start from when the name gives nothing.
 * @returns A key the format takes.
 */
export function uniqueKey(wanted: string, taken: Set<string>, fallback: string): string {
  let base = toKey(wanted)
    .replace(/^[^a-z]+/u, '')
    .slice(0, 58);

  if (base.length < 2) {
    base = fallback;
  }

  let key = base;

  for (let count = 2; taken.has(key); count += 1) {
    key = `${base}_${String(count)}`;
  }

  taken.add(key);

  return key;
}

/**
 * Home Assistant automations as this platform's.
 *
 * @param list - The automations as read.
 * @param taken - Keys already used here, so a ported one does not land on them.
 * @returns The automations and what was left out of them.
 */
export function convertHaAutomations(
  list: readonly unknown[],
  taken: Set<string>,
): Converted<ImportedAutomation> {
  const notes: ImportNote[] = [];
  const hints = new Map<string, string>();
  const devices = new Map<string, string>();
  const items: ImportedAutomation[] = [];

  for (const [index, raw] of list.entries()) {
    if (!isRaw(raw)) {
      continue;
    }

    const name =
      typeof raw['alias'] === 'string' && raw['alias'].trim() !== ''
        ? raw['alias'].trim().slice(0, 120)
        : translate('haImport.automationNumber', 'Automation {{number}}', {
            number: String(index + 1),
          });
    const book = new Notebook(name, notes, hints, devices);

    if (raw['use_blueprint'] !== undefined) {
      book.add(
        translate(
          'haImport.blueprint',
          'It is made from a blueprint, which cannot be ported; it was left out.',
        ),
      );

      continue;
    }

    let triggers = listOf(raw['triggers'] ?? raw['trigger']).flatMap((trigger) =>
      convertTrigger(trigger, book),
    );

    if (triggers.length === 0) {
      book.add(
        translate(
          'haImport.noTriggers',
          'None of its triggers could be ported; it runs only when asked until you add one.',
        ),
      );
      triggers = [{ type: 'manual' }];
    }

    const mode = textOf(raw['mode']);

    items.push({
      key: uniqueKey(keySource(raw['id'], name), taken, 'automation'),
      name,
      description: typeof raw['description'] === 'string' ? raw['description'].slice(0, 2000) : '',
      mode: mode === 'restart' || mode === 'queued' || mode === 'parallel' ? mode : 'single',
      maxRuntimeMs: DEFAULT_RUNTIME_MS,
      isEnabled: raw['initial_state'] !== false,
      definition: {
        triggers: triggers.slice(0, 20),
        if: convertConditions(raw['conditions'] ?? raw['condition'], book).slice(0, 20),
        then: convertActions(raw['actions'] ?? raw['action'], book).slice(0, 50),
      },
    });
  }

  return { items, notes, hints: Object.fromEntries(hints) };
}

/**
 * What one entity of a Home Assistant scene is set to, as a target state.
 *
 * @param entityId - The entity.
 * @param value - Its state, or its state and attributes.
 * @returns The target state; empty when nothing of it reads.
 */
function targetStateOf(entityId: string, value: unknown): JsonObject {
  const attributes: Raw = isRaw(value) ? value : { state: value };
  const state = textOf(attributes['state']).toLowerCase();
  const domain = entityId.slice(0, entityId.indexOf('.'));
  const target: Record<string, JsonValue> = {};

  switch (domain) {
    case 'cover': {
      const position =
        typeof attributes['current_position'] === 'number'
          ? attributes['current_position']
          : state === 'closed'
            ? 0
            : 100;

      target['cover'] = {
        position,
        ...(typeof attributes['current_tilt_position'] === 'number'
          ? { tilt: attributes['current_tilt_position'] }
          : {}),
      };
      break;
    }
    case 'lock': {
      target['lock'] = { lockState: state === 'unlocked' ? 'unlocked' : 'locked' };
      break;
    }
    case 'climate': {
      const mode = HVAC_MODES[state] ?? HVAC_MODES[textOf(attributes['hvac_mode'])] ?? 'heat';

      target['thermostat'] = {
        mode,
        targetTemperature:
          typeof attributes['temperature'] === 'number' ? attributes['temperature'] : 21,
      };
      break;
    }
    case 'media_player': {
      const volume = attributes['volume_level'];

      target['media_player'] = {
        playback: state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'stopped',
        volume: typeof volume === 'number' ? Math.round(volume * 100) : 30,
        isMuted: attributes['is_volume_muted'] === true,
      };
      break;
    }
    default: {
      if (state === 'on' || state === 'off') {
        target['on_off'] = { isOn: state === 'on' };
      }

      const level = levelOf(attributes);
      const colour = colourOf(attributes);
      const mireds = miredsOf(attributes);

      if (level !== null) {
        target['level'] = { level };
      }

      if (colour !== null) {
        target['color_hs'] = colour;
      } else if (mireds !== null) {
        target['color_temp'] = { mireds };
      }
    }
  }

  return target;
}

/**
 * Home Assistant scenes as this platform's.
 *
 * @param list - The scenes as read.
 * @param taken - Keys already used here.
 * @returns The scenes and what was left out of them.
 */
export function convertHaScenes(
  list: readonly unknown[],
  taken: Set<string>,
): Converted<ImportedScene> {
  const notes: ImportNote[] = [];
  const hints = new Map<string, string>();
  const devices = new Map<string, string>();
  const items: ImportedScene[] = [];

  for (const [index, raw] of list.entries()) {
    if (!isRaw(raw)) {
      continue;
    }

    const name =
      typeof raw['name'] === 'string' && raw['name'].trim() !== ''
        ? raw['name'].trim().slice(0, 120)
        : translate('haImport.sceneNumber', 'Scene {{number}}', { number: String(index + 1) });
    const book = new Notebook(name, notes, hints, devices);
    const entities = isRaw(raw['entities']) ? raw['entities'] : {};
    const members: ImportedSceneMember[] = [];

    for (const [address, value] of Object.entries(entities)) {
      const entityId = address.trim().toLowerCase();
      const targetState = targetStateOf(entityId, value);

      if (Object.keys(targetState).length === 0) {
        book.add(
          translate(
            'haImport.memberUnread',
            'What {{entityId}} is set to did not read; left out.',
            {
              entityId,
            },
          ),
        );

        continue;
      }

      members.push({ entityId, targetState, transitionMs: null });
    }

    items.push({
      key: uniqueKey(keySource(raw['id'], name), taken, 'scene'),
      name,
      icon: null,
      areaKey: null,
      transitionMs: 0,
      rollbackOnPartialFailure: false,
      members: members.slice(0, 200),
    });
  }

  return { items, notes, hints: Object.fromEntries(hints) };
}
