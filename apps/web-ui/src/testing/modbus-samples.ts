/**
 * The house's Modbus broker as the boards draw it, for the gallery: three gateways and five devices
 * - one of them silent - two servers found, one ignored, and the templates, the owner's and an
 * integration's.
 */
import { QueryClient } from '@tanstack/react-query';

import {
  modbusTemplateSchema,
  type DeviceView,
  type ModbusDevice,
  type ModbusFound,
  type ModbusStatus,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { MODBUS_QUERY_KEYS } from '@/library/modbus-api';

/** The relay board's template, which the editor's sample opens. */
export const MODBUS_SAMPLE_RELAY_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

/**
 * A time on the sample day.
 *
 * @param time - `14:31:07`.
 * @returns The moment, in UTC.
 */
const at = (time: string): Date => new Date(`2026-10-26T${time}Z`);

/** Where the sample broker stands: running, searching two ranges every two hours. */
export const MODBUS_SAMPLE_STATUS: ModbusStatus = {
  state: 'running',
  error: null,
  startedAt: new Date('2026-10-23T08:00:00Z'),
  settings: {
    isSearchEnabled: true,
    ranges: ['192.168.1.0/24', '192.168.20.10-192.168.20.60'],
    intervalMinutes: 120,
  },
  search: {
    isRunning: false,
    lastRun: { at: at('13:02:00'), durationMs: 6000, addresses: 305, answered: 5 },
    nextAt: at('15:02:00'),
  },
  devices: { total: 5, online: 4 },
  gateways: 3,
  requestsPerMinute: 38,
  averageMs: 41,
};

/**
 * One sample device.
 *
 * @param fields - What tells it apart.
 * @returns The device.
 */
function device(fields: Partial<ModbusDevice> & Pick<ModbusDevice, 'id' | 'name'>): ModbusDevice {
  return {
    host: '192.168.1.61',
    port: 502,
    unitId: 1,
    framing: 'tcp',
    template: MODBUS_SAMPLE_RELAY_ID,
    pollSeconds: null,
    templateName: 'Waveshare relay 8ch',
    vendorId: null,
    everySeconds: 5,
    state: 'online',
    lastReadAt: at('14:31:07'),
    lastError: null,
    deviceId: null,
    ...fields,
  };
}

/** The sample devices: an inverter, three behind an RS485 adapter, a relay board. */
export const MODBUS_SAMPLE_DEVICES: ModbusDevice[] = [
  device({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Inverter',
    host: '192.168.1.80',
    template: 'solax-power/x3-hybrid',
    templateName: 'X3-Hybrid G4',
    vendorId: 'solax-power',
    everySeconds: 10,
    deviceId: 'inverter',
  }),
  device({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Main meter',
    framing: 'rtu',
    template: '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e50',
    templateName: 'Eastron SDM630',
    everySeconds: 10,
    deviceId: 'main-meter',
  }),
  device({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Heat pump meter',
    unitId: 2,
    framing: 'rtu',
    template: '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e51',
    templateName: 'Eastron SDM120',
    everySeconds: 10,
    deviceId: 'heat-pump-meter',
  }),
  device({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Pool heat pump',
    unitId: 7,
    framing: 'rtu',
    template: '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e52',
    templateName: 'Pool heat pump',
    everySeconds: 30,
    state: 'offline',
    lastReadAt: at('09:12:00'),
    lastError: 'Unit 7 at 192.168.1.61:502 did not answer in time',
    deviceId: 'pool-heat-pump',
  }),
  device({
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Garage relays',
    host: '192.168.1.60',
    deviceId: 'garage-relays',
  }),
];

/** The servers the search found that are not devices yet. */
export const MODBUS_SAMPLE_FOUND: ModbusFound[] = [
  { host: '192.168.1.94', port: 502, foundAt: at('13:02:04'), claims: [] },
  {
    host: '192.168.1.112',
    port: 502,
    foundAt: at('13:02:05'),
    claims: [
      {
        vendorId: 'fronius',
        vendorName: 'Fronius',
        kind: 'fronius/symo',
        model: 'Symo 8.2-3-M',
        unitId: 1,
      },
    ],
  },
];

/** The relay board's template: relays on coils, an input, the firmware. */
const RELAY = modbusTemplateSchema.parse({
  name: 'Waveshare relay 8ch',
  device: 'Waveshare Modbus POE ETH Relay',
  pollSeconds: 5,
  entities: [
    {
      id: 'relay_1',
      name: 'Relay 1',
      domain: 'switch',
      capabilities: {
        on_off: {
          read: { function: 1, address: '0x0000' },
          write: { function: 5, on: '0xFF00', off: '0x0000' },
        },
      },
    },
    {
      id: 'input_1',
      name: 'Input 1',
      domain: 'binary_sensor',
      capabilities: { sensor_binary: { read: { function: 2, address: '0x0000' } } },
    },
    {
      id: 'firmware',
      name: 'Firmware',
      domain: 'sensor',
      capabilities: {
        sensor_numeric: { read: { function: 3, address: '0x8000', type: 'u16', scale: 0.01 } },
      },
    },
    {
      id: 'mode',
      name: 'Mode',
      domain: 'select',
      capabilities: {
        select: {
          read: {
            function: 3,
            address: '0x0010',
            options: { '0': 'Off', '1': 'Eco', '2': 'Boost' },
          },
          write: { function: 6 },
        },
      },
    },
  ],
});

/**
 * One sample template.
 *
 * @param fields - What tells it apart.
 * @returns The template.
 */
function template(
  fields: Partial<ModbusTemplateRecord> & Pick<ModbusTemplateRecord, 'id'>,
): ModbusTemplateRecord {
  return {
    vendorId: null,
    vendorName: null,
    document: RELAY,
    isReadOnly: false,
    usedBy: 0,
    updatedAt: at('12:00:00'),
    ...fields,
  };
}

/**
 * A template of entities named only, for the lists.
 *
 * @param name - Its name.
 * @param device - The device it is for.
 * @param entities - How many entities it has.
 * @returns The template.
 */
function named(name: string, device: string, entities: number) {
  return modbusTemplateSchema.parse({
    name,
    device,
    entities: [...Array(entities).keys()].map((index) => ({
      id: `value_${String(index + 1)}`,
      name: `Value ${String(index + 1)}`,
      domain: 'sensor',
      capabilities: { sensor_numeric: { read: { function: 4, address: index * 2, type: 'f32' } } },
    })),
  });
}

/** The templates: four of the owner's, five an integration ships. */
export const MODBUS_SAMPLE_TEMPLATES: ModbusTemplateRecord[] = [
  template({ id: MODBUS_SAMPLE_RELAY_ID, usedBy: 1 }),
  template({
    id: '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e50',
    document: named('Eastron SDM630', 'Eastron SDM630', 9),
    usedBy: 1,
  }),
  template({
    id: '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e51',
    document: named('Eastron SDM120', 'Eastron SDM120', 5),
    usedBy: 1,
  }),
  template({
    id: '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e52',
    document: named('Pool heat pump', 'Pool heat pump', 3),
    usedBy: 1,
  }),
  ...(
    [
      ['x3-hybrid', 'X3-Hybrid G4', 48],
      ['x1-hybrid', 'X1-Hybrid G4', 44],
      ['x1-boost', 'X1-Boost', 22],
      ['x3-mic-pro', 'X3-MIC PRO', 26],
      ['x3-evc', 'X3-EVC charger', 18],
    ] as const
  ).map(([driver, name, entities]) =>
    template({
      id: `solax-power/${driver}`,
      vendorId: 'solax-power',
      vendorName: 'SolaX Power',
      document: named(name, name, entities),
      isReadOnly: true,
      usedBy: driver === 'x3-hybrid' ? 1 : 0,
      updatedAt: null,
    }),
  ),
];

/**
 * A cache already holding the broker, for its pages drawn with no server.
 *
 * @returns The cache.
 */
export function modbusSampleCache(): QueryClient {
  // Never fetched: the pages poll, and there is no server behind the gallery.
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, staleTime: Infinity, retry: false } },
  });

  client.setQueryData(MODBUS_QUERY_KEYS.status, MODBUS_SAMPLE_STATUS);
  client.setQueryData(MODBUS_QUERY_KEYS.devices, MODBUS_SAMPLE_DEVICES);
  client.setQueryData(MODBUS_QUERY_KEYS.templates, MODBUS_SAMPLE_TEMPLATES);
  client.setQueryData(MODBUS_QUERY_KEYS.found, {
    items: MODBUS_SAMPLE_FOUND,
    ignored: [{ host: '192.168.1.30', port: 502, at: new Date('2026-10-12T10:00:00Z') }],
  });
  client.setQueryData(LIBRARY_QUERY_KEYS.devices, [] as DeviceView[]);
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, []);
  client.setQueryData(LIBRARY_QUERY_KEYS.vendors, []);

  return client;
}
