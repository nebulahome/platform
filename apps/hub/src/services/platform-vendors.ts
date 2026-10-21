/**
 * The platform's own vendors, `matter` and `mqtt`: the devices of its brokers no integration
 * claims.
 *
 * Not bundles - nothing to install, nothing read from a folder - but loaded beside the bundles as
 * ones, so that a device no vendor takes is added, run and removed the way every device is: an
 * instance of `<broker>/generic`, the platform's mapping of the broker's devices, reached over the
 * broker's transport. Each vendor's rule takes every device of its broker; discovery offers a
 * device to it only when no vendor's own rules take it, or more than one do. The Integrations page
 * leaves them out: their devices are the Brokers page's.
 */
import {
  integrationSetupSchema,
  MATTER_GENERIC_KIND,
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  MQTT_GENERIC_KIND,
  MQTT_HOUSE_TRANSPORT,
  MQTT_VENDOR,
  type JsonObject,
  type TransportWire,
} from '@nebulahome/contracts';
import {
  bundleManifestSchema,
  createMatterIntegration,
  createMqttIntegration,
  resolveDiscovery,
  vendorDiscoverySchema,
  vendorManifestSchema,
  type Integration,
  type LoadedBundle,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

/** What tells one platform vendor from the other. */
type PlatformVendorSpec = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly transport: string;
  readonly kind: 'matter' | 'mqtt';
  readonly driverKind: string;
  readonly driverName: string;
  readonly wire: TransportWire;

  /** The vendor's `discovery.json`: its broker's block, a rule every device holds. */
  readonly discovery: JsonObject;

  readonly integration: (manifest: { readonly id: string }) => Integration;
};

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
        vendorDiscoverySchema.parse({ ...spec.discovery, adopt: 'automatic' }),
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
