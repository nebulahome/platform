# @nebulahome/integration-sdk

The SDK's version is the version of the integration contract the platform implements: a minor
version adds to the contract, a major one breaks it, and a patch leaves it as it is.

## 1.4.0

The house's Modbus client is the platform's.

- The platform runs the house's Modbus TCP client in the hub, the way it runs the MQTT broker:
  one connection per server, one request at a time, shared by everything in the hub that speaks
  Modbus - over MBAP, or RTU frames a transparent RS485 adapter carries over TCP.
- A driver may run on the platform's `modbus` transport with `"kind": "modbus"` and a `template`:
  the platform reads the device through the template - each entity's capabilities mapped to the
  register it is read from (functions 01-04) and the command it is written with (05, 06, 15, 16) -
  with neither a profile nor code. The template is the one the owner writes on the Brokers page,
  and the integration's show there, read-only, for the owner to duplicate.
- `discovery.json` may say which of the Modbus servers the network search finds are the vendor's,
  in a `modbus` block: the values to read - registers, as a template reads them - and conditions on
  `values.<name>`; `listen` may then be left out. The platform recognises no server on its own.
- `sdk.openModbus({ host, port, framing })` opens a session through the hub's one connection to a
  server, for a transport of the vendor's own: its requests wait their turn with the platform's,
  so a gateway that takes one client at a time is never asked twice at once.
- `identifyModbus(vendor, identity)` in `@nebulahome/integration-sdk/testing` says whether the
  vendor's `modbus` rules take a server, and `schemas/modbus-template.schema.json` checks a
  template in the editor.

## 1.3.0

The house's MQTT broker is the platform's.

- The platform runs the house's MQTT broker in the hub, the way it runs the Matter fabric:
  `requires: { "services": ["mqtt-broker"] }` is always met, and `sdk.platform.mqtt` is the hub's
  own username on it.
- A driver may run on the platform's `mqtt-house` transport with `"kind": "mqtt"`: the platform's
  MQTT mapping is its driver, with neither a profile nor code, for the devices that announce
  themselves on the broker the way the MQTT discovery convention says, and those the owner maps
  by hand.
- `discovery.json` may say which of those devices are the vendor's, in an `mqtt` block of
  conditions on who each says it is - `manufacturer`, `model`, `originName` and the rest; `listen`
  may then be left out.
- `identifyMqtt(vendor, identity)` in `@nebulahome/integration-sdk/testing` says whether the
  vendor's `mqtt` rules take such a device, and as which driver and model.

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
