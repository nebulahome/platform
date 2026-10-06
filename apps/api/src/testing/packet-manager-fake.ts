/**
 * A packet-manager on the harness's bus, and one package running under it.
 *
 * The package is `mqtt`, a system package with a setup that asks for a port and a password, a
 * folder written here with its interface's module and its logo, and two methods: `clients`, for
 * anyone who may read it, and `kick`, for who may configure it. A search of the Community Hub
 * finds one package, `nvr`, whose logo it relays, and one integration, `zigbee`, which installs
 * and removes as the packet-manager would.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  ConflictError,
  hubDetailRequestSchema,
  integrationInstallRequestSchema,
  integrationRemoveRequestSchema,
  integrationSearchRequestSchema,
  NotFoundError,
  PACKAGE_RPC_METHOD,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageConfigureRequestSchema,
  packageHubLogoRequestSchema,
  packageIdRequestSchema,
  packageInstallRequestSchema,
  packageRemoveRequestSchema,
  packageRpcRequestSchema,
  packageSearchRequestSchema,
  type InstalledPackage,
  type IntegrationListing,
  type PackageDetail,
  type PackageListing,
} from '@nebulahome/contracts';

/** Where the fake package's files are. */
export const FAKE_PACKAGE_ROOT = mkdtempSync(path.join(os.tmpdir(), 'api-package-'));

