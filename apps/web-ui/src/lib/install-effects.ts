/**
 * What installing a package or an integration does, worked out from what the platform knows
 * before anything is downloaded - the plan, the release's requirements, what the Community Hub
 * says its drivers speak - for the "What installing does" list of the install dialogs.
 *
 * Each line is a fact the data carries. Nothing here is a promise the platform cannot keep: an
 * integration whose transports the Hub does not know says nothing about them.
 */
import {
  PLATFORM_SERVICES,
  type HubDetail,
  type IntegrationListing,
  type PackageListing,
} from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

/** One thing installing does. */
export type InstallEffect = {
  /** The glyph in its well. */
  readonly icon: UiIconId;

  /** What it does, in a few words. */
  readonly title: string;

  /** One line of what that means. */
  readonly note: string;

  /** Whether it deserves attention: code that runs inside the house. */
  readonly tone?: 'neutral' | 'warning';
};

/** What each transport a driver speaks is called, as a person recognises it. */
const TRANSPORT_NAMES: Readonly<Record<string, string>> = {
  http: 'HTTP',
  mqtt: 'MQTT',
  ble: 'Bluetooth LE',
  zigbee: 'Zigbee',
  udp: 'UDP',
  modbus: 'Modbus TCP',
  websocket: 'WebSocket',
  rtsp: 'RTSP',
};

/**
 * Names joined as a sentence lists them: `A`, `A and B`, `A, B and C`.
 *
 * @param names - The names.
 * @returns The list.
 */
export function listed(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join('');
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * What a platform service is called.
 *
 * @param name - The service: `mqtt-broker`.
 * @returns Its label: `MQTT broker`; the name itself for one the platform does not know.
 */
function serviceLabel(name: string): string {
  return PLATFORM_SERVICES.find((service) => service.name === name)?.label ?? name;
}

/**
 * What a transport is called.
 *
 * @param transport - The transport, as a driver names it.
 * @returns Its name: `HTTP`.
 */
export function transportName(transport: string): string {
  return TRANSPORT_NAMES[transport] ?? transport.toUpperCase();
}

/**
 * What installing a package does.
 *
 * @param listing - The package, as the search found it.
 * @param others - The names of the packages the plan installs with it, which it needs.
 * @returns The lines, in the order they happen.
 */
export function packageEffects(
  listing: PackageListing,
  others: readonly string[],
): InstallEffect[] {
  const effects: InstallEffect[] = [];
  const requires = listing.latest?.requires.services ?? [];
  const provides = listing.latest?.provides ?? [];

  if (others.length > 0) {
    effects.push({
      icon: 'package',
      title: `Also installs ${listed(others)}`,
      note: 'It needs it, so it goes in first.',
    });
  }

  for (const service of requires.filter((name) => !provides.includes(name))) {
    effects.push({
      icon: 'network',
      title: `Uses the ${serviceLabel(service)}`,
      note: 'Whatever provides it in the house is shared with it.',
    });
  }

  for (const service of provides) {
    effects.push({
      icon: 'server',
      title: `Provides the ${serviceLabel(service)}`,
      note: 'Integrations and other packages can use it once it runs.',
    });
  }

  effects.push({
    icon: 'power',
    title: 'Starts at once',
    note: 'Nothing else restarts.',
  });

  return effects;
}

/**
 * What installing an integration does.
 *
 * @param listing - The integration, as the search found it.
 * @param detail - What the Hub says of it beyond the row; undefined while it is read, or for a
 *   local file the Hub does not list.
 * @returns The lines, in the order they matter.
 */
export function integrationEffects(
  listing: IntegrationListing,
  detail: HubDetail | undefined,
): InstallEffect[] {
  const effects: InstallEffect[] = [];
  const internetRequired = listing.internetRequired ?? detail?.internetRequired ?? null;
  const transports = (detail?.transports ?? []).map(transportName);
  const requires = listing.latest?.requires;
  const bundleKind = listing.latest?.bundleKind ?? detail?.bundleKind ?? null;

  if (transports.length > 0 || internetRequired !== null) {
    effects.push({
      icon: internetRequired === true ? 'globe' : 'cable',
      title:
        transports.length === 0
          ? internetRequired === true
            ? 'Reaches its devices through the internet'
            : 'Reaches its devices on your network'
          : `Talks to its devices over ${listed(transports)}`,
      note:
        internetRequired === true
          ? "Through the vendor's cloud: it stops working when the internet does."
          : 'On your network. Nothing leaves the house.',
    });
  }

  for (const service of requires?.services ?? []) {
    effects.push({
      icon: 'network',
      title: `Needs the ${serviceLabel(service)}`,
      note: 'Its devices wait until the house has one running.',
    });
  }

  for (const packageId of Object.keys(requires?.packages ?? {})) {
    effects.push({
      icon: 'package',
      title: `Needs the ${packageId} package`,
      note: 'Install it from Packages; its devices wait until it runs.',
    });
  }

  if (bundleKind === 'code') {
    effects.push({
      icon: 'triangle-alert',
      tone: 'warning',
      title: 'Contains code',
      note: listing.isOfficial
        ? "It runs inside Nebula Home. The Community Hub's team publishes it."
        : 'It runs inside Nebula Home, and nobody has reviewed it. Install it only if you trust who publishes it.',
    });
  } else if (bundleKind === 'declarative') {
    effects.push({
      icon: 'package',
      title: 'Nothing else to install',
      note: 'Profiles only: it runs inside Nebula Home, with no code of its own.',
    });
  }

  effects.push({
    icon: 'radio-tower',
    title: 'Then add its devices',
    note: 'From its page, once it is installed.',
  });

  return effects;
}

/** What the install dialog offers for an integration, at its foot. */
export type IntegrationAction =
  | { readonly kind: 'install'; readonly label: string }
  | { readonly kind: 'update'; readonly label: string; readonly version: string }
  | { readonly kind: 'reinstall'; readonly label: string }
  | { readonly kind: 'open'; readonly label: string };

/**
 * What the install dialog offers for an integration: to install it, update it, reinstall a
 * rebuild of it - or, when it is installed and current, to open its page.
 *
 * @param listing - The integration, as the search found it.
 * @returns The action, and the words on its button.
 */
export function integrationActionOf(listing: IntegrationListing): IntegrationAction {
  if (listing.installedVersion === null) {
    return { kind: 'install', label: `Install ${listing.name}` };
  }

  if (listing.hasUpdate && listing.latest !== null) {
    return {
      kind: 'update',
      label: `Update to ${listing.latest.version}`,
      version: listing.latest.version,
    };
  }

  if (listing.hasNewBuild) {
    return { kind: 'reinstall', label: 'Reinstall' };
  }

  return { kind: 'open', label: 'Open' };
}

/**
 * Says whether installing an integration asks the owner to trust it first: code nobody reviewed.
 *
 * @param listing - The integration.
 * @returns True for a bundle with code that the Hub's team does not publish.
 */
export function needsTrust(listing: IntegrationListing): boolean {
  return listing.latest?.bundleKind === 'code' && !listing.isOfficial;
}
