/**
 * The sample values the entity lab starts a field at.
 *
 * Generic first: an enum's first value, the middle of a number's bounds, "Option 3" for the third
 * member of a list. A few unbounded numbers read better with a realistic value - a temperature of
 * 21 rather than 0 - and those come from a small table of hints by the field's name. A field the
 * table does not know still gets a value.
 */
import type { FieldKind, ItemNode, SchemaField } from '@/testing/entity-lab/schema-fields';

/** Realistic values for fields whose schema leaves them unbounded, by the field's name. */
const HINTS: Readonly<Record<string, unknown>> = {
  mode: 'heat',
  motion: 'stopped',
  action: 'heating',
  playback: 'playing',
  activity: 'docked',
  lockState: 'locked',
  currentTemperature: 21.4,
  targetTemperature: 21,
  targetTemperatureLow: 19,
  targetTemperatureHigh: 24,
  minTemperature: 7,
  maxTemperature: 30,
  temperatureStep: 0.5,
  humidity: 48,
  targetHumidity: 45,
  min: 0,
  max: 120,
  step: 1,
  value: 21.4,
  minMireds: 153,
  maxMireds: 455,
  mireds: 370,
  hue: 28,
  saturation: 80,
  level: 60,
  position: 60,
  tilt: 40,
  volume: 35,
  percentage: 50,
  speedCount: 3,
  progress: 40,
  latitude: 45.0703,
  longitude: 7.6869,
  accuracyMeters: 18,
  distanceKm: 42,
  mediaDurationSeconds: 245,
  mediaPositionSeconds: 92,
  codeLength: 4,
  installedVersion: '1.4.2',
  latestVersion: '1.5.0',
  title: 'Firmware',
  releaseSummary: 'Faster reconnects after a power cut, and a fix for the LED staying on.',
  releaseUrl: 'https://example.com/releases/1.5.0',
  mediaTitle: 'Blue in Green',
  mediaArtist: 'Miles Davis',
  mediaAlbum: 'Kind of Blue',
  source: 'Spotify',
  zone: 'home',
  locationName: 'Via Roma 12',
  ipAddress: '192.168.1.42',
  macAddress: '3C:22:FB:1A:09:7E',
  hostName: 'bobby-phone',
  revision: 'r1',
  packageId: 'pkg-template',
  type: 'item',
};

/**
 * A sample number inside a number field's bounds.
 *
 * @param key - The field, for a hint.
 * @param kind - Its bounds.
 * @returns The number.
 */
function sampleNumber(key: string, kind: Extract<FieldKind, { type: 'number' }>): number {
  const hint = HINTS[key];

  if (typeof hint === 'number') {
    return Math.min(kind.max ?? hint, Math.max(kind.min ?? hint, hint));
  }

  if (kind.min !== undefined && kind.max !== undefined) {
    const middle = (kind.min + kind.max) / 2;

    return kind.isInt ? Math.round(middle) : middle;
  }

  return kind.min ?? 0;
}

/**
 * A sample member of a list.
 *
 * @param item - The members' schema.
 * @param index - Which member, from 0.
 * @returns The member.
 */
export function sampleItem(item: ItemNode, index: number): unknown {
  const n = String(index + 1);

  if (item.type === 'object') {
    const value: Record<string, unknown> = {};

    for (const [key, node] of Object.entries(item.properties ?? {})) {
      if (!(item.required ?? []).includes(key)) {
        continue;
      }

      value[key] =
        key === 'id' || key === 'value'
          ? `${key}-${n}`
          : node.type === 'number'
            ? index
            : `${key.charAt(0).toUpperCase()}${key.slice(1)} ${n}`;
    }

    // A select's options are named and valued alike: "Option 3".
    if ('label' in value) {
      value['label'] = `Option ${n}`;
    }

    if ('name' in value) {
      value['name'] = `Room ${n}`;
    }

    return value;
  }

  if (item.type === 'number' || item.type === 'integer') {
    return index;
  }

  return `Option ${n}`;
}

/**
 * A field's sample value: what the lab shows before anything is touched.
 *
 * @param field - The field.
 * @param listLength - How many members a list starts with.
 * @returns The value; undefined for an optional field, which starts not reported.
 */
export function sampleValue(field: SchemaField, listLength = 4): unknown {
  const { key, kind } = field;
  const hint = HINTS[key];

  switch (kind.type) {
    case 'boolean': {
      return field.hasDefault ? field.fallback : false;
    }
    case 'enum': {
      if (typeof hint === 'string' && kind.values.includes(hint)) {
        return hint;
      }

      return field.hasDefault ? field.fallback : kind.values[0];
    }
    case 'number': {
      return field.hasDefault && field.fallback !== null ? field.fallback : sampleNumber(key, kind);
    }
    case 'string': {
      if (typeof hint === 'string') {
        return hint;
      }

      return field.hasDefault ? field.fallback : `Sample ${key}`;
    }
    case 'enum-list': {
      return field.hasDefault ? field.fallback : [...kind.values];
    }
    case 'list': {
      if (field.hasDefault) {
        return field.fallback;
      }

      const length = Math.min(kind.maxItems, Math.max(kind.minItems, listLength));

      return [...Array.from({ length }).keys()].map((index) => sampleItem(kind.item, index));
    }
    case 'json': {
      return field.hasDefault ? field.fallback : {};
    }
  }
}

/**
 * A field's value when it is first switched on: a string or a number with a value, a nullable
 * field with one rather than null.
 *
 * @param field - The field.
 * @returns The value.
 */
export function firstValue(field: SchemaField): unknown {
  const sample = sampleValue(field);

  return sample ?? (field.kind.type === 'string' ? `Sample ${field.key}` : sample);
}
