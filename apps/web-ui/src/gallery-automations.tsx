/**
 * The automation pages in the gallery, on sample data: the list with every kind of last run, the
 * editor on the board's Evening lights - every lane, a renamed block and one turned off, AND and OR
 * groups with a NOT, the sun, an if/else, a loop and parallel branches - and the three empty
 * states. Development only, like the rest of the gallery: the pages read a cache filled here, and
 * never ask the API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

import {
  entityIdSchema,
  type AliasView,
  type AutomationRun,
  type AutomationView,
  type SceneView,
} from '@nebulahome/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { PACKAGE_QUERY_KEYS } from '@/packages/api';
import { AliasEditor } from '@/routes/library/alias-editor';
import { AliasesPage } from '@/routes/library/aliases-page';
import { AutomationEditor } from '@/routes/library/automation-editor';
import { AutomationsPage } from '@/routes/library/automations-page';
import { ScenePage } from '@/routes/library/scene-page';
import { ScenesPage } from '@/routes/library/scenes-page';
import { anArea, anEntity } from '@/testing/fixtures';

/**
 * An address, as the format holds one.
 *
 * @param value - The address.
 * @returns It, checked.
 */
const entity = (value: string) => entityIdSchema.parse(value);

/** The editor's sample: the board's Evening lights. */
const EVENING_ID = '00000000-0000-4000-8000-0000000000e1';

/**
 * A moment some minutes ago.
 *
 * @param minutes - How many.
 * @returns The moment.
 */
const ago = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

/**
 * An automation of the list.
 *
 * @param id - Its id's last digits.
 * @param name - Its name.
 * @param overrides - Anything else.
 * @returns The automation.
 */
function anAutomation(
  id: string,
  name: string,
  overrides: Partial<AutomationView> = {},
): AutomationView {
  return {
    id: `00000000-0000-4000-8000-0000000000${id}`,
    key: name.toLowerCase().replaceAll(' ', '_'),
    name,
    description: '',
    definition: {
      triggers: [
        {
          type: 'entity',
          entityId: 'binary_sensor.lr_motion',
          change: { kind: 'state', to: 'on' },
        },
      ],
      then: [{ type: 'scene', sceneKey: 'evening' }],
    },
    definitionVersion: 1,
    mode: 'single',
    maxRuntimeMs: 300_000,
    isEnabled: true,
    lastTriggeredAt: null,
    lastRun: null,
    missingEntities: [],
    ...overrides,
  };
}

/**
 * A last run.
 *
 * @param result - How it ended.
 * @param minutes - How long ago.
 * @returns The run.
 */
function lastRun(result: AutomationRun['result'], minutes: number): AutomationView['lastRun'] {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    time: ago(minutes),
    finishedAt: ago(minutes),
    result,
  };
}

