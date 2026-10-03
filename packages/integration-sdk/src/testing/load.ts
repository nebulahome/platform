/**
 * Loading an integration in a test, the way `hub` loads it: every file read and checked by the
 * hub's own loader, every module imported and handed an SDK - a fake one, whose sockets and logs
 * the test reads. The sources are loaded as they stand - a module in TypeScript is imported as
 * the test runner imports TypeScript - or the build in `dist/`, to test what is released.
 */
import { pathToFileURL } from 'node:url';

import {
  instantiateVendor,
  readVendorDirectory,
  type BundleFailure,
  type LoadedBundle,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

import { IntegrationError, readProject, runtimeVersion, sourceModule } from '../project.js';

import { createFakeSdk, type FakeSdk, type FakeSdkOptions } from './fake-sdk.js';

/** What loading takes. */
export type LoadIntegrationOptions = {
  /** The repository's folder; the working directory when not said. */
  readonly root?: string;

  /** Which tree: the sources in `src/` (the default), or the build in `dist/`. */
  readonly from?: 'source' | 'build';

  /** The fake SDK the code is handed, or what to build one with; a new one when not said. */
  readonly sdk?: FakeSdk | FakeSdkOptions;
};

/** An integration, loaded. */
export type LoadedIntegration = {
  /** The vendor, as `hub` holds it: its drivers, its transports, its discovery. */
  readonly vendor: LoadedVendor;

  /** The drivers, and the `discovery.json`, that did not load: `hub` loads the rest without them. */
  readonly failures: readonly BundleFailure[];

  /** The SDK its code was handed, and what the code did with it. */
  readonly fake: FakeSdk;

  /**
   * One driver.
   *
   * @param driverId - Its folder's name.
   * @returns The driver.
   * @throws {Error} When it is not one that loaded.
   */
  driver: (driverId: string) => LoadedBundle;

  /**
   * Lets go of what the integration's code opened, as `hub` does when it lets go of a vendor.
   *
   * @returns Once it is let go of.
   */
  release: () => Promise<void>;
};

/**
 * Loads an integration as `hub` would.
 *
 * @param options - The repository, which tree, and the fake SDK.
 * @returns The vendor and its drivers, loaded.
 * @throws {IntegrationError} When the vendor does not load at all, with why.
 */
export async function loadIntegration(
  options: LoadIntegrationOptions = {},
): Promise<LoadedIntegration> {
  const project = await readProject(options.root ?? process.cwd());
  const isBuild = options.from === 'build';
  const fake =
    options.sdk !== undefined && 'sdk' in options.sdk ? options.sdk : createFakeSdk(options.sdk);
  let found: Awaited<ReturnType<typeof instantiateVendor>>;

  try {
    const declaration = await readVendorDirectory(
      isBuild ? project.outputDirectory : project.sourceDirectory,
      isBuild
        ? { expectedId: project.vendorId, runtimeVersion: runtimeVersion() }
        : {
            expectedId: project.vendorId,
            stamp: project.stamp,
            runtimeVersion: runtimeVersion(),
            resolveModule: sourceModule,
          },
    );

    found = await instantiateVendor(declaration, {
      sdk: fake.sdk,
      release: fake.release,
      origin: 'development',

      /**
       * Imports a module, as the test runner imports one: TypeScript too.
       *
       * @param file - The module.
       * @returns The module.
       */
      importModule: async (file: string): Promise<unknown> => import(pathToFileURL(file).href),
    });
  } catch (error: unknown) {
    await fake.release();

    throw new IntegrationError([error instanceof Error ? error.message : String(error)]);
  }

  const { vendor, failures } = found;

  if (vendor === null) {
    throw new IntegrationError(failures.map((failure) => failure.message));
  }

  return {
    vendor,
    failures,
    fake,

    /**
     * One driver.
     *
     * @param driverId - Its folder's name.
     * @returns The driver.
     * @throws {Error} When it did not load.
     */
    driver: (driverId) => {
      const driver = vendor.drivers.find((candidate) => candidate.driverId === driverId);

      if (driver === undefined) {
        throw new Error(
          `${vendor.manifest.id} has no driver ${driverId} that loaded; it has ${vendor.drivers.map((candidate) => candidate.driverId).join(', ')}`,
        );
      }

      return driver;
    },
    release: vendor.release,
  };
}
