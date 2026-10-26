/**
 * The registry, as the API serves it, for tests that need a few rows of it.
 *
 * Each builder returns a complete, valid row with the fields a test does not care about filled in
 * sensibly, so a test names only what it is about: `anEntity({ capabilities: [...] })`.
 */
import {
  entityIdSchema,
  type AreaView,
  type DeviceView,
  type EntityView,
  type IntegrationVendorView,
  type TagView,
} from '@nebulahome/contracts';

/**
 * An entity: a switch on a Shelly relay that has reported once.
 *
 * @param overrides - What differs.
 * @returns The entity.
 */
export function anEntity(
  overrides: Omit<Partial<EntityView>, 'entityId'> & { readonly entityId?: string } = {},
): EntityView {
  const { entityId = 'switch.garage_relay', ...rest } = overrides;

  return {
    entityId: entityIdSchema.parse(entityId),
    domain: entityId.split('.')[0] ?? 'switch',
    name: 'Garage relay',
    icon: null,
    areaKey: null,
    areaName: null,
    deviceId: '00000000-0000-4000-8000-000000000010',
    source: 'shelly-garage',
    unitOfMeasurement: null,
    deviceClass: null,
    isEnabled: true,
    isHidden: false,
    capabilities: [{ capability: 'on_off', params: {} }],
    searchAliases: [],
    state: { on_off: { isOn: false } },
    attributes: {},
    isAvailable: true,
    lastChanged: new Date('2026-09-20T08:00:00.000Z'),
    lastUpdated: new Date('2026-09-20T08:00:05.000Z'),
    tagIds: [],
    addresses: [],
    linked: null,
    key: null,
    createdAt: null,
    original: null,
    ...rest,
  };
}

/**
 * A device: the Shelly relay the default entity belongs to.
 *
 * @param overrides - What differs.
 * @returns The device.
 */
export function aDevice(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 'shelly-garage',
    name: 'Garage relay',
    icon: 'relay',
    kind: 'shelly/switch',
    origin: 'integration',
    kindVersion: '1.0.0',
    vendorId: 'shelly',
    driverId: 'switch',
    driverName: 'Relay',
    model: '1 Gen3',
    series: null,
    transport: 'shelly/rpc',
    transportConfig: {},
    options: {},
    isEnabled: true,
    state: 'running',
    lastError: null,
    lastStartedAt: null,
    lastUpdatedAt: null,
    externalId: null,
    manufacturer: 'Shelly',
    swVersion: null,
    hwVersion: null,
    areaId: null,
    areaKey: null,
    areaName: null,
    entityIds: [],
    tagIds: [],
    mac: null,
    serialNumber: null,
    createdAt: null,
    linked: null,
    suggestedLinks: [],
    ...overrides,
  };
}

/**
 * An area: a house, a floor or a room.
 *
 * @param id - Its id, which is also its key.
 * @param kind - Which of the three.
 * @param parentId - What it is in, or null for the house.
 * @param overrides - What else differs.
 * @returns The area.
 */
export function anArea(
  id: string,
  kind: AreaView['kind'],
  parentId: string | null,
  overrides: Partial<AreaView> = {},
): AreaView {
  return {
    id,
    key: id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replaceAll('_', ' '),
    kind,
    parentId,
    icon: null,
    sortOrder: 0,
    level: kind === 'floor' ? 0 : null,
    latitude: null,
    longitude: null,
    deviceCount: 0,
    entityCount: 0,
    ...overrides,
  };
}

/**
 * Twelve hexadecimal digits that follow from a key, so a tag's id is the same in every run.
 *
 * @param key - The key.
 * @returns The digits.
 */
function digest(key: string): string {
  let hash = 7;

  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) % 0xffffffffffff;
  }

  return hash.toString(16).padStart(12, '0');
}

/**
 * A tag.
 *
 * @param key - Its key; its name is the key, spoken.
 * @param overrides - What else differs.
 * @returns The tag.
 */
export function aTag(key: string, overrides: Partial<TagView> = {}): TagView {
  return {
    id: `00000000-0000-4000-8000-${digest(key)}`,
    key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    color: 'teal',
    icon: null,
    deviceCount: 0,
    entityCount: 0,
    ...overrides,
  };
}

/**
 * An integration, installed and set up, with no driver of its own.
 *
 * @param overrides - What differs.
 * @returns The integration.
 */
export function aVendor(overrides: Partial<IntegrationVendorView> = {}): IntegrationVendorView {
  return {
    id: 'shelly',
    version: '1.0.0',
    name: 'Shelly',
    description: 'Relays, plugs and meters on the local network.',
    url: 'https://shelly.com',
    color: '#62a9ff',
    origin: 'development',
    install: null,
    hasCode: false,
    logoPadding: 0,
    internetRequired: false,
    transports: ['shelly/rpc'],
    wires: [],
    discoverySources: [],
    adoption: 'owner',
    twins: ['mac'],
    pairing: null,
    listener: null,
    passedOver: [],
    requires: { packages: {}, services: [] },
    packageProblems: [],
    account: null,
    accounts: [],
    needsAccount: false,
    needsPackage: false,
    update: null,
    containers: [],
    containerStatuses: [],
    setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
    drivers: [],
    needsSetup: false,
    isConfigured: true,
    transportConfig: {},
    options: {},
    configuredAt: null,
    deviceCount: 0,
    entityCount: 0,
    ...overrides,
  };
}
