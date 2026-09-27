/**
 * The supervisor against a real Docker: a throwaway container listed, inspected, measured,
 * stopped, started, read, and updated to a newer image by being made again.
 *
 * Needs Docker and the internet (it pulls two small Alpine images). The socket is
 * `SUPERVISOR_DOCKER_SOCKET`, `/var/run/docker.sock` when unset. Skipped when Docker does not
 * answer.
 */
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ulid } from '@nebula-home/bus';
import { loadConfig } from '@nebula-home/config';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { supervisorEnvSchema } from '@/config.js';
import { DockerEngine } from '@/docker/engine.js';
import { parseLogs } from '@/domain/log-frames.js';
import { planRecreate } from '@/domain/recreate.js';
import { cpuCountersOf, memoryUsedOf } from '@/domain/stats.js';
import { replaceContainer } from '@/services/replace.js';

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
const name = `nebulahome-test-${ulid().toLowerCase().slice(0, 10)}`;

let logger: PlatformLogger;
let id: string;

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
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
  );
}

describe.skipIf(!isReachable)('a container, through the engine', () => {
  beforeAll(async () => {
    logger = silent();
    await engine.pull('alpine', '3.20', () => undefined);
    id = await engine.createContainer(name, {
      Image: 'alpine:3.20',
      Cmd: ['sh', '-c', 'echo ready; while true; do sleep 1; done'],
      Env: ['OWN_SETTING=kept'],
      Labels: { 'io.nebulahome.test': 'true' },
    });
    await engine.control(id, 'start');
  });

  afterAll(async () => {
    const left = (await engine.listContainers()).filter((container) =>
      container.Names.some((each) => each.startsWith(`/${name}`)),
    );

    await Promise.all(left.map(async (container) => engine.removeContainer(container.Id)));
  });

  it('lists and inspects it', async () => {
    const listed = (await engine.listContainers()).find((container) => container.Id === id);
    const inspected = await engine.inspectContainer(id);

    expect(listed?.State).toBe('running');
    expect(inspected.Config.Env).toContain('OWN_SETTING=kept');
  });

  it('measures it', async () => {
    const stats = await engine.stats(id);

    expect(cpuCountersOf(stats).container).toBeGreaterThanOrEqual(0);
    expect(memoryUsedOf(stats)).not.toBe(null);
  });

  it('reads what it wrote', async () => {
    const inspected = await engine.inspectContainer(id);
    const lines = parseLogs(await engine.logs(id, 50), inspected.Config.Tty === true);

    expect(lines.map((line) => line.text)).toContain('ready');
    expect(lines[0]?.at).toBeInstanceOf(Date);
  });

  it('stops and starts it, and takes a second stop as done', async () => {
    await engine.control(id, 'stop');
    await engine.control(id, 'stop');
    expect((await engine.inspectContainer(id)).State.Running).toBe(false);

    await engine.control(id, 'start');
    expect((await engine.inspectContainer(id)).State.Running).toBe(true);
  });

  it("makes it again on a newer image, keeping the owner's settings", async () => {
    await engine.pull('alpine', '3.21', () => undefined);

    const inspected = await engine.inspectContainer(id);
    const oldImage = await engine.inspectImage(inspected.Image);
    const plan = planRecreate(inspected, oldImage, 'alpine:3.21');

    id = await replaceContainer({
      engine,
      logger,
      id: inspected.Id,
      name,
      wasRunning: true,
      body: plan.body,
      networks: plan.networks,
    });

    const replaced = await engine.inspectContainer(name);

    expect(replaced.Id).toBe(id);
    expect(replaced.Config.Image).toBe('alpine:3.21');
    expect(replaced.Config.Env).toContain('OWN_SETTING=kept');
    expect(replaced.Config.Labels['io.nebulahome.test']).toBe('true');
    expect(replaced.State.Running).toBe(true);
    expect(
      (await engine.listContainers()).filter((container) =>
        container.Names.some((each) => each.startsWith(`/${name}`)),
      ),
    ).toHaveLength(1);
  });
});
