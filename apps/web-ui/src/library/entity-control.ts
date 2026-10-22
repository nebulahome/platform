/**
 * What an entity can be told to do, and whether this person may tell it.
 *
 * The controls on an entity's page are drawn from three facts that are all here: the state it is
 * in now (the live channel's when it has spoken, the page's otherwise), the limits its device
 * declared (`params` - a lamp's warmest and coolest white, a thermostat's range), and whether a
 * command would be accepted at all.
 *
 * **Commands are always explicit.** `toggle` is in the contract, but a bundle maps only the
 * commands its device documents, and several do not map it - a Govee, a Nanoleaf, a Sonoff. The
 * interface knows which way it is switching, so it says so: `turn_on` or `turn_off`, never
 * "the other way", which would also turn the light off twice when two people press at once.
 *
 * The colour helpers draw the grooves of the colour sliders from the device's own range, so the
 * warmth slider of a lamp that goes from 2000 K to 6500 K shows that lamp's whites and no other.
 */
import type { z } from 'zod';

import {
  CAPABILITY_DEFINITIONS,
  capabilityStateSchema,
  commandSchemaFor,
  type CapabilityName,
  type CapabilityState,
  type EntityView,
  type JsonObject,
  type TagView,
} from '@nebulahome/contracts';

import type { LiveReading } from '@/live/live-store';

/** The device limits of one capability, as its schema reads them. */
export type ParamsOf<TCapability extends CapabilityName> = z.output<
  (typeof CAPABILITY_DEFINITIONS)[TCapability]['params']
>;

/**
 * The state of an entity, capability by capability.
 *
 * @param entity - The entity as the API served it.
 * @param live - What the channel has said since, if anything.
 * @returns The newer state, parsed; empty when there is none or it does not read.
 */
export function capabilityStateOf(
  entity: Pick<EntityView, 'state'>,
  live: Pick<LiveReading, 'state'> | undefined,
): CapabilityState {
  const parsed = capabilityStateSchema.safeParse(live?.state ?? entity.state ?? {});

  return parsed.success ? parsed.data : {};
}

/**
 * Whether an entity declares a capability.
 *
 * @param entity - Its capabilities.
 * @param capability - The one asked about.
 * @returns True when it does.
 */
export function hasCapability(
  entity: Pick<EntityView, 'capabilities'>,
  capability: CapabilityName,
): boolean {
  return entity.capabilities.some((entry) => entry.capability === capability);
}

/**
 * The limits a device declared for one of its capabilities.
 *
 * @param entity - Its capabilities, each with its params.
 * @param capability - The one asked about.
 * @returns The params, with the schema's defaults; null when it does not declare the capability,
 * or declared params that do not read - a lamp whose range is missing cannot be commanded safely.
 */
export function paramsOf<TCapability extends CapabilityName>(
  entity: Pick<EntityView, 'capabilities'>,
  capability: TCapability,
): ParamsOf<TCapability> | null {
  const entry = entity.capabilities.find((candidate) => candidate.capability === capability);

  if (entry === undefined) {
    return null;
  }

  const parsed = CAPABILITY_DEFINITIONS[capability].params.safeParse(entry.params);

  // The table's params schemas are indexed by the same key, so the output is this capability's.
  return parsed.success ? (parsed.data as ParamsOf<TCapability>) : null;
}

/**
 * Whether anything about an entity can be commanded at all.
 *
 * `core` refuses a command to a disabled entity, to a calculated alias and to the system
 * monitor's readings, and to a capability that only reports; a control drawn for any of those
 * would be a button that always fails.
 *
 * @param entity - Its source, whether it is enabled, and its capabilities.
 * @returns True when at least one of its capabilities takes commands.
 */
export function isCommandable(
  entity: Pick<EntityView, 'source' | 'isEnabled' | 'capabilities'>,
): boolean {
  if (!entity.isEnabled || entity.source === 'derived' || entity.source === 'system') {
    return false;
  }

  return entity.capabilities.some((entry) => commandSchemaFor(entry.capability) !== null);
}

