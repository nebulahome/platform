/**
 * The named volumes of the containers the platform makes, copied out for a backup and written
 * back by a restore.
 *
 * Docker keeps a volume where only it reaches, so each is read and written through a container
 * that mounts it - one made of the platform's own image for the copy, removed after it. Docker's
 * archive API reads a container's folders as a tar, a volume it mounts among them, and writes a
 * tar into them, while the container is stopped: so it is never started to read. Before a volume
 * is written back it is emptied, by that container run once, so what was made since the archive
 * does not stay mixed with what the archive holds - a database's files from two moments are no
 * database.
 *
 * Beside the tars, `volumes.json` keeps each volume's labels: a restore makes a missing one with
 * them, so a compose project takes it as its own again.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { z } from 'zod';

import {
  PLATFORM_LABEL,
  UpstreamError,
  volumeNameSchema,
  type VolumesExportReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { InspectedVolume } from '../docker/engine-schemas.js';
import type { DockerEngine } from '../docker/engine.js';

/** Where the copying container mounts the volume. */
const MOUNT = '/volume';

/** The record of the volumes copied, beside their tars. */
const RECORD_FILE = 'volumes.json';

/** The label Docker gives a volume it made for a container without a name anyone chose. */
const ANONYMOUS_LABEL = 'com.docker.volume.anonymous';

/** What `volumes.json` holds. */
const recordSchema = z.array(
  z.object({ name: volumeNameSchema, labels: z.record(z.string(), z.string()) }),
);

/** What copying the volumes needs. */
export type VolumeCopyOptions = {
  readonly engine: Pick<
    DockerEngine,
    | 'archiveIn'
    | 'archiveOut'
    | 'control'
    | 'createContainer'
    | 'createVolume'
    | 'inspectVolume'
    | 'removeContainer'
    | 'wait'
  >;
  readonly logger: PlatformLogger;

  /** The image the copying container is made of: the platform's own, which has a shell. */
  readonly image: string;

  /** The folder the tars are written to, or read from. */
  readonly directory: string;
};

/**
 * Why a volume is not copied, if it is not.
 *
 * @param volume - The volume, inspected.
 * @returns The reason, or null for one that is copied.
 */
export function skipReason(volume: InspectedVolume): string | null {
  if (volume.Labels[ANONYMOUS_LABEL] !== undefined || /^[0-9a-f]{64}$/.test(volume.Name)) {
    return 'An anonymous volume: no container names it, so none would find it again';
  }

  if (volume.Driver !== 'local' || Object.keys(volume.Options).length > 0) {
    return 'Its driver keeps it outside this machine';
  }

  return null;
}

/**
 * Runs something against a container that mounts a volume, and removes the container after.
 *
 * @param options - The engine, the logger and the image.
 * @param volume - The volume.
 * @param isReadOnly - Whether the volume is mounted read-only: for a copy out.
 * @param use - What to do with the container's id.
 * @returns What `use` gave.
 */
async function withCopier<TResult>(
  options: VolumeCopyOptions,
  volume: string,
  isReadOnly: boolean,
  use: (id: string) => Promise<TResult>,
): Promise<TResult> {
  const id = await options.engine.createContainer(`nebulahome-volume-${randomUUID().slice(0, 8)}`, {
    Image: options.image,
    // Started only to empty the volume; the archive API reads and writes it stopped.
    Entrypoint: ['sh', '-c'],
    Cmd: [`find ${MOUNT} -mindepth 1 -delete`],
    // The platform's own: listed as a system container, never a device.
    Labels: { [PLATFORM_LABEL]: 'true' },
    NetworkDisabled: true,
    HostConfig: {
      NetworkMode: 'none',
      Mounts: [{ Type: 'volume', Source: volume, Target: MOUNT, ReadOnly: isReadOnly }],
    },
  });

  try {
    return await use(id);
  } finally {
    await options.engine.removeContainer(id).catch((error: unknown) => {
      options.logger.warn({ err: error, volume }, 'Could not remove the container that copied it');
    });
  }
}

/**
 * Copies volumes into the folder, one tar each, and records their labels beside them.
 *
 * @param options - The engine, the logger, the image and the folder.
 * @param names - The volumes the platform's containers mount.
 * @returns What was copied, and what was left out and why.
 */
export async function exportVolumes(
  options: VolumeCopyOptions,
  names: readonly string[],
): Promise<VolumesExportReply> {
  const volumes: VolumesExportReply['volumes'] = [];
  const skipped: VolumesExportReply['skipped'] = [];
  const records: z.output<typeof recordSchema> = [];

  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop -- one volume at a time: one copy's disk and I/O
    const volume = await options.engine.inspectVolume(name);

    if (volume === undefined) {
      // Removed since its container was listed.
      continue;
    }

    const reason = skipReason(volume);

    if (reason !== null) {
      skipped.push({ name, reason });
      continue;
    }

    const file = path.join(options.directory, `${name}.tar`);

    // eslint-disable-next-line no-await-in-loop -- as above
    await withCopier(options, name, true, async (id) =>
      pipeline(
        await options.engine.archiveOut(id, MOUNT),
        createWriteStream(file, { mode: 0o600 }),
      ),
    );
    // eslint-disable-next-line no-await-in-loop -- as above
    volumes.push({ name, bytes: (await stat(file)).size });
    records.push({ name, labels: volume.Labels });
  }

  await writeFile(path.join(options.directory, RECORD_FILE), JSON.stringify(records, null, 2), {
    mode: 0o600,
  });

  return { volumes, skipped };
}

/**
 * Writes back every volume the folder holds: made when missing, emptied, then filled from its
 * tar with the owners the tar has.
 *
 * @param options - The engine, the logger, the image and the folder.
 * @returns The volumes written back; none for a folder without a record.
 * @throws {UpstreamError} When a volume could not be emptied.
 */
export async function importVolumes(options: VolumeCopyOptions): Promise<string[]> {
  let text: string;

  try {
    text = await readFile(path.join(options.directory, RECORD_FILE), 'utf8');
  } catch {
    // An archive made before volumes were taken, or with none.
    return [];
  }

  const records = recordSchema.parse(JSON.parse(text));

  for (const record of records) {
    // eslint-disable-next-line no-await-in-loop -- one volume at a time, as they were copied
    if ((await options.engine.inspectVolume(record.name)) === undefined) {
      // eslint-disable-next-line no-await-in-loop -- as above
      await options.engine.createVolume(record.name, record.labels);
    }

    // eslint-disable-next-line no-await-in-loop -- as above
    await withCopier(options, record.name, false, async (id) => {
      await options.engine.control(id, 'start');

      const code = await options.engine.wait(id);

      if (code !== 0) {
        throw new UpstreamError(
          `Could not empty the volume ${record.name} (exit ${String(code)})`,
          {
            details: { volume: record.name, code },
          },
        );
      }

      // The tar's top entry is the mount's own name: unpacked at the root, it fills the volume.
      await options.engine.archiveIn(
        id,
        '/',
        createReadStream(path.join(options.directory, `${record.name}.tar`)),
      );
    });
    options.logger.info({ volume: record.name }, 'Wrote a volume back from the archive');
  }

  return records.map((record) => record.name);
}
