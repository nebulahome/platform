import { describe, expect, it } from 'vitest';

import { inspectedContainerSchema, inspectedImageSchema } from '../docker/engine-schemas.js';

import { planRecreate } from './recreate.js';

const CONTAINER = inspectedContainerSchema.parse({
  Id: 'abcdef1234567890'.padEnd(64, '0'),
  Name: '/web',
  Created: '2026-09-01T10:00:00Z',
  Image: 'sha256:old',
  State: { Status: 'running', Running: true },
  Config: {
    Hostname: 'abcdef123456',
    Env: ['PATH=/usr/bin', 'NGINX_VERSION=1.27.3', 'SITE=home'],
    Cmd: ['nginx', '-g', 'daemon off;'],
    Image: 'nginx:1.27.3',
    Labels: { maintainer: 'NGINX', 'com.example.owner': 'me' },
    Volumes: { '/var/cache': {} },
    ExposedPorts: { '80/tcp': {} },
  },
  HostConfig: {
    NetworkMode: 'frontend',
    RestartPolicy: { Name: 'unless-stopped' },
    Binds: ['/srv/site:/usr/share/nginx/html:ro'],
  },
  Mounts: [
    { Type: 'bind', Source: '/srv/site', Destination: '/usr/share/nginx/html', RW: false },
    {
      Type: 'volume',
      Name: '4f1c2d',
      Source: '/var/lib/docker/volumes/4f1c2d/_data',
      Destination: '/var/cache',
      RW: true,
    },
  ],
  NetworkSettings: {
    Networks: {
      frontend: { Aliases: ['abcdef123456', 'web', 'www'] },
      backend: { Aliases: ['abcdef123456', 'api'] },
    },
  },
});

const OLD_IMAGE = inspectedImageSchema.parse({
  Id: 'sha256:old',
  RepoTags: ['nginx:1.27.3'],
  RepoDigests: [],
  Config: {
    Env: ['PATH=/usr/bin', 'NGINX_VERSION=1.27.3'],
    Cmd: ['nginx', '-g', 'daemon off;'],
    Labels: { maintainer: 'NGINX' },
  },
});

describe('planRecreate', () => {
  it('mounts the volumes nobody named into the new container, so their data follows', () => {
    const { body } = planRecreate(CONTAINER, OLD_IMAGE, 'nginx:1.27.4');

    expect(body['HostConfig']).toMatchObject({
      Binds: ['/srv/site:/usr/share/nginx/html:ro'],
      Mounts: [{ Type: 'volume', Source: '4f1c2d', Target: '/var/cache', ReadOnly: false }],
    });
  });

  it("keeps what the owner set and leaves the old image's defaults to the new image", () => {
    const { body } = planRecreate(CONTAINER, OLD_IMAGE, 'nginx:1.27.4');

    expect(body['Image']).toBe('nginx:1.27.4');
    expect(body['Env']).toEqual(['SITE=home']);
    expect(body['Labels']).toEqual({ 'com.example.owner': 'me' });
    expect(body).not.toHaveProperty('Cmd');
    expect(body).not.toHaveProperty('Hostname');
    expect(body).not.toHaveProperty('Volumes');
    expect(body['HostConfig']).toMatchObject({ RestartPolicy: { Name: 'unless-stopped' } });
  });

  it("starts on its first network under the owner's aliases and joins the rest after", () => {
    const plan = planRecreate(CONTAINER, OLD_IMAGE, 'nginx:1.27.4');

    expect(plan.body['NetworkingConfig']).toEqual({
      EndpointsConfig: { frontend: { Aliases: ['web', 'www'] } },
    });
    expect(plan.networks).toEqual([{ name: 'backend', aliases: ['api'] }]);
  });
});
