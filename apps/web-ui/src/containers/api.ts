/**
 * The calls the containers pages make.
 *
 * Every answer is parsed with the contract's schema, as everywhere else, so a server that changes
 * the shape fails the parse instead of drawing a page out of whatever arrived.
 */
import { z } from 'zod';

import {
  containerDetailSchema,
  containerLogsReplySchema,
  containersViewSchema,
  containerSummarySchema,
  type ContainerAction,
  type ContainerDetail,
  type ContainerLogsReply,
  type ContainersView,
  type ContainerSummary,
} from '@nebula-home/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the containers are cached. */
export const CONTAINER_QUERY_KEYS = {
  all: ['containers'],
  list: ['containers', 'list'],
  /**
   * Where one container is cached.
   *
   * @param name - Its name.
   * @returns The key.
   */
  one: (name: string) => ['containers', 'one', name] as const,

  /**
   * Where one container's logs are cached.
   *
   * @param name - Its name.
   * @returns The key.
   */
  logs: (name: string) => ['containers', 'logs', name] as const,
} as const;

/**
 * The path of one container.
 *
 * @param name - Its name.
 * @returns `/containers/<name>`.
 */
function pathOf(name: string): string {
  return `/containers/${encodeURIComponent(name)}`;
}

/**
 * Reads every container, and whether Docker can be seen.
 *
 * @param signal - Cancels the request.
 * @returns Docker's status and the containers.
 */
export async function fetchContainers(signal?: AbortSignal): Promise<ContainersView> {
  return apiRequest('/containers', containersViewSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Reads one container.
 *
 * @param name - Its name.
 * @param signal - Cancels the request.
 * @returns The container.
 */
export async function fetchContainer(name: string, signal?: AbortSignal): Promise<ContainerDetail> {
  return apiRequest(pathOf(name), containerDetailSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Reads the last lines a container wrote.
 *
 * @param name - Its name.
 * @param tail - How many lines.
 * @param signal - Cancels the request.
 * @returns The lines, oldest first.
 */
export async function fetchContainerLogs(
  name: string,
  tail: number,
  signal?: AbortSignal,
): Promise<ContainerLogsReply> {
  return apiRequest(`${pathOf(name)}/logs?tail=${String(tail)}`, containerLogsReplySchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Starts, stops or restarts a container.
 *
 * @param name - Its name.
 * @param action - What to do.
 * @returns The container as it now is.
 */
export async function controlContainer(
  name: string,
  action: ContainerAction,
): Promise<ContainerSummary> {
  return apiRequest(`${pathOf(name)}/${action}`, containerSummarySchema, { method: 'POST' });
}

/**
 * Starts updating a container to the newest image on offer.
 *
 * @param name - Its name.
 */
export async function updateContainer(name: string): Promise<void> {
  await apiRequest(`${pathOf(name)}/update`, z.unknown(), { method: 'POST' });
}

/**
 * Asks the registries now whether newer images are out.
 */
export async function checkContainerUpdates(): Promise<void> {
  await apiRequest('/containers/check-updates', z.unknown(), { method: 'POST' });
}