/** The board's Evening lights. */
const EVENING: AutomationView = anAutomation('e1', 'Evening lights', {
  id: EVENING_ID,
  description: 'Warm light in the living room when someone comes in after sunset.',
  mode: 'restart',
  lastRun: lastRun('success', 20),
  missingEntities: [],
  definition: {
    triggers: [
      {
        type: 'entity',
        entityId: entity('binary_sensor.lr_motion'),
        change: { kind: 'state', to: 'on' },
        name: 'Someone comes in',
      },
      { type: 'sun', event: 'sunset', offsetMinutes: -15 },
      {
        type: 'time',
        at: { kind: 'clock', time: '18:30', weekdays: ['saturday', 'sunday'] },
        isEnabled: false,
      },
      { type: 'time', at: { kind: 'cron', expression: '0 */2 * * 1-5' } },
    ],
    if: [
      { type: 'time', from: '16:00', to: '23:30', days: ['monday', 'tuesday', 'wednesday'] },
      { type: 'sun', phase: 'below', elevation: 6 },
      {
        type: 'or',
        conditions: [
          {
            type: 'entity',
            entityId: entity('person.anna'),
            match: { kind: 'state', states: ['on'] },
          },
          {
            type: 'entity',
            entityId: entity('person.bobby'),
            match: { kind: 'state', states: ['on'] },
          },
        ],
      },
      {
        type: 'and',
        isNot: true,
        conditions: [
          {
            type: 'entity',
            entityId: entity('sensor.lr_lux'),
            match: { kind: 'numeric', operator: 'gt', value: 200 },
          },
          { type: 'time', days: ['saturday', 'sunday'] },
        ],
      },
    ],
    then: [
      {
        type: 'command',
        entityId: entity('light.living_room'),
        capability: 'level',
        params: { command: 'set_level', level: 60, transitionMs: 2_000 },
        name: 'Warm the room',
      },
      {
        type: 'command',
        entityId: entity('light.lr_strip'),
        capability: 'color_hs',
        params: { command: 'set_color', hue: 28, saturation: 80 },
      },
      {
        type: 'command',
        entityId: entity('cover.lr_blinds'),
        capability: 'cover',
        params: { command: 'set_position', position: 40 },
      },
      {
        type: 'command',
        entityId: entity('lock.front_door'),
        capability: 'lock',
        params: { command: 'lock' },
      },
      {
        type: 'command',
        entityId: entity('climate.hall'),
        capability: 'thermostat',
        params: { command: 'set_target', temperature: 21 },
      },
      {
        type: 'command',
        entityId: entity('media_player.speaker'),
        capability: 'media_player',
        params: { command: 'set_volume', volume: 30 },
      },
      {
        type: 'command',
        entityId: entity('select.fan_speed'),
        capability: 'select',
        params: { command: 'select_option', option: 'medium' },
      },
      {
        type: 'command',
        entityId: entity('vacuum.robbie'),
        capability: 'vacuum',
        params: { command: 'clean_rooms', rooms: ['kitchen', 'hallway'] },
      },
      {
        type: 'command',
        entityId: entity('number.grid_limit'),
        capability: 'number',
        params: { command: 'set_value', value: 3000 },
      },
      { type: 'wait_duration', durationMs: 600_000 },
      {
        type: 'if',
        conditions: [
          {
            type: 'entity',
            entityId: entity('sensor.lr_lux'),
            match: { kind: 'numeric', operator: 'lt', value: 50 },
          },
        ],
        then: [{ type: 'scene', sceneKey: 'evening' }],
        else: [
          {
            type: 'notify',
            channel: 'telegram',
            message: 'Evening lights skipped: it is still bright',
            isEnabled: false,
          },
        ],
      },
      {
        type: 'parallel',
        branches: [
          [{ type: 'scene', sceneKey: 'evening' }],
          [{ type: 'wait_duration', durationMs: 5_000 }],
        ],
      },
      {
        type: 'while',
        conditions: [
          {
            type: 'entity',
            entityId: entity('binary_sensor.lr_motion'),
            match: { kind: 'state', states: ['on'] },
          },
        ],
        actions: [{ type: 'wait_duration', durationMs: 60_000 }],
      },
      { type: 'stop' },
    ],
  },
});

/** Its runs, for the Last runs card. */
const EVENING_RUNS: AutomationRun[] = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    automationId: EVENING_ID,
    time: ago(20),
    trigger: { kind: 'entity', entityId: 'binary_sensor.lr_motion', from: 'off', to: 'on' },
    result: 'success',
    finishedAt: ago(10),
    durationMs: 600_400,
    trace: [
      {
        path: 'triggers.0',
        kind: 'trigger',
        type: 'entity',
        at: ago(20),
        durationMs: 0,
        result: 'ok',
        entityId: 'binary_sensor.lr_motion',
        detail: 'off → on',
      },
      {
        path: 'if.0',
        kind: 'condition',
        type: 'time',
        at: ago(20),
        durationMs: 0,
        result: 'true',
        detail: 'it is 19:42',
      },
      {
        path: 'then.0',
        kind: 'action',
        type: 'command',
        at: ago(20),
        durationMs: 120,
        result: 'ok',
        entityId: 'light.living_room',
        detail: 'sent set_level',
      },
    ],
    error: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    automationId: EVENING_ID,
    time: ago(60 * 26),
    trigger: { kind: 'sun', path: 'triggers.1' },
    result: 'condition_not_met',
    finishedAt: ago(60 * 26),
    durationMs: 4,
    trace: [
      {
        path: 'if.2.conditions.1',
        kind: 'condition',
        type: 'entity',
        at: ago(60 * 26),
        durationMs: 0,
        result: 'false',
        entityId: 'person.bobby',
        detail: 'off',
      },
    ],
    error: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000a3',
    automationId: EVENING_ID,
    time: ago(60 * 50),
    trigger: { kind: 'manual' },
    result: 'failed',
    finishedAt: ago(60 * 50),
    durationMs: 5_012,
    trace: [],
    error: 'No reply on nebula.v1.svc.govee.command within 5000ms',
  },
];

