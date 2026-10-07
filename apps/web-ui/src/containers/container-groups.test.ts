import { describe, expect, it } from 'vitest';

import type { ComposeOperation, ContainerInstall } from '@nebulahome/contracts';

import { composeOf, containerSummary } from '@/testing/container-fixtures';

import { OPEN_CONTAINER_FILTER } from './container-filters';
import { composeGroups, containerTiles, groupUsage, projectTitle } from './container-groups';

const PLATFORM = containerSummary({
  name: 'nebulahome-nebulahome-1',
  displayName: 'NebulaHome',
  isSelf: true,
  isSystem: true,
  compose: composeOf('nebulahome', 'nebulahome'),
  cpuPercent: 2,
  memoryUsedBytes: 100,
});

const DATABASE = containerSummary({
  name: 'nebulahome-postgres-1',
  displayName: 'PostgreSQL',
  isSystem: true,
  compose: composeOf('nebulahome', 'postgres'),
  cpuPercent: 1.5,
  memoryUsedBytes: 50,
});

const PLEX = containerSummary({
  name: 'media-plex-1',
  displayName: 'Plex',
  compose: composeOf('media-stack', 'plex', { isEditable: true }),
  state: 'exited',
});

const ALONE = containerSummary({ name: 'whoami', displayName: 'Whoami' });

const OPERATION: ComposeOperation = {
  project: 'fresh',
  action: 'deploy',
  phase: 'pulling',
  log: [],
  error: null,
  startedAt: new Date('2026-09-27T20:00:00Z'),
  finishedAt: null,
};

const INSTALL: ContainerInstall = {
  name: 'grafana',
  image: 'grafana/grafana:12.0.0',
  phase: 'pulling',
  progress: 40,
  error: null,
  startedAt: new Date('2026-09-27T20:00:00Z'),
};

describe('projectTitle', () => {
  it("calls the platform's project NebulaHome and another by its name in words", () => {
    expect(projectTitle('nebulahome', true)).toBe('NebulaHome');
    expect(projectTitle('media-stack', false)).toBe('Media Stack');
  });
});

describe('composeGroups', () => {
  it('gathers the containers of each project, the platform first', () => {
    const groups = composeGroups([PLEX, ALONE, DATABASE, PLATFORM], [OPERATION]);

    expect(groups.map((group) => [group.title, group.containers.length, group.isEditable])).toEqual(
      [
        ['NebulaHome', 2, false],
        ['Fresh', 0, true],
        ['Media Stack', 1, true],
      ],
    );
  });
});

describe('containerTiles', () => {
  it('shows installs first, then the platform container by container, then the rest', () => {
    const tiles = containerTiles(
      [PLEX, ALONE, DATABASE, PLATFORM],
      [],
      [INSTALL],
      OPEN_CONTAINER_FILTER,
    );

    expect(
      tiles.map((tile) =>
        tile.kind === 'compose'
          ? tile.title
          : tile.kind === 'container'
            ? tile.container.displayName
            : tile.install.name,
      ),
    ).toEqual(['grafana', 'NebulaHome', 'PostgreSQL', 'Media Stack', 'Whoami']);
  });

  it('keeps a project when one of its containers passes the filter', () => {
    const tiles = containerTiles([PLEX, ALONE, DATABASE, PLATFORM], [], [INSTALL], {
      ...OPEN_CONTAINER_FILTER,
      run: 'stopped',
    });

    expect(tiles.map((tile) => tile.kind)).toEqual(['install', 'compose']);
  });

  it("shows only the platform's containers when asked for the system", () => {
    const tiles = containerTiles([PLEX, ALONE, DATABASE, PLATFORM], [OPERATION], [INSTALL], {
      ...OPEN_CONTAINER_FILTER,
      owner: 'system',
    });

    // The platform's containers, each its own card: not its project as one.
    expect(
      tiles.map((tile) => (tile.kind === 'container' ? tile.container.displayName : tile.kind)),
    ).toEqual(['NebulaHome', 'PostgreSQL']);
  });
});

describe('groupUsage', () => {
  it('adds up what the running containers of a project take', () => {
    expect(groupUsage({ containers: [PLATFORM, DATABASE, PLEX] })).toEqual({
      running: 2,
      cpuPercent: 3.5,
      memoryUsedBytes: 150,
    });
  });
});
