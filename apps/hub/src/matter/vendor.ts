/**
 * The platform's own vendor, `matter`: the Matter devices no integration claims.
 *
 * Not a bundle - nothing to install, nothing read from a folder - but loaded beside the bundles as
 * one, so that a Matter device no vendor takes is added, run and removed the way every device is:
 * an instance of `matter/generic`, the platform's Matter mapping, reached over the `matter`
 * transport. Its rule takes every Matter device; discovery offers a device to it only when no
 * vendor's own rules take it, or more than one do. The Integrations page leaves it out: its
 * devices are the Brokers page's.
 */
import {
  integrationSetupSchema,
  MATTER_GENERIC_KIND,
  MATTER_TRANSPORT,
  MATTER_VENDOR,
} from '@nebulahome/contracts';
import {
  bundleManifestSchema,
  createMatterIntegration,
  resolveDiscovery,
  vendorDiscoverySchema,
  vendorManifestSchema,
  type LoadedBundle,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

/** The driver's id within the vendor. */
const DRIVER_ID = MATTER_GENERIC_KIND.slice(MATTER_VENDOR.length + 1);

/**
 * Builds the platform's Matter vendor.
 *
 * @param version - The platform's version, which the vendor carries as its own.
 * @param sdk - The integration contract the hub implements.
 * @returns The vendor, as the loader would hand a bundle over.
 */
export function platformMatterVendor(version: string, sdk: string): LoadedVendor {
  const setup = integrationSetupSchema.parse({ transport: { fields: [] } });
  const manifest = vendorManifestSchema.parse({
    id: MATTER_VENDOR,
    version,
    sdk,
    name: 'Matter',
    description: 'Matter devices no integration claims, mapped by the platform.',
    color: '#141414',
  });
  const driverManifest = bundleManifestSchema.parse({
    id: MATTER_GENERIC_KIND,
    version,
    sdk,
    name: 'Matter device',
    vendor: { id: MATTER_VENDOR, name: 'Matter' },
    transport: MATTER_TRANSPORT,
    kind: 'matter',
    setup: './setup.json',
  });
  const driver: LoadedBundle = {
    manifest: driverManifest,
    vendorId: MATTER_VENDOR,
    driverId: DRIVER_ID,
    driverName: 'Matter device',
    integration: createMatterIntegration(driverManifest),
    setup,
    directory: '',
  };

  return {
    manifest,
    origin: 'platform',
    setup,
    transports: [MATTER_TRANSPORT],
    wires: ['matter'],
    ownTransports: [],
    streams: [],
    drivers: [driver],
    discovery: {
      plan: resolveDiscovery(
        MATTER_VENDOR,
        vendorDiscoverySchema.parse({
          matter: { match: [{ path: 'nodeId', exists: true }] },
          adopt: 'automatic',
        }),
        [{ id: DRIVER_ID, name: 'Matter device', transport: MATTER_TRANSPORT, models: [] }],
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
