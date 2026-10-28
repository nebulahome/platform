/**
 * The platform's own vendors, `matter`, `mqtt`, `modbus`, `bluetooth` and `infrared`: the devices
 * of its brokers no integration claims, for Modbus the devices read through the owner's templates,
 * for Bluetooth the BTHome sensors the platform reads itself, and for Infrared the remotes the
 * house learned.
 *
 * Not bundles - nothing to install, nothing read from a folder - but loaded beside the bundles as
 * ones, so that a device no vendor takes is added, run and removed the way every device is: an
 * instance of `<broker>/generic`, the platform's mapping of the broker's devices, reached over the
 * broker's transport. Each vendor's rule takes every device of its broker; discovery offers a
 * device to it only when no vendor's own rules take it, or more than one do. The Integrations page
 * leaves them out: their devices are the Brokers page's.
 */
import {
  BLUETOOTH_TRANSPORT,
  BLUETOOTH_VENDOR,
  BTHOME_KIND,
  BTHOME_SERVICE_UUID,
  INFRARED_REMOTE_KIND,
  INFRARED_TRANSPORT,
  INFRARED_VENDOR,
  integrationSetupSchema,
  MATTER_GENERIC_KIND,
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  MODBUS_GENERIC_KIND,
  MODBUS_TRANSPORT,
  MODBUS_VENDOR,
  MQTT_GENERIC_KIND,
  MQTT_HOUSE_TRANSPORT,
  MQTT_VENDOR,
  type JsonObject,
  type TransportWire,
} from '@nebulahome/contracts';
import {
  bundleManifestSchema,
  createBthomeIntegration,
  createInfraredIntegration,
  createMatterIntegration,
  createModbusIntegration,
  createMqttIntegration,
  resolveDiscovery,
  vendorDiscoverySchema,
  vendorManifestSchema,
  type Integration,
  type LoadedBundle,
  type LoadedVendor,
  type VendorDiscovery,
} from '@nebulahome/package-runtime';

/** What tells one platform vendor from the other. */
type PlatformVendorSpec = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly transport: string;
  readonly kind: 'matter' | 'mqtt' | 'modbus' | 'bluetooth' | 'infrared';
  readonly driverKind: string;
  readonly driverName: string;
  readonly wire: TransportWire;

  /**
   * The vendor's `discovery.json`: its broker's block, a rule every device holds; null for a broker
   * whose every device names its driver, which no rule is asked of.
   */
  readonly discovery: JsonObject | null;

  readonly integration: (manifest: { readonly id: string }) => Integration;
};

/** The discovery of a vendor whose devices each name their driver: added at once, by no rule. */
const NO_RULES: VendorDiscovery = { listen: [], match: [], identity: {}, adopt: 'automatic' };

/**
 * Builds one of the platform's vendors.
 *
 * @param spec - What it is.
 * @param version - The platform's version, which the vendor carries as its own.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor, as the loader would hand a bundle over.
 */
function platformVendor(spec: PlatformVendorSpec, version: string, sdk: string): LoadedVendor {
  const setup = integrationSetupSchema.parse({ transport: { fields: [] } });
  const driverId = spec.driverKind.slice(spec.id.length + 1);
  const manifest = vendorManifestSchema.parse({
    id: spec.id,
    version,
    sdk,
    name: spec.name,
    description: spec.description,
    color: spec.color,
  });
  const driverManifest = bundleManifestSchema.parse({
    id: spec.driverKind,
    version,
    sdk,
    name: spec.driverName,
    vendor: { id: spec.id, name: spec.name },
    transport: spec.transport,
    kind: spec.kind,
    // The template of each of its devices comes with the device: this names none of its own.
    ...(spec.kind === 'modbus' ? { template: './template.json' } : {}),
    // A code kind names its entry; the platform's mapping is the code, and nothing is read.
    ...(spec.kind === 'bluetooth' ? { entry: './index.js' } : {}),
    setup: './setup.json',
  });
  const driver: LoadedBundle = {
    manifest: driverManifest,
    vendorId: spec.id,
    driverId,
    driverName: spec.driverName,
    integration: spec.integration(driverManifest),
    setup,
    directory: '',
  };

  return {
    manifest,
    origin: 'platform',
    setup,
    transports: [spec.transport],
    wires: [spec.wire],
    ownTransports: [],
    streams: [],
    drivers: [driver],
    discovery: {
      plan: resolveDiscovery(
        spec.id,
        spec.discovery === null
          ? NO_RULES
          : vendorDiscoverySchema.parse({ ...spec.discovery, adopt: 'automatic' }),
        [{ id: driverId, name: spec.driverName, transport: spec.transport, models: [] }],
      ),
      sources: [],
    },
    directory: '',

    /**
     * Lets go of nothing: the vendor holds no module.
     *
     * @returns At once.
     */
    release: () => Promise.resolve(),
  };
}

