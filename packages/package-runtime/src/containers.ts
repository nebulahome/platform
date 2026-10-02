/**
 * The containers a vendor's devices depend on, as its `manifest.json` declares them.
 *
 * Zigbee reaches the platform through zigbee2mqtt, which is not a library but a program with a
 * database of its own; the vendor that speaks it cannot work until that program runs. So a vendor
 * may declare containers - an image on a registry, the oldest release it works with, what the
 * container is given - and the platform downloads and runs them once the vendor is set up. The
 * supervisor does the running (ARCHITECTURE.md 4.10); this file is the declaration's grammar and
 * the step that fills the vendor's settings in.
 *
 * What a declaration may say is narrow on purpose. It names the path **inside** the container of
 * each volume and never a path of the host: where the data lives is the platform's to choose, in
 * its data directory, so a backup takes it. The only paths of the host are the devices, which
 * come from what the owner typed, and must be under `/dev`.
 *
 * Values are text with `{setup.<key>}` where one of the vendor's settings goes, and
 * `{platform.…}` where the platform's go (the broker's address, the time zone), which the
 * supervisor fills in. An entry may carry `when`, the grammar of a setup field's `shownWhen`: it
 * applies only while a choice of the vendor's settings holds one of the values.
 *
 * A variable whose value is one setting and nothing else - `{setup.channel}` - is left out while
 * the owner has not set it, rather than handed over empty: the program then keeps its own default,
 * or what its own configuration file says, where `NAME=` would have overridden it with nothing.
 */
import { type z } from 'zod';

import {
  containerDependenciesSchema,
  containerDependencySchema,
  type containerWhenSchema,
  HOST_DEVICE_PATTERN,
  WHOLE_SETTING_PATTERN,
  type ContainerDependency,
  type IntegrationSetup,
  type ManagedContainerSpec,
} from '@nebulahome/contracts';

export { containerDependenciesSchema, containerDependencySchema, type ContainerDependency };

/** A value that is one setting and nothing else, for a number that comes from the settings. */
const WHOLE_SETTING = WHOLE_SETTING_PATTERN;

/** A path of the host a device may be: under `/dev`, nothing that climbs out of it. */
const DEVICE_PATH = HOST_DEVICE_PATTERN;

