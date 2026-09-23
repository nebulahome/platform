import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { countDiskCategories, directorySize } from './disk-usage.js';

describe('countDiskCategories', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nebula-disk-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('counts the database and what is in each folder as parts of the platform, largest first', async () => {
    await mkdir(join(dataDir, 'cache', 'maps', '15', '17000'), { recursive: true });
    await writeFile(join(dataDir, 'cache', 'maps', '15', '17000', '11000.png'), Buffer.alloc(300));
    await mkdir(join(dataDir, 'hub', 'integrations', 'shelly'), { recursive: true });
    await writeFile(
      join(dataDir, 'hub', 'integrations', 'shelly', 'manifest.json'),
      Buffer.alloc(40),
    );
    await mkdir(join(dataDir, 'secrets'));
    await writeFile(join(dataDir, 'secrets', 'nebula-secrets-key'), Buffer.alloc(64));
    await writeFile(join(dataDir, 'notes.txt'), Buffer.alloc(20));

    const categories = await countDiskCategories({ dataDir, databaseBytes: 1000 });

    expect(categories).toEqual([
      {
        id: 'core',
        kind: 'core',
        bytes: 1424,
        parts: [
          { id: 'database', bytes: 1000 },
          { id: 'cache/maps', bytes: 300 },
          { id: 'secrets', bytes: 64 },
          { id: 'hub/integrations', bytes: 40 },
          { id: 'files', bytes: 20 },
        ],
      },
    ]);
  });

  it('gives each package and the backups a category of their own', async () => {
    await mkdir(join(dataDir, 'packages', 'nvr'), { recursive: true });
    await writeFile(join(dataDir, 'packages', 'nvr', 'model.bin'), Buffer.alloc(500));
    await mkdir(join(dataDir, 'backups'));
    await writeFile(join(dataDir, 'backups', 'nightly.tar'), Buffer.alloc(200));

    const categories = await countDiskCategories({ dataDir, databaseBytes: undefined });

    // In the order the directory listed them; putting them in reading order is the page's
    // composition's job (composeDiskUsage).
    expect(
      categories
        .map((category) => [category.id, category.kind, category.bytes])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ).toEqual([
      ['backups', 'backups', 200],
      ['core', 'core', 0],
      ['package:nvr', 'package', 500],
    ]);
  });

  it('finds nothing but an empty platform in a data directory that is not there', async () => {
    const categories = await countDiskCategories({
      dataDir: join(dataDir, 'missing'),
      databaseBytes: undefined,
    });

    expect(categories).toEqual([{ id: 'core', kind: 'core', bytes: 0, parts: [] }]);
  });
});

describe('directorySize', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nebula-walk-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not follow a link, so a link back into the tree is not counted forever', async () => {
    await mkdir(join(root, 'inner'));
    await writeFile(join(root, 'inner', 'a.bin'), Buffer.alloc(64));

    try {
      await symlink(root, join(root, 'inner', 'loop'), 'junction');
    } catch {
      // Creating links can need privileges on Windows; the walk is then simply linkless.
    }

    expect(await directorySize(root)).toBe(64);
  });
});
