/**
 * Which body the entity dialog draws for an entity, chosen the way `entityKindOf` names it: the
 * strongest capability decides - a thermostat that also reports humidity is a thermostat, a fan
 * that switches is a fan, not a switch.
 *
 * A capability no body is drawn for yet - a package's own entity type, one added after
 * this was written - still gets its controls: the entity page's own, one block per capability.
 * The dialog never opens empty.
 */
import type { ComponentType } from 'react';

import {
  sensorClassLabel,
  type CapabilityName,
  type CapabilityState,
  type EntityView,
} from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { hasCapability, paramsOf } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { BINARY_WORDS } from '@/library/entity-reading';
import { ENTITY_CONTROLS } from '@/routes/library/entity/controls/control-panel';
import { ClimateBody, climateLookOf } from '@/routes/library/entity/sheet/bodies/climate-body';
import { CoverBody } from '@/routes/library/entity/sheet/bodies/cover-body';
import { FanBody } from '@/routes/library/entity/sheet/bodies/fan-body';
import { ImageBody } from '@/routes/library/entity/sheet/bodies/image-body';
import { LightBody, lampColourOf } from '@/routes/library/entity/sheet/bodies/light-body';
import { LocationBody } from '@/routes/library/entity/sheet/bodies/location-body';
import { LockBody, lockToneOf } from '@/routes/library/entity/sheet/bodies/lock-body';
import { MediaBody } from '@/routes/library/entity/sheet/bodies/media-body';
import { MowerBody, VacuumBody } from '@/routes/library/entity/sheet/bodies/robot-body';
import {
  BinaryBody,
  binaryLookOf,
  SensorBody,
} from '@/routes/library/entity/sheet/bodies/sensor-body';
import {
  ButtonBody,
  CameraBody,
  NumberBody,
  SelectBody,
} from '@/routes/library/entity/sheet/bodies/setting-bodies';
import { SwitchBody } from '@/routes/library/entity/sheet/bodies/switch-body';
import { UpdateBody } from '@/routes/library/entity/sheet/bodies/update-body';
import type { SheetBodyProps, SheetKind } from '@/routes/library/entity/sheet/sheet-types';
import type { SheetTone } from '@/routes/library/entity/sheet/tones';

/** The kinds of thing the dialog has a body for. */
type KindId =
  | 'camera'
  | 'location'
  | 'media'
  | 'mower'
  | 'vacuum'
  | 'climate'
  | 'lock'
  | 'cover'
  | 'fan'
  | 'light'
  | 'update'
  | 'switch'
  | 'select'
  | 'number'
  | 'button'
  | 'image'
  | 'binary'
  | 'sensor';

/** How a kind is picked: any of its capabilities, and a domain when only that domain's will do. */
type KindRule = {
  readonly id: KindId;
  readonly anyOf: readonly CapabilityName[];
  readonly domain?: string;
  readonly history: SheetKind['history'];
  readonly Body: ComponentType<SheetBodyProps>;
};

/** The kinds, strongest capability first: the first that matches is the one drawn. */
const KINDS: readonly KindRule[] = [
  { id: 'camera', anyOf: ['camera'], history: 'drawer', Body: CameraBody },
  { id: 'location', anyOf: ['location'], history: 'drawer', Body: LocationBody },
  { id: 'media', anyOf: ['media_player'], history: 'drawer', Body: MediaBody },
  { id: 'mower', anyOf: ['lawn_mower'], history: 'drawer', Body: MowerBody },
  { id: 'vacuum', anyOf: ['vacuum'], history: 'drawer', Body: VacuumBody },
  { id: 'climate', anyOf: ['thermostat'], history: 'drawer', Body: ClimateBody },
  { id: 'lock', anyOf: ['lock'], history: 'drawer', Body: LockBody },
  { id: 'cover', anyOf: ['cover'], history: 'drawer', Body: CoverBody },
  { id: 'fan', anyOf: ['fan'], history: 'drawer', Body: FanBody },
  { id: 'fan', anyOf: ['on_off'], domain: 'fan', history: 'drawer', Body: FanBody },
  { id: 'light', anyOf: ['on_off'], domain: 'light', history: 'drawer', Body: LightBody },
  { id: 'update', anyOf: ['update'], history: 'none', Body: UpdateBody },
  { id: 'switch', anyOf: ['on_off'], history: 'drawer', Body: SwitchBody },
  { id: 'select', anyOf: ['select'], history: 'drawer', Body: SelectBody },
  { id: 'number', anyOf: ['number'], history: 'drawer', Body: NumberBody },
  { id: 'button', anyOf: ['button'], history: 'none', Body: ButtonBody },
  { id: 'image', anyOf: ['image'], history: 'none', Body: ImageBody },
  { id: 'binary', anyOf: ['sensor_binary'], history: 'body', Body: BinaryBody },
  { id: 'sensor', anyOf: ['sensor_numeric', 'sensor_text'], history: 'body', Body: SensorBody },
];