/**
 * Builds the platform's Matter vendor.
 *
 * @param version - The platform's version.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor.
 */
export function platformMatterVendor(version: string, sdk: string): LoadedVendor {
  return platformVendor(
    {
      id: MATTER_VENDOR,
      name: 'Matter',
      description: 'Matter devices no integration claims, mapped by the platform.',
      color: '#141414',
      transport: MATTER_TRANSPORT,
      kind: 'matter',
      driverKind: MATTER_GENERIC_KIND,
      driverName: 'Matter device',
      wire: 'matter',
      discovery: { matter: { match: [{ path: 'nodeId', exists: true }] } },
      integration: createMatterIntegration,
    },
    version,
    sdk,
  );
}

/**
 * Builds the platform's MQTT vendor.
 *
 * @param version - The platform's version.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor.
 */
export function platformMqttVendor(version: string, sdk: string): LoadedVendor {
  return platformVendor(
    {
      id: MQTT_VENDOR,
      name: 'MQTT',
      description: 'MQTT devices no integration claims, mapped by the platform.',
      color: '#660066',
      transport: MQTT_HOUSE_TRANSPORT,
      kind: 'mqtt',
      driverKind: MQTT_GENERIC_KIND,
      driverName: 'MQTT device',
      wire: 'mqtt',
      discovery: { mqtt: { match: [{ path: 'deviceKey', exists: true }] } },
      integration: createMqttIntegration,
    },
    version,
    sdk,
  );
}

/**
 * Builds the platform's Modbus vendor: the devices the owner added through templates of their own.
 *
 * @param version - The platform's version.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor.
 */
export function platformModbusVendor(version: string, sdk: string): LoadedVendor {
  return platformVendor(
    {
      id: MODBUS_VENDOR,
      name: 'Modbus',
      description: 'Modbus devices read through the owner’s templates, by the platform.',
      color: '#4fc3d9',
      transport: MODBUS_TRANSPORT,
      kind: 'modbus',
      driverKind: MODBUS_GENERIC_KIND,
      driverName: 'Modbus device',
      wire: 'modbus',
      discovery: { modbus: { match: [{ path: 'deviceKey', exists: true }] } },
      integration: createModbusIntegration,
    },
    version,
    sdk,
  );
}

/**
 * Builds the platform's Bluetooth vendor: the BTHome sensors the platform recognises and reads
 * itself, by the service data BTHome advertises under.
 *
 * @param version - The platform's version.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor.
 */
export function platformBluetoothVendor(version: string, sdk: string): LoadedVendor {
  return platformVendor(
    {
      id: BLUETOOTH_VENDOR,
      name: 'Bluetooth',
      description: 'BTHome sensors heard over Bluetooth, read by the platform.',
      color: '#0082fc',
      transport: BLUETOOTH_TRANSPORT,
      kind: 'bluetooth',
      driverKind: BTHOME_KIND,
      driverName: 'BTHome',
      wire: 'ble',
      discovery: {
        bluetooth: { match: [{ path: `serviceData.'${BTHOME_SERVICE_UUID}'`, exists: true }] },
      },
      integration: createBthomeIntegration,
    },
    version,
    sdk,
  );
}

/**
 * Builds the platform's Infrared vendor: the remotes the house learned, each button a button of the
 * house, sent through an integration's IR blaster.
 *
 * @param version - The platform's version.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor.
 */
export function platformInfraredVendor(version: string, sdk: string): LoadedVendor {
  return platformVendor(
    {
      id: INFRARED_VENDOR,
      name: 'Infrared',
      description: 'Remotes the house learned, sent through an IR blaster, by the platform.',
      color: '#e5484d',
      transport: INFRARED_TRANSPORT,
      kind: 'infrared',
      driverKind: INFRARED_REMOTE_KIND,
      driverName: 'Remote',
      wire: 'ir',
      // Every remote names its driver: the broker proposes it as `infrared/remote`.
      discovery: null,
      integration: createInfraredIntegration,
    },
    version,
    sdk,
  );
}
