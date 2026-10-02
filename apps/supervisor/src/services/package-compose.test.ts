/**
 * The packages' compose projects against stand-in projects: a new or changed project brought up,
 * an unchanged one left alone, one no longer declared taken down.
 */
import { describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import type { ComposeDefinition } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import type { PlatformContext } from '../domain/managed.js';

import { PackageCompose } from './package-compose.js';

const logger = createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' });

const CONTEXT: PlatformContext = {
  network: 'bridge',
  installationId: 'test',
  networkName: 'nebulahome',
  platformAlias: 'nebulahome',
  mqtt: null,
  timezone: 'Europe/Rome',
  dataMount: { kind: 'volume', volume: 'nebulahome_nebula-data' },
};

/**
 * Stand-in projects that keep what was deployed.
 *
 * @param kept - The projects already there, with their files and values.
 * @returns The projects, and what was deployed and removed.
 */
function standIn(kept: Map<string, { file: string; env: string }>) {
  const deployed: ComposeDefinition[] = [];
  const removed: string[] = [];

  return {
    deployed,
    removed,
    projects: {
      projects: () => [...kept.keys()],
      isEditable: (project: string) => kept.has(project),
      get: async (project: string) => {
        const found = kept.get(project);

        if (found === undefined) {
          throw new Error('missing');
        }

        return Promise.resolve({ project, ...found, updatedAt: new Date() });
      },
      deploy: async (definition: ComposeDefinition) => {
        deployed.push(definition);
        kept.set(definition.project, { file: definition.file, env: definition.env });

        return Promise.resolve();
      },
      remove: (project: string) => {
        removed.push(project);
      },
    },
  };
}

describe("the packages' compose projects", () => {
  it('brings a new project up, leaves an unchanged one, and takes a dropped one down', async () => {
    const kept = new Map<string, { file: string; env: string }>();
    const stand = standIn(kept);
    const compose = new PackageCompose({
      projects: stand.projects,
      client: new BusClient({ transport: new FakeTransport(), source: 'supervisor', logger }),
      logger,
      context: () => CONTEXT,
      neighbours: () => ({ names: new Set(), ports: new Set() }),
    });
    const nvr = {
      packageId: 'nvr',
      file: 'services:\n  server:\n    image: x\n',
      values: { NEBULA_SETUP_CITY: 'Turin' },
    };

    await compose.reconcile([nvr]);
    await compose.reconcile([nvr]);

    expect(stand.deployed).toHaveLength(1);
    expect(stand.deployed[0]).toMatchObject({ project: 'nebulahome-pkg-nvr', file: nvr.file });
    expect(stand.deployed[0]?.env).toContain("NEBULA_SETUP_CITY='Turin'");
    expect(stand.deployed[0]?.env).toContain("NEBULA_PLATFORM_TIMEZONE='Europe/Rome'");
    expect(compose.runs('nvr')).toBe(true);

    await compose.reconcile([{ ...nvr, values: { NEBULA_SETUP_CITY: 'Milan' } }]);

    expect(stand.deployed).toHaveLength(2);

    await compose.reconcile([]);

    expect(stand.removed).toEqual(['nebulahome-pkg-nvr']);
    expect(compose.runs('nvr')).toBe(false);
  });
});