/**
 * A kind's colour, for an entity of it.
 *
 * @param id - The kind.
 * @param entity - The entity: a binary sensor's colour is its class's, a restart button's red.
 * @param state - Its state now: a lock's and a thermostat's colour is the one their body shows.
 * @returns The colour.
 */
function toneOf(id: KindId, entity: EntityView, state: CapabilityState): SheetTone {
  const deviceClass = entity.deviceClass ?? '';

  switch (id) {
    case 'camera': {
      return 'muted';
    }
    case 'media': {
      return 'media';
    }
    case 'mower': {
      return 'success';
    }
    case 'lock': {
      return state.lock === undefined ? 'success' : lockToneOf(state.lock);
    }
    case 'climate': {
      return state.thermostat === undefined ? 'heat' : climateLookOf(state.thermostat).tone;
    }
    case 'light': {
      return 'lamp';
    }
    case 'update':
    case 'select': {
      return 'violet';
    }
    case 'button': {
      return deviceClass === 'restart' ? 'danger' : 'violet';
    }
    case 'binary': {
      return binaryLookOf(entity.deviceClass).tone;
    }
    case 'cover':
    case 'switch':
    case 'number': {
      return 'primary';
    }
    case 'location':
    case 'vacuum':
    case 'fan':
    case 'image':
    case 'sensor': {
      return 'cyan';
    }
  }
}

/**
 * A kind's glyph, for an entity of it with no icon of its own.
 *
 * @param id - The kind.
 * @param entity - The entity: a sensor's glyph follows its class. It never follows the state:
 * the glyph is the entity's, as its owner may also choose one; only the colour does.
 * @returns The glyph.
 */
function iconOf(id: KindId, entity: EntityView): UiIconId {
  const deviceClass = entity.deviceClass ?? '';
  const glyphs: Readonly<Record<KindId, UiIconId>> = {
    camera: 'camera',
    location: 'map-pin',
    media: deviceClass === 'tv' ? 'tv' : 'speaker',
    mower: 'sprout',
    vacuum: 'bot',
    climate: 'thermometer',
    lock: 'lock',
    cover: 'blinds',
    fan: 'fan',
    light: 'lightbulb',
    update: 'circle-arrow-up',
    switch: deviceClass === 'outlet' ? 'plug' : 'power',
    select: 'list',
    number: 'hash',
    image: 'image',
    button:
      deviceClass === 'restart'
        ? 'rotate-ccw'
        : deviceClass === 'identify'
          ? 'scan-eye'
          : 'circle-dot',
    binary: binaryLookOf(entity.deviceClass).on,
    sensor:
      deviceClass === 'temperature'
        ? 'thermometer'
        : deviceClass === 'energy' || deviceClass === 'power'
          ? 'zap'
          : hasCapability(entity, 'sensor_text')
            ? 'text-align-start'
            : 'gauge',
  };

  return glyphs[id];
}

/**
 * What an entity of a kind is, in the line under its name: "Light · dimmable".
 *
 * @param id - The kind.
 * @param entity - The entity.
 * @returns The words.
 */
