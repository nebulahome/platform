import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@nebula-home/contracts';

import { composeConflicts, problemsOf, rewriteComposePaths } from './compose-paths.js';

/** A project as `docker compose config --format json` writes it. */
const CONFIG: JsonObject = {
  name: 'web',
  services: {
    nginx: {
      image: 'nginx:alpine',
      ports: [{ mode: 'ingress', target: 80, published: '8088', protocol: 'tcp' }],
      volumes: [
        {
          type: 'bind',
          source: '/data/containers/compose/web/html',
          target: '/usr/share/nginx/html',
          read_only: true,
          bind: { create_host_path: true },
        },
        { type: 'bind', source: '/mnt/media', target: '/media' },
        { type: 'volume', source: 'cache', target: '/cache', volume: {} },
      ],
    },
  },
  volumes: { cache: { name: 'web_cache' } },
};

const OPTIONS = { projectDir: '/data/containers/compose/web', dataRoot: '/data' };

describe('rewriteComposePaths', () => {
  it("points the project's own folders at the host's, where the data is a folder of it", () => {
    const { config, folders, problems } = rewriteComposePaths(CONFIG, {
      ...OPTIONS,
      dataMount: { kind: 'bind', hostPath: '/srv/nebula/' },
    });
    const nginx = (config['services'] as Record<string, JsonObject>)['nginx'];

    expect(problems).toEqual([]);
    expect(folders).toEqual(['containers/compose/web/html']);
    expect(nginx?.['volumes']).toEqual([
      {
        type: 'bind',
        source: '/srv/nebula/containers/compose/web/html',
        target: '/usr/share/nginx/html',
        read_only: true,
        bind: { create_host_path: true },
      },
      { type: 'bind', source: '/mnt/media', target: '/media' },
      { type: 'volume', source: 'cache', target: '/cache', volume: {} },
    ]);
    expect(nginx?.['labels']).toEqual({ 'io.nebulahome.compose': 'true' });
  });

  it('mounts them as a part of the data volume, where the data is a volume', () => {
    const { config } = rewriteComposePaths(CONFIG, {
      ...OPTIONS,
      dataMount: { kind: 'volume', volume: 'nebulahome_nebula-data' },
    });
    const nginx = (config['services'] as Record<string, JsonObject>)['nginx'];

    expect((nginx?.['volumes'] as JsonObject[])[0]).toEqual({
      type: 'volume',
      source: 'nebulahome-platform-data',
      target: '/usr/share/nginx/html',
      read_only: true,
      volume: { subpath: 'containers/compose/web/html' },
    });
    expect(config['volumes']).toEqual({
      cache: { name: 'web_cache' },
      'nebulahome-platform-data': { external: true, name: 'nebulahome_nebula-data' },
    });
  });

  it('says it cannot, where Docker is too old to mount a part of a volume', () => {
    const { problems } = rewriteComposePaths(CONFIG, {
      ...OPTIONS,
      dataMount: { kind: 'separate' },
    });

    expect(problems).toHaveLength(1);
  });
});

describe('composeConflicts', () => {
  it('names a port and a name another container holds, and an image to build', () => {
    const config: JsonObject = {
      services: {
        ...(CONFIG['services'] as JsonObject),
        app: { build: { context: '.' }, container_name: 'plex' },
      },
    };

    expect(
      composeConflicts(config, { names: new Set(['plex']), ports: new Set(['8088/tcp']) }).map(
        (problem) => problem.message,
      ),
    ).toEqual([
      'nginx: port 8088/tcp of the machine is already published by another container',
      'app builds its image: only an image from a registry can be run here',
      'app: another container is already called plex',
    ]);
  });
});

describe('problemsOf', () => {
  it("keeps what docker compose said, with the file's line when it said", () => {
    expect(
      problemsOf(
        'validating /data/containers/compose/.staging/compose.yaml: yaml: line 4: mapping values are not allowed in this context\n',
      ),
    ).toEqual([
      { line: 4, message: 'yaml: line 4: mapping values are not allowed in this context' },
    ]);
  });

  it('reads the line the way a newer plugin writes it, and drops the file it names', () => {
    expect(
      problemsOf(
        'failed to parse /data/containers/compose/.staging/x/compose.yaml: go-yaml load error in scanner at L4.C17: mapping values are not allowed in this context',
      ),
    ).toEqual([
      {
        line: 4,
        message:
          'go-yaml load error in scanner at L4.C17: mapping values are not allowed in this context',
      },
    ]);
  });
});
