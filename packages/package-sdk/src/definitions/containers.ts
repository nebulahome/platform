/**
 * `defineContainer` and `defineCompose`: what a package runs beside or instead of its process
 * (PACKAGES_DOCS.md 4.7, 4.8). The supervisor runs them on the platform's network, keeps them up,
 * and removes them with the package.
 */

/** A value one of the package's settings gives: `{setup.webPort}`. */
export type SettingPlaceholder = `{setup.${string}}`;

/** An entry kept only while one of the settings holds one of the values. */
export type When = {
  readonly key: string;
  readonly equals: readonly (string | boolean)[];
};

/** A port: a number, or one of the settings. */
export type ContainerPort = number | SettingPlaceholder;

/** How far a container must have come before one that depends on it starts. */
export type ContainerCondition = 'started' | 'healthy';

/** A container, as declared. */
export type ContainerDefinition<TId extends string = string> = {
  readonly kind: 'container';

  /** Names the container and its folder: `^[a-z][a-z0-9-]{1,31}$`. */
  readonly id: TId;

  readonly name: string;

  /** The image, without a tag: `koenkk/zigbee2mqtt`, `ghcr.io/owner/app`. */
  readonly image: string;

  /** The oldest release it works with: the newest of that major is installed. */
  readonly minVersion: string;

  /** Paths inside the container; where they live is the platform's, in its data directory. */
  readonly volumes?: readonly {
    readonly name: string;
    readonly path: string;

    /** Left out of backups: what can be made again. */
    readonly isCache?: boolean;
  }[];

  /** Its environment; `{setup.x}` and `{platform.…}` are filled in. */
  readonly env?: Readonly<Record<string, string | { readonly value: string; readonly when: When }>>;

  /** Devices of the host it is given, under `/dev`. */
  readonly devices?: readonly {
    readonly host: string;
    readonly container: string;
    readonly when?: When;
  }[];

  /** Ports published when the platform is on a bridge network. */
  readonly ports?: readonly {
    readonly container: ContainerPort;
    readonly host: ContainerPort;
    readonly protocol?: 'tcp' | 'udp';
    readonly when?: When;
  }[];

  /** Files written into a volume once, when missing. */
  readonly seed?: readonly {
    readonly volume: string;
    readonly path: string;
    readonly content: string;
  }[];

  /** The topics it uses on the house's broker, which a username of its own is held to. */
  readonly mqttTopics?: readonly string[];

  /** The port of its own web page, which the interface links to. */
  readonly webPort?: ContainerPort;

  readonly webPortWhen?: When;

  /** The command, instead of the image's: each argument on its own. */
  readonly command?: readonly string[];

  /** How the platform knows it is ready: `test` is `CMD …` or `CMD-SHELL …`. */
  readonly healthcheck?: {
    readonly test: readonly string[];
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly retries?: number;
    readonly startPeriodMs?: number;
  };

  /** Containers of the same package it starts after, and how far each must have come. */
  readonly dependsOn?: Readonly<Record<string, ContainerCondition>>;
};

/** A compose file, as declared. */
export type ComposeDefinition = {
  readonly kind: 'compose';

  /** The file, next to the config: `./compose.yaml`. */
  readonly file: string;
};

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares a container the package runs.
 *
 * @param container - Its image, release, volumes, environment and the rest.
 * @returns The container, for `definePackage`'s `containers`.
 */
export function defineContainer<const TId extends string>(
  container: Omit<ContainerDefinition<TId>, 'kind'>,
): ContainerDefinition<TId> {
  return { ...container, kind: 'container' };
}

/* @__NO_SIDE_EFFECTS__ */
/**
 * Declares a compose file the package runs instead of declared containers.
 *
 * @param compose - Where the file is.
 * @returns The compose file, for `definePackage`'s `compose`.
 */
export function defineCompose(compose: Omit<ComposeDefinition, 'kind'>): ComposeDefinition {
  return { ...compose, kind: 'compose' };
}
