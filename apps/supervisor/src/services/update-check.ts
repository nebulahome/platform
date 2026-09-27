/**
 * Whether a newer image is out for a container.
 *
 * Asked of the image's registry, never of Docker's own pull: a check must not download anything.
 * An image pinned to a release is offered the newest release of the same shape; one following a
 * tag such as `latest` is offered the image the tag points at now, when it is not the one the
 * machine has. An image pinned to a digest never changes, and is not asked about.
 */
import { isNebulaError } from '@nebula-home/contracts';

import { parseImageReference, type ImageReference } from '../domain/image-ref.js';
import { isPinnedTag, newestOfShape, shortDigest, versionOf } from '../domain/versions.js';
import type { RegistryClient } from '../registry/registry-client.js';

/** What a check found. */
export type UpdateFinding = {
  readonly installedVersion: string | null;
  readonly latestVersion: string | null;
  readonly isAvailable: boolean;

  /** The tag to pull to install it: another release, or the same tag again. */
  readonly targetTag: string | null;
  readonly error: string | null;

  /**
   * True when the registry does not have the image at all - it was built on this machine - so it
   * has no page there and nothing is ever on offer.
   */
  readonly isUnpublished: boolean;
};

/** What a check needs to know about the image a container runs. */
export type InstalledImage = {
  /** As the container names it: `nginx:1.27.3`. */
  readonly reference: string;
  readonly labels: Readonly<Record<string, string>>;

  /** `repo@sha256:…`, one per registry the image was pulled from. */
  readonly repoDigests: readonly string[];
};

/**
 * Checks one image.
 *
 * @param image - The image the container runs.
 * @param registry - The registry client.
 * @param tagsOf - Reads an image's tags, shared across one pass so an image run by several
 * containers is asked once.
 * @returns What was found; an unreachable registry is an error in the finding, not a throw.
 */
export async function checkImage(
  image: InstalledImage,
  registry: RegistryClient,
  tagsOf: (image: ImageReference) => Promise<string[]>,
): Promise<UpdateFinding> {
  const reference = parseImageReference(image.reference);
  const installedVersion =
    versionOf(image.labels, reference.tag) ??
    (image.repoDigests[0] === undefined ? null : shortDigest(image.repoDigests[0]));

  // An image with no digest was built on this machine, not pulled: no registry has it to ask.
  if (reference.digest !== null || image.repoDigests.length === 0) {
    return {
      installedVersion,
      latestVersion: null,
      isAvailable: false,
      targetTag: null,
      error: null,
      isUnpublished: image.repoDigests.length === 0,
    };
  }

  try {
    if (isPinnedTag(reference.tag)) {
      const newest = newestOfShape(reference.tag, await tagsOf(reference));
      const isAvailable = newest !== null && newest !== reference.tag;

      return {
        installedVersion,
        latestVersion: isAvailable ? newest : installedVersion,
        isAvailable,
        targetTag: isAvailable ? newest : null,
        error: null,
        isUnpublished: false,
      };
    }

    const remote = await registry.remote(reference);
    const isAvailable = !image.repoDigests.some((digest) => digest.endsWith(`@${remote.digest}`));

    // The same release built again - a base image patched under `2` - says the same version; the
    // offer names the build, or it would read as the version already installed.
    const offered =
      remote.version === null || remote.version === installedVersion
        ? `${remote.version === null ? '' : `${remote.version}+`}${shortDigest(remote.digest)}`
        : remote.version;

    return {
      installedVersion,
      latestVersion: isAvailable ? offered : installedVersion,
      isAvailable,
      targetTag: isAvailable ? reference.tag : null,
      error: null,
      isUnpublished: false,
    };
  } catch (error: unknown) {
    // Not in the registry at all: an image built here and never pushed, which Docker's own store
    // may still give a digest. Nothing is on offer, and nothing went wrong.
    const status = isNebulaError(error) ? error.details['status'] : undefined;

    if (status === 401 || status === 404) {
      return {
        installedVersion,
        latestVersion: null,
        isAvailable: false,
        targetTag: null,
        error: null,
        isUnpublished: true,
      };
    }

    return {
      installedVersion,
      latestVersion: null,
      isAvailable: false,
      targetTag: null,
      error:
        isNebulaError(error) || error instanceof Error
          ? error.message
          : 'The registry could not be asked',
      isUnpublished: false,
    };
  }
}
