import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BACKUP_EXCLUDES,
  BACKUPS_DIRECTORY,
  CACHE_DIRECTORY,
  DEVELOPMENT_DATA_DIR,
  resolveDataLayout,
  SECRETS_DIRECTORY,
} from './data-layout.js';

describe('resolveDataLayout', () => {
  it('puts every folder under the data directory it was given', () => {
    const root = path.resolve('/srv/nebula');
    const layout = resolveDataLayout({ NEBULA_DATA_DIR: root });

    expect(layout).toEqual({
      root,
      integrations: path.join(root, 'hub', 'integrations'),
      matter: path.join(root, 'hub', 'matter'),
      proxyTls: path.join(root, 'proxy', 'tls'),
      packages: path.join(root, 'packages'),
      containers: path.join(root, 'containers'),
      containerCache: path.join(root, 'cache', 'containers'),
      secrets: path.join(root, 'secrets'),
      cache: path.join(root, 'cache'),
      mapTiles: path.join(root, 'cache', 'maps'),
      backups: path.join(root, 'backups'),
    });
  });

  it("falls back to the repository's infra/data, found from the package rather than the working directory", () => {
    expect(resolveDataLayout({}).root).toBe(DEVELOPMENT_DATA_DIR);
    expect(DEVELOPMENT_DATA_DIR.endsWith(path.join('infra', 'data'))).toBe(true);
    expect(path.isAbsolute(DEVELOPMENT_DATA_DIR)).toBe(true);
  });

  it('keeps the map tiles in the cache, which a backup leaves out', () => {
    const layout = resolveDataLayout({});

    expect(path.relative(layout.cache, layout.mapTiles).startsWith('..')).toBe(false);
  });

  it("keeps a container's volumes out of the cache, and the ones that can be made again in it", () => {
    const layout = resolveDataLayout({});

    expect(path.relative(layout.cache, layout.containers).startsWith('..')).toBe(true);
    expect(path.relative(layout.cache, layout.containerCache).startsWith('..')).toBe(false);
  });
});

describe('BACKUP_EXCLUDES', () => {
  it('leaves out the backups themselves, the cache and the keys, and nothing else', () => {
    expect([...BACKUP_EXCLUDES].sort()).toEqual(
      [BACKUPS_DIRECTORY, CACHE_DIRECTORY, SECRETS_DIRECTORY].sort(),
    );
  });
});
