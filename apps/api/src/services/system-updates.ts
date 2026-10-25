/**
 * Settings › Maintenance's list of updates (docs/releases-and-updates.md 4): Nebula Home from the
 * supervisor's GitHub check, the packages and the integrations from the packet-manager's indexes,
 * gathered into one list; and the round of updates the packet-manager runs, backup first.
 *
 * A part that cannot be read leaves its rows out and says why in `problems`, so the page shows
 * what it can.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  compareVersions,
  DeviceUnavailableError,
  integrationAvailableReplySchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageAvailableReplySchema,
  platformReleasesReplySchema,
  runUpdatesReplySchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorAcknowledgementSchema,
  updateChannelSchema,
  updateStatusReplySchema,
  type PlatformReleasesReply,
  type SystemUpdatesView,
  type UpdateItem,
  type UpdateRound,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { readSettingValues } from './settings.js';

/** What the list needs. */
export type SystemUpdatesContext = {
  readonly bus: BusClient | undefined;
  readonly db: Database;
  readonly traceId: string;
  readonly logger: PlatformLogger;
};

/** Who asked. */
type Requester = { readonly id: string; readonly username: string };

/** Reads answer quickly; a check asks GitHub, a restart waits for the daemon. */
const READ_TIMEOUT_MS = 10_000;
const CHECK_TIMEOUT_MS = 30_000;
const POWER_TIMEOUT_MS = 60_000;

/**
 * Asks a service one of its methods.
 *
 * @param context - The bus and the trace id.
 * @param service - The service.
 * @param method - The method.
 * @param payload - The request.
 * @param reply - The reply's schema.
 * @param timeoutMs - How long it may take.
 * @returns The reply.
 * @throws {DeviceUnavailableError} When the bus is away.
 */
async function ask<TReply>(
  context: SystemUpdatesContext,
  service: string,
  method: string,
  payload: unknown,
  reply: { parse: (value: unknown) => TReply } & Parameters<BusClient['request']>[2],
  timeoutMs = READ_TIMEOUT_MS,
): Promise<TReply> {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return (await context.bus.request(busSubjects.service(service, method), payload, reply, {
    traceId: context.traceId,
    timeoutMs,
  })) as TReply;
}

/**
 * Says what an error says.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gathers everything that can update.
 *
 * @param context - The request's collaborators.
 * @returns The list, Nebula Home first, and the round running or last run.
 */
export async function systemUpdates(context: SystemUpdatesContext): Promise<SystemUpdatesView> {
  const problems: string[] = [];

  /**
   * Reads one part, leaving a problem when it cannot be read.
   *
   * @param what - What it is, for the problem.
   * @param read - How it is read.
   * @returns It, or null.
   */
  const partOf = async <T>(what: string, read: () => Promise<T>): Promise<T | null> =>
    read().catch((error: unknown) => {
      problems.push(`${what}: ${messageOf(error)}`);

      return null;
    });

  const [settings, core, packages, integrations, status] = await Promise.all([
    readSettingValues(context.db),
    partOf('Nebula Home', async () =>
      ask(
        context,
        SUPERVISOR_SERVICE,
        SUPERVISOR_METHODS.platformReleases,
        { check: false },
        platformReleasesReplySchema,
      ),
    ),
    partOf('Packages', async () =>
      ask(
        context,
        PACKET_MANAGER_SERVICE,
        PACKET_MANAGER_METHODS.available,
        {},
        packageAvailableReplySchema,
        CHECK_TIMEOUT_MS,
      ),
    ),
    partOf('Integrations', async () =>
      ask(
        context,
        PACKET_MANAGER_SERVICE,
        PACKET_MANAGER_METHODS.integrationAvailable,
        {},
        integrationAvailableReplySchema,
        CHECK_TIMEOUT_MS,
      ),
    ),
    partOf('Updates', async () =>
      ask(
        context,
        PACKET_MANAGER_SERVICE,
        PACKET_MANAGER_METHODS.updateStatus,
        {},
        updateStatusReplySchema,
      ),
    ),
  ]);
  const channel = updateChannelSchema.catch('stable').parse(settings.get('updates.channel.core'));
  const release = core === null ? null : newestFor(core, channel);

  for (const error of [core?.error, packages?.error, integrations?.error]) {
    if (typeof error === 'string') {
      problems.push(error);
    }
  }

  return {
    core: core === null ? null : { ...core, channel },
    rows: [
      ...(core !== null && release !== null
        ? [
            {
              item: { kind: 'core' as const, version: release.version },
              name: 'Nebula Home',
              installedVersion: core.installedVersion,
              latestVersion: release.version,
              notes: release.notes,
              notesUrl: release.url,
            },
          ]
        : []),
      ...(packages?.items ?? [])
        .filter((each) => each.hasUpdate && each.installedVersion !== null && each.latest !== null)
        .map((each) => ({
          item: { kind: 'package' as const, id: each.id },
          name: each.name,
          installedVersion: each.installedVersion ?? '',
          latestVersion: each.latest?.version ?? '',
          notes: null,
          notesUrl: each.latest?.changelogUrl ?? null,
        })),
      ...(integrations?.items ?? [])
        .filter((each) => each.hasUpdate && each.latestVersion !== null)
        .map((each) => ({
          item: { kind: 'integration' as const, id: each.vendorId },
          name: each.name ?? each.vendorId,
          installedVersion: each.installedVersion,
          latestVersion: each.latestVersion ?? '',
          notes: null,
          notesUrl: each.changelogUrl,
        })),
    ],
    problems,
    round: status?.round ?? null,
  };
}

