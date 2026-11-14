/**
 * The engine's pull against a fake Docker on a socket of its own: one that goes quiet half-way.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
 * A fake Docker that starts a pull and then says nothing more.
 *
 * @returns The socket it listens on.
 */
async function silentDocker(): Promise<string> {
  const name = `nebula-engine-${randomBytes(4).toString('hex')}`;
  const socketPath =
    process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(tmpdir(), `${name}.sock`);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"status":"Pulling from library/alpine","id":"3.20"}\n');
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  return socketPath;
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
