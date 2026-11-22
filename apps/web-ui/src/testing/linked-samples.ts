/**
 * The Dryer plug of the boards, reached through Shelly and Matter: its readings, those linked and
 * those read one way, for the gallery, the entity lab and the device page's and dialog's tests. Built on the Matter
 * broker's samples, whose house it is.
 */
import type { QueryClient } from '@tanstack/react-query';

import type {
  DeviceView,
  EntitySource,
  EntityView,
  LinkPreview,
  StateHistoryPoint,
} from '@nebulahome/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { aDevice, anEntity } from '@/testing/fixtures';
import { MATTER_SAMPLE_DEVICES, matterSampleCache } from '@/testing/matter-samples';

/** The two ways into the Dryer plug, by instance. */
const SHELLY = 'shelly-dryer';
const MATTER = 'matter-1f';

/** The Dryer plug, as the devices list has it. */
export const LINKED_SAMPLE_DEVICE: DeviceView = {
  ...aDevice(),
  ...MATTER_SAMPLE_DEVICES[0],
  mac: '08:f9:e0:12:4c:7a',
  swVersion: '1.4.2',
  suggestedLinks: [],
  parentId: null,
  childIds: [],
};

/**
 * One way a reading is read.
 *
 * @param way - The way.
 * @param entityId - The reading through it.
 * @param state - What it says.
 * @param key - Its key in that way.
 * @returns The source.
 */
function source(
  way: string,
  entityId: string,
  state: EntitySource['state'],
  key: string | null,
): EntitySource {
  const isMatter = way === MATTER;

  return {
    entityId: entityId as EntitySource['entityId'],
    deviceId: way,
    vendorId: 'shelly',
    transport: isMatter ? 'matter' : 'shelly/rpc',
    key: isMatter ? null : key,
    matter: isMatter ? { endpoint: 1, cluster: key === 'switch:0' ? 6 : 0x90, attribute: 0 } : null,
    isActive: !isMatter,
    isAvailable: true,
    state,
    lastUpdated: new Date(),
    origin: isMatter ? 'declared' : null,
  };
}

/**
 * A reading read both ways.
 *
 * @param entityId - Its address, the Shelly one's.
 * @param name - What it is called.
 * @param overrides - What else differs.
 * @param key - Its key over RPC.
 * @returns The entity.
 */
function linked(
  entityId: string,
  name: string,
  overrides: Partial<EntityView>,
  key: string,
): EntityView {
  const state = overrides.state ?? null;
  const matterId = `${entityId}_matter`;

  return anEntity({
    entityId,
    name,
    source: SHELLY,
    areaKey: 'utility',
    areaName: 'Utility',
    ...overrides,
    addresses: [entityId as EntityView['entityId'], matterId as EntityView['entityId']],
    linked: {
      sources: [source(SHELLY, entityId, state, key), source(MATTER, matterId, state, key)],
      transport: null,
      preferred: SHELLY,
      active: SHELLY,
    },
  });
}

/**
 * A reading read one way.
 *
 * @param entityId - Its address.
 * @param name - What it is called.
 * @param way - The way.
 * @param overrides - What else differs.
 * @returns The entity.
 */
function oneWay(
  entityId: string,
  name: string,
  way: string,
  overrides: Partial<EntityView>,
): EntityView {
  return anEntity({
    entityId,
    name,
    source: way,
    areaKey: 'utility',
    areaName: 'Utility',
    ...overrides,
  });
}

/** A sensor's shape. */
const SENSOR = { capabilities: [{ capability: 'sensor_numeric' as const, params: {} }] };

/** Its readings. */
export const LINKED_SAMPLE_ENTITIES: EntityView[] = [
  linked(
    'switch.dryer_plug',
    'Plug',
    { state: { on_off: { isOn: true } }, icon: 'plug' },
    'switch:0',
  ),
  oneWay('sensor.dryer_plug_power', 'Power', SHELLY, {
    ...SENSOR,
    deviceClass: 'power',
    unitOfMeasurement: 'W',
    state: { sensor_numeric: { value: 1860 } },
  }),
  oneWay('sensor.dryer_plug_active_power', 'Active power', MATTER, {
    ...SENSOR,
    deviceClass: 'power',
    unitOfMeasurement: 'W',
    state: { sensor_numeric: { value: 1857 } },
  }),
  linked(
    'sensor.dryer_plug_voltage',
    'Voltage',
    {
      ...SENSOR,
      deviceClass: 'voltage',
      unitOfMeasurement: 'V',
      state: { sensor_numeric: { value: 229.8 } },
    },
    'switch:0',
  ),
  linked(
    'sensor.dryer_plug_current',
    'Current',
    {
      ...SENSOR,
      deviceClass: 'current',
      unitOfMeasurement: 'A',
      state: { sensor_numeric: { value: 8.1 } },
    },
    'switch:0',
  ),
  linked(
    'sensor.dryer_plug_energy',
    'Energy',
    {
      ...SENSOR,
      deviceClass: 'energy',
      unitOfMeasurement: 'kWh',
      state: { sensor_numeric: { value: 312.4 } },
    },
    'switch:0',
  ),
  oneWay('sensor.dryer_plug_temperature', 'Device temperature', SHELLY, {
    ...SENSOR,
    deviceClass: 'temperature',
    unitOfMeasurement: '°C',
    state: { sensor_numeric: { value: 41.5 } },
  }),
  oneWay('sensor.dryer_plug_wifi', 'Wi-Fi signal', SHELLY, {
    ...SENSOR,
    deviceClass: 'signal_strength',
    unitOfMeasurement: 'dBm',
    state: { sensor_numeric: { value: -61 } },
  }),
];

