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
 *
 * Nothing here may import zod either: a module validates with `sdk.z`, and the build refuses a
 * module that brings its own. So what validates - the infrared codec - is handed over on the SDK
 * (`sdk.codecs.infrared`), and only names that import nothing are exported as values.
 */

export {
  defineAccountModule,
  defineDiscoveryModule,
  defineDriverModule,
  defineStreamModule,
  defineTransportModule,
} from './modules.js';

// The ops the hub sends a device playing a broker's role, and the `bluetooth` transport's GATT ops.
export { BLUETOOTH_GATT_OPS, BLUETOOTH_PROXY_OPS, INFRARED_OPS } from '@nebulahome/contracts';

// The SDK the hub hands a module.
export type {
  BluetoothScanner,
  BluetoothScannerOptions,
  BundleBluetooth,
  BundleCodecs,
  BundleImages,
  BundleLogFn,
  BundleLogger,
  BundleSdk,
  InfraredCodec,
  IntegrationFactory,
  ManagedMqtt,
  ManagedMqttOptions,
  ManagedSocket,
  ManagedSocketClose,
  ManagedSocketHeaders,
  ManagedSocketOptions,
  ManagedUdpSocket,
  ManagedUdpSocketOptions,
  OpenMqtt,
  OpenSerial,
  OpenUdpSocket,
  OpenWebSocket,
  PalettedPicture,
  PaletteColour,
  PlatformMqtt,
  PlatformServices,
  SerialSession,
  StreamFactory,
  TransportFactory,
  UdpPeer,
} from '@nebulahome/package-runtime';

// A serial port's line, a Bluetooth advertisement, an infrared code, the roles a profile declares
// and what the reserved ops carry.
export type {
  BluetoothAdvert,
  BluetoothAdvertInput,
  BluetoothProxyFilterArgs,
  BluetoothProxyInstallArgs,
  BluetoothProxyProfile,
  BluetoothProxyState,
  BluetoothScanMode,
  InfraredCode,
  InfraredLearnArgs,
  InfraredProfile,
  InfraredProtocol,
  InfraredProtocolName,
  InfraredSendArgs,
  InfraredSignal,
  InfraredSweepArgs,
  InfraredSweepResult,
  SerialDeviceConfig,
  SerialLine,
  SerialLineInput,
} from '@nebulahome/contracts';
export type {
  BluetoothSighting,
  FlipperIrCode,
  FlipperIrFile,
  InfraredImportProblem,
  SerialSighting,
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
