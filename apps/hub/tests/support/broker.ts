/**
 * An MQTT broker for the integration tests: aedes in this process, on a port of its own, letting
 * anyone in - what the development stack's Mosquitto was before the house's broker became a
 * package.
 *
 * Started once for the whole run by vitest's global setup; each file reads its address with
 * `inject('mqttUrl')`.
 */
import net from 'node:net';

import { Aedes } from 'aedes';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  /** What the global setup hands every test file. */
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a module's interface is augmented, and only an interface merges
  export interface ProvidedContext {
    /** The test broker's address: `mqtt://127.0.0.1:<port>`. */
    readonly mqttUrl: string;
  }
}

/**
 * Starts the broker, and hands its address to the tests.
 *
 * @param project - The test project, to provide the address to.
 * @returns What stops it.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  project.provide('mqttUrl', `mqtt://127.0.0.1:${String(port)}`);

  return async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      broker.close(() => {
        resolve();
      });
    });
  };
}