/** The list: one of each kind of last run, and one never run. */
const AUTOMATIONS: AutomationView[] = [
  EVENING,
  anAutomation('e2', 'Bathroom fan after a shower', {
    mode: 'restart',
    lastRun: lastRun('success', 90),
    missingEntities: [],
  }),
  anAutomation('e3', 'Dehumidifier in the cellar', {
    lastRun: lastRun('failed', 300),
    missingEntities: [entity('sensor.cellar_humidity')],
  }),
  anAutomation('e4', 'Garden irrigation', {
    mode: 'queued',
    lastRun: lastRun('condition_not_met', 600),
    missingEntities: [],
  }),
  anAutomation('e5', 'Christmas lights', { isEnabled: false }),
  anAutomation('e6', 'Doorbell on the TV', {
    mode: 'parallel',
    lastRun: lastRun('cancelled', 60 * 30),
    missingEntities: [],
  }),
];

/** A scene the blocks name. */
const EVENING_SCENE: SceneView = {
  id: '00000000-0000-4000-8000-0000000000c1',
  key: 'evening',
  name: 'Evening',
  icon: null,
  areaKey: 'living_room',
  transitionMs: 2_000,
  rollbackOnPartialFailure: false,
  unresolvedMembers: [],
  members: [],
};

/**
 * A cache that never goes stale, filled with the house the samples name.
 *
 * @param automations - The automations it lists.
 * @returns The cache.
 */
