/**
 * Removing the image a container ran on once it no longer runs on it - after an update made it
 * again on a newer one, or after it was removed - so the disk does not keep every version it ever
 * ran.
 *
 * Only an image no container uses, stopped ones included: Docker would refuse their image anyway,
 * and they may be started again. Its names are removed one by one, never with `force`, because
 * Docker refuses an id more than one name holds; the last name takes the image with it, and one
 * with no name left is removed by its id. Not `docker image prune`: that would take images the
 * platform never pulled, and keep the old ones still tagged with their version.
 *
 * Never a failure of what it follows: an image Docker refuses to remove is logged and left - it is
 * clutter, not an update that did not happen.
 */
import type { PlatformLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';

/**
 * Removes an image when no container uses it any more.
 *
 * @param engine - The engine.
 * @param imageId - The image's id, as a container's inspect or list answer gives it; nothing is
 *   done without one.
 * @param logger - Where what was removed, or why not, is said.
 * @returns Once it is removed, or left.
 */
export async function removeUnusedImage(
  engine: Pick<DockerEngine, 'listContainers' | 'inspectImage' | 'removeImage'>,
  imageId: string | undefined,
  logger: PlatformLogger,
): Promise<void> {
  if (imageId === undefined || imageId === '') {
    return;
  }

  try {
    if ((await engine.listContainers()).some((container) => container.ImageID === imageId)) {
      return;
    }

    const image = await engine.inspectImage(imageId);

    if (image === undefined) {
      return;
    }

    for (const tag of image.RepoTags) {
      // eslint-disable-next-line no-await-in-loop -- one name after another: the last takes the image
      await engine.removeImage(tag);
    }

    if (image.RepoTags.length === 0) {
      await engine.removeImage(image.Id);
    }

    logger.info({ image: imageId, tags: image.RepoTags }, 'Removed an image nothing uses any more');
  } catch (error: unknown) {
    logger.warn({ err: error, image: imageId }, 'Could not remove an image nothing uses any more');
  }
}
