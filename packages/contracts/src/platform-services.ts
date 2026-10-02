/**
 * The platform services: what the platform itself needs from a package (PACKAGES.md 2).
 *
 * Some of what the house runs is not the platform's own but a package's: the MQTT broker every
 * MQTT integration meets on, later a Matter controller. Each is a *platform service* named
 * `<protocol>-broker`. A package that `provides` the name is the house's broker for that protocol,
 * and the platform asks it what it needs over the bus, on `svc.<package>.<method>`. Which package
 * that is gets looked up, never assumed: the one that provides the service, a running one first and
 * then the service's default, so that another package may stand in for the default one.
 *
 * A service the house must always have is kept by the packet-manager: when no installed package
 * provides it, it installs the newest release of the default package that fits - from a local
 * file or the index - and it refuses to remove or stop the last package that provides it. A broker
 * the environment names (`NEBULA_MQTT_URL`) stands in for the service, and nothing is installed.
 */
import { z } from 'zod';

/** A platform service's name: `<protocol>-broker`. */
export const platformServiceNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*-broker$/, 'Must be <protocol>-broker');

/** One platform service. */
export type PlatformService = {
  /** Its name, as a package `provides` it. */
  readonly name: string;

  /** What it is, for a sentence that names it: "MQTT broker". */
  readonly label: string;

  /** The package installed when nothing provides it. */
  readonly defaultPackage: string;

  /** Whether the house must always have one. */
  readonly isRequired: boolean;

  /** The bus methods the platform calls on whichever package provides it. */
  readonly methods: readonly string[];
};

/** The house's MQTT broker. */
export const MQTT_BROKER_SERVICE = 'mqtt-broker';

/** What the platform asks the MQTT broker: a username of its own, for the hub or a container. */
export const MQTT_CREDENTIALS_METHOD = 'credentials';

/** Every platform service. */
export const PLATFORM_SERVICES: readonly PlatformService[] = [
  {
    name: MQTT_BROKER_SERVICE,
    label: 'MQTT broker',
    defaultPackage: 'mqtt',
    isRequired: true,
    methods: [MQTT_CREDENTIALS_METHOD],
  },
];

/** `mqtt-broker`'s `credentials`: who asks for a username, and for which topics. */
export const mqttCredentialsRequestSchema = z.discriminatedUnion('principal', [
  z.strictObject({ principal: z.literal('hub') }),
  z.strictObject({
    principal: z.literal('container'),

    /** Whose container: `vendor:zigbee2mqtt`, `package:nvr`. */
    owner: z.string().regex(/^(vendor|package):[a-z][a-z0-9-]{1,63}$/),

    /** The topics it may use; every topic when not said. */
    topics: z.array(z.string().min(1).max(256)).max(16).optional(),
  }),
]);

/** Who asks the MQTT broker for a username. */
export type MqttCredentialsRequest = z.output<typeof mqttCredentialsRequestSchema>;

/** What the MQTT broker answers: the username, its password, and the port it listens on. */
export const mqttCredentialsReplySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  port: z.int().min(1).max(65_535),
});

/** What the MQTT broker answers. */
export type MqttCredentialsReply = z.output<typeof mqttCredentialsReplySchema>;

/** A package as the services are looked up among: what it provides, and whether it runs. */
export type ServiceProvider = {
  readonly id: string;
  readonly provides: readonly string[];
  readonly isRunning: boolean;
};

/**
 * The platform service of a name.
 *
 * @param name - The name.
 * @returns The service, or undefined when the platform asks nothing of it.
 */
export function platformServiceOf(name: string): PlatformService | undefined {
  return PLATFORM_SERVICES.find((service) => service.name === name);
}

/**
 * The package that provides a service: a running one first, then the service's default, then by
 * id - so that the answer is the same every time it is asked.
 *
 * @param service - The service.
 * @param packages - The installed packages.
 * @returns The package's id, or undefined when none provides it.
 */
export function providerOf(
  service: string,
  packages: readonly ServiceProvider[],
): string | undefined {
  const defaultPackage = platformServiceOf(service)?.defaultPackage;

  /**
   * How far down the list a package goes: running before not, the default before the others.
   *
   * @param provider - The package.
   * @returns Its rank, lowest first.
   */
  const rankOf = (provider: ServiceProvider): number =>
    (provider.isRunning ? 0 : 2) + (provider.id === defaultPackage ? 0 : 1);

  return packages
    .filter((provider) => provider.provides.includes(service))
    .sort((left, right) => rankOf(left) - rankOf(right) || left.id.localeCompare(right.id))[0]?.id;
}

/**
 * The services the house must have that a package is the only one to provide: removing or
 * stopping it would leave the house without them.
 *
 * @param packageId - The package.
 * @param packages - The installed packages.
 * @returns The services.
 */
export function servicesHeldBy(
  packageId: string,
  packages: readonly Pick<ServiceProvider, 'id' | 'provides'>[],
): PlatformService[] {
  const held = packages.find((provider) => provider.id === packageId);

  return PLATFORM_SERVICES.filter(
    (service) =>
      service.isRequired &&
      held?.provides.includes(service.name) === true &&
      !packages.some(
        (provider) => provider.id !== packageId && provider.provides.includes(service.name),
      ),
  );
}

/**
 * The services the house must have and that no installed package provides.
 *
 * @param packages - The installed packages.
 * @param external - The services something outside the platform stands in for.
 * @returns The services.
 */
export function missingServices(
  packages: readonly Pick<ServiceProvider, 'provides'>[],
  external: ReadonlySet<string>,
): PlatformService[] {
  return PLATFORM_SERVICES.filter(
    (service) =>
      service.isRequired &&
      !external.has(service.name) &&
      !packages.some((provider) => provider.provides.includes(service.name)),
  );
}
