/**
 * `@nebulahome/integration-sdk/testing`: an integration under test, loaded and driven the way
 * `hub` loads and drives it (INTEGRATIONS_DOCS.md 9).
 *
 * - {@link loadIntegration} reads the sources - or the build - with the hub's own loader and
 *   hands the code a fake SDK;
 * - {@link driverHarness} claims, describes, maps what a device sends and builds commands;
 * - {@link identify} says what discovery makes of a device heard;
 * - {@link identifyMatter} says what it makes of one of the house's Matter devices;
 * - {@link identifyMqtt} says what it makes of a device the house's MQTT broker hears;
 * - {@link createFakeSdk} is the SDK a test hands a module, recording what it logged and sent.
 */

export {
  createFakeSdk,
  type FakeSdk,
  type FakeSdkOptions,
  type FakeUdpSocket,
  type FakeWebSocket,
  type LogLevel,
  type LogRecord,
  type SentDatagram,
} from './fake-sdk.js';
export {
  driverHarness,
  type DriverHarness,
  type DriverHarnessOptions,
  type HarnessDevice,
} from './harness.js';
export {
  identify,
  identifyMatter,
  identifyModbus,
  identifyMqtt,
  type Identification,
  type MatterIdentification,
  type ModbusIdentification,
  type MqttIdentification,
} from './identify.js';
export { loadIntegration, type LoadedIntegration, type LoadIntegrationOptions } from './load.js';
export { IntegrationError } from '../project.js';

export type {
  Association,
  BundleFailure,
  LoadedAccount,
  LoadedBundle,
  LoadedDiscovery,
  LoadedListenSource,
  LoadedVendor,
  SightingIdentity,
} from '@nebulahome/package-runtime';
