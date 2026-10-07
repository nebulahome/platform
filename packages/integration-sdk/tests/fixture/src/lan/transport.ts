import type { BundleSdk, Transport } from '@nebulahome/integration-sdk';

import { PORT, packetOf } from './packet.js';

/**
 * A transport of the vendor's own, over UDP: what the SDK's build compiles.
 *
 * @param sdk - What the hub hands over.
 * @returns The transport.
 */
export default function lan(sdk: BundleSdk): Transport {
  return sdk.defineTransport({
    id: 'fixture/lan',
    configSchema: sdk.z.object({ host: sdk.z.string() }),
    connectionKey: (config) => config.host,
    connect: async () => Promise.reject(new Error('Not in the fixture')),
    async *scan() {},
    probe: async (config) => {
      const socket = sdk.openUdpSocket({ onMessage: () => undefined });

      await socket.send(packetOf('hello'), PORT, config.host);
      await socket.close();

      return `${config.host} was greeted`;
    },
  });
}
