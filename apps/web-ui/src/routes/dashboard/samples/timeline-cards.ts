/**
 * Sample cards of Compare, Activity, Automation and Shortcut, as the board `K-New` draws them:
 * four temperatures side by side, the house's last changes, Night lights and its runs, and the
 * places a shortcut goes. The automations and the changes are read from {@link TIMELINE_SOURCE},
 * which the sample source hands to the cards.
 */
import {
  entityIdSchema,
  type ActivityEntry,
  type AutomationView,
  type DashboardLeafCard,
  type EntityView,
  type JsonObject,
} from '@nebulahome/contracts';

import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** The sample automations' ids. */
const NIGHT_LIGHTS = '00000000-0000-4000-8000-0000000000a1';
const MORNING_BLINDS = '00000000-0000-4000-8000-0000000000a2';
const PORCH_LIGHT = '00000000-0000-4000-8000-0000000000a3';

/**
 * A temperature sensor of the comparison.
 *
 * @param entityId - Its address.
 * @param name - Its room.
 * @param value - What it reads.
 * @returns The entity.
 */
function thermometer(entityId: string, name: string, value: number): EntityView {
  return sampleEntity(entityId, {
    name,
    area: name,
    capabilities: [can('sensor_numeric')],
    state: { sensor_numeric: { value } },
    unit: '°C',
    deviceClass: 'temperature',
  });
}

/** The entities the sample cards read, beside the other samples. */
export const TIMELINE_ENTITIES: readonly EntityView[] = [
  thermometer('sensor.bedroom_temperature', 'Bedroom', 19.8),
  thermometer('sensor.bathroom_temperature', 'Bathroom', 22.6),
  thermometer('sensor.outside_temperature', 'Outside', 9.2),
];

/**
 * A card of the samples, at its smallest size.
 *
 * @param card - What it is, without its place.
 * @returns The card.
 */
function at<TCard extends Omit<DashboardLeafCard, 'x' | 'y'>>(card: TCard): TCard & { x: 0; y: 0 } {
  return { ...card, x: 0, y: 0 };
}

/** The sample cards: one of each type first, the one the catalogue draws. */
export const TIMELINE_CARDS: readonly DashboardLeafCard[] = [
  at({
    type: 'compare',
    id: 'samplecompare1',
    w: 2,
    h: 2,
    entityIds: [
      entityIdSchema.parse('sensor.living_temperature'),
      entityIdSchema.parse('sensor.bedroom_temperature'),
      entityIdSchema.parse('sensor.bathroom_temperature'),
      entityIdSchema.parse('sensor.outside_temperature'),
    ],
    range: null,
    title: 'Temperatures',
  }),
  at({
    type: 'activity',
    id: 'sampleactivity1',
    w: 1,
    h: 2,
    scope: { kind: 'house' },
    title: null,
  }),
  at({
    type: 'automation',
    id: 'sampleautomation1',
    w: 1,
    h: 1,
    automationId: NIGHT_LIGHTS,
    title: null,
    icon: null,
  }),
  at({
    type: 'automation',
    id: 'sampleautomation2',
    w: 1,
    h: 1,
    automationId: MORNING_BLINDS,
    title: null,
    icon: null,
  }),
  at({
    type: 'automation',
    id: 'sampleautomation3',
    w: 1,
    h: 1,
    automationId: PORCH_LIGHT,
    title: null,
    icon: null,
  }),
  at({
    type: 'shortcut',
    id: 'sampleshortcut1',
    w: 1,
    h: 1,
    target: { kind: 'page', path: '/automations' },
    title: null,
    icon: null,
  }),
  at({
    type: 'shortcut',
    id: 'sampleshortcut2',
    w: 1,
    h: 1,
    target: { kind: 'url', url: 'http://192.168.1.1/' },
    title: 'Router',
    icon: null,
  }),
];

/**
 * Cards of these types on the editor lab's sample dashboard (`gallery-dashboard-editor.tsx`), to
 * see their settings: on the page's rows 14 and down, so the families never overlap.
 */