function automationCache(automations: readonly AutomationView[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });

  client.setQueryData(LIBRARY_QUERY_KEYS.automations, automations);
  client.setQueryData([...LIBRARY_QUERY_KEYS.automations, EVENING_ID], EVENING);
  client.setQueryData([...LIBRARY_QUERY_KEYS.automationRuns, EVENING_ID], { items: EVENING_RUNS });
  client.setQueryData(LIBRARY_QUERY_KEYS.scenes, automations.length === 0 ? [] : [EVENING_SCENE]);
  client.setQueryData(LIBRARY_QUERY_KEYS.aliases, []);
  client.setQueryData(PACKAGE_QUERY_KEYS.list, []);
  client.setQueryData(LIBRARY_QUERY_KEYS.devices, []);
  client.setQueryData(LIBRARY_QUERY_KEYS.automationHouse, {
    timeZone: 'Europe/Rome',
    position: { latitude: 41.9, longitude: 12.5 },
  });
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, [
    anArea('home', 'house', null, { latitude: 41.9, longitude: 12.5 }),
    anArea('ground_floor', 'floor', 'home'),
    anArea('living_room', 'room', 'ground_floor', { name: 'Living room' }),
  ]);
  client.setQueryData(LIBRARY_QUERY_KEYS.entities, [
    anEntity({
      entityId: 'binary_sensor.lr_motion',
      name: 'Living room motion',
      deviceClass: 'motion',
      capabilities: [{ capability: 'sensor_binary', params: {} }],
      state: { sensor_binary: { isOn: false } },
    }),
    anEntity({
      entityId: 'light.living_room',
      name: 'Living room ceiling',
      capabilities: [
        { capability: 'on_off', params: {} },
        { capability: 'level', params: { hasTransition: true } },
      ],
      state: { on_off: { isOn: true }, level: { level: 60 } },
    }),
    anEntity({
      entityId: 'light.lr_strip',
      name: 'Living room strip',
      capabilities: [
        { capability: 'on_off', params: {} },
        { capability: 'color_hs', params: {} },
      ],
      state: { on_off: { isOn: false }, color_hs: { hue: 28, saturation: 80 } },
    }),
    anEntity({
      entityId: 'sensor.lr_lux',
      name: 'Living room lux',
      deviceClass: 'illuminance',
      unitOfMeasurement: 'lx',
      capabilities: [{ capability: 'sensor_numeric', params: {} }],
      state: { sensor_numeric: { value: 32 } },
    }),
    anEntity({
      entityId: 'cover.lr_blinds',
      name: 'Blinds',
      capabilities: [{ capability: 'cover', params: { hasTilt: true } }],
      state: { cover: { position: 40, tilt: 20, motion: 'stopped' } },
    }),
    anEntity({
      entityId: 'lock.front_door',
      name: 'Front door',
      capabilities: [{ capability: 'lock', params: {} }],
      state: { lock: { lockState: 'locked' } },
    }),
    anEntity({
      entityId: 'climate.hall',
      name: 'Thermostat',
      capabilities: [
        {
          capability: 'thermostat',
          params: {
            supportedModes: ['off', 'heat', 'cool', 'auto'],
            minTemperature: 7,
            maxTemperature: 30,
            temperatureStep: 0.5,
          },
        },
      ],
      state: {
        thermostat: { currentTemperature: 20, targetTemperature: 21, mode: 'heat', action: 'idle' },
      },
    }),
    anEntity({
      entityId: 'media_player.speaker',
      name: 'Speaker',
      capabilities: [{ capability: 'media_player', params: {} }],
      state: { media_player: { playback: 'playing', volume: 30, isMuted: false } },
    }),
    anEntity({
      entityId: 'select.fan_speed',
      name: 'Fan speed',
      capabilities: [
        {
          capability: 'select',
          params: {
            options: ['off', 'low', 'medium', 'high', 'auto'].map((value) => ({
              value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            })),
          },
        },
      ],
      state: { select: { option: 'medium' } },
    }),
    anEntity({
      entityId: 'vacuum.robbie',
      name: 'Robbie',
      capabilities: [{ capability: 'vacuum', params: { canCleanRooms: true } }],
      state: {
        vacuum: {
          activity: 'docked',
          rooms: [
            { id: 'kitchen', name: 'Kitchen' },
            { id: 'living', name: 'Living room' },
            { id: 'hallway', name: 'Hallway' },
            { id: 'office', name: 'Office' },
          ],
          isResumable: false,
        },
      },
    }),
    anEntity({
      entityId: 'number.grid_limit',
      name: 'Grid power limit',
      unitOfMeasurement: 'W',
      capabilities: [{ capability: 'number', params: { min: 0, max: 5000, step: 50 } }],
      state: { number: { value: 3000 } },
    }),
    anEntity({
      entityId: 'person.anna',
      name: 'Anna',
      deviceClass: 'presence',
      capabilities: [{ capability: 'sensor_binary', params: {} }],
      state: { sensor_binary: { isOn: true } },
    }),
    anEntity({
      entityId: 'person.bobby',
      name: 'Bobby',
      deviceClass: 'presence',
      capabilities: [{ capability: 'sensor_binary', params: {} }],
      state: { sensor_binary: { isOn: false } },
    }),
  ]);

  return client;
}

/** The board's Evening scene: one member of every kind, and one waiting for an entity. */
const SCENE_PAGE: SceneView = {
  ...EVENING_SCENE,
  transitionMs: 2_000,
  members: [
    {
      entityId: entity('light.living_room'),
      entityName: 'Living room ceiling',
      targetState: { on_off: { isOn: true }, level: { level: 40 } },
      transitionMs: 4_000,
    },
    {
      entityId: entity('light.lr_strip'),
      entityName: 'Living room strip',
      targetState: { on_off: { isOn: true }, color_hs: { hue: 235, saturation: 80 } },
      transitionMs: null,
    },
    {
      entityId: entity('cover.lr_blinds'),
      entityName: 'Blinds',
      targetState: { cover: { position: 0, tilt: 30, motion: 'stopped' } },
      transitionMs: null,
    },
    {
      entityId: entity('climate.hall'),
      entityName: 'Thermostat',
      targetState: {
        thermostat: { currentTemperature: 20, targetTemperature: 21, mode: 'heat', action: 'idle' },
      },
      transitionMs: null,
    },
    {
      entityId: entity('media_player.speaker'),
      entityName: 'Speaker',
      targetState: { media_player: { playback: 'playing', volume: 30, isMuted: false } },
      transitionMs: null,
    },
    {
      entityId: entity('lock.front_door'),
      entityName: 'Front door',
      targetState: { lock: { lockState: 'locked' } },
      transitionMs: null,
    },
  ],
  unresolvedMembers: [
    {
      entityId: entity('light.garden'),
      targetState: { on_off: { isOn: true } },
      transitionMs: null,
    },
  ],
};