/**
 * The scopes an entity falls under, the way the API builds them for a permission check.
 *
 * The same three the API names - the entity, the area it is in, the tags on it and on its device
 * (`apps/api/src/auth/permissions.ts`) - so a control is hidden exactly where the server would
 * refuse it. Not a security boundary: the server checks regardless.
 *
 * @param entity - The address, the area and its own tags.
 * @param tags - Every tag, to turn ids into keys.
 * @param deviceTagIds - The tags on the device it belongs to.
 * @returns The scopes.
 */
export function entityScopesOf(
  entity: Pick<EntityView, 'entityId' | 'areaKey' | 'tagIds'>,
  tags: readonly TagView[],
  deviceTagIds: readonly string[] = [],
): string[] {
  const keys = new Map(tags.map((tag) => [tag.id, tag.key]));
  const scopes = [`entity.${entity.entityId}`];

  if (entity.areaKey !== null) {
    scopes.push(`area.${entity.areaKey}`);
  }

  for (const id of new Set([...entity.tagIds, ...deviceTagIds])) {
    const key = keys.get(id);

    if (key !== undefined) {
      scopes.push(`tag.${key}`);
    }
  }

  return scopes;
}

/**
 * The command that switches an entity on or off.
 *
 * @param isOn - Which way.
 * @returns `turn_on` or `turn_off` - never `toggle`; see the module note.
 */
export function powerCommand(isOn: boolean): JsonObject {
  return { command: isOn ? 'turn_on' : 'turn_off' };
}

/**
 * Converts mireds, the reciprocal scale devices speak, to kelvin, the one people read.
 *
 * @param mireds - A colour temperature in mireds.
 * @returns The same temperature in kelvin, to the nearest ten.
 */
export function miredsToKelvin(mireds: number): number {
  return Math.round(1_000_000 / mireds / 10) * 10;
}

/**
 * Converts kelvin to mireds.
 *
 * @param kelvin - A colour temperature in kelvin.
 * @returns The same temperature in whole mireds, as the contract takes it.
 */
export function kelvinToMireds(kelvin: number): number {
  return Math.round(1_000_000 / kelvin);
}

/**
 * Clamps a value into a byte.
 *
 * @param value - Any number.
 * @returns It, rounded and held between 0 and 255.
 */
function byte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

/**
 * The colour a white of a given temperature looks, closely enough to paint a slider with.
 *
 * Tanner Helland's fit of the black-body curve: good to a few percent between 1000 K and
 * 40000 K, which is more than any lamp spans.
 *
 * @param kelvin - The temperature.
 * @returns A CSS colour.
 */
export function kelvinColor(kelvin: number): string {
  const t = kelvin / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return `rgb(${String(byte(red))} ${String(byte(green))} ${String(byte(blue))})`;
}

/**
 * The groove of a warmth slider: the device's whites, warmest on the left.
 *
 * @param minKelvin - The warmest it goes.
 * @param maxKelvin - The coolest it goes.
 * @returns A CSS gradient.
 */
