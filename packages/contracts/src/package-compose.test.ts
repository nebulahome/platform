import { describe, expect, it } from 'vitest';

import { composeVariableOf, packageComposeProblems } from './package-compose.js';

describe('a package’s compose file', () => {
  it('runs with folders beside it and devices of the host', () => {
    expect(
      packageComposeProblems({
        services: {
          server: {
            image: 'example/server:2.3.1',
            volumes: ['./data:/data', '/dev/ttyUSB0:/dev/ttyUSB0'],
          },
        },
      }),
    ).toEqual([]);
  });

  it('refuses what the platform must keep: built images, names, networks, volumes it cannot back up', () => {
    expect(
      packageComposeProblems({
        services: {
          server: {
            build: '.',
            container_name: 'mine',
            network_mode: 'host',
            volumes: [
              'db:/var/lib/db',
              '../outside:/x',
              { type: 'bind', source: '/etc', target: '/etc' },
            ],
          },
          'Bad Name': { image: 'x' },
        },
        volumes: { db: {} },
      }),
    ).toEqual([
      'Named volumes are not kept by a backup: use a folder beside the file, ./data',
      "server: a package's images are pulled, never built: name an image",
      'server: names no image',
      "server: the platform names a package's containers; leave out container_name",
      "server: the platform puts a package's services on its network; leave out network_mode",
      'server: db is a volume a backup does not keep: use a folder beside the file, ./data',
      "server: ../outside is outside the project's folder; only ./folders and devices under /dev",
      "server: /etc is outside the project's folder; only ./folders and devices under /dev",
      'Bad Name: a service is named like a container, a short lower-case id',
    ]);
  });

  it('reads a normalized file, whose folders are inside the project’s', () => {
    const projectDir = '/data/containers/packages/nebulahome-pkg-nvr';

    expect(
      packageComposeProblems(
        {
          services: {
            server: {
              image: 'x',
              volumes: [{ type: 'bind', source: `${projectDir}/data`, target: '/data' }],
            },
          },
        },
        { projectDir },
      ),
    ).toEqual([]);
  });

  it('names a setting’s variable in upper snake case', () => {
    expect(composeVariableOf('apiToken')).toBe('NEBULA_SETUP_API_TOKEN');
    expect(composeVariableOf('port')).toBe('NEBULA_SETUP_PORT');
  });
});
