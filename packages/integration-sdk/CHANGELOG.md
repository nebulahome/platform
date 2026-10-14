# @nebulahome/integration-sdk

The SDK's version is the version of the integration contract the platform implements: a minor
version adds to the contract, a major one breaks it, and a patch leaves it as it is.

## 1.0.0

The first public release.

- `nebulahome-integration validate`, `build` and `pack`: check `src/` the way the hub reads a
  bundle, build it into `dist/<vendor>/` with its code bundled and the manifest's `version` and
  `sdk` written in, and pack it into the `<vendor>-<version>.tgz` a GitHub release carries.
- `defineTransportModule`, `defineDriverModule`, `defineDiscoveryModule`, `defineAccountModule`
  and `defineStreamModule`, which type a bundle's modules, and the types of the contract they are
  written against.
- `@nebulahome/integration-sdk/testing`: `loadIntegration`, `driverHarness`, `identify` and
  `createFakeSdk`, to test a bundle as the hub runs it.
- `@nebulahome/integration-sdk/schemas/*`: the JSON schemas of `manifest.json`, `driver.json`,
  `setup.json`, `profile.json`, `discovery.json` and `account.json`.
