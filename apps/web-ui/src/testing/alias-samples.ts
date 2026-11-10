/**
 * Aliases to draw the pages on without a house: a thermostat of parts from every source, a light
 * of five lamps, a sensor averaging three rooms, a binary sensor whose code is failing, a switch
 * that is off and a sensor whose input went silent - with the entities they read and a day of
 * their history, as the gallery and the tests need them.
 */
import { QueryClient } from '@tanstack/react-query';

import type {
  AliasActionLastRun,
  AliasTarget,
  AliasDetail,
  AliasListItem,
  AliasSetupChange,
  AliasView,
  EntityView,
  JsonObject,
  StateHistoryPoint,
} from '@nebulahome/contracts';
import { entityIdSchema } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { PACKAGE_QUERY_KEYS } from '@/packages/api';
import { anArea, anEntity } from '@/testing/fixtures';

/** The moment the samples end at. */
export const SAMPLE_NOW = Date.now();

/**
 * Some hours before now.
 *
 * @param hours - How many.
 * @returns The date.
 */
const hoursAgo = (hours: number): Date => new Date(SAMPLE_NOW - hours * 3_600_000);

/**
 * An entity id, checked.
 *
 * @param value - The id.
 * @returns It, as an entity id.
 */
const id = (value: string) => entityIdSchema.parse(value);

/** The shared virtual device. */
export const SHARED_DEVICE = {
  id: '00000000-0000-4000-8000-00000000a11a',
  name: 'Aliases',
  isVirtual: true,
  isShared: true,
} as const;

/** The thermostat's code. */
export const THERMOSTAT_CODE = `"""Living room thermostat: what the heating is doing."""

def action():
    if part.mode == "off":
        return "off"
    if binary_sensor.lr_window:
        return "idle"              # window open: no heating
    room = part.current_temperature
    if room is None:
        return None                # unknown until it reports again
    if room < part.target_temperature - 0.3:
        return "heating"
    return "idle"
`;

/** The washer's code, which fails while the plug is silent. */
export const WASHER_CODE = `"""Washing done: on once the washer has gone quiet."""

def on():
    power = sensor.washing_machine_plug_power
    recent = mem.get("recent", [])
    recent = (recent + [power])[-10:]
    mem["recent"] = recent
    quiet = avg(recent) < 3
    return quiet
`;

/**
 * An alias whole, with the defaults filled.
 *
 * @param fields - What differs.
 * @returns The alias.
 */
function anAlias(
  fields: Partial<AliasView> & Pick<AliasView, 'id' | 'entityId' | 'name' | 'behavesAs' | 'parts'>,
): AliasView {
  return {
    icon: null,
    area: null,
    device: SHARED_DEVICE,
    isEnabled: true,
    health: 'ok',
    problem: null,
    reads: [],
    key: fields.entityId.split('.')[1] ?? 'alias',
    customType: null,
    code: '',
    cases: [],
    memory: {},
    ifOneStops: 'unavailable',
    debounceMs: 0,
    display: { deviceClass: null, unit: null, precision: null },
    lastError: null,
    lastEvaluatedAt: hoursAgo(0.01),
    createdAt: new Date('2026-10-12T09:00:00Z'),
    ...fields,
  };
}

/** The thermostat: target and mode Stored, action from code, room from an entity, humidity from a formula. */
export const THERMOSTAT = anAlias({
  id: '00000000-0000-4000-8000-0000000a1001',
  entityId: id('alias.living_room_thermostat'),
  name: 'Living room thermostat',
  behavesAs: 'thermostat',
  area: { key: 'living_room', name: 'Living room' },
  device: {
    id: '00000000-0000-4000-8000-0000000d0001',
    name: 'Living room heater',
    isVirtual: false,
    isShared: false,
  },
  reads: [
    id('binary_sensor.lr_window'),
    id('sensor.living_room_temperature'),
    id('sensor.lr_humidity'),
    id('sensor.purifier_humidity'),
  ],
  ifOneStops: 'last_known',
  code: THERMOSTAT_CODE,
  cases: [
    {
      id: 'window-open',
      name: 'Window open',
      function: 'action',
      inputs: {
        'binary_sensor.lr_window': true,
        'part.mode': 'heat',
        'part.current_temperature': 19,
        'part.target_temperature': 21,
      },
      now: null,
      mem: {},
      expected: 'idle',
      fromFailureAt: null,
    },
    {
      id: 'cold-room',
      name: 'Cold room',
      function: 'action',
      inputs: {
        'binary_sensor.lr_window': false,
        'part.mode': 'heat',
        'part.current_temperature': 19,
        'part.target_temperature': 21,
      },
      now: null,
      mem: {},
      expected: 'heating',
      fromFailureAt: null,
    },
  ],
  parts: {
    target_temperature: { from: 'stored', value: 21, min: 5, max: 30, step: 0.5 },
    mode: { from: 'stored', value: 'heat', offered: ['off', 'heat'] },
    action: { from: 'code', function: 'action' },
    current_temperature: { from: 'entity', entity: id('sensor.living_room_temperature') },
    humidity: { from: 'formula', formula: 'avg(sensor.lr_humidity, sensor.purifier_humidity)' },
  },
});

