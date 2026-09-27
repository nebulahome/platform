import { describe, expect, it } from 'vitest';

import type { ContainerInstallRequest } from '@nebula-home/contracts';

import { installCreateBody, installedFolder, takenPorts } from './install.js';
import type { PlatformContext } from './managed.js';

const CONTEXT: PlatformContext = {
  network: 'bridge',
  networkName: 'nebulahome',
  platformAlias: 'nebulahome',
  mqtt: null,
  timezone: 'Europe/Rome',
  dataMount: { kind: 'volume', volume: 'nebulahome_nebula-data' },
};

const REQUEST: ContainerInstallRequest = {
  name: 'whoami',
  image: 'traefik/whoami',
  tag: 'v1.10',
  ports: [{ host: 8081, container: 80, protocol: 'tcp' }],
  env: [{ name: 'WHOAMI_NAME', value: 'lab' }],
  volumes: [
    { kind: 'data', name: 'config', target: '/config', isReadOnly: false },
    { kind: 'volume', name: 'whoami-cache', target: '/cache', isReadOnly: false },
    { kind: 'bind', source: '/mnt/media', target: '/media', isReadOnly: true },
  ],
  devices: [],
  restartPolicy: 'unless-stopped',
  network: 'bridge',
};

describe('installCreateBody', () => {
  it('asks Docker for what the form said', () => {
    expect(installCreateBody(REQUEST, CONTEXT)).toEqual({
      Image: 'traefik/whoami:v1.10',
      Env: ['WHOAMI_NAME=lab'],
      Labels: { 'io.nebulahome.installed': 'true' },
      ExposedPorts: { '80/tcp': {} },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        Mounts: [
          {
            Type: 'volume',
            Source: 'nebulahome_nebula-data',
            Target: '/config',
            VolumeOptions: { Subpath: 'containers/installed/whoami/config' },
          },
          { Type: 'volume', Source: 'whoami-cache', Target: '/cache' },
          { Type: 'bind', Source: '/mnt/media', Target: '/media', ReadOnly: true },
        ],
        Devices: [],
        NetworkMode: 'bridge',
        PortBindings: { '80/tcp': [{ HostPort: '8081' }] },
      },
    });
  });

  it("puts a container on the platform's network under its name", () => {
    const body = installCreateBody({ ...REQUEST, network: 'platform' }, CONTEXT);

    expect(body['HostConfig']).toMatchObject({ NetworkMode: 'nebulahome' });
    expect(body['NetworkingConfig']).toEqual({
      EndpointsConfig: { nebulahome: { Aliases: ['whoami'] } },
    });
  });

  it("publishes nothing on the host's network, where every port already is the machine's", () => {
    const body = installCreateBody({ ...REQUEST, network: 'host' }, CONTEXT);

    expect(body['HostConfig']).not.toHaveProperty('PortBindings');
  });
});

describe('installedFolder', () => {
  it('keeps the folders under the containers the owner installed', () => {
    expect(installedFolder('whoami', 'config')).toBe('containers/installed/whoami/config');
  });
});

describe('takenPorts', () => {
  it('names the host ports another container already publishes', () => {
    expect(takenPorts(REQUEST, new Set(['8081/tcp']))).toEqual(['8081/tcp']);
    expect(takenPorts(REQUEST, new Set(['8081/udp']))).toEqual([]);
    expect(takenPorts({ ...REQUEST, network: 'host' }, new Set(['8081/tcp']))).toEqual([]);
  });
});
