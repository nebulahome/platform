/**
 * The containers an integration runs: how one is named, labelled, configured and found again.
 *
 * What the bundle declared reaches here with the vendor's settings already put in (by `hub`), and
 * what is left in braces is the platform's: how the container reaches the platform's broker, and
 * the time zone. Only the supervisor knows how the container it makes reaches the rest - on the
 * bridge by the platform container's name, on the host network by its loopback, in development by
 * Docker's name for the machine - so it fills those in here.
 *
 * Where a volume lives is never the bundle's to say: under `containers/<id>/<volume>` of the data
 * directory, so a backup takes it, or under the cache for one the bundle marks as such.
 *
 * Everything the supervisor needs to find a container again is on it, as labels: which vendor
 * runs it, which of its containers it is, and a hash of what it was made from. A container whose
 * hash differs from its declaration's is made again; one that matches is left running.
 *
 * And which installation made it: a development platform and the all-in-one container may share
 * one Docker, each with a supervisor that would otherwise make the other's `nebulahome-<vendor>`
 * again - its broker, its network - every time it looked. A container another installation made
 * is left to it.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

import { CACHE_DIRECTORY, CONTAINERS_DIRECTORY } from '@nebula-home/config';
import type {
  JsonObject,
  ManagedContainerSpec,
  ManagedVolume,
  PlatformNetworkMode,
} from '@nebula-home/contracts';

/** The labels a managed container carries. */
export const MANAGED_LABELS = {
  managed: 'io.nebulahome.managed',
  vendor: 'io.nebulahome.vendor',
  dependency: 'io.nebulahome.dependency',
  spec: 'io.nebulahome.spec',
  minVersion: 'io.nebulahome.min-version',
  installation: 'io.nebulahome.installation',
} as const;

/** The labels the network the managed containers share carries. */
export const NETWORK_LABELS = { [MANAGED_LABELS.managed]: 'true' } as const;

/** How the platform's own data directory reaches Docker, so a volume can be put inside it. */
export type DataMount =
  /** A named volume - the compose file's `nebula-data` - mounted in part, by `Subpath`. */
  | { readonly kind: 'volume'; readonly volume: string }
  /** A folder of the host: bound in part. The path is the host's. */
  | { readonly kind: 'bind'; readonly hostPath: string }
  /** Neither can be used - an engine too old for `Subpath` - so each volume is a volume. */
  | { readonly kind: 'separate' };

/** What the platform looks like to the containers it makes. */
export type PlatformContext = {
  readonly network: PlatformNetworkMode;

  /** Which installation this is, labelled on every container it makes. */
  readonly installationId: string;

  /** The network the managed containers share, on a bridge or in development. */
  readonly networkName: string;

  /** The name the platform's container has on it. */
  readonly platformAlias: string;

  /** The broker, as the platform's own services reach it; null when there is none. */
  readonly mqtt: {
    readonly url: string;
    readonly username: string | undefined;
    readonly password: string | undefined;
  } | null;
  readonly timezone: string;
  readonly dataMount: DataMount;
};

/**
 * Whether another installation made a managed container, which this one then leaves alone.
 *
 * @param labels - The container's labels.
 * @param installationId - This installation.
 * @returns True for one labelled with another installation; false for this one's, and for one
 *   made before containers were labelled with it, which is taken as this one's.
 */
export function isAnotherInstallations(
  labels: Readonly<Record<string, string>>,
  installationId: string,
): boolean {
  const made = labels[MANAGED_LABELS.installation];

  return made !== undefined && made !== installationId;
}

/**
 * The name of the container that is one of a vendor's declared containers.
 *
 * @param spec - The declaration.
 * @returns `nebulahome-<vendor>`, or `nebulahome-<vendor>-<id>` when the id is not the vendor's.
 */
export function managedName(spec: Pick<ManagedContainerSpec, 'vendorId' | 'dependencyId'>): string {
  return spec.dependencyId === spec.vendorId
    ? `nebulahome-${spec.vendorId}`
    : `nebulahome-${spec.vendorId}-${spec.dependencyId}`;
}

/**
 * The broker's address as a container the platform makes reaches it.
 *
 * @param context - The platform.
 * @returns The URL, or an empty string when there is no broker.
 */
function brokerUrlFor(context: PlatformContext): string {
  if (context.mqtt === null) {
    return '';
  }

  const url = new URL(context.mqtt.url);

  // On the host network a container shares the platform's loopback; on a bridge it reaches the
  // platform's container by its name; a platform that is not in a container is the machine,
  // which Docker names host.docker.internal.
  url.hostname =
    context.network === 'host'
      ? url.hostname
      : context.network === 'bridge'
        ? context.platformAlias
        : 'host.docker.internal';

  return url.href.replace(/\/$/, '');
}

/**
 * What the platform's placeholders stand for.
 *
 * @param context - The platform.
 * @returns Each placeholder's value.
 */
export function platformValues(context: PlatformContext): Readonly<Record<string, string>> {
  return {
    'platform.mqtt.url': brokerUrlFor(context),
    'platform.mqtt.username': context.mqtt?.username ?? '',
    'platform.mqtt.password': context.mqtt?.password ?? '',
    'platform.timezone': context.timezone,
  };
}

/**
 * Puts the platform's values in place of their placeholders. A placeholder that is not the
 * platform's is left as it is: `hub` put in the vendor's, and a brace in a value is text.
 *
 * @param value - The text.
 * @param values - What each placeholder stands for.
 * @returns The text, filled in.
 */
