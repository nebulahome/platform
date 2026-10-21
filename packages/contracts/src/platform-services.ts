/**
 * The platform services: what a package or an integration may count on the platform for
 * (PACKAGES.md 2).
 *
 * Some of what a device needs is a whole protocol's - the MQTT broker every MQTT integration
 * meets on - and the platform runs it itself, in `hub`, the way it runs the Matter fabric. Such a
 * service has a name, `<protocol>-broker`, which a manifest's `requires.services` names: it is
 * always there, so a requirement on it is always met. No package can stand in for one - a package
 * that `provides` it is refused at install - since every integration must be able to count on the
 * one the platform runs.
 */

/** One service the platform runs itself. */
export type PlatformService = {
  /** Its name, as a manifest's `requires.services` names it. */
  readonly name: string;

  /** What it is, for a sentence that names it: "MQTT broker". */
  readonly label: string;
};

/** The house's MQTT broker. */
export const MQTT_BROKER_SERVICE = 'mqtt-broker';

/** Every platform service. */
export const PLATFORM_SERVICES: readonly PlatformService[] = [
  { name: MQTT_BROKER_SERVICE, label: 'MQTT broker' },
];

/**
 * Whether the platform runs a service itself.
 *
 * @param name - The service's name.
 * @returns True for one of the {@link PLATFORM_SERVICES}.
 */
export function isPlatformService(name: string): boolean {
  return PLATFORM_SERVICES.some((service) => service.name === name);
}
