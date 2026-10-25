/**
 * Settings › Maintenance's calls (docs/releases-and-updates.md 4): the list of updates, a check,
 * a round of updates, and restarting or shutting down Nebula Home.
 */
import { z } from 'zod';

import {
  systemUpdatesViewSchema,
  updateRoundSchema,
  type SystemUpdatesView,
  type UpdateItem,
  type UpdateRound,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the list is cached. */
export const UPDATES_QUERY_KEY = ['system', 'updates'] as const;

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

/** Asks GitHub again now for Nebula Home's releases. */
export async function checkSystemUpdates(): Promise<void> {
  await apiRequest('/system/updates/check', z.unknown(), { method: 'POST' });
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

/**
 * Restarts or shuts down Nebula Home.
 *
 * @param action - Which.
 */
export async function powerPlatform(action: 'restart' | 'shutdown'): Promise<void> {
  await apiRequest(`/system/${action}`, z.unknown(), { method: 'POST' });
}

/**
 * Whether Nebula Home answers: its API's version list, which needs no sign-in.
 *
 * @returns True once it answers.
 */
export async function isPlatformUp(): Promise<boolean> {
  try {
    return (await fetch('/api/versions', { cache: 'no-store' })).ok;
  } catch {
    return false;
  }
}