/** Five lamps behind one light. */
export const LIGHTS = anAlias({
  id: '00000000-0000-4000-8000-0000000a1002',
  entityId: id('alias.downstairs_lights'),
  name: 'Downstairs lights',
  behavesAs: 'light',
  area: { key: 'downstairs', name: 'Downstairs' },
  reads: ['light.hall', 'light.kitchen', 'light.lounge', 'light.stairs', 'light.porch'].map(id),
  parts: {
    on: {
      from: 'entities',
      entities: ['light.hall', 'light.kitchen', 'light.lounge', 'light.stairs', 'light.porch'].map(
        id,
      ),
      rule: 'any',
    },
    brightness: {
      from: 'entities',
      entities: ['light.hall', 'light.kitchen', 'light.lounge'].map(id),
      rule: 'average',
      actions: [
        {
          id: 'level',
          when: { kind: 'command', command: 'set_level' },
          then: [
            {
              type: 'command',
              entityId: 'light.lounge',
              capability: 'level',
              params: { command: 'set_level', level: { formula: 'command.level' } },
            },
            {
              type: 'command',
              entityId: 'light.kitchen',
              capability: 'level',
              params: { command: 'set_level', level: { formula: 'command.level * 0.6' } },
            },
          ],
        },
        {
          id: 'bright',
          when: { kind: 'change', change: { kind: 'numeric', operator: 'gt', value: 60 } },
          then: [
            {
              type: 'command',
              entityId: 'light.stairs',
              capability: 'on_off',
              params: { command: 'turn_off' },
            },
          ],
        },
      ],
    },
  },
});

/** What the actions of the samples act on, as the API names them. */
export const SAMPLE_TARGETS = new Map<AliasView, AliasTarget[]>([
  [
    LIGHTS,
    [
      {
        kind: 'entity',
        id: 'light.lounge',
        name: 'Lounge',
        isPresent: true,
        parts: ['brightness'],
      },
      {
        kind: 'entity',
        id: 'light.kitchen',
        name: 'Kitchen',
        isPresent: true,
        parts: ['brightness'],
      },
      {
        kind: 'entity',
        id: 'light.stairs',
        name: 'Stairs',
        isPresent: true,
        parts: ['brightness'],
      },
    ],
  ],
]);

/** How the actions of the samples last went. */
export const SAMPLE_LAST_RUNS = new Map<AliasView, AliasActionLastRun[]>([
  [
    LIGHTS,
    [
      {
        part: 'brightness',
        actionId: 'level',
        at: hoursAgo(1.5),
        result: 'failed',
        error: 'Kitchen did not answer in 5 s',
      },
      { part: 'brightness', actionId: 'bright', at: hoursAgo(3), result: 'success', error: null },
    ],
  ],
]);

/** The average of three rooms. */
export const HOUSE_TEMPERATURE = anAlias({
  id: '00000000-0000-4000-8000-0000000a1003',
  entityId: id('alias.house_temperature'),
  name: 'House temperature',
  behavesAs: 'sensor',
  area: { key: 'home', name: 'Whole house' },
  display: { deviceClass: 'temperature', unit: '°C', precision: 1 },
  reads: [
    id('sensor.living_room_temperature'),
    id('sensor.kitchen_temperature'),
    id('sensor.bedroom_temperature'),
  ],
  parts: {
    value: {
      from: 'entities',
      entities: [
        id('sensor.living_room_temperature'),
        id('sensor.kitchen_temperature'),
        id('sensor.bedroom_temperature'),
      ],
      rule: 'average',
    },
  },
});