mkdirSync(path.join(FAKE_PACKAGE_ROOT, 'ui', 'assets'), { recursive: true });
writeFileSync(
  path.join(FAKE_PACKAGE_ROOT, 'nebula.package.json'),
  JSON.stringify({
    id: 'mqtt',
    version: '1.0.0',
    platform: '^1.0.0',
    sdk: '^1.0.0',
    name: 'MQTT',
    description: 'The broker.',
    category: 'protocol',
    runtime: 'node',
    server: { entry: './server/index.js' },
    logo: { path: './logo.svg' },
    ui: { entry: './ui/index.js', page: true },
  }),
);
writeFileSync(path.join(FAKE_PACKAGE_ROOT, 'ui', 'index.js'), 'export default {};\n');
writeFileSync(path.join(FAKE_PACKAGE_ROOT, 'ui', 'assets', 'broker.svg'), '<svg/>');
writeFileSync(
  path.join(FAKE_PACKAGE_ROOT, 'logo.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);
writeFileSync(path.join(FAKE_PACKAGE_ROOT, 'secret.txt'), 'not for the browser');

/** The broker, as the packet-manager lists it. */
export const MQTT_PACKAGE: InstalledPackage = {
  id: 'mqtt',
  version: '1.0.0',
  build: '1.0.0+3f2a9c1d',
  name: 'MQTT',
  description: 'The broker.',
  category: 'protocol',
  runtime: 'node',
  state: 'running',
  source: 'index',
  isSystem: true,
  repository: 'nebulahome/pkg-mqtt',
  url: null,
  color: null,
  hasLogo: true,
  ui: { entry: './ui/index.js', page: true, cards: [], entityViews: [] },
  entityTypes: [],
  requires: { packages: {}, services: [] },
  provides: ['mqtt-broker'],
  hasSetup: true,
  previousVersion: null,
  lastStartedAt: new Date('2026-09-29T08:00:00Z'),
  lastError: null,
  installedAt: new Date('2026-09-28T08:00:00Z'),
  updatedAt: new Date('2026-09-29T08:00:00Z'),
  rpcMethods: [
    { name: 'clients', access: 'read' },
    { name: 'kick', access: 'configure' },
  ],
  problems: [],
  usedBy: [],
  dependsOn: [],
};

/** Its detail: its setup, and a password already saved - sealed, as the packet-manager keeps it. */
const MQTT_DETAIL: PackageDetail = {
  ...MQTT_PACKAGE,
  setup: {
    transport: {
      constants: {},
      fields: [
        {
          key: 'port',
          type: 'number',
          label: 'Port',
          isRequired: true,
          isInteger: true,
          min: 1,
          max: 65_535,
        },
        { key: 'password', type: 'secret', label: 'Password', isRequired: false, maxLength: 128 },
      ],
    },
    options: { constants: {}, fields: [] },
  },
  config: { port: 1883, password: { $sealed: 'v1.bm90LWEtcmVhbC1jaXBoZXJ0ZXh0' } },
  root: FAKE_PACKAGE_ROOT,
};

/** The logo the Hub shows for `nvr`, and its digest. */
export const HUB_LOGO = {
  sha256: 'a'.repeat(64),
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
};

/** What a search of the Hub finds. */
export const NVR_LISTING: PackageListing = {
  id: 'nvr',
  name: 'Recorder',
  description: 'Records the cameras.',
  category: 'security',
  repository: 'nebulahome/pkg-nvr',
  icon: null,
  latest: {
    version: '1.4.0',
    requires: { packages: {}, services: [] },
    provides: [],
    publishedAt: new Date('2026-09-29T08:00:00.000Z'),
    changelogUrl: null,
    source: 'index',
  },
  newestVersion: '1.4.0',
  installedVersion: null,
  hasUpdate: false,
  hasNewBuild: false,
  color: '#3F6FD8',
  logo: HUB_LOGO.sha256,
  isOfficial: true,
  downloads: 1823,
  stars: 97,
  origin: 'hub',
  unavailableReason: null,
};

/** The one integration a search of the Hub finds. */
export const ZIGBEE_LISTING: IntegrationListing = {
  id: 'zigbee',
  name: 'Zigbee2MQTT',
  description: 'Every Zigbee device Zigbee2MQTT supports, through its bridge.',
  repository: 'nebulahome/integration-zigbee',
  color: '#ffc135',
  logo: null,
  isOfficial: true,
  downloads: 1200,
  stars: 14,
  internetRequired: false,
  origin: 'hub',
  latest: {
    version: '1.1.0',
    sdk: '^1.0.0',
    requires: { packages: {}, services: ['mqtt-broker'] },
    bundleKind: 'declarative',
    publishedAt: new Date('2026-10-01T08:00:00Z'),
    changelogUrl: null,
    source: 'index',
  },
  newestVersion: '1.1.0',
  installedVersion: null,
  isBuiltIn: false,
  hasUpdate: false,
  hasNewBuild: false,
  unavailableReason: null,
};

/** What the fake was asked, by method. */
export const packetManagerRequests: { method: string; payload: unknown }[] = [];

/**
 * Serves the packet-manager's methods, and the package's own calls.
 *
 * @param packetManager - A client speaking as the packet-manager.
 * @param mqtt - A client speaking as the package.
 * @returns The subscriptions.
 */
export function servePacketManagerFake(
  packetManager: BusClient,
  mqtt: BusClient,
): BusSubscription[] {
  packetManagerRequests.length = 0;

  /**
   * The subject of one method.
   *
   * @param method - The method.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(PACKET_MANAGER_SERVICE, method);

  /**
   * Records a request.
   *
   * @param method - Which method.
   * @param payload - What it carried.
   */
  const record = (method: string, payload: unknown): void => {
    packetManagerRequests.push({ method, payload });
  };

  return [
    packetManager.serve(subject(PACKET_MANAGER_METHODS.list), z.unknown(), () => ({
      items: [MQTT_PACKAGE],
    })),
    packetManager.serve(subject(PACKET_MANAGER_METHODS.get), packageIdRequestSchema, (request) => {
      if (request.packageId !== 'mqtt') {
        throw new NotFoundError('No package is installed by that id');
      }

      return MQTT_DETAIL;
    }),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.install),
      packageInstallRequestSchema,
      (request) => {
        record('install', request);

        if (request.packageId === 'watcher') {
          throw new ConflictError(
            'Watcher needs a package that provides object-detection, and none does',
            {
              details: { reason: 'cannot-install' },
            },
          );
        }

        return {
          installed: [
            { ...MQTT_PACKAGE, id: request.packageId, isSystem: false, source: 'index' as const },
          ],
        };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.search),
      packageSearchRequestSchema,
      (request) => {
        record('search', request);

        return { items: [NVR_LISTING], nextCursor: null, hubError: null };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.integrationSearch),
      integrationSearchRequestSchema,
      (request) => {
        record('integration_search', request);

        return { items: [ZIGBEE_LISTING], nextCursor: null, hubError: null };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.hubDetail),
      hubDetailRequestSchema,
      (request) => {
        record('hub_detail', request);

        return {
          ...request,
          owner: 'nebulahome',
          homepageUrl: null,
          models: request.kind === 'integration' ? ['CC2652P'] : [],
          internetRequired: request.kind === 'integration' ? false : null,
          version: '1.1.0',
          publishedAt: new Date('2026-10-01T08:00:00Z'),
          transports: request.kind === 'integration' ? ['mqtt'] : [],
          bundleKind: request.kind === 'integration' ? ('declarative' as const) : null,
        };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.integrationInstall),
      integrationInstallRequestSchema,
      (request) => {
        record('integration_install', request);

        return {
          vendorId: request.vendorId,
          action: 'installed' as const,
          install: {
            build: `${request.version ?? '1.1.0'}-0a1b2c3d`,
            version: request.version ?? '1.1.0',
            source: 'index' as const,
            artifactSha256: 'a'.repeat(64),
            installedAt: '2026-10-06T08:00:00.000Z',
            installedBy: request.requestedBy ?? null,
          },
          warnings: [],
        };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.integrationRemove),
      integrationRemoveRequestSchema,
      (request) => {
        record('integration_remove', request);

        if (request.vendorId !== 'zigbee') {
          throw new NotFoundError(`${request.vendorId} was not installed by the platform`);
        }

        return { isRestartNeeded: false };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.hubLogo),
      packageHubLogoRequestSchema,
      (request) => {
        if (request.sha256 !== HUB_LOGO.sha256) {
          throw new NotFoundError('No search showed this logo');
        }

        return {
          contentType: 'image/svg+xml',
          data: Buffer.from(HUB_LOGO.svg).toString('base64'),
        };
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.remove),
      packageRemoveRequestSchema,
      (request) => {
        record('remove', request);

        throw new ConflictError('MQTT is part of the platform and is not removed', {
          details: { reason: 'system' },
        });
      },
    ),
    packetManager.serve(
      subject(PACKET_MANAGER_METHODS.configure),
      packageConfigureRequestSchema,
      (request) => {
        record('configure', request);

        return { package: MQTT_PACKAGE };
      },
    ),
    mqtt.serve(
      busSubjects.service('mqtt', PACKAGE_RPC_METHOD),
      packageRpcRequestSchema,
      (request) => {
        record('rpc', request);

        return { output: request.method === 'clients' ? ['tasmota-kitchen'] : null };
      },
    ),
  ];
}
