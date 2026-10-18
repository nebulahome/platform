# @nebulahome/integration-sdk

The SDK's version is the version of the integration contract the platform implements: a minor
version adds to the contract, a major one breaks it, and a patch leaves it as it is.

## 1.1.0

Matter, and a wider grammar for conditions.

- A driver may run on the platform's `matter` transport with `"kind": "matter"`: the platform's
  Matter mapping is its driver, with neither a profile nor code.
- `discovery.json` may say which of the house's Matter devices are the vendor's, in a `matter`
  block of conditions on who each device says it is; `listen` may then be left out.
- Conditions, in claims and in `discovery.json`, take `endsWith`, `contains` (a part of a text, or
  an item of a list) and `min` / `max` (a number in a range) beside `equals`, `exists`, `oneOf`
  and `startsWith`.

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
