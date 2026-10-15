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
import { sensorClassLabel, type CapabilityName, type EntityView } from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import { defineMessage, type Message, translate } from '@/i18n/messages';

/**
 * The family an entity's tile is drawn in.
 *
 * A family rather than a colour, so the palette stays the component's: `light` is warm whatever
 * the theme draws warm as.
 */
export type EntityTone =
  | 'light'
  | 'power'
  | 'sensor'
  | 'cover'
  | 'climate'
  | 'secure'
  | 'media'
  | 'camera'
  | 'garden'
  | 'derived';

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
      label:
        reads === undefined
          ? translate('library.entityKind.alias', 'Alias')
          : translate('library.entityKind.aliasReads', 'Alias · {{reads}}', { reads }),
      icon: 'sigma',
      tone: 'derived',
    };
  }

  if (has.has('camera')) {
    return {
      label: translate('library.entityKind.camera', 'Camera'),
      icon: 'camera',
      tone: 'camera',
    };
  }

  if (has.has('lawn_mower')) {
    return {
      label: translate('library.entityKind.lawnMower', 'Lawn mower'),
      icon: 'tractor',
      tone: 'garden',
    };
  }

  if (has.has('vacuum')) {
    return {
      label: translate('library.entityKind.robotVacuum', 'Robot vacuum'),
      icon: 'bot',
      tone: 'power',
    };
  }

  if (has.has('image')) {
    return {
      label: translate('library.entityKind.picture', 'Picture'),
      icon: 'image',
      tone: 'camera',
    };
  }

  if (has.has('media_player')) {
    return {
      label: translate('library.entityKind.mediaPlayer', 'Media player'),
      icon: 'play',
      tone: 'media',
    };
  }

  if (has.has('thermostat')) {
    return {
      label: translate('library.entityKind.thermostat', 'Thermostat'),
      icon: 'thermometer',
      tone: 'climate',
    };
  }

  if (has.has('lock')) {
    return { label: translate('library.entityKind.lock', 'Lock'), icon: 'lock', tone: 'secure' };
  }

  if (has.has('cover')) {
    return { label: translate('library.entityKind.cover', 'Cover'), icon: 'blinds', tone: 'cover' };
  }

  if (has.has('color_hs')) {
    return {
      label: translate('library.entityKind.colourLight', 'Colour light'),
      icon: 'lightbulb',
      tone: 'light',
    };
  }

  if (has.has('color_temp')) {
    return {
      label: translate('library.entityKind.tunableWhiteLight', 'Tunable white light'),
      icon: 'lightbulb',
      tone: 'light',
    };
  }

  if (has.has('level')) {
    return isLight
      ? {
          label: translate('library.entityKind.dimmableLight', 'Dimmable light'),
          icon: 'lightbulb',
          tone: 'light',
        }
      : { label: translate('library.entityKind.dimmer', 'Dimmer'), icon: 'sun', tone: 'light' };
  }

  if (has.has('on_off')) {
    return isLight
      ? { label: translate('library.entityKind.light', 'Light'), icon: 'lightbulb', tone: 'light' }
      : { label: translate('library.entityKind.switch', 'Switch'), icon: 'power', tone: 'power' };
  }

  if (has.has('sensor_numeric')) {
    return { label: numericLabel(entity), icon: 'gauge', tone: 'sensor' };
  }

  if (has.has('sensor_binary')) {
    const label =
      entity.deviceClass === null
        ? translate('library.entityKind.binarySensor', 'Binary sensor')
        : translate('library.entityKind.deviceclassSensor', '{{deviceClass}} sensor', {
            deviceClass: spoken(entity.deviceClass),
          });

    return { label, icon: 'activity', tone: 'sensor' };
  }

  if (has.has('sensor_text')) {
    return {
      label: translate('library.entityKind.textSensor', 'Text sensor'),
      icon: 'type',
      tone: 'sensor',
    };
  }

  if (has.has('update')) {
    return {
      label: translate('library.entityKind.firmware', 'Firmware'),
      icon: 'circle-arrow-up',
      tone: 'power',
    };
  }

  if (has.has('select')) {
    return {
      label: translate('library.entityKind.setting', 'Setting'),
      icon: 'list',
      tone: 'power',
    };
  }

  if (has.has('number')) {
    return {
      label: translate('library.entityKind.numberSetting', 'Number setting'),
      icon: 'hash',
      tone: 'power',
    };
  }

  if (has.has('button')) {
    return {
      label: translate('library.entityKind.button', 'Button'),
      icon: 'circle-dot',
      tone: 'power',
    };
  }

  if (has.has('custom')) {
    return {
      label: spoken(entity.domain === 'custom' ? 'item' : entity.domain),
      icon: 'package',
      tone: 'sensor',
    };
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
      return translate('library.entityKind.power', 'Power');
    case 'level':
      return domain === 'light' ? 'Brightness' : 'Level';
    case 'color_hs':
      return translate('library.entityKind.colour', 'Colour');
    case 'color_temp':
      return translate('library.entityKind.colourTemperature', 'Colour temperature');
    case 'cover':
      return translate('library.entityKind.position', 'Position');
    case 'lock':
      return translate('library.entityKind.lock', 'Lock');
    case 'thermostat':
      return translate('library.entityKind.climate', 'Climate');
    case 'sensor_numeric':
      return translate('library.entityKind.reading', 'Reading');
    case 'sensor_binary':
      return translate('library.entityKind.state', 'State');
    case 'sensor_text':
      return translate('library.entityKind.text', 'Text');
    case 'media_player':
      return translate('library.entityKind.playback', 'Playback');
    case 'camera':
      return translate('library.entityKind.camera', 'Camera');
    case 'button':
      return translate('library.entityKind.press', 'Press');
    case 'update':
      return translate('library.entityKind.firmware', 'Firmware');
    case 'lawn_mower':
      return translate('library.entityKind.mower', 'Mower');
    case 'select':
      return translate('library.entityKind.choice', 'Choice');
    case 'number':
      return translate('library.entityKind.value', 'Value');
    case 'vacuum':
      return translate('library.entityKind.cleaning', 'Cleaning');
    case 'image':
      return translate('library.entityKind.picture', 'Picture');
    case 'custom':
      return translate('library.entityKind.details', 'Details');
  }
}

