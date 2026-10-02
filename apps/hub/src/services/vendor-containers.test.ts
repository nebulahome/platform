import { describe, expect, it } from 'vitest';

import { integrationSetupSchema } from '@nebulahome/contracts';
import { vendorManifestSchema } from '@nebulahome/package-runtime';

import type { LoadedVendor } from './bundles.js';
import { declaredContainers } from './vendor-containers.js';

/**
 * A vendor that runs a container of its own, as the loader would have produced it.
 *
 * @returns The vendor.
 */
function vendorWithContainer(): LoadedVendor {
  return {
    manifest: vendorManifestSchema.parse({
      id: 'zigbee2mqtt',
      version: '1.0.0',
      sdk: '^1.3.0',
      name: 'Zigbee2MQTT',
      containers: [
        {
          id: 'zigbee2mqtt',
          name: 'Zigbee2MQTT',
          image: 'koenkk/zigbee2mqtt',
          minVersion: '2.1.0',
          env: [
            { name: 'ADAPTER', value: '{setup.adapter}' },
            { name: 'PORT', value: '/dev/zigbee', when: { key: 'connection', equals: ['usb'] } },
          ],
          devices: [
            {
              host: '{setup.serialPath}',
              container: '/dev/zigbee',
              when: { key: 'connection', equals: ['usb'] },
            },
          ],
        },
      ],
    }),
    origin: 'development',
    setup: integrationSetupSchema.parse({
      transport: { fields: [] },
      options: {
        fields: [
          {
            key: 'adapter',
            type: 'choice',
            label: 'Adapter',
            isRequired: true,
            choices: [{ value: 'ember', label: 'Ember' }],
          },
          {
            key: 'connection',
            type: 'choice',
            label: 'Connection',
            choices: [
              { value: 'usb', label: 'USB' },
              { value: 'network', label: 'Network' },
            ],
            default: 'usb',
          },
          { key: 'serialPath', type: 'text', label: 'Serial port' },
        ],
      },
    }),
    transports: [],
    wires: [],
    ownTransports: [],
    streams: [],
    drivers: [],
    directory: '/bundles/zigbee2mqtt',
    release: () => Promise.resolve(),
  };
}

describe('declaredContainers', () => {
  it('declares nothing while the vendor still needs setting up', () => {
    expect(declaredContainers(vendorWithContainer(), undefined)).toEqual({
      vendorId: 'zigbee2mqtt',
      containers: [],
    });
  });

  it("fills the declaration in with the owner's settings, a choice left alone at its default", () => {
    const { containers } = declaredContainers(vendorWithContainer(), {
      transportConfig: {},
      options: { adapter: 'ember', serialPath: '/dev/ttyUSB0' },
    });

    expect(containers[0]?.env).toEqual([
      { name: 'ADAPTER', value: 'ember' },
      { name: 'PORT', value: '/dev/zigbee' },
    ]);
    expect(containers[0]?.devices).toEqual([{ host: '/dev/ttyUSB0', container: '/dev/zigbee' }]);
  });
});