function wordsOf(id: KindId, entity: EntityView): string {
  const deviceClass = entity.deviceClass;
  const spokenClass = deviceClass?.replaceAll('_', ' ') ?? null;

  switch (id) {
    case 'camera': {
      return translate('entity.sheet.kind.camera', 'Camera');
    }
    case 'location': {
      return entity.domain === 'geo_location'
        ? translate('entity.sheet.kind.geoLocation', 'Geo location')
        : translate('entity.sheet.kind.deviceTracker', 'Device tracker');
    }
    case 'media': {
      return [
        translate('entity.sheet.kind.mediaPlayer', 'Media player'),
        deviceClass === 'tv' ? translate('entity.sheet.kind.tv', 'TV') : spokenClass,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'mower': {
      return translate('entity.sheet.kind.lawnMower', 'Lawn mower');
    }
    case 'vacuum': {
      return translate('entity.sheet.kind.vacuum', 'Vacuum');
    }
    case 'climate': {
      const modes = paramsOf(entity, 'thermostat')?.supportedModes ?? [];

      return modes.every((mode) => mode === 'off' || mode === 'heat')
        ? translate('entity.sheet.kind.thermostat', 'Thermostat')
        : translate('entity.sheet.kind.climate', 'Climate');
    }
    case 'lock': {
      return translate('entity.sheet.kind.lock', 'Lock');
    }
    case 'cover': {
      return [translate('entity.sheet.kind.cover', 'Cover'), spokenClass]
        .filter(Boolean)
        .join(' · ');
    }
    case 'fan': {
      return translate('entity.sheet.kind.fan', 'Fan');
    }
    case 'light': {
      const mode = hasCapability(entity, 'color_hs')
        ? translate('entity.sheet.kind.colour', 'colour')
        : hasCapability(entity, 'color_temp')
          ? translate('entity.sheet.kind.white', 'white')
          : hasCapability(entity, 'level')
            ? translate('entity.sheet.kind.dimmable', 'dimmable')
            : null;

      return [translate('entity.sheet.kind.light', 'Light'), mode].filter(Boolean).join(' · ');
    }
    case 'update': {
      return translate('entity.sheet.kind.update', 'Update');
    }
    case 'switch': {
      return deviceClass === 'outlet'
        ? translate('entity.sheet.kind.outlet', 'Outlet')
        : translate('entity.sheet.kind.switch', 'Switch');
    }
    case 'select': {
      return translate('entity.sheet.kind.select', 'Select');
    }
    case 'number': {
      return translate('entity.sheet.kind.number', 'Number');
    }
    case 'button': {
      return translate('entity.sheet.kind.button', 'Button');
    }
    case 'image': {
      return translate('entity.sheet.kind.picture', 'Picture');
    }
    case 'binary': {
      return deviceClass === null || BINARY_WORDS[deviceClass] === undefined
        ? translate('entity.sheet.kind.binarySensor', 'Binary sensor')
        : (spokenClass ?? '').charAt(0).toUpperCase() + (spokenClass ?? '').slice(1);
    }
    case 'sensor': {
      return sensorClassLabel(deviceClass) ?? translate('entity.sheet.kind.sensor', 'Sensor');
    }
  }
}

/**
 * Whether an entity of a kind has its tile lit: a lamp on, a cover open, a tracker home.
 *
 * @param id - The kind.
 * @param state - Its state now.
 * @returns True when lit.
 */
function isLitOf(id: KindId, state: CapabilityState): boolean {
  switch (id) {
    case 'media':
    case 'fan':
    case 'light':
    case 'switch': {
      return state.on_off?.isOn !== false;
    }
    case 'climate': {
      return state.thermostat?.mode !== 'off';
    }
    case 'cover': {
      return (state.cover?.position ?? 0) > 0;
    }
    case 'location': {
      return state.location?.zone === 'home';
    }
    case 'binary': {
      return state.sensor_binary?.isOn === true;
    }
    default: {
      return true;
    }
  }
}

/**
 * The body of an entity no other body draws: its controls from the entity page, one per
 * capability it declares.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The controls.
 */
function ControlsBody(props: SheetBodyProps) {
  return (
    <div className="flex flex-col gap-5">
      {ENTITY_CONTROLS.filter(([capability]) => hasCapability(props.entity, capability)).map(
        ([capability, control]) => (
          <div key={capability}>{control(props)}</div>
        ),
      )}
    </div>
  );
}

/**
 * Works out how an entity is drawn in the dialog.
 *
 * @param entity - The entity.
 * @param state - Its state now, for whether its tile is lit.
 * @returns Its kind.
 */
export function sheetKindOf(entity: EntityView, state: CapabilityState): SheetKind {
  const rule = KINDS.find(
    (each) =>
      each.anyOf.some((capability) => hasCapability(entity, capability)) &&
      (each.domain === undefined || each.domain === entity.domain),
  );

  if (rule === undefined) {
    const kind = entityKindOf(entity);

    return {
      tone: 'primary',
      icon: kind.icon,
      words: kind.label,
      isLit: true,
      history: 'drawer',
      Body: ControlsBody,
    };
  }

  const colour = rule.id === 'light' ? lampColourOf(entity, state) : undefined;

  return {
    ...(colour === undefined ? {} : { colour }),
    tone: toneOf(rule.id, entity, state),

    icon: iconOf(rule.id, entity),
    words: wordsOf(rule.id, entity),
    isLit: isLitOf(rule.id, state),
    history: rule.history,
    Body: rule.Body,
  };
}
