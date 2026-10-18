# @nebulahome/integration-sdk

Write a NebulaHome integration: check it, build it, test it and release it for the platform.

An integration teaches the platform a brand of devices. It is a **vendor directory** - the same
files the hub loads - in a repository of its own, `integration-<vendor>`, started from
[`integration-template`](https://github.com/nebulahome/integration-template), which already
depends on this package; anywhere else:

```sh
npm install --save-dev @nebulahome/integration-sdk
```

```
integration-acme/
├── package.json         the release's version
├── src/                 the vendor directory, as the hub loads it
│   ├── manifest.json    who the vendor is
│   ├── logo.svg
│   ├── discovery.json   how its devices are found         (optional)
│   ├── lan/transport.ts a transport of its own, in TypeScript (optional)
│   └── panels/          one folder per driver
│       ├── driver.json  the models it drives, the transport it speaks
│       ├── setup.json   what adding a device asks
│       └── profile.json what the device means           (or a module of code)
└── tests/
```

Every JSON file names its schema, so the editor checks it as it is typed:

```json
{ "$schema": "../node_modules/@nebulahome/integration-sdk/schemas/manifest.schema.json" }
```

`FILES.md`, beside this file, says what each of them holds in full - discovery, accounts, setup
forms, the profile's grammar and its limits, firmware updates, cameras and pictures.

## The command

```sh
nebulahome-integration validate   # src/ holds together, the way the hub reads a bundle
nebulahome-integration build      # validate, build src/ into dist/<vendor>/, load it back
nebulahome-integration pack       # dist/<vendor>/ into <vendor>-<version>.tgz
```

`validate` runs the hub's own loader over `src/`. `build` copies every file but code - the JSON
without its `$schema`, the manifest with `version` (from `package.json`) and `sdk` (this SDK's
range) written in - and builds every module the bundle names, where it names it, in one go:
`./lan/transport.js` from `src/lan/transport.ts`, what they import bundled in, zod refused (a
module uses `sdk.z`). `pack` writes the archive a GitHub release carries.

## Code

A module default-exports a function of the SDK the hub hands over; the helpers only type it:

```ts
import { defineTransportModule } from '@nebulahome/integration-sdk';

export default defineTransportModule((sdk) =>
  sdk.defineTransport({
    id: 'acme/lan',
    configSchema: sdk.z.object({ host: sdk.z.string() }),
    connectionKey: (config) => config.host,
    connect: async (config, context) => {
      /* … */
    },
    async *scan() {},
  }),
);
```

`defineDriverModule`, `defineDiscoveryModule`, `defineAccountModule` and `defineStreamModule`
type the other modules the same way.

## Tests

```ts
import { driverHarness, loadIntegration } from '@nebulahome/integration-sdk/testing';

const integration = await loadIntegration(); // src/, as the hub loads it
const light = driverHarness(integration.driver('panels'));

light.add({ deviceKey: '192.168.1.40', payload: infoJson });
light.receive(stateJson); // → state reports
light.command('light.device', 'on_off', { command: 'turn_on' }); // → the HTTP request
```

`identify` says what discovery makes of a device heard, `identifyMatter` what the vendor's `matter`
rules make of one of the house's Matter devices, and `createFakeSdk` is the SDK handed to
the code, recording what it logged and sent: its UDP sockets and WebSockets connect to nothing, and
a test opens, delivers to and drops them.

## Releasing

Raise `version` in `package.json` and push the tag `v<version>`: the template's workflow
validates, tests, builds, packs and publishes a GitHub release with `<vendor>-<version>.tgz`, which
the Community Hub imports from the repository `integration-<vendor>`. To try a build on a running
platform before it is released, copy the archive into the platform's local folder
(`infra/local-integrations`) and install it from **Integrations → Install integration**.

The SDK's version is the version of the integration contract the platform implements; a bundle
built with it declares `^<major>.<minor>.0`. The full guide is `INTEGRATIONS_DOCS.md`.

## Releasing the SDK

For the platform's maintainers. The hub reads the contract's version from this `package.json`, so
the version is raised by hand:

- **patch** - a fix, or a change to the command, the tests' helpers or the documentation that
  leaves what a bundle can use as it is. Bundles keep declaring `^<major>.<minor>.0`, so it is
  released whenever it is ready.
- **minor** - the contract grows. Raise it in the first commit that grows it, so a bundle using
  the new part is never loaded by a platform without it; release it with the platform that
  implements it.
- **major** - the contract breaks: bundles built before are refused until they are built again.

Every change of the release goes into `CHANGELOG.md`. Then, from the commit released:

```sh
git tag integration-sdk@<version> && git push origin integration-sdk@<version>
```

`.github/workflows/release-integration-sdk.yml` checks the tag says the package's version, runs the
SDK's gates and publishes a GitHub release with the archive npm will receive. The maintainer
publishes that archive, signed in to npm:

```sh
npm publish nebulahome-integration-sdk-<version>.tgz
```
