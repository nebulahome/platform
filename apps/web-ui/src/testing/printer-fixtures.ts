/**
 * A workshop printer and a garage relay, as the registry lists them, for the tests of the devices
 * list and of a device's page: the same two devices, their vendors, the printer's entities and a
 * tag on one of them.
 */
import {
  entityIdSchema,
  type DeviceView,
  type EntityView,
  type IntegrationVendorView,
} from '@nebula-home/contracts';

/** A tag the owner made, on the nozzle. */
export const EXTERIOR = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'exterior',
  name: 'Exterior',
  color: 'green',
  icon: null,
  deviceCount: 0,
  entityCount: 1,
} as const;

/** The printer's nozzle thermometer. */
export const NOZZLE_ID = entityIdSchema.parse('sensor.bambu_lab_p1s_nozzle_temperature');

/** The printer's chamber light. */
export const LIGHT_ID = entityIdSchema.parse('light.bambu_lab_p1s_chamber_light');

/** The printer, as the registry lists it. */
export const PRINTER: DeviceView = {
  id: 'bambu-lab-p1s',
  name: 'Workshop printer',
  icon: 'printer',
  kind: 'bambu-lab/printer',
  origin: 'integration',
  kindVersion: '1.0.0',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  driverName: 'Printer',
  model: 'P1S',
  transport: 'mqtt',
  transportConfig: {},
  options: {},
  isEnabled: true,
  state: 'running',
  lastError: null,
  lastStartedAt: null,
  lastUpdatedAt: null,
  externalId: '01P00A000000042',
  manufacturer: 'Bambu Lab',
  swVersion: null,
  hwVersion: null,
  areaId: null,
  areaKey: null,
  areaName: null,
  entityIds: [NOZZLE_ID, LIGHT_ID],
  tagIds: [],
};

/** A relay of another vendor, switched off. */
export const RELAY: DeviceView = {
  ...PRINTER,
  id: 'shelly-garage',
  name: 'Garage relay',
  icon: 'relay',
  kind: 'shelly/1pm-mini-g3',
  vendorId: 'shelly',
  driverId: '1pm-mini-g3',
  driverName: '1PM Mini Gen3',
  model: '1PM Mini Gen3',
  transport: 'http',
  isEnabled: false,
  state: 'disabled',
  externalId: null,
  manufacturer: 'Shelly',
  areaId: null,
  areaKey: 'garage',
  areaName: 'Garage',
  entityIds: [],
  tagIds: [],
};

/** The vendors, as the catalogue lists them. */
export const VENDORS: IntegrationVendorView[] = ['bambu-lab', 'shelly'].map((id) => ({
  id,
  version: '1.0.0',
  name: id === 'shelly' ? 'Shelly' : 'Bambu Lab',
  logoPadding: 0,
  internetRequired: false,
  transports: [],
  wires: [],
  discoverySources: [],
  adoption: 'owner',
  pairing: null,
  listener: null,
  passedOver: [],
  containers: [],
  containerStatuses: [],
  setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
  drivers: [],
  needsSetup: false,
  isConfigured: false,
  transportConfig: {},
  options: {},
  configuredAt: null,
  deviceCount: 1,
  entityCount: 2,
}));

/**
 * An entity of the printer that has never reported.
 *
 * @param entityId - Its address.
 * @param name - What it is called.
 * @param overrides - What differs from a thermometer.
 * @returns The entity.
 */
export function printerEntity(
  entityId: EntityView['entityId'],
  name: string,
  overrides: Partial<EntityView> = {},
): EntityView {
  return {
    entityId,
    domain: entityId.split('.')[0] ?? '',
    name,
    icon: null,
    areaKey: null,
    areaName: null,
    deviceId: '00000000-0000-4000-8000-000000000010',
    source: 'bambu-lab-p1s',
    unitOfMeasurement: '°C',
    deviceClass: 'temperature',
    isEnabled: true,
    isHidden: false,
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    searchAliases: [],
    state: null,
    attributes: {},
    isAvailable: true,
    lastChanged: null,
    lastUpdated: null,
    tagIds: [],
    ...overrides,
  };
}

/**
 * The printer's two entities: the nozzle, tagged Exterior, and the chamber light.
 *
 * @returns The entities.
 */
export function printerEntities(): EntityView[] {
  return [
    printerEntity(NOZZLE_ID, 'Nozzle temperature', { tagIds: [EXTERIOR.id] }),
    printerEntity(LIGHT_ID, 'Chamber light', {
      unitOfMeasurement: null,
      deviceClass: null,
      capabilities: [{ capability: 'on_off', params: {} }],
    }),
  ];
}
