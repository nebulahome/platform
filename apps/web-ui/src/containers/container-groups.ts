/**
 * How the containers page lays the containers out: one card per compose project, one per
 * container started on its own, one per install still going.
 *
 * A compose project is one thing to the person who wrote it - the services of a stack - so it is
 * one card, opening a page of its own that lists them. The platform's own project is the
 * exception, as the board draws it: Nebula Home, PostgreSQL and NATS are each a card, first, each
 * marked part of the platform. A project the platform is deploying before any of its containers exists
 * still gets its card, from the operation, so the page shows the work from the moment it began.
 *
 * Pure, so what the grid shows is tested without the page.
 */
import type { ComposeOperation, ContainerInstall, ContainerSummary } from '@nebulahome/contracts';

import { matchesQuery } from '@/lib/search-text';

import { matchesContainer, type ContainerFilter } from './container-filters';

/** A compose project, as its card shows it. */
export type ComposeGroup = {
  readonly kind: 'compose';
  readonly project: string;

  /** What the card calls it. */
  readonly title: string;
  readonly containers: readonly ContainerSummary[];

  /** Whether it is the platform's own. */
  readonly isSystem: boolean;

  /** Whether the platform deployed it and keeps its file. */
  readonly isEditable: boolean;

  /** The last operation on it, for a project deployed from here. */
  readonly operation: ComposeOperation | null;
};

/** One card of the grid. */
export type ContainerTile =
  | ComposeGroup
  | { readonly kind: 'container'; readonly container: ContainerSummary }
  | { readonly kind: 'install'; readonly install: ContainerInstall };

/**
 * What a compose project is called on its card.
 *
 * @param project - The project's name.
 * @param isSystem - Whether it is the platform's own.
 * @returns `NebulaHome` for the platform's, the name in words otherwise.
 */
export function projectTitle(project: string, isSystem: boolean): string {
  if (isSystem) {
    return 'NebulaHome';
  }

  const words = project.split(/[_-]+/).filter((word) => word !== '');

  return words.length === 0
    ? project
    : words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

/**
 * Every compose project the containers and the operations name.
 *
 * @param containers - Every container.
 * @param operations - The last operation on each project deployed from here.
 * @returns The projects, the platform's first, then by title.
 */
export function composeGroups(
  containers: readonly ContainerSummary[],
  operations: readonly ComposeOperation[],
): ComposeGroup[] {
  const members = new Map<string, ContainerSummary[]>();

  for (const container of containers) {
    if (container.compose !== null) {
      members.set(container.compose.project, [
        ...(members.get(container.compose.project) ?? []),
        container,
      ]);
    }
  }

  for (const operation of operations) {
    if (!members.has(operation.project)) {
      members.set(operation.project, []);
    }
  }

  return [...members.entries()]
    .map(([project, list]): ComposeGroup => {
      const isSystem = list.some((container) => container.isSystem);
      const operation = operations.find((each) => each.project === project) ?? null;

      return {
        kind: 'compose',
        project,
        title: projectTitle(project, isSystem),
        containers: list,
        isSystem,
        isEditable:
          operation !== null || list.some((container) => container.compose?.isEditable === true),
        operation,
      };
    })
    .sort(
      (left, right) =>
        Number(right.isSystem) - Number(left.isSystem) || left.title.localeCompare(right.title),
    );
}

/**
 * The cards the grid shows, narrowed by the filter.
 *
 * A project is shown when any of its containers passes, or its name is searched for; an install
 * when its name or image is.
 *
 * @param containers - Every container.
 * @param operations - The last operation on each project deployed from here.
 * @param installs - The installs still going, or failed.
 * @param filter - What the page is narrowed by.
 * @returns The cards: installs first, then the platform's, then the rest by name.
 */
export function containerTiles(
  containers: readonly ContainerSummary[],
  operations: readonly ComposeOperation[],
  installs: readonly ContainerInstall[],
  filter: ContainerFilter,
): ContainerTile[] {
  // What has no container yet - an install, a project being deployed - is the owner's and not
  // running: shown unless the filter asks for something else.
  const isPendingShown =
    filter.run !== 'running' && (filter.owner === 'any' || filter.owner === 'other');
  const groups = composeGroups(containers, operations).filter(
    (group) =>
      // The platform's own project is not one card: each of its containers is its own.
      !group.isSystem &&
      (group.containers.length === 0
        ? isPendingShown && matchesQuery([group.project, group.title], filter.search)
        : group.containers.some((container) => matchesContainer(container, filter))),
  );
  const alone = containers
    .filter(
      (container) =>
        (container.compose === null || container.isSystem) && matchesContainer(container, filter),
    )
    .map((container) => ({ kind: 'container' as const, container }));
  const pending = isPendingShown
    ? installs
        .filter((install) => matchesQuery([install.name, install.image], filter.search))
        .map((install) => ({ kind: 'install' as const, install }))
    : [];

  /**
   * What a card is sorted by.
   *
   * @param tile - The card.
   * @returns The platform's first, then by what the card is called.
   */
  const key = (tile: ComposeGroup | (typeof alone)[number]): [number, string] =>
    tile.kind === 'compose'
      ? [tile.isSystem ? 0 : 1, tile.title]
      : [tile.container.isSystem ? 0 : 1, tile.container.displayName];

  return [
    ...pending,
    ...[...groups, ...alone].sort((left, right) => {
      const [leftRank, leftName] = key(left);
      const [rightRank, rightName] = key(right);

      return leftRank - rightRank || leftName.localeCompare(rightName);
    }),
  ];
}

/**
 * What a compose project's containers take together.
 *
 * @param group - The project.
 * @returns How many run, and their processor share and memory added up; null for none measured.
 */
export function groupUsage(group: Pick<ComposeGroup, 'containers'>): {
  readonly running: number;
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
} {
  const running = group.containers.filter((container) => container.state === 'running');
  const cpu = running.flatMap((container) =>
    container.cpuPercent === null ? [] : [container.cpuPercent],
  );
  const memory = running.flatMap((container) =>
    container.memoryUsedBytes === null ? [] : [container.memoryUsedBytes],
  );

  return {
    running: running.length,
    cpuPercent: cpu.length === 0 ? null : cpu.reduce((sum, value) => sum + value, 0),
    memoryUsedBytes: memory.length === 0 ? null : memory.reduce((sum, value) => sum + value, 0),
  };
}
