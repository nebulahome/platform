/**
 * `@nebulahome/integration-sdk`: what an integration's own code is written against.
 *
 * An integration is a vendor directory the hub loads - `manifest.json`, a `driver.json` per
 * driver with its `setup.json` and its `profile.json` or code - and the code is a set of modules,
 * each default-exporting a function of the SDK the hub hands over (INTEGRATIONS_DOCS.md 5). This
 * entry point is the contract's types and the helpers that type those functions; it reads no file
 * and holds no state, because the build inlines what a module imports from it.
 *
 * The rest of the SDK: `@nebulahome/integration-sdk/testing` for tests, the
 * `nebulahome-integration` command to check, build and pack a release, and
 * `@nebulahome/integration-sdk/schemas/*.schema.json` for the editor.
 */

export {
  defineAccountModule,
  defineDiscoveryModule,
  defineDriverModule,
  defineStreamModule,
  defineTransportModule,
} from './modules.js';

// The SDK the hub hands a module.
export type {
  BundleCodecs,
  BundleImages,
  BundleLogFn,
  BundleLogger,
  BundleSdk,
  IntegrationFactory,
  ManagedMqtt,
  ManagedMqttOptions,
  ManagedSocket,
  ManagedSocketOptions,
  ManagedUdpSocket,
  ManagedUdpSocketOptions,
  OpenMqtt,
  OpenUdpSocket,
  OpenWebSocket,
  PalettedPicture,
  PaletteColour,
  PlatformMqtt,
  PlatformServices,
  StreamFactory,
  TransportFactory,
  UdpPeer,
} from '@nebulahome/package-runtime';

// A transport: where every I/O of an integration happens.
export type {
  Discovered,
  Transport,
  TransportConnection,
  TransportContext,
  TransportInbound,
  TransportLookContext,
  TransportRequest,
  TransportSpec,
  TransportStatus,
  TransportSubscription,
} from '@nebulahome/package-runtime';

// An integration: what a device means, pure throughout.
export type {
  Claim,
  CommandTarget,
  DeviceDescriptor,
  DeviceInfo,
  EntityDescriptor,
  ImageBlob,
  Integration,
  MappingContext,
  ReportedState,
  StreamRequest,
} from '@nebulahome/package-runtime';

// Discovery: a listener of the vendor's own.
export type {
  DiscoveryListenContext,
  DiscoverySource,
  DiscoverySourceFactory,
  ListenerStatus,
  MdnsAnnouncement,
  PassedOverSighting,
  Sighting,
} from '@nebulahome/package-runtime';

// An account the vendor's devices are reached through.
export type {
  AccountFactory,
  AccountHandle,
  AccountIdentity,
  AccountModule,
  AccountModuleStep,
  AccountStepContext,
} from '@nebulahome/package-runtime';

// A camera's stream.
export type {
  OpenRtsp,
  RtspFrame,
  RtspOptions,
  StreamFrame,
  StreamSink,
  StreamSource,
  StreamSourceSpec,
  StreamTrack,
} from '@nebulahome/package-runtime';
