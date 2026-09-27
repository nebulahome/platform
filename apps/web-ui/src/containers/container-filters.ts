/**
 * What the containers page is narrowed by: a search, whether a container runs, and who it
 * belongs to - the platform itself, an integration, or the owner.
 *
 * Kept in the address like every other list's filter, and pure, so what the list lets through is
 * tested without the page.
 */
import type { ContainerSummary } from '@nebula-home/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

/** Whether a container runs. */
export const CONTAINER_RUN_CHOICES = ['any', 'running', 'stopped'] as const;

/** Whether a container runs. */
export type ContainerRunChoice = (typeof CONTAINER_RUN_CHOICES)[number];

/** Who a container belongs to. */
export const CONTAINER_OWNER_CHOICES = ['any', 'platform', 'integration', 'other'] as const;

/** Who a container belongs to. */
export type ContainerOwnerChoice = (typeof CONTAINER_OWNER_CHOICES)[number];

/** What the containers page is narrowed by. */
export type ContainerFilter = {
  readonly search: string;
  readonly run: ContainerRunChoice;
  readonly owner: ContainerOwnerChoice;
};

/** Every container. */
export const OPEN_CONTAINER_FILTER: ContainerFilter = { search: '', run: 'any', owner: 'any' };

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
    run: readChoice(params, 'run', CONTAINER_RUN_CHOICES, 'any'),
    owner: readChoice(params, 'owner', CONTAINER_OWNER_CHOICES, 'any'),
  }),

  /**
   * Writes what differs from the open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({ q: [filter.search, ''], run: [filter.run, 'any'], owner: [filter.owner, 'any'] }),
};

/**
 * Who a container belongs to.
 *
 * @param container - The container.
 * @returns The platform for its own, an integration for one it runs, the owner otherwise.
 */
export function ownerOf(container: ContainerSummary): Exclude<ContainerOwnerChoice, 'any'> {
  if (container.isSelf) {
    return 'platform';
  }

  return container.managedBy !== null && !container.managedBy.isReleased ? 'integration' : 'other';
}

/**
 * Whether a container is one the filter lets through.
 *
 * @param container - The container.
 * @param filter - The filter.
 * @returns True when it passes every part of it.
 */
export function matchesContainer(container: ContainerSummary, filter: ContainerFilter): boolean {
  const isRunning = container.state === 'running';

  if (filter.run !== 'any' && (filter.run === 'running') !== isRunning) {
    return false;
  }

  if (filter.owner !== 'any' && ownerOf(container) !== filter.owner) {
    return false;
  }

  return matchesQuery(
    [container.name, container.image, container.version, container.managedBy?.vendorId],
    filter.search,
  );
}
