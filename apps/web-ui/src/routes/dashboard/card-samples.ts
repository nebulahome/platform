/**
 * The sample every kind of card is drawn with when it is not on a dashboard: in the Add card
 * catalogue, where each tile shows the real card, and on the development card lab.
 *
 * One house, the one the design boards draw (`K-All`): Island lights in the Kitchen at 72%, the
 * Living room at 21.4 °C, Midnight City on the speaker. Nothing here is read from the hub; the
 * cards read these entities, and their past and pictures from {@link SAMPLE_SOURCE}.
 */
import {
  entityIdSchema,
  type EntityView,
  type StateHistoryPoint,
  type TelemetryPoint,
} from '@nebulahome/contracts';

import { allowedSizes, CARD_SIZES } from '@/dashboard/card-sizes';
import { capabilityStateOf } from '@/library/entity-control';
import type { CardSampleSource } from '@/routes/dashboard/cards/card-sample';
import { CARD_ENTITIES } from '@/routes/dashboard/samples/cards';
import { CONTROL_SAMPLES, CONTROL_VARIANTS } from '@/routes/dashboard/samples/controls';
import { LIGHT, LIGHT_VARIANTS } from '@/routes/dashboard/samples/lights';
import { MORE_SAMPLES, MORE_VARIANTS, SAMPLE_SCENES } from '@/routes/dashboard/samples/more';
import { READING_SAMPLES, READING_VARIANTS } from '@/routes/dashboard/samples/readings';
import { VIEW_ONLY_SOURCE } from '@/routes/dashboard/samples/sample-entity';
import { TIMELINE_SOURCE } from '@/routes/dashboard/samples/timeline-cards';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** Every sample entity the catalogue draws: one per kind of card. */
export const SAMPLE_ENTITIES: readonly EntityView[] = [
  LIGHT,
  ...READING_SAMPLES,
  ...CONTROL_SAMPLES,
  ...MORE_SAMPLES,
];

/** The entities the lab draws besides the catalogue's: what each kind looks like when it can do less. */
export const SAMPLE_VARIANTS: readonly EntityView[] = [
  ...CARD_ENTITIES,
  ...LIGHT_VARIANTS,
  ...READING_VARIANTS,
  ...CONTROL_VARIANTS,
  ...MORE_VARIANTS,
];

/** The sample entities, by address. */
const BY_ID: ReadonlyMap<string, EntityView> = new Map(
  [...SAMPLE_ENTITIES, ...SAMPLE_VARIANTS].map((entity) => [entity.entityId, entity]),
);

/**
 * A sample entity by its address.
 *
 * @param entityId - Its address.
 * @returns The entity.
 */
export function sampleEntityById(entityId: string): EntityView | undefined {
  return BY_ID.get(entityId);
}

/** A day of a living room's temperature: cool before dawn, warm by the evening. */
const TEMPERATURE_DAY: readonly number[] = [
  19.2, 19.0, 18.8, 18.7, 18.6, 18.6, 18.9, 19.6, 20.4, 20.9, 21.1, 21.2, 21.3, 21.5, 21.6, 21.7,
  21.8, 21.6, 21.5, 21.4, 21.5, 21.6, 21.5, 21.4,
];

/**
 * A day of readings, one an hour, ending now.
 *
 * @param values - The readings, oldest first.
 * @param now - The last hour's end.
 * @returns The points.
 */
function hourly(values: readonly number[], now: number): TelemetryPoint[] {
  return values.map((value, index) => ({
    time: new Date(now - (values.length - 1 - index) * 3_600_000),
    value,
  }));
}

/**
 * A day of a switch or a door: when it went on or open, and off or closed again.
 *
 * @param entityId - The entity.
 * @param capability - What it reports, `on_off` or `sensor_binary`.
 * @param hoursOn - The hours, counted back from now, it was on during.
 * @param now - The window's end.
 * @returns The changes, oldest first.
 */
function onOffDay(
  entityId: string,
  capability: 'on_off' | 'sensor_binary',
  hoursOn: readonly number[],
  now: number,
): StateHistoryPoint[] {
  return hoursOn
    .flatMap((hour) => [
      { at: now - hour * 3_600_000, isOn: true },
      { at: now - hour * 3_600_000 + 40 * 60_000, isOn: false },
    ])
    .sort((a, b) => a.at - b.at)
    .map(({ at, isOn }) => ({
      time: new Date(at),
      entityId: entityIdSchema.parse(entityId),
      state: { [capability]: { isOn } },
      previousState: { [capability]: { isOn: !isOn } },
      attributes: {},
      isAvailable: true,
      source: 'sample',
    }));
}

