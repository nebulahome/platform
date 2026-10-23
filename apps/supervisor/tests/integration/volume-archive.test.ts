/**
 * A named volume against a real Docker: copied out to a tar with its owners, then written back
 * over what was changed since - emptied first, so nothing made after the copy stays - and made
 * again, with its labels, when it was removed.
 *
 * Needs Docker and the internet (it pulls a small Alpine image). The socket is
 * `SUPERVISOR_DOCKER_SOCKET`, `/var/run/docker.sock` when unset. Skipped when Docker does not
 * answer.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ulid } from '@nebulahome/bus';
import { loadConfig } from '@nebulahome/config';
import { createLogger } from '@nebulahome/logging';

import { supervisorEnvSchema } from '@/config.js';
import { DockerEngine } from '@/docker/engine.js';
import { parseLogs } from '@/domain/log-frames.js';
import { exportVolumes, importVolumes, type VolumeCopyOptions } from '@/services/volume-archive.js';

const run = promisify(execFile);
const IMAGE = 'alpine:3.21';
const engine = new DockerEngine({
  socketPath: loadConfig(
    z.object({ SUPERVISOR_DOCKER_SOCKET: supervisorEnvSchema.shape.SUPERVISOR_DOCKER_SOCKET }),
  ).SUPERVISOR_DOCKER_SOCKET,
  timeoutMs: 30_000,
});
const isReachable = await engine.negotiate().then(
  () => true,
  () => false,
);
const volume = `nebulahome-test-${ulid().toLowerCase().slice(0, 10)}`;

let directory = '';

/**
 * The options every copy takes.
 *
 * @returns Them, over the test's folder.
 */
function options(): VolumeCopyOptions {
  return {
    engine,
    logger: createLogger(
      { service: 'supervisor-test', version: '0.0.0', level: 'fatal' },
      new Writable({
        /**
         * Discards a chunk.
         *
         * @param chunk - Ignored.
         * @param encoding - Ignored.
         * @param done - Called to accept the write.
         */
        write(chunk, encoding, done): void {
          done();
        },
      }),
    ),
    image: IMAGE,
    directory,
  };
}

/**
 * Runs a script in a container that mounts the volume at `/data`.
 *
 * @param script - The script.
 * @returns The lines it wrote.
 */
async function inVolume(script: string): Promise<string[]> {
  const id = await engine.createContainer(`${volume}-${ulid().toLowerCase().slice(-6)}`, {
    Image: IMAGE,
    Cmd: ['sh', '-c', script],
    HostConfig: { Mounts: [{ Type: 'volume', Source: volume, Target: '/data' }] },
  });

  try {
    await engine.control(id, 'start');
    await engine.wait(id);

    return parseLogs(await engine.logs(id, 100), false).map((line) => line.text);
  } finally {
    await engine.removeContainer(id);
  }
}

describe.skipIf(!isReachable)('a named volume, through a backup and a restore', () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'nebula-volumes-'));
    await engine.pull('alpine', '3.21', () => undefined);
    await engine.createVolume(volume, { 'io.nebulahome.test': 'true' });
    await inVolume(
      'echo first > /data/kept && chown 1000:1000 /data/kept && mkdir /data/sub && echo deep > /data/sub/file',
    );
  });

  afterAll(async () => {
    await run('docker', ['volume', 'rm', '-f', volume]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it('copies it out', async () => {
    const reply = await exportVolumes(options(), [volume]);

    expect(reply.skipped).toEqual([]);
    expect(reply.volumes).toEqual([{ name: volume, bytes: expect.any(Number) as number }]);
    expect(reply.volumes[0]?.bytes).toBeGreaterThan(0);
    expect(existsSync(path.join(directory, `${volume}.tar`))).toBe(true);
  });

  it('writes it back as it was copied, with nothing made since', async () => {
    await inVolume('echo later > /data/stray && echo changed > /data/kept');

    expect(await importVolumes(options())).toEqual([volume]);
    expect(
      await inVolume('cat /data/kept /data/sub/file; ls -A /data; stat -c %u /data/kept'),
    ).toEqual(['first', 'deep', 'kept', 'sub', '1000']);
  });

  it('makes it again, with its labels, when it was removed', async () => {
    await run('docker', ['volume', 'rm', '-f', volume]);

    await importVolumes(options());

    expect((await engine.inspectVolume(volume))?.Labels['io.nebulahome.test']).toBe('true');
    expect(await inVolume('cat /data/kept')).toEqual(['first']);
  });
});