/** A vendor setting a value is filled from: `{setup.serialPath}`. */
const SETTING_PLACEHOLDER = /\{setup\.([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** The saved settings of a vendor, both groups together, as the declaration reads them. */
export type VendorValues = Readonly<Record<string, unknown>>;

/**
 * Every setting a declaration reads: its `when` keys and its placeholders.
 *
 * @param dep - One declared container.
 * @returns The keys.
 */
function settingsRead(dep: ContainerDependency): Set<string> {
  const keys = new Set<string>();
  const texts: string[] = [
    ...dep.env.map((entry) => entry.value),
    ...dep.devices.map((device) => device.host),
    ...dep.ports.flatMap((port) => [String(port.container), String(port.host)]),
    ...(dep.webPort === undefined ? [] : [String(dep.webPort)]),
  ];

  for (const text of texts) {
    for (const match of text.matchAll(SETTING_PLACEHOLDER)) {
      keys.add(match[1] ?? '');
    }
  }

  const conditions = [
    ...dep.env.map((entry) => entry.when),
    ...dep.devices.map((device) => device.when),
    ...dep.ports.map((port) => port.when),
    dep.webPortWhen,
  ];

  for (const condition of conditions) {
    if (condition !== undefined) {
      keys.add(condition.key);
    }
  }

  return keys;
}

/**
 * Checks a vendor's declared containers against its own settings, once, at load: every setting
 * a declaration reads must be one the vendor's `setup.json` asks.
 *
 * @param deps - The declared containers.
 * @param setup - The vendor's own setup, or undefined for a vendor with none.
 * @returns What is wrong, one sentence each; empty when nothing is.
 */
export function containerDependencyProblems(
  deps: readonly ContainerDependency[],
  setup: IntegrationSetup | undefined,
): string[] {
  const asked = new Set(
    [...(setup?.transport.fields ?? []), ...(setup?.options.fields ?? [])].map(
      (field) => field.key,
    ),
  );
  return deps.flatMap((dep) => [
    ...[...settingsRead(dep)]
      .filter((key) => !asked.has(key))
      .map(
        (key) => `${dep.id} reads the setting ${key}, which the vendor's setup.json does not ask`,
      ),
    ...dep.seed
      .filter((seed) => !dep.volumes.some((volume) => volume.name === seed.volume))
      .map((seed) => `${dep.id} seeds ${seed.path} into ${seed.volume}, which it does not declare`),
  ]);
}

/**
 * Whether an entry applies with these settings.
 *
 * @param when - The entry's condition, if any.
 * @param values - The vendor's settings.
 * @returns True without a condition, or when the setting holds one of the values.
 */
function applies(
  when: z.output<typeof containerWhenSchema> | undefined,
  values: VendorValues,
): boolean {
  if (when === undefined) {
    return true;
  }

  const value = values[when.key];

  return when.equals.some((wanted) => wanted === value);
}

/**
 * Puts the vendor's settings in place of their placeholders.
 *
 * @param text - The text.
 * @param values - The settings.
 * @returns The text, filled in; a setting with no value is an empty string.
 */
function fillSettings(text: string, values: VendorValues): string {
  return text.replaceAll(SETTING_PLACEHOLDER, (whole, key: string) => {
    const value = values[key];

    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  });
}

/**
 * Whether a value is one setting and nothing else, and that setting has no value.
 *
 * @param text - The value as declared.
 * @param values - The settings.
 * @returns True for `{setup.channel}` while the channel is not set.
 */
function isUnsetSetting(text: string, values: VendorValues): boolean {
  const whole = WHOLE_SETTING.exec(text);

  if (whole === null) {
    return false;
  }

  const value = values[whole[1] ?? ''];

  return value === undefined || value === null || value === '';
}

/**
 * A port, filled in.
 *
 * @param port - A number, or a setting.
 * @param values - The settings.
 * @returns The number.
 * @throws {Error} When the setting is not a port.
 */
function portOf(port: number | string, values: VendorValues): number {
  const value = typeof port === 'number' ? port : Number(fillSettings(port, values));

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${String(port)} is not a port`);
  }

  return value;
}

/**
 * What the supervisor is handed for a vendor, or a package: each declaration with the owner's
 * settings put in, the entries whose condition does not hold left out.
 *
 * @param vendorId - The vendor, or the package.
 * @param deps - Its declared containers.
 * @param values - Its saved settings, secrets opened.
 * @param ownerKind - Which of the two declares them.
 * @returns One spec per container.
 * @throws {Error} When a device is not under `/dev` once filled in, or a port is not a port.
 */
export function renderContainers(
  vendorId: string,
  deps: readonly ContainerDependency[],
  values: VendorValues,
  ownerKind: ManagedContainerSpec['ownerKind'] = 'vendor',
): ManagedContainerSpec[] {
  return deps.map((dep) => {
    const devices = dep.devices
      .filter((device) => applies(device.when, values))
      .map((device) => ({ host: fillSettings(device.host, values), container: device.container }));

    for (const device of devices) {
      if (!DEVICE_PATH.test(device.host) || device.host.split('/').includes('..')) {
        throw new Error(
          `${dep.id} would be given ${device.host}, which is not a device under /dev`,
        );
      }
    }

    const webPort =
      dep.webPort !== undefined && applies(dep.webPortWhen, values)
        ? portOf(dep.webPort, values)
        : null;

    return {
      ownerKind,
      vendorId,
      dependencyId: dep.id,
      name: dep.name,
      image: dep.image,
      minVersion: dep.minVersion,
      env: dep.env
        .filter((entry) => applies(entry.when, values) && !isUnsetSetting(entry.value, values))
        .map((entry) => ({ name: entry.name, value: fillSettings(entry.value, values) })),
      volumes: dep.volumes.map((volume) => ({
        name: volume.name,
        path: volume.path,
        isCache: volume.cache,
      })),
      devices,
      ports: dep.ports
        .filter((port) => applies(port.when, values))
        .map((port) => ({
          container: portOf(port.container, values),
          host: portOf(port.host, values),
          protocol: port.protocol,
        })),
      seed: dep.seed.map((seed) => ({ ...seed, content: fillSettings(seed.content, values) })),
      webPort,
      ...(dep.mqttTopics === undefined ? {} : { mqttTopics: [...dep.mqttTopics] }),
      ...(dep.command === undefined
        ? {}
        : { command: dep.command.map((argument) => fillSettings(argument, values)) }),
      ...(dep.healthcheck === undefined
        ? {}
        : { healthcheck: { ...dep.healthcheck, test: [...dep.healthcheck.test] } }),
      ...(dep.dependsOn === undefined ? {} : { dependsOn: { ...dep.dependsOn } }),
    };
  });
}
