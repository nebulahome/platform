/**
 * The configuration a container is created again with, on a newer image.
 *
 * Docker cannot change a container's image: an update is a new container made like the old one.
 * Its inspect answer is what it was made with - but merged with what its image set, so copying it
 * whole would pin the old image's defaults onto the new one: its `PATH`, its version variable,
 * its command, its labels. So whatever is the same as the old image's is left out, and the new
 * image brings its own; what the owner set - a variable, a command, a label of their own - stays.
 *
 * The host's side - ports, volumes, devices, restart policy, limits - is the owner's entirely and
 * is copied as it is. The networks beyond the first are joined after the container is made, as
 * `docker network connect` would.
 */
import type { JsonObject } from '@nebula-home/contracts';

import type { InspectedContainer, InspectedImage } from '../docker/engine-schemas.js';

/** One network the new container joins after it is made. */
export type ExtraNetwork = { readonly name: string; readonly aliases: readonly string[] };

/** What the new container is made with. */
export type RecreatePlan = {
  /** The body of `POST /containers/create`. */
  readonly body: JsonObject;

  /** The networks it joins afterwards. */
  readonly networks: ExtraNetwork[];
};

/**
 * Whether two lists hold the same strings in the same order.
 *
 * @param left - One.
 * @param right - The other.
 * @returns True when they are equal.
 */
function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * The aliases the owner gave a container on a network, without the ones Docker added itself.
 *
 * @param aliases - What the inspect answer lists.
 * @param container - The old container: Docker adds its short id and its host name.
 * @returns The owner's aliases.
 */
function ownAliases(aliases: readonly string[], container: InspectedContainer): string[] {
  const shortId = container.Id.slice(0, 12);

  return aliases.filter((alias) => alias !== shortId && alias !== container.Config.Hostname);
}

/**
 * The host's side of the container, with its anonymous volumes named.
 *
 * A volume the image declares and nobody named - PostgreSQL's data - is mounted by Docker under a
 * random name that only the old container knows. Left out, the new container would get an empty
 * one, and the data would stay behind with the container being removed. So every volume the old
 * container has is mounted into the new one by name, unless the owner's own binds already mount
 * something there.
 *
 * @param container - The old container.
 * @returns Its host configuration, with those volumes added.
 */
function withAnonymousVolumes(container: InspectedContainer): JsonObject {
  const host = { ...(container.HostConfig as JsonObject) };
  const binds = Array.isArray(host['Binds']) ? (host['Binds'] as string[]) : [];
  const mounts = Array.isArray(host['Mounts']) ? (host['Mounts'] as JsonObject[]) : [];
  const covered = new Set([
    ...binds.map((bind) => bind.split(':')[1] ?? ''),
    ...mounts.map((mount) => (typeof mount['Target'] === 'string' ? mount['Target'] : '')),
  ]);
  const kept = container.Mounts.filter(
    (mount) =>
      mount.Type === 'volume' && mount.Name !== undefined && !covered.has(mount.Destination),
  ).map((mount) => ({
    Type: 'volume',
    Source: mount.Name ?? '',
    Target: mount.Destination,
    ReadOnly: mount.RW === false,
  }));

  if (kept.length > 0) {
    host['Mounts'] = [...mounts, ...kept];
  }

  return host;
}

/**
 * Plans the new container.
 *
 * @param container - The old container, inspected whole.
 * @param oldImage - The image it ran, inspected: its defaults are what is left out.
 * @param newImage - The reference the new container runs.
 * @returns The body and the networks to join.
 */
export function planRecreate(
  container: InspectedContainer,
  oldImage: InspectedImage | undefined,
  newImage: string,
): RecreatePlan {
  const config = container.Config;
  const defaults = oldImage?.Config;
  const imageEnv = new Set(defaults?.Env ?? []);
  const imageLabels = defaults?.Labels ?? {};
  const body: JsonObject = { ...(container.Config as JsonObject) };

  body['Image'] = newImage;
  body['Env'] = config.Env.filter((entry) => !imageEnv.has(entry));
  body['Labels'] = Object.fromEntries(
    Object.entries(config.Labels).filter(([key, value]) => imageLabels[key] !== value),
  );

  if (defaults !== null && defaults !== undefined) {
    if (sameList(config.Cmd, defaults.Cmd)) {
      delete body['Cmd'];
    }

    if (sameList(config.Entrypoint, defaults.Entrypoint)) {
      delete body['Entrypoint'];
    }

    if (config.WorkingDir === defaults.WorkingDir) {
      delete body['WorkingDir'];
    }

    if (config.User === defaults.User) {
      delete body['User'];
    }
  }

  // A host name Docker made up is the old container's short id, which the new one does not have.
  if (config.Hostname === container.Id.slice(0, 12)) {
    delete body['Hostname'];
  }

  // Docker lists the image's own volumes and ports in the container's configuration; the new
  // image declares its own.
  delete body['Volumes'];
  delete body['ExposedPorts'];

  body['HostConfig'] = withAnonymousVolumes(container);

  const mode = container.HostConfig.NetworkMode ?? 'default';
  const attached = Object.entries(container.NetworkSettings.Networks);
  const primary = attached.find(([name]) => name === mode);

  if (primary !== undefined) {
    body['NetworkingConfig'] = {
      EndpointsConfig: {
        [primary[0]]: { Aliases: ownAliases(primary[1].Aliases, container) },
      },
    };
  }

  const networks = attached
    .filter(([name]) => name !== mode && !mode.startsWith('container:'))
    .map(([name, endpoint]) => ({ name, aliases: ownAliases(endpoint.Aliases, container) }));

  return { body, networks };
}