export function warmthGradient(minKelvin: number, maxKelvin: number): string {
  const stops = [0, 0.25, 0.5, 0.75, 1].map(
    (at) => `${kelvinColor(minKelvin + (maxKelvin - minKelvin) * at)} ${String(at * 100)}%`,
  );

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * The colour of a hue and a saturation, at full brightness.
 *
 * @param hue - 0 to 360.
 * @param saturation - 0 to 100.
 * @returns A CSS colour.
 */
export function hsColor(hue: number, saturation: number): string {
  // At full saturation a hue is lit at half; with none it is white. Between the two the
  // lightness rises, which is how a bulb's colour fades towards white.
  const lightness = 100 - saturation / 2;

  return `hsl(${String(Math.round(hue))} ${String(Math.round(saturation))}% ${String(Math.round(lightness))}%)`;
}

/**
 * The hue and saturation of a colour written `#rrggbb` - what a colour picker hands back.
 *
 * Its brightness is left out: a light's colour and its brightness are two settings, and a dark
 * red picked from a photo is a red, not a light turned down.
 *
 * @param hex - `#rrggbb` or `#rgb`.
 * @returns The hue (0 to 360) and saturation (0 to 100), or null for anything else.
 */
export function hexToHs(hex: string): { hue: number; saturation: number } | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  const parts = long?.slice(1) ?? short?.slice(1).map((digit) => `${digit}${digit}`);

  if (parts === undefined) {
    return null;
  }

  const [r = 0, g = 0, b = 0] = parts.map((part) => Number.parseInt(part, 16));
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  if (max === 0 || delta === 0) {
    return { hue: 0, saturation: 0 };
  }

  const sector =
    max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;

  return { hue: Math.round(sector * 60) % 360, saturation: Math.round((delta / max) * 100) };
}

/**
 * The colour a hue and a saturation stand for at full brightness, as `#rrggbb`: what a HEX field
 * shows, and what {@link hexToHs} reads back to the same hue and saturation.
 *
 * @param hue - 0 to 360.
 * @param saturation - 0 to 100.
 * @returns The colour.
 */
export function hsToHex(hue: number, saturation: number): string {
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  const h = (((hue % 360) + 360) % 360) / 60;

  /**
   * One channel of the colour, by the HSV formula at full value.
   *
   * @param n - Which channel: 5 red, 3 green, 1 blue.
   * @returns The channel, 0 to 255.
   */
  const channel = (n: number): number => {
    const k = (n + h) % 6;

    return Math.round((1 - s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };

  return `#${[channel(5), channel(3), channel(1)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The groove of a hue slider: the whole wheel, unrolled.
 *
 * @returns A CSS gradient.
 */
export function hueGradient(): string {
  const stops = [0, 60, 120, 180, 240, 300, 360].map((hue) => `hsl(${String(hue)} 100% 50%)`);

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * The groove of a saturation slider: from white to the hue at its fullest.
 *
 * @param hue - The hue being saturated.
 * @returns A CSS gradient.
 */
export function saturationGradient(hue: number): string {
  return `linear-gradient(90deg, ${hsColor(hue, 0)}, ${hsColor(hue, 100)})`;
}

/**
 * Whether an entity carries a number a threshold can be compared against.
 *
 * A numeric trigger or condition on a switch would never fire: the reading is on or off. The
 * numbers are a sensor's reading, and the figures a device's state carries - a level, a
 * position, a temperature.
 *
 * @param entity - Its capabilities.
 * @returns True for a numeric sensor, and for an entity whose state holds a number.
 */
export function hasNumber(entity: Pick<EntityView, 'capabilities'>): boolean {
  const numeric: readonly CapabilityName[] = [
    'sensor_numeric',
    'number',
    'level',
    'color_temp',
    'cover',
    'thermostat',
    'media_player',
  ];

  return entity.capabilities.some((entry) => numeric.includes(entry.capability));
}

/** The whites a lamp is assumed to span when the entity is not known yet. */
const DEFAULT_KELVIN = { min: 2_000, max: 6_500 } as const;

/**
 * The whites a lamp spans, warmest first.
 *
 * @param entity - The entity, or undefined while none is chosen.
 * @returns The range in kelvin.
 */
export function kelvinRangeOf(entity: Pick<EntityView, 'capabilities'> | undefined): {
  min: number;
  max: number;
} {
  const params = entity === undefined ? null : paramsOf(entity, 'color_temp');

  return params === null
    ? DEFAULT_KELVIN
    : { min: miredsToKelvin(params.maxMireds), max: miredsToKelvin(params.minMireds) };
}