/** The board's House temperature: a calculated alias over three sources. */
const HOUSE_TEMPERATURE: AliasView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  entityId: entity('sensor.house_temperature'),
  name: 'House temperature',
  kind: 'calculated',
  domain: 'sensor',
  capability: 'sensor_numeric',
  capabilities: ['sensor_numeric'],
  expression: '(t_living + t_lux) / 2',
  debounceMs: 500,
  fallbackPolicy: 'ignore_missing',
  isEnabled: true,
  lastError: null,
  lastEvaluatedAt: null,
  unitOfMeasurement: '°C',
  deviceClass: 'temperature',
  min: null,
  max: null,
  step: null,
  sources: [
    {
      variableName: 't_living',
      entityId: entity('sensor.lr_lux'),
      entityName: 'Living room lux',
      areaName: 'Living room',
    },
    {
      variableName: 't_lux',
      entityId: entity('sensor.lr_lux'),
      entityName: 'Living room lux',
      areaName: 'Living room',
    },
  ],
};

/** The cache of the list and the editor. */
const FULL_CACHE = automationCache(AUTOMATIONS);

FULL_CACHE.setQueryData(LIBRARY_QUERY_KEYS.scenes, [SCENE_PAGE]);
FULL_CACHE.setQueryData(LIBRARY_QUERY_KEYS.aliases, [HOUSE_TEMPERATURE]);

/** The cache of a house with nothing yet. */
const EMPTY_CACHE = automationCache([]);

/**
 * A page of the application, framed the way the shell frames it.
 *
 * @param props - The page and where it is.
 * @param props.path - The route the page answers.
 * @param props.at - Where the router starts.
 * @param props.cache - The cache it reads.
 * @param props.children - The page.
 * @returns The framed page.
 */
function Frame(props: {
  readonly path: string;
  readonly at: string;
  readonly cache: QueryClient;
  readonly children: React.ReactNode;
}) {
  const { path, at, cache, children } = props;

  return (
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[at]}>
        {/* Wider than the gallery's column: the editor's side column wants a window's width. */}
        <div
          data-sample={at}
          className="relative left-1/2 flex h-[56rem] w-[min(94vw,90rem)] shrink-0 -translate-x-1/2 overflow-hidden rounded-panel border border-border bg-canvas"
        >
          <Routes>
            <Route path={path} element={children} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * The automation list on sample data.
 *
 * @returns The page.
 */
export function AutomationsListSample() {
  return (
    <Frame path="/automations" at="/automations" cache={FULL_CACHE}>
      <AutomationsPage />
    </Frame>
  );
}

/**
 * The automation editor on the board's Evening lights.
 *
 * @returns The page.
 */
export function AutomationEditorSample() {
  return (
    <Frame path="/automations/:automationId" at={`/automations/${EVENING_ID}`} cache={FULL_CACHE}>
      <AutomationEditor />
    </Frame>
  );
}

/**
 * The three empty states: a house with no automations, no scenes and no aliases.
 *
 * @returns The pages.
 */
export function EmptyLibrarySample() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Frame path="/automations" at="/automations" cache={EMPTY_CACHE}>
        <AutomationsPage />
      </Frame>
      <Frame path="/scenes" at="/scenes" cache={EMPTY_CACHE}>
        <ScenesPage />
      </Frame>
      <Frame path="/aliases" at="/aliases" cache={EMPTY_CACHE}>
        <AliasesPage />
      </Frame>
    </div>
  );
}

/**
 * A scene's own page, on the board's Evening.
 *
 * @returns The page.
 */
export function ScenePageSample() {
  return (
    <Frame path="/scenes/:sceneId" at={`/scenes/${SCENE_PAGE.id}`} cache={FULL_CACHE}>
      <ScenePage />
    </Frame>
  );
}

/**
 * The alias editor, on a calculated alias and on a new one.
 *
 * @returns The pages.
 */
export function AliasEditorSample() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Frame path="/aliases/:aliasId" at={`/aliases/${HOUSE_TEMPERATURE.id}`} cache={FULL_CACHE}>
        <AliasEditor />
      </Frame>
      <Frame path="/aliases/new" at="/aliases/new" cache={FULL_CACHE}>
        <AliasEditor />
      </Frame>
    </div>
  );
}
