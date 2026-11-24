/**
 * Removing an image no container uses, against an engine the test holds: one in use is left, its
 * names go one by one, one without a name goes by its id, and a refusal is only logged.
 */
import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';

import { removeUnusedImage } from './unused-image.js';

/**
 * An engine with some containers and one image, recording each removal.
 *
 * @param running - The image ids the containers run, stopped ones included.
 * @param tags - The image's names.
 * @returns The engine, the removals and the logger.
 */
function engineWith(running: readonly string[], tags: readonly string[]) {
  const removed: string[] = [];
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as PlatformLogger;
  const engine = {
    listContainers: vi.fn(async () =>
      Promise.resolve(running.map((image, index) => ({ Id: `c${String(index)}`, ImageID: image }))),
    ),
    inspectImage: vi.fn(async (id: string) => Promise.resolve({ Id: id, RepoTags: [...tags] })),
    removeImage: vi.fn(async (reference: string) => {
      removed.push(reference);

      return Promise.resolve();
    }),
  } as unknown as Pick<DockerEngine, 'listContainers' | 'inspectImage' | 'removeImage'>;

  return { engine, removed, logger };
}

describe('removeUnusedImage', () => {
  it('removes each name of an image nothing uses', async () => {
    const { engine, removed, logger } = engineWith(['sha256:new'], ['app:1.0', 'app:stable']);

    await removeUnusedImage(engine, 'sha256:old', logger);

    expect(removed).toEqual(['app:1.0', 'app:stable']);
  });

  it('removes an image without a name by its id', async () => {
    const { engine, removed, logger } = engineWith([], []);

    await removeUnusedImage(engine, 'sha256:old', logger);

    expect(removed).toEqual(['sha256:old']);
  });

  it('leaves an image a container uses: the new one on the same image, or a stopped one', async () => {
    const { engine, removed, logger } = engineWith(['sha256:same'], ['app:1.0']);

    await removeUnusedImage(engine, 'sha256:same', logger);

    expect(removed).toEqual([]);
  });

  it('does nothing without an image', async () => {
    const { engine, logger } = engineWith([], []);

    await removeUnusedImage(engine, undefined, logger);
    await removeUnusedImage(engine, '', logger);

    expect(engine.listContainers).not.toHaveBeenCalled();
  });

  it('only logs what Docker refuses', async () => {
    const { engine, logger } = engineWith([], ['app:1.0']);

    vi.mocked(engine.removeImage).mockRejectedValueOnce(new ConflictError('in use'));

    await expect(removeUnusedImage(engine, 'sha256:old', logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
