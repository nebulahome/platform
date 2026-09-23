import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '@nebula-home/logging';
import { defineTransport } from '@nebula-home/package-runtime';

import { openWebSocket } from '../transports/managed-socket.js';

import { createBundleSdk } from './bundle-sdk.js';

describe('createBundleSdk', () => {
  it('hands a bundle the runtime version and the platform pieces, by reference', () => {
    // By reference matters: a bundle's schema has to validate under the zod the hub checks
    // against, and a copy of `defineTransport` would be a second contract.
    const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
    const sdk = createBundleSdk({ version: '1.0.0', logger });

    expect(sdk.version).toBe('1.0.0');
    expect(sdk.z).toBe(z);
    expect(sdk.defineTransport).toBe(defineTransport);
    expect(sdk.openWebSocket).toBe(openWebSocket);
    expect(sdk.logger).toBe(logger);
  });
});