/** The families the entity picker narrows by, in the order its pills read. */
export const ENTITY_FAMILIES = [
  'lights',
  'switches',
  'sensors',
  'covers',
  'climate',
  'locks',
  'media',
  'cameras',
  'garden',
  'aliases',
] as const;

/** A family of entities, as the picker narrows by it. */
export type EntityFamily = (typeof ENTITY_FAMILIES)[number];

/** What each family is called on its pill. */
export const FAMILY_LABELS: Readonly<Record<EntityFamily, Message>> = {
  lights: defineMessage('library.entityKind.lights', 'Lights'),
  switches: defineMessage('library.entityKind.switches', 'Switches'),
  sensors: defineMessage('library.entityKind.sensors', 'Sensors'),
  covers: defineMessage('library.entityKind.covers', 'Covers'),
  climate: defineMessage('library.entityKind.climate', 'Climate'),
  locks: defineMessage('library.entityKind.locks', 'Locks'),
  media: defineMessage('library.entityKind.media', 'Media'),
  cameras: defineMessage('library.entityKind.cameras', 'Cameras'),
  garden: defineMessage('library.entityKind.garden', 'Garden'),
  aliases: defineMessage('library.entityKind.aliases', 'Aliases'),
};

/**
 * Which family an entity is picked from.
 *
 * @param entity - Its domain, source, class and capabilities.
 * @returns The family, decided by the same strongest-capability rule as its kind.
 */
export function entityFamilyOf(
  entity: Pick<EntityView, 'domain' | 'source' | 'deviceClass' | 'capabilities'>,
): EntityFamily {
  switch (entityKindOf(entity).tone) {
    case 'derived':
      return 'aliases';
    case 'camera':
      return 'cameras';
    case 'garden':
      return 'garden';
    case 'media':
      return 'media';
    case 'climate':
      return 'climate';
    case 'secure':
      return 'locks';
    case 'light':
      return 'lights';
    case 'power':
      return 'switches';
    case 'cover':
      return 'covers';
    case 'sensor':
      return 'sensors';
  }
}