/** A garden at dusk behind a fence, under one lamp: the camera boards' picture. */
const GARDEN_STILL = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1d3a"/><stop offset=".55" stop-color="#2b2c4f"/><stop offset="1" stop-color="#16182c"/></linearGradient><radialGradient id="g" cx=".66" cy=".38" r=".42"><stop offset="0" stop-color="#ffc247" stop-opacity=".45"/><stop offset="1" stop-color="#ffc247" stop-opacity="0"/></radialGradient></defs><rect width="640" height="360" fill="url(#s)"/><rect width="640" height="360" fill="url(#g)"/><path d="M0 230 Q200 200 400 222 T640 214 V360 H0Z" fill="#20223c"/><g fill="#3a3d63">' +
    [...Array.from({ length: 17 }).keys()]
      .map((index) => `<rect x="${String(8 + index * 38)}" y="236" width="7" height="58"/>`)
      .join('') +
    '</g><rect x="0" y="248" width="640" height="5" fill="#3a3d63"/><rect x="0" y="276" width="640" height="5" fill="#3a3d63"/><rect x="420" y="128" width="3" height="130" fill="#6b6b80"/><circle cx="421" cy="126" r="7" fill="#ffd27a"/><path d="M180 360 L330 262 L420 262 L520 360Z" fill="#262842" opacity=".8"/></svg>',
)}`;

/** Where every sample card reads its past and its pictures. */
export const SAMPLE_SOURCE: CardSampleSource = {
  /**
   * A day of readings for a sensor sample: the living room's day, ending on its own reading.
   *
   * @param entityId - The sensor.
   * @returns The day.
   */
  telemetry: (entityId) => {
    const now = Date.now();
    // The living room's day, moved to end on what this sensor reads now, and flatter the further
    // it is from it: a cellar or the garden do not follow the room's heating.
    const entity = BY_ID.get(entityId);
    const last = TEMPERATURE_DAY.at(-1) ?? 0;
    const target =
      entity === undefined
        ? last
        : (capabilityStateOf(entity, undefined).sensor_numeric?.value ?? last);
    const damping = 1 / (1 + Math.abs(target - last) / 6);

    return {
      window: { from: now - 24 * 3_600_000, to: now },
      points: hourly(
        TEMPERATURE_DAY.map((reading) => target + (reading - last) * damping),
        now,
      ),
    };
  },

  /**
   * A day of switching or opening: a few times, in the morning and the evening.
   *
   * @param entityId - The entity.
   * @returns The day.
   */
  stateChanges: (entityId) => {
    const now = Date.now();
    const capability = entityId.startsWith('binary_sensor.') ? 'sensor_binary' : 'on_off';

    return {
      window: { from: now - 24 * 3_600_000, to: now },
      points: onOffDay(entityId, capability, [15, 14, 9, 8, 7, 3, 2], now),
    };
  },

  /**
   * The garden at dusk, for every camera sample.
   *
   * @returns The picture.
   */
  still: () => GARDEN_STILL,
  automations: TIMELINE_SOURCE.automations,
  activity: TIMELINE_SOURCE.activity,
};

/**
 * What the cards read, for sample cards.
 *
 * @param entities - The entities they show; the samples when absent.
 * @returns The data, with everything allowed: a sample is never commanded, it is drawn `inert`.
 */
export function sampleDashboardData(
  entities: readonly EntityView[] = [...SAMPLE_ENTITIES, ...SAMPLE_VARIANTS],
): DashboardData {
  return {
    entityById: new Map(entities.map((entity) => [entity.entityId, entity])),
    sceneById: new Map(SAMPLE_SCENES.map((scene) => [scene.id, scene])),
    packageById: new Map(),
    icons: new Map(),
    readings: {},

    /**
     * A sample's card is called by its entity.
     *
     * @param entity - The entity.
     * @returns Its name.
     */
    entityTitleOf: (entity) => entity.name,

    /**
     * A sample is drawn as it would be for someone who may use it, but for the ones the lab draws
     * for someone who may only look (`source: 'sample-view-only'`).
     *
     * @param entity - The entity.
     * @returns Whether it is drawn with its controls.
     */
    canControl: (entity) => entity.source !== VIEW_ONLY_SOURCE,

    /**
     * A sample's past is in {@link SAMPLE_SOURCE}.
     *
     * @returns True.
     */
    canReadHistory: () => true,

    /**
     * A sample is never changed.
     *
     * @returns False.
     */
    canWriteEntity: () => false,
    canApplyScenes: true,

    /**
     * The sizes a sample card may take, as on a dashboard.
     *
     * @param card - The card.
     * @returns Its sizes.
     */
    sizesOf: (card) => {
      if (card.type !== 'entity') {
        return CARD_SIZES[card.type].sizes;
      }

      const entity = BY_ID.get(card.entityId);

      return entity === undefined ? CARD_SIZES.missing.sizes : allowedSizes(entity);
    },
    isPending: false,
  };
}
