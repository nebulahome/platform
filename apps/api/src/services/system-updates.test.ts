import { describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  catalogueRequestSchema,
  ConflictError,
  HUB_CATALOGUE_METHOD,
  HUB_SERVICE,
  integrationAvailableRequestSchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageAvailableRequestSchema,
  platformReleasesRequestSchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorEmptyRequestSchema,
  ValidationError,
  type PlatformState,
  type SystemUpdatesView,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import {
  checkSystemUpdates,
  offeredItems,
  platformState,
  type SystemUpdatesContext,
} from './system-updates.js';

/**
 * The list as the page reads it: Nebula Home, a package and an integration with an update.
 *
 * @param refusal - Why Nebula Home cannot update itself here; null when it can.
 * @returns It.
 */
function list(refusal: string | null = null): Pick<SystemUpdatesView, 'core' | 'rows'> {
  const row = (item: SystemUpdatesView['rows'][number]['item'], latestVersion: string) => ({
    item,
    name: item.kind,
    installedVersion: '1.0.0',
    latestVersion,
    notes: null,
    notesUrl: null,
  });
  const core: NonNullable<SystemUpdatesView['core']> = {
    installedVersion: '2026.10.1',
    stable: null,
    beta: null,
    dev: null,
    checkedAt: null,
    error: null,
    refusal,
    lastUpdate: null,
    channel: 'stable',
  };

  return {
    core,
    rows: [
      row({ kind: 'core', version: '2026.11.0' }, '2026.11.0'),
      row({ kind: 'package', id: 'music' }, '1.1.0'),
      row({ kind: 'integration', id: 'shelly' }, '2.6.0'),
    ],
  };
}

describe('what a round may update', () => {
  it('takes every row when nothing is named', () => {
    expect(offeredItems(list(), undefined)).toEqual([
      { kind: 'core', version: '2026.11.0' },
      { kind: 'package', id: 'music' },
      { kind: 'integration', id: 'shelly' },
    ]);
  });

  it('leaves Nebula Home out of every row where it cannot update itself', () => {
    expect(offeredItems(list('Updating needs the Docker socket'), undefined)).toEqual([
      { kind: 'package', id: 'music' },
      { kind: 'integration', id: 'shelly' },
    ]);
  });

  it('takes what was named once each', () => {
    expect(
      offeredItems(list(), [
        { kind: 'package', id: 'music' },
        { kind: 'package', id: 'music' },
        { kind: 'core', version: '2026.11.0' },
      ]),
    ).toEqual([
      { kind: 'package', id: 'music' },
      { kind: 'core', version: '2026.11.0' },
    ]);
  });

  it('refuses another version of Nebula Home than the one offered', () => {
    // An older one, or a dev build off the channel the house follows.
    for (const version of ['2026.10.0', '2026.12.0-alpha.1']) {
      expect(() => offeredItems(list(), [{ kind: 'core', version }])).toThrow(ValidationError);
    }
  });

  it('refuses an integration or a package with no update offered', () => {
    // Installing one is not an update: it takes its own permission.
    expect(() => offeredItems(list(), [{ kind: 'integration', id: 'tuya' }])).toThrow(
      ValidationError,
    );
    expect(() => offeredItems(list(), [{ kind: 'package', id: 'weather' }])).toThrow(
      ValidationError,
    );
  });

  it('refuses Nebula Home where it cannot update itself, saying why', () => {
    const refused = (): unknown =>
      offeredItems(list('An update is running'), [{ kind: 'core', version: '2026.11.0' }]);

    expect(refused).toThrow(ConflictError);
    expect(refused).toThrow('An update is running');
  });

  it('offers nothing of Nebula Home when its releases could not be read', () => {
    expect(() =>
      offeredItems({ core: null, rows: [] }, [{ kind: 'core', version: '2026.11.0' }]),
    ).toThrow(ValidationError);
  });
});

describe('what every page reads of Nebula Home', () => {
  const STATE: PlatformState = {
    version: '2026.10.1',
    machine: 'nuc',
    startedAt: new Date('2026-11-06T08:00:00Z'),
    operation: null,
    lastUpdate: null,
  };

  /**
   * The api's side of the bus, with a supervisor answering and, when asked for, a hub.
   *
   * @param isHubServing - Whether the hub answers for its catalogue.
   * @returns What the reads need.
   */
  function context(isHubServing: boolean): SystemUpdatesContext {
    const transport = new FakeTransport();
    const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });

    new BusClient({ transport, source: 'supervisor', logger }).serve(
      busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.platformState),
      supervisorEmptyRequestSchema,
      () => STATE,
    );

    if (isHubServing) {
      new BusClient({ transport, source: 'hub', logger }).serve(
        busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
        catalogueRequestSchema,
        () => ({ vendors: [] }),
      );
    }

    return {
      bus: new BusClient({ transport, source: 'api', logger }),
      // Not read: the state comes from the bus alone.
      db: {} as unknown as SystemUpdatesContext['db'],
      traceId: '01JBZ8Y6Q0000000000000000A',
      logger,
    };
  }

  it('says the hub is up once it answers', async () => {
    await expect(platformState(context(true))).resolves.toEqual({ ...STATE, isHubUp: true });
  });

  it('says the hub is away, and still what the supervisor says, while it does not', async () => {
    await expect(platformState(context(false))).resolves.toEqual({ ...STATE, isHubUp: false });
  });
});