/**
 * The rows of the plug's last day: on twice, and three minutes through Matter last night.
 *
 * @returns The rows, oldest first.
 */
function plugHistory(): StateHistoryPoint[] {
  const now = Date.now();
  /**
   * A moment before now.
   *
   * @param hoursAgo - How long before.
   * @returns The moment.
   */
  const at = (hoursAgo: number): Date => new Date(now - hoursAgo * 3_600_000);
  /**
   * One row.
   *
   * @param time - When.
   * @param isOn - What it said.
   * @param through - The way it came in.
   * @returns The row.
   */
  const row = (time: Date, isOn: boolean, through: string): StateHistoryPoint => ({
    time,
    entityId: 'switch.dryer_plug' as StateHistoryPoint['entityId'],
    state: { on_off: { isOn } },
    previousState: { on_off: { isOn: !isOn } },
    attributes: {},
    isAvailable: true,
    source: through,
  });

  return [
    row(at(20), true, SHELLY),
    row(at(18), false, SHELLY),
    row(at(16), true, MATTER),
    row(at(15.95), true, SHELLY),
    row(at(4.8), true, SHELLY),
    row(at(2.4), false, SHELLY),
    row(at(0.6), true, SHELLY),
  ];
}

/** What linking Power and Active power would do. */
export const LINK_SAMPLE_PREVIEW: LinkPreview = {
  action: 'link',
  scope: 'entity',
  device: null,
  other: null,
  pairs: [
    {
      holder: {
        entityId: 'sensor.dryer_plug_power' as EntitySource['entityId'],
        name: 'Power',
        deviceId: SHELLY,
        vendorId: 'shelly',
        transport: 'shelly/rpc',
        usedBy: { automations: [], scenes: [], aliases: [], cards: [] },
      },
      others: [
        {
          entityId: 'sensor.dryer_plug_active_power' as EntitySource['entityId'],
          name: 'Active power',
          deviceId: MATTER,
          vendorId: 'shelly',
          transport: 'matter',
          usedBy: {
            automations: ['Dryer finished'],
            scenes: [],
            aliases: [],
            cards: [{ dashboard: 'Utility', count: 1 }],
          },
        },
      ],
      origin: 'manual',
    },
  ],
  single: [],
  preferred: { deviceId: SHELLY, vendorId: 'shelly', transport: 'shelly/rpc' },
  linkedSince: null,
};

/** What unlinking Energy would do. */
export const UNLINK_SAMPLE_PREVIEW: LinkPreview = {
  ...LINK_SAMPLE_PREVIEW,
  action: 'unlink',
  pairs: [
    {
      holder: {
        entityId: 'sensor.dryer_plug_energy' as EntitySource['entityId'],
        name: 'Energy',
        deviceId: SHELLY,
        vendorId: 'shelly',
        transport: 'shelly/rpc',
        usedBy: {
          automations: ['Dryer finished', 'Night tariff'],
          scenes: [],
          aliases: [],
          cards: [{ dashboard: 'Energy', count: 2 }],
        },
      },
      others: [
        {
          entityId: 'sensor.dryer_plug_energy_matter' as EntitySource['entityId'],
          name: 'Energy',
          deviceId: MATTER,
          vendorId: 'shelly',
          transport: 'matter',
          usedBy: { automations: [], scenes: [], aliases: [], cards: [] },
        },
      ],
      origin: 'declared',
    },
  ],
  linkedSince: new Date('2026-10-12T09:00:00Z'),
};

/**
 * A cache holding the plug, its readings and its last day, for a page drawn with no server.
 *
 * @returns The cache.
 */
export function linkedSampleCache(): QueryClient {
  const client = matterSampleCache();
  const devices = [LINKED_SAMPLE_DEVICE, ...MATTER_SAMPLE_DEVICES.slice(1)];

  client.setQueryData(LIBRARY_QUERY_KEYS.devices, devices);
  client.setQueryData([...LIBRARY_QUERY_KEYS.devices, 'shelly-dryer'], {
    ...LINKED_SAMPLE_DEVICE,
    suggestedLinks: [{ entityIds: ['sensor.dryer_plug_power', 'sensor.dryer_plug_active_power'] }],
  });
  client.setQueryData(LIBRARY_QUERY_KEYS.entities, LINKED_SAMPLE_ENTITIES);

  for (const entity of LINKED_SAMPLE_ENTITIES) {
    client.setQueryData([...LIBRARY_QUERY_KEYS.entities, entity.entityId], entity);
  }

  client.setQueryData([...LIBRARY_QUERY_KEYS.history, 'switch.dryer_plug', 'state', '24h'], {
    window: { from: Date.now() - 86_400_000, to: Date.now() },
    points: plugHistory(),
  });
  client.setQueryData(
    [
      ...LINK_QUERY_KEYS.preview,
      'link',
      'entity',
      'sensor.dryer_plug_power',
      'sensor.dryer_plug_active_power',
    ],
    LINK_SAMPLE_PREVIEW,
  );
  client.setQueryData(
    [...LINK_QUERY_KEYS.preview, 'unlink', 'entity', 'sensor.dryer_plug_energy', ''],
    UNLINK_SAMPLE_PREVIEW,
  );

  return client;
}
