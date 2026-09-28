/**
 * The supervisor against a real Docker: a throwaway container listed, inspected, measured,
 * stopped, started, read, updated to a newer image by being made again, and put back on the
 * network the managed containers reach the platform by.
 *
 * Needs Docker and the internet (it pulls two small Alpine images). The socket is
 * `SUPERVISOR_DOCKER_SOCKET`, `/var/run/docker.sock` when unset. Skipped when Docker does not
 * answer.
 */
import { execFile } from 'node:child_process';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';

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
import { RegistryClient } from '@/registry/registry-client.js';
import { ManagedContainers } from '@/services/managed-containers.js';
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

  it('puts the platform back on its network, under the name the others reach it by', async () => {
    const network = `${name}-net`;
    const managed = new ManagedContainers({
      engine,
      // Never asked: the network is all this test reaches.
      registry: new RegistryClient({ timeoutMs: 1000, architecture: 'amd64' }),
      logger,
      dataRoot: '.',
      context: () => null,
      installationId: 'test',

      /**
       * The throwaway container stands in for the platform's.
       *
       * @returns Its id.
       */
      selfId: () => id,
      onChange: () => undefined,
    });
    const context = {
      network: 'bridge',
      installationId: 'test',
      networkName: network,
      platformAlias: 'platform-under-test',
      mqtt: null,
      timezone: 'UTC',
      dataMount: { kind: 'separate' },
    } as const;

    try {
      // Off the network, as after the platform's container is made again from a new image.
      await managed.ensureNetwork(context);
      expect(
        (await engine.inspectContainer(id)).NetworkSettings.Networks[network]?.Aliases,
      ).toContain('platform-under-test');

      // On it, but without the name - put there by hand.
      await engine.disconnectNetwork(network, id);
      await engine.connectNetwork(network, id, []);
      await managed.ensureNetwork(context);
      expect(
        (await engine.inspectContainer(id)).NetworkSettings.Networks[network]?.Aliases,
      ).toContain('platform-under-test');
    } finally {
      await engine.disconnectNetwork(network, id).catch(() => undefined);
      // The engine has no call to remove a network: the platform never removes one.
      await promisify(execFile)('docker', ['network', 'rm', network]).catch(() => undefined);
    }
  });
});