describe('checking again now', () => {
  /**
   * The api's side of the bus, with the supervisor and the packet-manager answering when asked
   * for, each saying what it was asked.
   *
   * @param serving - Who answers.
   * @param serving.isSupervisorServing - Whether the supervisor answers.
   * @param serving.isPacketManagerServing - Whether the packet-manager answers.
   * @returns The context, and what each was asked.
   */
  function context({
    isSupervisorServing,
    isPacketManagerServing,
  }: {
    isSupervisorServing: boolean;
    isPacketManagerServing: boolean;
  }): { context: SystemUpdatesContext; asked: string[] } {
    const transport = new FakeTransport();
    const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
    const asked: string[] = [];

    if (isSupervisorServing) {
      new BusClient({ transport, source: 'supervisor', logger }).serve(
        busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.platformReleases),
        platformReleasesRequestSchema,
        (request) => {
          asked.push(`core check=${String(request.check)}`);

          return {
            installedVersion: '2026.10.1',
            stable: null,
            beta: null,
            dev: null,
            checkedAt: null,
            error: null,
            refusal: null,
            lastUpdate: null,
          };
        },
      );
    }

    if (isPacketManagerServing) {
      const packetManager = new BusClient({ transport, source: 'packet-manager', logger });

      packetManager.serve(
        busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.available),
        packageAvailableRequestSchema,
        (request) => {
          asked.push(`packages check=${String(request.check)}`);

          return { items: [], checkedAt: null, error: null };
        },
      );
      packetManager.serve(
        busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.integrationAvailable),
        integrationAvailableRequestSchema,
        (request) => {
          asked.push(`integrations check=${String(request.check)}`);

          return { items: [], error: null };
        },
      );
    }

    return {
      context: {
        bus: new BusClient({ transport, source: 'api', logger }),
        // Not read: a check asks the bus alone.
        db: {} as unknown as SystemUpdatesContext['db'],
        traceId: '01JBZ8Y6Q0000000000000000A',
        logger,
      },
      asked,
    };
  }

  it("asks GitHub and both of the Hub's indexes again", async () => {
    const { context: checking, asked } = context({
      isSupervisorServing: true,
      isPacketManagerServing: true,
    });

    await checkSystemUpdates(checking);
    expect(asked.toSorted()).toEqual([
      'core check=true',
      'integrations check=true',
      'packages check=true',
    ]);
  });

  it('checks Nebula Home still while the packet-manager does not answer', async () => {
    const { context: checking, asked } = context({
      isSupervisorServing: true,
      isPacketManagerServing: false,
    });

    await expect(checkSystemUpdates(checking)).resolves.toBeUndefined();
    expect(asked).toEqual(['core check=true']);
  });

  it('fails when GitHub could not be asked', async () => {
    const { context: checking } = context({
      isSupervisorServing: false,
      isPacketManagerServing: true,
    });

    await expect(checkSystemUpdates(checking)).rejects.toThrow();
  });
});