/** A binary sensor whose code fails while its input is silent. */
export const WASHER = anAlias({
  id: '00000000-0000-4000-8000-0000000a1004',
  entityId: id('alias.washing_done'),
  name: 'Washing done',
  behavesAs: 'binary_sensor',
  area: { key: 'laundry', name: 'Laundry' },
  device: {
    id: '00000000-0000-4000-8000-0000000d0002',
    name: 'Washing machine plug',
    isVirtual: false,
    isShared: false,
  },
  health: 'failing',
  problem: 'Line 8 · avg() got None',
  reads: [id('sensor.washing_machine_plug_power')],
  code: WASHER_CODE,
  memory: { recent: [0.4, 0.3, 0.3] },
  parts: { on: { from: 'code', function: 'on' } },
  lastError: {
    message: 'avg() got None',
    part: 'on',
    function: 'on',
    line: 8,
    column: 13,
    since: hoursAgo(0.4),
    count: 7,
    inputs: { 'sensor.washing_machine_plug_power': null },
  },
});

/** A stored switch, turned off. */
export const GUEST_MODE = anAlias({
  id: '00000000-0000-4000-8000-0000000a1005',
  entityId: id('alias.guest_mode'),
  name: 'Guest mode',
  behavesAs: 'switch',
  area: { key: 'home', name: 'Whole house' },
  isEnabled: false,
  health: 'off',
  parts: { on: { from: 'stored', value: false, assumed: false } },
});

/** A sensor whose plug went silent. */
export const GARAGE_POWER = anAlias({
  id: '00000000-0000-4000-8000-0000000a1006',
  entityId: id('alias.garage_power'),
  name: 'Garage power',
  behavesAs: 'sensor',
  area: { key: 'garage', name: 'Garage' },
  device: {
    id: '00000000-0000-4000-8000-0000000d0003',
    name: 'Garage plug',
    isVirtual: false,
    isShared: false,
  },
  health: 'unavailable',
  problem: 'sensor.garage_plug_power is unavailable',
  display: { deviceClass: 'power', unit: 'W', precision: 0 },
  reads: [id('sensor.garage_plug_power')],
  parts: { value: { from: 'entity', entity: id('sensor.garage_plug_power') } },
});

/** Every sample alias. */
export const SAMPLE_ALIASES: readonly AliasView[] = [
  THERMOSTAT,
  LIGHTS,
  HOUSE_TEMPERATURE,
  WASHER,
  GUEST_MODE,
  GARAGE_POWER,
];

/**
 * An alias as the list has it.
 *
 * @param alias - The alias.
 * @returns The list item.
 */
export function listItemOf(alias: AliasView): AliasListItem {
  return {
    id: alias.id,
    entityId: alias.entityId,
    name: alias.name,
    icon: alias.icon,
    behavesAs: alias.behavesAs,
    area: alias.area,
    device: alias.device,
    isEnabled: alias.isEnabled,
    health: alias.health,
    problem: alias.problem,
    reads: alias.reads,
  };
}

/**
 * An alias with its inputs and users.
 *
 * @param alias - The alias.
 * @param developerMode - Whether code can be changed.
 * @returns The detail.
 */
export function detailOf(alias: AliasView, developerMode = true): AliasDetail {
  const named = new Map(SAMPLE_ENTITIES.map((entity) => [entity.entityId as string, entity.name]));

  return {
    alias,
    inputs: alias.reads.map((entityId) => ({
      entityId,
      name: named.get(entityId) ?? entityId,
      areaName: null,
      isPresent: named.has(entityId),
    })),
    usedBy: {
      automations:
        alias === THERMOSTAT
          ? [
              { id: 'a1', name: 'Morning heating' },
              { id: 'a2', name: 'Night setback' },
            ]
          : [],
      scenes: alias === THERMOSTAT ? [{ id: 's1', name: 'Cosy evening' }] : [],
      dashboards: [{ id: 'd1', name: 'Home' }],
      aliases: [],
    },
    targets: SAMPLE_TARGETS.get(alias) ?? [],
    lastActionRuns: SAMPLE_LAST_RUNS.get(alias) ?? [],
    developerMode,
  };
}

