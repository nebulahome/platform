/**
 * Packages as the API lists them, for the tests of what draws them.
 */
import type { ApiPackage, AvailablePackage } from '@nebulahome/contracts';

/**
 * The MQTT broker, running, with a card and a page.
 *
 * @param overrides - What differs.
 * @returns The package.
 */
export function aPackage(overrides: Partial<ApiPackage> = {}): ApiPackage {
  return {
    id: 'mqtt',
    version: '1.0.0',
    build: '1.0.0+3f2a9c1d',
    name: 'MQTT',
    description: 'The broker the house talks MQTT through.',
    category: 'protocol',
    runtime: 'node',
    state: 'running',
    source: 'index',
    isSystem: true,
    repository: 'nebulahome/pkg-mqtt',
    url: null,
    color: null,
    hasLogo: false,
    ui: {
      entry: './ui/index.js',
      styles: './ui/index.css',
      page: true,
      cards: [
        {
          id: 'broker',
          name: 'MQTT broker',
          icon: 'router',
          sizes: ['small', 'medium'],
          options: [],
          padding: 'default',
        },
      ],
      entityViews: [],
    },
    entityTypes: [],
    requires: { packages: {}, services: [] },
    provides: ['mqtt-broker'],
    hasSetup: false,
    previousVersion: null,
    lastStartedAt: new Date('2026-09-29T08:00:00.000Z'),
    lastError: null,
    installedAt: new Date('2026-09-28T08:00:00.000Z'),
    updatedAt: new Date('2026-09-29T08:00:00.000Z'),
    rpcMethods: [{ name: 'clients', access: 'read' }],
    problems: [],
    usedBy: [],
    dependsOn: [],
    deviceCount: 1,
    entityCount: 3,
    ...overrides,
  };
}

/**
 * A package the index offers.
 *
 * @param overrides - What differs.
 * @returns The package.
 */
export function anOffer(overrides: Partial<AvailablePackage> = {}): AvailablePackage {
  return {
    id: 'nvr',
    name: 'NVR',
    description: 'Records the cameras.',
    category: 'media',
    repository: 'nebulahome/pkg-nvr',
    icon: null,
    latest: {
      version: '1.4.0',
      requires: { packages: { mqtt: '^1.0.0' }, services: [] },
      provides: [],
      publishedAt: new Date('2026-09-20T08:00:00.000Z'),
      changelogUrl: null,
      source: 'index',
    },
    newestVersion: '1.4.0',
    installedVersion: null,
    hasUpdate: false,
    hasNewBuild: false,
    ...overrides,
  };
}
