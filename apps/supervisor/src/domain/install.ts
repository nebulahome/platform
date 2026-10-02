/**
 * A container the owner installs from the containers page: what Docker is asked to make.
 *
 * What the form says - the image, the ports, the environment, the folders, how it restarts, which
 * network it joins - becomes the body of `POST /containers/create`. A folder kept "in NebulaHome's
 * data" lives under `containers/installed/<name>/<folder>` of the data directory, mounted the way
 * an integration's container's volumes are, so a backup takes it; a Docker volume or a folder of
 * the machine is mounted as it is named.
 */
import path from 'node:path';

import { CONTAINERS_DIRECTORY, INSTALLED_CONTAINERS_DIRECTORY } from '@nebulahome/config';
import {
  INSTALLED_LABEL,
  type ContainerInstallRequest,
  type InstallVolume,
  type JsonObject,
} from '@nebulahome/contracts';

import { folderMount, type PlatformContext } from './managed.js';

/** How many times a container that fails is started again, under `on-failure`. */
const ON_FAILURE_RETRIES = 5;

/**
 * The folder of the data directory one of an installed container's folders lives in.
 *
 * @param name - The container.
 * @param folder - The folder's name.
 * @returns `containers/installed/<name>/<folder>`, relative to the data directory.
 */
export function installedFolder(name: string, folder: string): string {
  return path.posix.join(CONTAINERS_DIRECTORY, INSTALLED_CONTAINERS_DIRECTORY, name, folder);
}

/**
 * How one folder is mounted.
 *
 * @param name - The container.
 * @param volume - The folder.
 * @param context - The platform.
 * @returns The entry of `HostConfig.Mounts`.
 */
function mountOf(name: string, volume: InstallVolume, context: PlatformContext): JsonObject {
  const readOnly = volume.isReadOnly ? { ReadOnly: true } : {};

  switch (volume.kind) {
    case 'data': {
      return folderMount(
        installedFolder(name, volume.name),
        volume.target,
        context.dataMount,
        `${name}-${volume.name}`,
        volume.isReadOnly,
      );
    }

    case 'volume': {
      return { Type: 'volume', Source: volume.name, Target: volume.target, ...readOnly };
    }

    case 'bind': {
      return { Type: 'bind', Source: volume.source, Target: volume.target, ...readOnly };
    }
  }
}

/**
 * The body of `POST /containers/create` for a container the owner installs.
 *
 * @param request - What the form said.
 * @param context - The platform: the network the platform shares, and how its data reaches Docker.
 * @returns The body.
 */
export function installCreateBody(
  request: ContainerInstallRequest,
  context: PlatformContext,
): JsonObject {
  const isHost = request.network === 'host';
  const networkMode =
    request.network === 'platform'
      ? context.networkName
      : request.network === 'host'
        ? 'host'
        : 'bridge';

  return {
    Image: `${request.image}:${request.tag}`,
    Env: request.env.map((entry) => `${entry.name}=${entry.value}`),
    Labels: { [INSTALLED_LABEL]: 'true' },
    ExposedPorts: Object.fromEntries(
      request.ports.map((port) => [`${String(port.container)}/${port.protocol}`, {}]),
    ),
    HostConfig: {
      RestartPolicy:
        request.restartPolicy === 'on-failure'
          ? { Name: 'on-failure', MaximumRetryCount: ON_FAILURE_RETRIES }
          : { Name: request.restartPolicy },
      Mounts: request.volumes.map((volume) => mountOf(request.name, volume, context)),
      Devices: request.devices.map((device) => ({
        PathOnHost: device.host,
        PathInContainer: device.container,
        CgroupPermissions: 'rwm',
      })),
      NetworkMode: networkMode,
      ...(isHost
        ? {}
        : {
            PortBindings: Object.fromEntries(
              request.ports.map((port) => [
                `${String(port.container)}/${port.protocol}`,
                [{ HostPort: String(port.host) }],
              ]),
            ),
          }),
    },
    ...(request.network === 'platform'
      ? {
          NetworkingConfig: {
            EndpointsConfig: { [context.networkName]: { Aliases: [request.name] } },
          },
        }
      : {}),
  };
}

/**
 * The host ports a request asks for that another container already publishes.
 *
 * @param request - What the form said.
 * @param published - Every `port/protocol` another container publishes on the machine.
 * @returns The taken ones, as `port/protocol`.
 */
export function takenPorts(
  request: Pick<ContainerInstallRequest, 'ports' | 'network'>,
  published: ReadonlySet<string>,
): string[] {
  if (request.network === 'host') {
    return [];
  }

  return request.ports
    .map((port) => `${String(port.host)}/${port.protocol}`)
    .filter((port) => published.has(port));
}
