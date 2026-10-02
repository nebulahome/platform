import { describe, expect, it } from 'vitest';

import type { PlatformContext } from './managed.js';
import {
  composeEnv,
  packageIdOfProject,
  packageProjectOf,
  platformVariables,
  shapePackageCompose,
} from './package-compose.js';

const BRIDGE: PlatformContext = {
  network: 'bridge',
  installationId: 'test',
  networkName: 'nebulahome',
  platformAlias: 'nebulahome',
  mqtt: { url: 'mqtt://127.0.0.1:1883', username: 'nvr', password: 'secret' },
  timezone: 'Europe/Rome',
  dataMount: { kind: 'volume', volume: 'nebulahome_nebula-data' },
};

const PROJECT_DIR = '/data/containers/packages/nebulahome-pkg-nvr';

describe('a package’s compose project', () => {
  it('is named after the package, and read back', () => {
    expect(packageProjectOf('nvr')).toBe('nebulahome-pkg-nvr');
    expect(packageIdOfProject('nebulahome-pkg-nvr')).toBe('nvr');
    expect(packageIdOfProject('media')).toBeUndefined();
  });

  it('puts the platform’s labels and network on every service, whatever the file says', () => {
    const { config, problems } = shapePackageCompose(
      {
        name: 'nebulahome-pkg-nvr',
        services: {
          server: {
            image: 'example/server:1.0.0',
            labels: { mine: 'yes' },
            networks: { default: null },
            volumes: [{ type: 'bind', source: `${PROJECT_DIR}/data`, target: '/data' }],
          },
        },
        networks: { default: { name: 'nebulahome-pkg-nvr_default' } },
      },
      'nebulahome-pkg-nvr',
      BRIDGE,
      PROJECT_DIR,
    );

    expect(problems).toEqual([]);
    expect(config).toMatchObject({
      services: {
        server: {
          labels: {
            mine: 'yes',
            'io.nebulahome.managed': 'true',
            'io.nebulahome.owner-kind': 'package',
            'io.nebulahome.vendor': 'nvr',
            'io.nebulahome.dependency': 'server',
            'io.nebulahome.installation': 'test',
          },
          networks: { nebulahome: { aliases: ['pkg-nvr-server'] } },
        },
      },
      networks: { nebulahome: { name: 'nebulahome', external: true } },
    });
  });

  it('runs on the host’s network on a host platform, and says what cannot run', () => {
    const { config, problems } = shapePackageCompose(
      { services: { server: { image: 'x', container_name: 'mine' } } },
      'nebulahome-pkg-nvr',
      { ...BRIDGE, network: 'host' },
      PROJECT_DIR,
    );

    expect(config).toMatchObject({ services: { server: { network_mode: 'host' } } });
    expect(config['networks']).toBeUndefined();
    expect(problems.map((problem) => problem.message)).toEqual([
      "server: the platform names a package's containers; leave out container_name",
    ]);
  });

  it('writes its values quoted, and the platform’s as variables', () => {
    expect(composeEnv({ NEBULA_SETUP_TOKEN: "it's", NEBULA_SETUP_CITY: 'Turin' })).toBe(
      `NEBULA_SETUP_CITY='Turin'\nNEBULA_SETUP_TOKEN="it's"\n`,
    );
    expect(platformVariables(BRIDGE)).toMatchObject({
      NEBULA_PLATFORM_MQTT_USERNAME: 'nvr',
      NEBULA_PLATFORM_TIMEZONE: 'Europe/Rome',
    });
  });
});