export function fillPlaceholders(value: string, values: Readonly<Record<string, string>>): string {
  return value.replaceAll(/\{(platform\.[a-z.]+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * The folder of the data directory one volume lives in, relative to the directory.
 *
 * @param spec - Its container.
 * @param volume - The volume.
 * @returns `containers/<id>/<name>`, or `cache/containers/<id>/<name>`.
 */
export function volumeFolder(
  spec: Pick<ManagedContainerSpec, 'dependencyId'>,
  volume: ManagedVolume,
): string {
  const folder = path.posix.join(CONTAINERS_DIRECTORY, spec.dependencyId, volume.name);

  return volume.isCache ? path.posix.join(CACHE_DIRECTORY, folder) : folder;
}

/**
 * How a folder of the data directory is mounted into a container.
 *
 * @param folder - The folder, relative to the data directory.
 * @param target - Where the container sees it.
 * @param dataMount - How the data directory reaches Docker.
 * @param separateName - The volume it is instead, where the data directory cannot be mounted in
 * part.
 * @param isReadOnly - Whether the container may only read it.
 * @returns The entry of `HostConfig.Mounts`.
 */
export function folderMount(
  folder: string,
  target: string,
  dataMount: DataMount,
  separateName: string,
  isReadOnly = false,
): JsonObject {
  const readOnly = isReadOnly ? { ReadOnly: true } : {};

  switch (dataMount.kind) {
    case 'volume': {
      return {
        Type: 'volume',
        Source: dataMount.volume,
        Target: target,
        VolumeOptions: { Subpath: folder },
        ...readOnly,
      };
    }

    case 'bind': {
      return {
        Type: 'bind',
        Source: `${dataMount.hostPath.replace(/[/\\]+$/, '')}/${folder}`,
        Target: target,
        ...readOnly,
      };
    }

    case 'separate': {
      return { Type: 'volume', Source: separateName, Target: target, ...readOnly };
    }
  }
}

/**
 * How one volume is mounted.
 *
 * @param spec - Its container.
 * @param volume - The volume.
 * @param dataMount - How the data directory reaches Docker.
 * @returns The entry of `HostConfig.Mounts`.
 */
function mountOf(
  spec: ManagedContainerSpec,
  volume: ManagedVolume,
  dataMount: DataMount,
): JsonObject {
  return folderMount(
    volumeFolder(spec, volume),
    volume.path,
    dataMount,
    `${managedName(spec)}-${volume.name}`,
  );
}

/**
 * The body of `POST /containers/create` for a declared container.
 *
 * @param spec - The declaration, the vendor's settings in it.
 * @param tag - The release to run.
 * @param context - The platform.
 * @returns The body, and the hash it carries.
 */
export function managedCreateBody(
  spec: ManagedContainerSpec,
  tag: string,
  context: PlatformContext,
): { readonly body: JsonObject; readonly hash: string } {
  const values = platformValues(context);
  const env = spec.env.map((entry) => `${entry.name}=${fillPlaceholders(entry.value, values)}`);
  const isHost = context.network === 'host';
  const hash = specHash(spec, env, context);

  const body: JsonObject = {
    Image: `${spec.image}:${tag}`,
    Env: env,
    Labels: {
      [MANAGED_LABELS.managed]: 'true',
      [MANAGED_LABELS.vendor]: spec.vendorId,
      [MANAGED_LABELS.dependency]: spec.dependencyId,
      [MANAGED_LABELS.spec]: hash,
      [MANAGED_LABELS.minVersion]: spec.minVersion,
      [MANAGED_LABELS.installation]: context.installationId,
    },
    ExposedPorts: Object.fromEntries(
      spec.ports.map((port) => [`${String(port.container)}/${port.protocol}`, {}]),
    ),
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Mounts: spec.volumes.map((volume) => mountOf(spec, volume, context.dataMount)),
      Devices: spec.devices.map((device) => ({
        PathOnHost: device.host,
        PathInContainer: device.container,
        CgroupPermissions: 'rwm',
      })),
      NetworkMode: isHost ? 'host' : context.networkName,
      ...(isHost
        ? {}
        : {
            PortBindings: Object.fromEntries(
              spec.ports.map((port) => [
                `${String(port.container)}/${port.protocol}`,
                [{ HostPort: String(port.host) }],
              ]),
            ),
          }),
      ...(context.network === 'native'
        ? { ExtraHosts: ['host.docker.internal:host-gateway'] }
        : {}),
    },
    ...(isHost
      ? {}
      : {
          NetworkingConfig: {
            EndpointsConfig: { [context.networkName]: { Aliases: [spec.dependencyId] } },
          },
        }),
  };

  return { body, hash };
}

/**
 * The hash of what a container was made from: when it differs from its declaration's, the
 * container is made again.
 *
 * The release is not in it - a container is upgraded when its version falls below the minimum,
 * not whenever the newest release moves - and the password is, because a container still holding
 * the old one could not reach the broker.
 *
 * @param spec - The declaration.
 * @param env - Its environment, filled in.
 * @param context - The platform.
 * @returns A short hex hash.
 */
function specHash(
  spec: ManagedContainerSpec,
  env: readonly string[],
  context: PlatformContext,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        image: spec.image,
        env,
        volumes: spec.volumes,
        devices: spec.devices,
        ports: spec.ports,
        network: context.network,
        dataMount: context.dataMount,
        installation: context.installationId,
      }),
    )
    .digest('hex')
    .slice(0, 16);
}
