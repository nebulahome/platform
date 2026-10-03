/**
 * What an integration's code modules default-export: a function of the {@link BundleSdk}.
 *
 * A module cannot import the platform - an installed bundle has no `node_modules` of the
 * platform's, and a zod of its own would validate under another instance than the one `hub`
 * checks against - so `hub` hands the pieces over when it loads the vendor, and the module's
 * default export is a function of them. These helpers only type that function: each returns what
 * it is given, and the build inlines it into the module.
 *
 * ```ts
 * import { defineTransportModule } from '@nebulahome/integration-sdk';
 *
 * export default defineTransportModule((sdk) =>
 *   sdk.defineTransport({ id: 'acme/lan', configSchema: sdk.z.object({ host: sdk.z.string() }), … }),
 * );
 * ```
 */
import type {
  AccountFactory,
  DiscoverySourceFactory,
  IntegrationFactory,
  StreamFactory,
  TransportFactory,
} from '@nebulahome/package-runtime';

/**
 * Types a transport module: `manifest.json`'s `transports`. The transport it builds must call
 * itself `<vendor>/<name>`, the name the manifest gives it.
 *
 * @param factory - Builds the transport from the SDK, with `sdk.defineTransport`.
 * @returns The factory, as the module's default export.
 */
export function defineTransportModule(factory: TransportFactory): TransportFactory {
  return factory;
}

/**
 * Types a code driver's module: `driver.json`'s `entry`, for a driver whose entities depend on
 * what the device says.
 *
 * @param factory - Builds the integration from the SDK.
 * @returns The factory, as the module's default export.
 */
export function defineDriverModule(factory: IntegrationFactory): IntegrationFactory {
  return factory;
}

/**
 * Types a discovery module: `discovery.json`'s `{ "module": "./lan/discovery.js" }`, a listener
 * of the vendor's own for a protocol the platform does not speak.
 *
 * @param factory - Builds what listens, from the SDK.
 * @returns The factory, as the module's default export.
 */
export function defineDiscoveryModule(factory: DiscoverySourceFactory): DiscoverySourceFactory {
  return factory;
}

/**
 * Types an account module: `account.json`'s `module`, which signs in to the account the
 * vendor's devices are reached through.
 *
 * @param factory - Builds the sign-in from the SDK, with `sdk.defineAccount`.
 * @returns The factory, as the module's default export.
 */
export function defineAccountModule(factory: AccountFactory): AccountFactory {
  return factory;
}

/**
 * Types a stream module: `manifest.json`'s `streams`, a camera's source. It must call itself
 * `<vendor>/<name>`.
 *
 * @param factory - Builds the source from the SDK, with `sdk.defineStreamSource`.
 * @returns The factory, as the module's default export.
 */
export function defineStreamModule(factory: StreamFactory): StreamFactory {
  return factory;
}
