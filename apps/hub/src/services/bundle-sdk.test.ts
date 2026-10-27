import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '@nebulahome/logging';
import { defineTransport } from '@nebulahome/package-runtime';

import { createBluetoothScanners } from '../bluetooth/scanners.js';
import { createModbusSessions } from '../modbus/sessions.js';
import { createSerialSessions } from '../serial/sessions.js';
import { openWebSocket } from '../transports/managed-socket.js';
import { createUdpSockets } from '../transports/managed-udp.js';

import { createBundleSdk } from './bundle-sdk.js';

describe('createBundleSdk', () => {
  it('hands a bundle the runtime version and the platform pieces, by reference', () => {
    // By reference matters: a bundle's schema has to validate under the zod the hub checks
    // against, and a copy of `defineTransport` would be a second contract.
    const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
    const udp = createUdpSockets(logger);
    const modbus = createModbusSessions(undefined);
    const serial = createSerialSessions(undefined, 'acme');
    const bluetooth = createBluetoothScanners(undefined, 'acme');
    const sdk = createBundleSdk({
      version: '1.0.0',
      logger,
      openUdpSocket: udp.open,
      openModbus: modbus.open,
      openSerial: serial.open,
      bluetooth: bluetooth.bluetooth,
      platform: { mqtt: null },
    });

    expect(sdk.version).toBe('1.0.0');
    expect(sdk.z).toBe(z);
    expect(sdk.defineTransport).toBe(defineTransport);
    expect(sdk.openWebSocket).toBe(openWebSocket);
    expect(sdk.logger).toBe(logger);
    expect(sdk.openUdpSocket).toBe(udp.open);
    expect(sdk.openModbus).toBe(modbus.open);
    expect(sdk.openSerial).toBe(serial.open);
    expect(sdk.bluetooth).toBe(bluetooth.bluetooth);
  });
});
