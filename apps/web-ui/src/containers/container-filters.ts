/**
 * What the containers page is narrowed by: a search, whether a container runs, and who it
 * belongs to - the platform itself (its own container and the rest of its compose file), an
 * integration, or the owner.
 *
 * Kept in the address like every other list's filter, and pure, so what the list lets through is
 * tested without the page.
 */
import type { ContainerSummary } from '@nebulahome/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

/** Whether a container runs. */
export const CONTAINER_RUN_STATES = ['running', 'stopped'] as const;

/** Whether a container runs. */
export type ContainerRunState = (typeof CONTAINER_RUN_STATES)[number];

/** Who a container belongs to. */
export const CONTAINER_OWNER_CHOICES = ['any', 'system', 'integration', 'other'] as const;

/** Who a container belongs to. */
export type ContainerOwnerChoice = (typeof CONTAINER_OWNER_CHOICES)[number];

/** What the containers page is narrowed by. */
export type ContainerFilter = {
  readonly search: string;

  /** Only containers running or stopped, as ticked: any of them. None means either. */
  readonly runs: readonly ContainerRunState[];

  readonly owner: ContainerOwnerChoice;
};

/** Every container. */
export const OPEN_CONTAINER_FILTER: ContainerFilter = { search: '', runs: [], owner: 'any' };

/** How the filter lives in the address. */
export const CONTAINER_FILTER_CODEC: ListCodec<ContainerFilter> = {
  keys: ['q', 'run', 'owner'],

  /**
   * Reads the filter.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    runs: (params.get('run') ?? '')
      .split(',')
      .flatMap((value) => CONTAINER_RUN_STATES.filter((state) => state === value)),
    owner: readChoice(params, 'owner', CONTAINER_OWNER_CHOICES, 'any'),
  }),

  /**
   * Writes what differs from the open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({
      q: [filter.search, ''],
      run: [filter.runs.join(','), ''],
      owner: [filter.owner, 'any'],
    }),
};

/**
 * Who a container belongs to.
 *
 * @param container - The container.
 * @returns The system for the platform's own, an integration for one it runs, the owner
 * otherwise.
 */
export function ownerOf(container: ContainerSummary): Exclude<ContainerOwnerChoice, 'any'> {
  if (container.isSelf || container.isSystem) {
    return 'system';
  }

  return container.managedBy !== null && !container.managedBy.isReleased ? 'integration' : 'other';
}

/**
 * Whether a container runs.
 *
 * @param container - The container.
 * @returns Running, or stopped for every other state.
 */
export function runStateOf(container: ContainerSummary): ContainerRunState {
  return container.state === 'running' ? 'running' : 'stopped';
}

/**
 * Whether a container is one the filter lets through.
 *
 * @param container - The container.
 * @param filter - The filter.
 * @returns True when it passes every part of it.
 */
export function matchesContainer(container: ContainerSummary, filter: ContainerFilter): boolean {
  if (filter.runs.length > 0 && !filter.runs.includes(runStateOf(container))) {
    return false;
  }

  if (filter.owner !== 'any' && ownerOf(container) !== filter.owner) {
    return false;
  }

  return matchesQuery(
    [
      container.displayName,
      container.name,
      container.image,
      container.version,
      container.managedBy?.vendorId,
      container.compose?.project,
      container.compose?.service,
    ],
    filter.search,
  );
}