/**
 * The release of a channel Nebula Home could update to: newer than the one running. The beta
 * channel has the newest of the two.
 *
 * @param core - What the supervisor found.
 * @param channel - The channel followed.
 * @returns The release, or null when there is nothing newer.
 */
function newestFor(core: PlatformReleasesReply, channel: 'stable' | 'beta') {
  const candidates = channel === 'beta' ? [core.beta, core.stable] : [core.stable];
  const newest = candidates
    .filter((release) => release !== null)
    .sort((left, right) => compareVersions(right.version, left.version))[0];

  return newest !== undefined && compareVersions(newest.version, core.installedVersion) > 0
    ? newest
    : null;
}

/**
 * Asks GitHub again now for Nebula Home's releases.
 *
 * @param context - The request's collaborators.
 */
export async function checkSystemUpdates(context: SystemUpdatesContext): Promise<void> {
  await ask(
    context,
    SUPERVISOR_SERVICE,
    SUPERVISOR_METHODS.platformReleases,
    { check: true },
    platformReleasesReplySchema,
    CHECK_TIMEOUT_MS,
  );
}

/**
 * Starts a round of updates: the items asked for, or every row of the list.
 *
 * @param context - The request's collaborators.
 * @param items - What to update; every row when absent.
 * @param requestedBy - Who asked.
 * @returns The round as it starts, or null when there was nothing to update.
 */
export async function runSystemUpdates(
  context: SystemUpdatesContext,
  items: readonly UpdateItem[] | undefined,
  requestedBy: Requester,
): Promise<UpdateRound | null> {
  const wanted = items ?? (await systemUpdates(context)).rows.map((row) => row.item);

  if (wanted.length === 0) {
    return null;
  }

  const reply = await ask(
    context,
    PACKET_MANAGER_SERVICE,
    PACKET_MANAGER_METHODS.runUpdates,
    { items: wanted, requestedBy },
    runUpdatesReplySchema,
  );

  return reply.round;
}

/**
 * Has the packet-manager plan the automatic updates again, after their settings changed.
 *
 * @param context - The request's collaborators.
 */
export async function reloadUpdates(context: SystemUpdatesContext): Promise<void> {
  await ask(
    context,
    PACKET_MANAGER_SERVICE,
    PACKET_MANAGER_METHODS.reloadUpdates,
    {},
    supervisorAcknowledgementSchema,
  );
}

/**
 * Restarts or shuts down the platform's own container.
 *
 * @param context - The request's collaborators.
 * @param action - Which.
 */
export async function powerPlatform(
  context: SystemUpdatesContext,
  action: 'restart' | 'shutdown',
): Promise<void> {
  await ask(
    context,
    SUPERVISOR_SERVICE,
    action === 'restart' ? SUPERVISOR_METHODS.restartPlatform : SUPERVISOR_METHODS.shutdownPlatform,
    {},
    supervisorAcknowledgementSchema,
    POWER_TIMEOUT_MS,
  );
}
