import { describe, expect, it } from 'vitest';

import { composeOf, isSystemContainer } from './system.js';

/**
 * The labels `docker compose` gives a service's container.
 *
 * @param project - The project.
 * @param service - The service.
 * @returns The labels.
 */
function composed(project: string, service: string): Record<string, string> {
  return {
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
    'com.docker.compose.container-number': '1',
    'com.docker.compose.project.working_dir': '/srv/stack',
    'com.docker.compose.project.config_files': '/srv/stack/compose.yaml,/srv/stack/override.yaml',
    'com.docker.compose.version': '2.39.1',
  };
}

const SELF = { id: 'self', labels: composed('nebulahome', 'nebulahome') };

describe('isSystemContainer', () => {
  it('counts the platform itself', () => {
    expect(isSystemContainer(SELF, SELF)).toBe(true);
  });

  it("counts the other services of the platform's compose project", () => {
    expect(isSystemContainer({ id: 'db', labels: composed('nebulahome', 'postgres') }, SELF)).toBe(
      true,
    );
  });

  it('counts a container its compose file labels, even when the platform runs natively', () => {
    expect(
      isSystemContainer({ id: 'db', labels: { 'io.nebulahome.platform': 'true' } }, null),
    ).toBe(true);
  });

  it("leaves another project's containers and a lone container to the owner", () => {
    expect(isSystemContainer({ id: 'web', labels: composed('media', 'plex') }, SELF)).toBe(false);
    expect(isSystemContainer({ id: 'lone', labels: {} }, SELF)).toBe(false);
    expect(isSystemContainer({ id: 'web', labels: composed('media', 'plex') }, null)).toBe(false);
  });
});

describe('composeOf', () => {
  it('reads the project, the service and where its files were', () => {
    expect(composeOf(composed('media', 'plex'), (project) => project === 'media')).toEqual({
      project: 'media',
      service: 'plex',
      number: 1,
      workingDir: '/srv/stack',
      configFiles: ['/srv/stack/compose.yaml', '/srv/stack/override.yaml'],
      version: '2.39.1',
      isEditable: true,
    });
  });

  it('says nothing for a container started on its own', () => {
    expect(composeOf({}, () => true)).toBe(null);
  });
});
