# pkg-mqtt (parked)

The house's MQTT broker, `platform/pkgs/mqtt` until 2026-10-02. It is parked here, outside the
workspace, while the package SDK is rewritten into `@nebulahome/package-sdk`: its code is unchanged,
but nothing builds, tests, ships or runs it.

While it is parked:

- `pnpm-workspace.yaml` does not reach it (`pkgs/*` is empty), so turbo, the image and
  packet-manager's builtin folder do not see it either.
- An installation that ran it keeps its row in `system.packages`: packet-manager leaves a system
  package the image no longer ships as it is, and does not start it.
- The house has no MQTT broker. The hub and the supervisor ask `svc.mqtt.credentials` and carry on
  without an answer; Zigbee2MQTT's instances wait with "needs a package that provides
  mqtt-broker".

To bring it back, migrate it to `@nebulahome/package-sdk` - a `nebula.config.ts` in place of
`nebula.package.json` and `setup.json`, `defineServer` in place of `definePackage`, the interface on
`@nebulahome/package-sdk/ui` - and move it back to `platform/pkgs/mqtt`. See `PACKAGES_DOCS.md`.
