# @nebulahome/integration-sdk

The SDK's version is the version of the integration contract the platform implements: a minor
version adds to the contract, a major one breaks it, and a patch leaves it as it is.

## 1.2.0

One device reached two ways.

- The manifest may say what makes two of the vendor's devices one, `"twins": ["mac"]` (or
  `["mac", "serial"]`): a device added over the vendor's own transport and again through the
  Matter broker is then offered to the owner to link, and becomes one device with two ways in.
- A profile's `identity` and `discovery.json`'s `identity` take `mac` and `serialNumber`, written
  any way the device writes them; `discovery.json`'s `identity` also takes `auth`, where the device
  says it is behind a password, which its row on the Found tab shows.
- An entity of a profile may carry `link`: its key in the transport's terms (`"switch:0"`), shown
  beside the transport's name, and where the same reading sits in Matter
  (`{ "endpoint": 1, "cluster": 6, "attribute": 0 }`), which links the two at once when the device
  is linked.

## 1.1.0

Matter, and a wider grammar for conditions.

- A driver may run on the platform's `matter` transport with `"kind": "matter"`: the platform's
  Matter mapping is its driver, with neither a profile nor code.
- `discovery.json` may say which of the house's Matter devices are the vendor's, in a `matter`
  block of conditions on who each device says it is; `listen` may then be left out.
- Conditions, in claims and in `discovery.json`, take `endsWith`, `contains` (a part of a text, or
  an item of a list) and `min` / `max` (a number in a range) beside `equals`, `exists`, `oneOf`
  and `startsWith`.
- `identifyMatter(vendor, identity)` in `@nebulahome/integration-sdk/testing` says whether the
  vendor's `matter` rules take a Matter device, and as which driver and model.

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