/**
 * A reading entity.
 *
 * @param entityId - Its id.
 * @param name - Its name.
 * @param state - Its state.
 * @param extra - What else differs.
 * @returns The entity.
 */
function reading(
  entityId: string,
  name: string,
  state: Record<string, unknown>,
  extra: Partial<EntityView> = {},
): EntityView {
  return anEntity({
    entityId,
    name,
    capabilities: Object.keys(state).map((capability) => ({
      capability: capability as EntityView['capabilities'][number]['capability'],
      params: {},
    })),
    state: state as EntityView['state'],
    ...extra,
  });
}

/** The entities the samples read, and the aliases' own. */
export const SAMPLE_ENTITIES: readonly EntityView[] = [
  reading(
    'binary_sensor.lr_window',
    'Living room window',
    { sensor_binary: { isOn: false } },
    { deviceClass: 'window' },
  ),
  reading(
    'sensor.living_room_temperature',
    'Living room temperature',
    { sensor_numeric: { value: 20.4 } },
    { unitOfMeasurement: '°C' },
  ),
  reading(
    'sensor.kitchen_temperature',
    'Kitchen temperature',
    { sensor_numeric: { value: 22.1 } },
    { unitOfMeasurement: '°C' },
  ),
  reading(
    'sensor.bedroom_temperature',
    'Bedroom temperature',
    { sensor_numeric: { value: 21.7 } },
    { unitOfMeasurement: '°C' },
  ),
  reading(
    'sensor.lr_humidity',
    'Living room humidity',
    { sensor_numeric: { value: 47 } },
    { unitOfMeasurement: '%' },
  ),
  reading(
    'sensor.purifier_humidity',
    'Air purifier humidity',
    { sensor_numeric: { value: 49 } },
    { unitOfMeasurement: '%' },
  ),
  reading(
    'sensor.washing_machine_plug_power',
    'Washing machine plug power',
    { sensor_numeric: { value: null } },
    { unitOfMeasurement: 'W', isAvailable: false },
  ),
  reading(
    'sensor.garage_plug_power',
    'Garage plug power',
    { sensor_numeric: { value: null } },
    { unitOfMeasurement: 'W', isAvailable: false },
  ),
  ...['hall', 'kitchen', 'lounge', 'stairs', 'porch'].map((room, index) =>
    reading(`light.${room}`, `${room.charAt(0).toUpperCase()}${room.slice(1)} light`, {
      on_off: { isOn: index < 3 },
      level: { level: 80 },
    }),
  ),
  reading('alias.living_room_thermostat', 'Living room thermostat', {
    thermostat: {
      targetTemperature: 21,
      mode: 'heat',
      action: 'heating',
      currentTemperature: 20.4,
      humidity: 48,
    },
  }),
  reading('alias.downstairs_lights', 'Downstairs lights', {
    on_off: { isOn: true },
    level: { level: 80 },
  }),
  reading(
    'alias.house_temperature',
    'House temperature',
    { sensor_numeric: { value: 21.4 } },
    { unitOfMeasurement: '°C' },
  ),
  reading(
    'alias.washing_done',
    'Washing done',
    { sensor_binary: { isOn: false } },
    { isAvailable: false },
  ),
  reading('alias.guest_mode', 'Guest mode', { on_off: { isOn: false } }),
  reading(
    'alias.garage_power',
    'Garage power',
    { sensor_numeric: { value: null } },
    { isAvailable: false },
  ),
];

/**
 * A change of the thermostat's state.
 *
 * @param hours - How long ago.
 * @param state - Its thermostat state.
 * @param cause - Who asked, when someone did.
 * @returns The point.
 */
function thermostatPoint(
  hours: number,
  state: JsonObject,
  cause?: 'user' | 'automation',
): StateHistoryPoint {
  return {
    time: hoursAgo(hours),
    entityId: THERMOSTAT.entityId,
    state: { thermostat: state },
    previousState: null,
    attributes: {},
    isAvailable: true,
    source: 'derived',
    ...(cause === undefined ? {} : { context: { type: cause } }),
  };
}

