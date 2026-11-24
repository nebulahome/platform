/**
 * The engine against a fake Docker on a socket of its own: one that goes quiet half-way through a
 * pull, and one that refuses.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConflictError } from '@nebulahome/contracts';

import { DockerEngine } from './engine.js';

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }

  servers.length = 0;
});

/**
 * A fake Docker answering every call the same way.
 *
 * @param answer - What it does with a call.
 * @returns The socket it listens on.
 */
async function fakeDocker(answer: http.RequestListener): Promise<string> {
  const name = `nebula-engine-${randomBytes(4).toString('hex')}`;
  const socketPath =
    process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(tmpdir(), `${name}.sock`);
  const server = http.createServer(answer);

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  return socketPath;
}

/**
 * A fake Docker that starts a pull and then says nothing more.
 *
 * @returns The socket it listens on.
 */
async function silentDocker(): Promise<string> {
  return fakeDocker((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"status":"Pulling from library/alpine","id":"3.20"}\n');
  });
}

/**
 * A fake Docker that refuses every call.
 *
 * @param status - The status it answers.
 * @returns The socket it listens on.
 */
async function refusingDocker(status: number): Promise<string> {
  return fakeDocker((request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: `refused with ${String(status)}` }));
  });
}

describe("the engine's pull", () => {
  it('gives up a pull that makes no progress, saying so', async () => {
    const engine = new DockerEngine({
      socketPath: await silentDocker(),
      timeoutMs: 1000,
      pullIdleMs: 100,
    });
    const seen: unknown[] = [];

    await expect(engine.pull('alpine', '3.20', (progress) => seen.push(progress))).rejects.toThrow(
      /made no progress/u,
    );
    expect(seen).toHaveLength(1);
  });
});

describe("the engine's image removal", () => {
  it('takes an image already gone as removed', async () => {
    const engine = new DockerEngine({ socketPath: await refusingDocker(404), timeoutMs: 1000 });

    await expect(engine.removeImage('alpine:3.20')).resolves.toBeUndefined();
  });

  it('says when Docker refuses, as for an image a container uses', async () => {
    const engine = new DockerEngine({ socketPath: await refusingDocker(409), timeoutMs: 1000 });

    await expect(engine.removeImage('alpine:3.20')).rejects.toBeInstanceOf(ConflictError);
  });
});
