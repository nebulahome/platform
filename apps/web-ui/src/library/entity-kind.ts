/**
 * What an entity is, in the words a person uses: "Dimmable light", "Temperature sensor".
 *
 * An entity declares capabilities - `on_off`, `level`, `color_temp` - and those are the platform's
 * words, not the household's. A row that printed them was a row written for the adapter. The
 * mapping from a set of capabilities to one name is made here, once, so the devices row, the
 * entity page and the picker call the same lamp the same thing.
 *
 * The strongest capability decides: a thermostat that also reports humidity is a thermostat, and
 * a light that can take a colour is a colour light whatever else it can do. A calculated alias
 * says so in its name, because what it reads is not a device's.
 */
import { sensorClassLabel, type CapabilityName, type EntityView } from '@nebula-home/contracts';
import type { UiIconId } from '@nebula-home/ui';

/**
 * The family an entity's tile is drawn in.
 *
 * A family rather than a colour, so the palette stays the component's: `light` is warm whatever
 * the theme draws warm as.
 */
export type EntityTone =
  'light' | 'power' | 'sensor' | 'climate' | 'secure' | 'media' | 'camera' | 'derived';

/** What an entity is, for a person. */
export type EntityKind = {
  /** Its name as a kind of thing: "Dimmable light". */
  readonly label: string;

  /** The interface glyph for the kind, drawn when the entity has no icon of its own. */
  readonly icon: UiIconId;

  /** The family its tile is drawn in. */
  readonly tone: EntityTone;
};

/**
 * Capitalises the first letter and spaces the underscores.
 *
 * @param word - As the registry has it: `garage_door`.
 * @returns `Garage door`.
 */
function spoken(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).replaceAll('_', ' ');
}

/**
 * Says what a numeric reading measures, from its class.
 *
 * @param entity - The class.
 * @returns "Temperature sensor", or plain "Sensor" for a reading with no class.
 */
function numericLabel(entity: Pick<EntityView, 'deviceClass'>): string {
  const label = sensorClassLabel(entity.deviceClass);

  return label === undefined ? 'Sensor' : `${label} sensor`;
}

/**
 * Works out what an entity is.
 *
 * @param entity - Its domain, source, class and capabilities.
 * @returns Its kind.
 */
export function entityKindOf(
  entity: Pick<EntityView, 'domain' | 'source' | 'deviceClass' | 'capabilities'>,
): EntityKind {
  const has = new Set<CapabilityName>(entity.capabilities.map((entry) => entry.capability));
  const isLight = entity.domain === 'light';

  if (entity.source === 'derived') {
    const reads = has.has('sensor_numeric') ? sensorClassLabel(entity.deviceClass) : undefined;

    return {
      label: reads === undefined ? 'Alias' : `Alias · ${reads}`,
      icon: 'sigma',
      tone: 'derived',
    };
  }

  if (has.has('camera')) {
    return { label: 'Camera', icon: 'camera', tone: 'camera' };
  }

  if (has.has('media_player')) {
    return { label: 'Media player', icon: 'play', tone: 'media' };
  }

  if (has.has('thermostat')) {
    return { label: 'Thermostat', icon: 'thermometer', tone: 'climate' };
  }

  if (has.has('lock')) {
    return { label: 'Lock', icon: 'lock', tone: 'secure' };
  }

  if (has.has('cover')) {
    return { label: 'Cover', icon: 'blinds', tone: 'sensor' };
  }

  if (has.has('color_hs')) {
    return { label: 'Colour light', icon: 'lightbulb', tone: 'light' };
  }

  if (has.has('color_temp')) {
    return { label: 'Tunable white light', icon: 'lightbulb', tone: 'light' };
  }

  if (has.has('level')) {
    return isLight
      ? { label: 'Dimmable light', icon: 'lightbulb', tone: 'light' }
      : { label: 'Dimmer', icon: 'sun', tone: 'light' };
  }

  if (has.has('on_off')) {
    return isLight
      ? { label: 'Light', icon: 'lightbulb', tone: 'light' }
      : { label: 'Switch', icon: 'power', tone: 'power' };
  }

  if (has.has('sensor_numeric')) {
    return { label: numericLabel(entity), icon: 'gauge', tone: 'sensor' };
  }

  if (has.has('sensor_binary')) {
    const label =
      entity.deviceClass === null ? 'Binary sensor' : `${spoken(entity.deviceClass)} sensor`;

    return { label, icon: 'activity', tone: 'sensor' };
  }

  if (has.has('sensor_text')) {
    return { label: 'Text sensor', icon: 'type', tone: 'sensor' };
  }

  return { label: spoken(entity.domain), icon: 'gauge', tone: 'sensor' };
}

/**
 * Names one capability for a person.
 *
 * @param capability - The capability.
 * @param domain - The entity's domain: a light's level is its brightness.
 * @returns The name: "Power", "Brightness", "Colour temperature".
 */
export function capabilityLabel(capability: CapabilityName, domain = ''): string {
  switch (capability) {
    case 'on_off':
      return 'Power';
    case 'level':
      return domain === 'light' ? 'Brightness' : 'Level';
    case 'color_hs':
      return 'Colour';
    case 'color_temp':
      return 'Colour temperature';
    case 'cover':
      return 'Position';
    case 'lock':
      return 'Lock';
    case 'thermostat':
      return 'Climate';
    case 'sensor_numeric':
      return 'Reading';
    case 'sensor_binary':
      return 'State';
    case 'sensor_text':
      return 'Text';
    case 'media_player':
      return 'Playback';
    case 'camera':
      return 'Camera';
  }
}