/** A day of the thermostat: its room cooling at night, the target set back and up again. */
export const THERMOSTAT_HISTORY: readonly StateHistoryPoint[] = Array.from(
  { length: 49 },
  (unused, index) => {
    const hours = 24 - index * 0.5;
    const night = hours < 16 && hours > 5;
    const target = night ? 18 : 21;
    const room = 18.4 + 2.5 * Math.cos((hours / 24) * 2 * Math.PI) + (index % 3) * 0.1;
    const action = room < target - 0.3 ? 'heating' : 'idle';

    return thermostatPoint(
      hours,
      {
        targetTemperature: target,
        mode: hours < 13 && hours > 6 ? 'off' : 'heat',
        action,
        currentTemperature: Number(room.toFixed(1)),
        humidity: 46 + (index % 5),
      },
      index === 16 ? 'automation' : index === 34 ? 'user' : undefined,
    );
  },
);

/** The thermostat's setup changes. */
export const THERMOSTAT_SETUP: readonly AliasSetupChange[] = [
  {
    at: hoursAgo(20),
    by: 'Bobby',
    action: 'update',
    before: {
      key: 'living_room_thermostat',
      name: 'Living room thermostat',
      behavesAs: 'thermostat',
      parts: { humidity: { from: 'entity', entity: 'sensor.lr_humidity' } },
    },
    after: {
      key: 'living_room_thermostat',
      name: 'Living room thermostat',
      behavesAs: 'thermostat',
      parts: {
        humidity: { from: 'formula', formula: 'avg(sensor.lr_humidity, sensor.purifier_humidity)' },
      },
    },
  },
];

/**
 * A cache that never goes stale, holding the sample aliases.
 *
 * @param isEmpty - Whether the house has no aliases.
 * @param developerMode - Whether code can be changed.
 * @returns The cache.
 */
export function sampleAliasCache(isEmpty: boolean, developerMode = true): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const window = { from: SAMPLE_NOW - 86_400_000, to: SAMPLE_NOW };

  client.setQueryData(LIBRARY_QUERY_KEYS.aliases, isEmpty ? [] : SAMPLE_ALIASES.map(listItemOf));

  for (const alias of SAMPLE_ALIASES) {
    client.setQueryData([...LIBRARY_QUERY_KEYS.aliases, alias.id], detailOf(alias, developerMode));
    client.setQueryData([...LIBRARY_QUERY_KEYS.history, alias.entityId, 'state', '24h'], {
      window,
      points: alias === THERMOSTAT ? THERMOSTAT_HISTORY : [],
    });
    client.setQueryData(
      [...LIBRARY_QUERY_KEYS.history, alias.entityId, 'alias-history', 7],
      alias === THERMOSTAT ? THERMOSTAT_HISTORY : [],
    );
    client.setQueryData(
      [...LIBRARY_QUERY_KEYS.aliases, alias.id, 'setup-history', 7],
      alias === THERMOSTAT ? THERMOSTAT_SETUP : [],
    );
    client.setQueryData([...LIBRARY_QUERY_KEYS.aliases, alias.id, 'action-runs', 7], []);
  }

  // What the action blocks of a part name: scenes, automations and the house they read.
  client.setQueryData(LIBRARY_QUERY_KEYS.scenes, []);
  client.setQueryData(LIBRARY_QUERY_KEYS.automations, []);
  client.setQueryData(LIBRARY_QUERY_KEYS.automationHouse, {
    timeZone: 'Europe/Rome',
    position: { latitude: 41.9, longitude: 12.5 },
  });

  client.setQueryData([...LIBRARY_QUERY_KEYS.aliases, 'devices'], [SHARED_DEVICE]);
  client.setQueryData([...LIBRARY_QUERY_KEYS.aliases, 'house'], {
    timeZone: 'Europe/Rome',
    position: { latitude: 41.9, longitude: 12.5 },
  });
  client.setQueryData(LIBRARY_QUERY_KEYS.entities, SAMPLE_ENTITIES);
  client.setQueryData(LIBRARY_QUERY_KEYS.devices, []);
  client.setQueryData(PACKAGE_QUERY_KEYS.list, []);
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, [
    anArea('home', 'house', null, { latitude: 41.9, longitude: 12.5 }),
    anArea('ground_floor', 'floor', 'home'),
    anArea('living_room', 'room', 'ground_floor', { name: 'Living room' }),
    anArea('laundry', 'room', 'ground_floor', { name: 'Laundry' }),
  ]);

  return client;
}

/**
 * Signs someone in with some permissions.
 *
 * @param permissions - What they hold.
 */
export function signIn(permissions: readonly string[]): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
      avatarUrl: null,
      locale: 'it',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });
}
