/**
 * Settings › Software's calls (docs/releases-and-updates.md 4): the list of updates, a check,
 * a round of updates, and restarting Nebula Home.
 */
import { z } from 'zod';

import {
  platformViewSchema,
  systemUpdatesViewSchema,
  updateRoundSchema,
  type PlatformView,
  type SystemUpdatesView,
  type UpdateItem,
  type UpdateRound,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the list is cached. */
export const UPDATES_QUERY_KEY = ['system', 'updates'] as const;

/** Where Nebula Home's own state is cached. */
export const PLATFORM_QUERY_KEY = ['system', 'platform'] as const;

/**
 * Reads everything that can update.
 *
 * @param signal - Cancels the request.
 * @returns The list, and the round running or last run.
 */
export async function fetchSystemUpdates(signal?: AbortSignal): Promise<SystemUpdatesView> {
  return apiRequest('/system/updates', systemUpdatesViewSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Reads what Nebula Home itself is doing: its version, a restart or an update under way, the last
 * update. Any signed-in page may.
 *
 * @param signal - Cancels the request.
 * @returns The state.
 */
export async function fetchPlatformState(signal?: AbortSignal): Promise<PlatformView> {
  return apiRequest('/system/platform', platformViewSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Where a release's notes are, on GitHub.
 *
 * @param version - The release.
 * @returns The address of its page.
 */
export function releaseNotesUrl(version: string): string {
  return `https://github.com/nebulahome/platform/releases/tag/v${version}`;
}

/** Asks GitHub again now for Nebula Home's releases. */
export async function checkSystemUpdates(): Promise<void> {
  await apiRequest('/system/updates/check', z.unknown(), { method: 'POST' });
}

/** Forgets how the last update of Nebula Home ended, so the page stops showing it. */
export async function dismissLastPlatformUpdate(): Promise<void> {
  await apiRequest('/system/updates/last', z.unknown(), { method: 'DELETE' });
}

/**
 * Starts a round of updates.
 *
 * @param items - What to update; every row of the list when absent.
 * @returns The round as it starts, or null when there was nothing to update.
 */
export async function runSystemUpdates(items?: readonly UpdateItem[]): Promise<UpdateRound | null> {
  const reply = await apiRequest(
    '/system/updates/run',
    z.object({ round: updateRoundSchema.nullable() }),
    { method: 'POST', body: items === undefined ? {} : { items } },
  );

  return reply.round;
}

/** Restarts Nebula Home. */
export async function restartPlatform(): Promise<void> {
  await apiRequest('/system/restart', z.unknown(), { method: 'POST' });
}

/**
 * Whether Nebula Home answers: its API's version list, which needs no sign-in.
 *
 * @param signal - Gives up on it; an answer that never came is no answer.
 * @returns True once it answers.
 */
export async function isPlatformUp(signal?: AbortSignal): Promise<boolean> {
  try {
    return (
      await fetch('/api/versions', {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
    ).ok;
  } catch {
    return false;
  }
}
