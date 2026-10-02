/**
 * A packet-manager on the harness's bus, and one package running under it.
 *
 * The package is `mqtt`, a system package with a setup that asks for a port and a password, a
 * folder written here with its interface's module and its logo, and two methods: `clients`, for
 * anyone who may read it, and `kick`, for who may configure it.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  ConflictError,
  NotFoundError,
  PACKAGE_RPC_METHOD,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageConfigureRequestSchema,
  packageIdRequestSchema,
  packageInstallRequestSchema,
  packageRemoveRequestSchema,
  packageRpcRequestSchema,
  type InstalledPackage,
  type PackageDetail,
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
  name: 'MQTT',
  description: 'The broker.',
  category: 'protocol',
  runtime: 'node',
  state: 'running',
  source: 'builtin',
  isSystem: true,
  repository: 'nebula-home/pkg-mqtt',
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