export const TIMELINE_EDITOR_CARDS: readonly DashboardLeafCard[] = TIMELINE_CARDS.flatMap(
  (card): DashboardLeafCard[] => {
    // The comparison, the activity, one automation and one shortcut, at their place.
    const places: Readonly<Record<string, readonly [number, number]>> = {
      samplecompare1: [0, 14],
      sampleactivity1: [2, 14],
      sampleautomation1: [3, 14],
      sampleshortcut1: [3, 15],
    };
    const place = places[card.id];

    return place === undefined ? [] : [{ ...card, id: `lab${card.id}`, x: place[0], y: place[1] }];
  },
);

/** A day ago, two days ago… for the sample runs. */
const HOUR = 3_600_000;

/**
 * A sample automation.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @param isEnabled - Whether it runs on its own.
 * @param lastRun - When it last ran, hours ago, and how.
 * @param lastRun.hoursAgo - How long ago.
 * @param lastRun.result - How it ended.
 * @param at - The time of day it runs at.
 * @returns The automation.
 */
function automation(
  id: string,
  name: string,
  isEnabled: boolean,
  lastRun: { readonly hoursAgo: number; readonly result: 'success' | 'failed' },
  at: string,
): AutomationView {
  const time = new Date(Date.now() - lastRun.hoursAgo * HOUR);

  return {
    id,
    key: name.toLowerCase().replaceAll(' ', '_'),
    name,
    description: '',
    definition: {
      triggers: [{ type: 'time', at: { kind: 'clock', time: at } }],
      actions: [],
    },
    definitionVersion: 1,
    mode: 'single',
    maxRuntimeMs: 0,
    isEnabled,
    lastTriggeredAt: time,
    lastRun: { id, time, finishedAt: time, result: lastRun.result },
    missingEntities: [],
  };
}

/**
 * One change of the house's sample day.
 *
 * @param entityId - What changed.
 * @param minutesAgo - When.
 * @param from - Its state before.
 * @param to - Its state after.
 * @returns The change.
 */
function change(
  entityId: string,
  minutesAgo: number,
  from: JsonObject,
  to: JsonObject,
): ActivityEntry {
  return {
    time: new Date(Date.now() - minutesAgo * 60_000),
    entityId: entityIdSchema.parse(entityId),
    kind: 'state',
    from,
    to,
    isAvailable: true,
    wasAvailable: true,
    source: 'system',
  };
}

/** What the sample source hands the automation and activity cards. */
export const TIMELINE_SOURCE: {
  readonly automations: readonly AutomationView[];
  readonly activity: readonly ActivityEntry[];
} = {
  automations: [
    automation(NIGHT_LIGHTS, 'Night lights', true, { hoursAgo: 20, result: 'success' }, '22:30'),
    automation(
      MORNING_BLINDS,
      'Morning blinds',
      false,
      { hoursAgo: 340, result: 'success' },
      '07:00',
    ),
    automation(PORCH_LIGHT, 'Porch light', true, { hoursAgo: 3, result: 'failed' }, '18:00'),
  ],
  activity: [
    change(
      'binary_sensor.front_door',
      4,
      { sensor_binary: { isOn: false } },
      { sensor_binary: { isOn: true } },
    ),
    change('switch.coffee', 26, { on_off: { isOn: false } }, { on_off: { isOn: true } }),
    change('light.island', 48, { on_off: { isOn: false } }, { on_off: { isOn: true } }),
    change(
      'cover.living_blinds',
      75,
      { cover: { position: 100, motion: 'stopped' } },
      { cover: { position: 0, motion: 'stopped' } },
    ),
    change(
      'lock.front_door',
      96,
      { lock: { lockState: 'unlocked' } },
      { lock: { lockState: 'locked' } },
    ),
    change(
      'media_player.living_speaker',
      130,
      { media_player: { playback: 'paused', volume: 55, isMuted: false } },
      { media_player: { playback: 'playing', volume: 55, isMuted: false } },
    ),
  ],
};
