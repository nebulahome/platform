/**
 * An image reference - `koenkk/zigbee2mqtt:2.14.1`, `ghcr.io/owner/app@sha256:…`, `nginx` - taken
 * apart the way Docker takes it apart.
 *
 * The first part is a registry only when it looks like a host: it has a dot or a port, or it is
 * `localhost`. Otherwise the whole name is on Docker Hub, and a name without a slash is one of
 * its official images, under `library/`.
 */

/** Docker Hub, as a reference names it and as its API is reached. */
export const DOCKER_HUB = 'docker.io';

/** An image reference, taken apart. */
export type ImageReference = {
  /** The registry's host: `docker.io`, `ghcr.io`. */
  readonly registry: string;

  /** The repository in it: `koenkk/zigbee2mqtt`, `library/nginx`. */
  readonly repository: string;

  /** The tag, `latest` when none was written. */
  readonly tag: string;

  /** The digest, when the reference pins one. */
  readonly digest: string | null;
};

/**
 * Takes a reference apart.
 *
 * @param reference - As a container names its image.
 * @returns The parts.
 */
export function parseImageReference(reference: string): ImageReference {
  const at = reference.indexOf('@');
  const named = at === -1 ? reference : reference.slice(0, at);
  const digest = at === -1 ? null : reference.slice(at + 1);

  // A colon after the last slash is a tag; one before it is a registry's port.
  const slash = named.lastIndexOf('/');
  const colon = named.lastIndexOf(':');
  const hasTag = colon > slash;
  const name = hasTag ? named.slice(0, colon) : named;
  const tag = hasTag ? named.slice(colon + 1) : 'latest';

  const first = name.split('/')[0] ?? '';
  const isRegistry =
    name.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  const registry = isRegistry ? first : DOCKER_HUB;
  const path = isRegistry ? name.slice(first.length + 1) : name;
  const repository = registry === DOCKER_HUB && !path.includes('/') ? `library/${path}` : path;

  return { registry, repository, tag, digest };
}

/**
 * The image without its tag, as a pull names it.
 *
 * @param reference - The parts.
 * @returns `koenkk/zigbee2mqtt`, `ghcr.io/owner/app`, `nginx`.
 */
export function imageName(reference: ImageReference): string {
  const path =
    reference.registry === DOCKER_HUB && reference.repository.startsWith('library/')
      ? reference.repository.slice('library/'.length)
      : reference.repository;

  return reference.registry === DOCKER_HUB ? path : `${reference.registry}/${path}`;
}

/**
 * The image's page on its registry, for a person to read: Docker Hub's, GitHub's, Quay's.
 *
 * @param reference - The parts.
 * @returns The page, or null for a registry with no page people read.
 */
export function registryPageOf(reference: ImageReference): string | null {
  if (reference.registry === DOCKER_HUB) {
    return reference.repository.startsWith('library/')
      ? `https://hub.docker.com/_/${reference.repository.slice('library/'.length)}`
      : `https://hub.docker.com/r/${reference.repository}`;
  }

  // ghcr.io sends a browser on to the package's page on GitHub.
  if (reference.registry === 'ghcr.io') {
    return `https://ghcr.io/${reference.repository}`;
  }

  if (reference.registry === 'quay.io') {
    return `https://quay.io/repository/${reference.repository}`;
  }

  return null;
}
