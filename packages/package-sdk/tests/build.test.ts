/**
 * `buildPackage` against a real package (`tests/fixture`): both halves built through its own
 * `vite.config.ts`, the release staged as the platform unpacks it, the interface's entry and
 * chunks loadable with the interface's React, the server free of the interface.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import { list } from 'tar';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { run } from '../src/cli/index.js';
import { packRelease } from '../src/cli/pack.js';
import { buildPackage } from '../src/vite/build.js';

const root = fileURLToPath(new URL('fixture/', import.meta.url));
const dist = path.join(root, 'dist');

/**
 * Reads a JSON file of the release.
 *
 * @param file - Its path in the release.
 * @returns What it holds.
 */
async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dist, file), 'utf8'));
}

beforeAll(async () => {
  await buildPackage({ root, logLevel: 'silent' });
}, 120_000);

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  Reflect.deleteProperty(globalThis, '__nebula');
});

describe('building a package', () => {
  it('stages the release the platform unpacks', async () => {
    expect((await readdir(dist)).sort()).toEqual([
      'logo.svg',
      'nebula.package.json',
      'server',
      'setup.json',
      'ui',
    ]);
    expect(await json('nebula.package.json')).toMatchObject({
      id: 'weather',
      version: '0.2.0',
      sdk: '^1.0.0',
      runtime: 'node',
      repository: 'nebula-home/pkg-weather',
      logo: { path: './logo.svg' },
      server: { entry: './server/index.js' },
      ui: {
        entry: './ui/index.js',
        styles: './ui/index.css',
        page: true,
        cards: [{ id: 'forecast', sizes: ['wide'] }],
        entityViews: ['alert'],
      },
      setup: './setup.json',
    });
    expect(await json('server/package.json')).toEqual({ type: 'module' });
  });

  it('builds a server that runs on its own, and knows nothing of the interface', async () => {
    const code = await readFile(path.join(dist, 'server', 'index.js'), 'utf8');
    const server: unknown = await import(pathToFileURL(path.join(dist, 'server', 'index.js')).href);

    expect(code).not.toContain('page-component-marker');
    expect(code).not.toMatch(/from ["']/);
    expect(server).toMatchObject({ default: { kind: 'nebula.server' } });
  });

  it('builds an interface whose components load with the interface’s React', async () => {
    Reflect.set(globalThis, '__nebula', {
      version: 2,
      sdk: '1.0.0',
      modules: { react: React, 'react/jsx-runtime': JsxRuntime },
    });

    const ui: unknown = await import(pathToFileURL(path.join(dist, 'ui', 'index.js')).href);
    const definition = (ui as { default: Record<string, unknown> }).default;
    const cards = definition['cards'] as Record<string, () => Promise<unknown>>;
    const forecastCard = await cards['forecast']?.();

    expect(definition).toMatchObject({ kind: 'nebula.ui' });
    expect(typeof forecastCard).toBe('function');
    expect((await readdir(path.join(dist, 'ui', 'chunks'))).length).toBeGreaterThanOrEqual(3);
  });

  it('bundles no React of its own, and builds for React’s production runtime', async () => {
    const files = [
      path.join(dist, 'ui', 'index.js'),
      ...(await readdir(path.join(dist, 'ui', 'chunks'))).map((file) =>
        path.join(dist, 'ui', 'chunks', file),
      ),
    ];
    const code = (await Promise.all(files.map(async (file) => readFile(file, 'utf8')))).join('\n');

    // React's element symbol is in its own code, never in a module that borrows it.
    expect(code).not.toContain('react.transitional.element');
    expect(code).not.toContain('jsxDEV');
  });

  it('scopes the interface’s stylesheet to the package', async () => {
    const css = await readFile(path.join(dist, 'ui', 'index.css'), 'utf8');

    expect(css).toContain(':where([data-nebula-package="weather"]) .forecast');
  });

  it('packs the release, at its root, with its entry for the index', async () => {
    const packed = await packRelease({
      root,
      outDir: dist,
      urlBase: 'https://github.com/nebula-home/pkg-weather/releases/download/v0.2.0',
      now: new Date('2026-10-02T08:00:00Z'),
    });
    const entries: string[] = [];

    await list({ file: packed.archive, onReadEntry: (entry) => entries.push(entry.path) });

    expect(entries).toContain('nebula.package.json');
    expect(entries).toContain('server/index.js');
    expect(entries).toContain('ui/index.js');
    expect(
      createHash('sha256')
        .update(await readFile(packed.archive))
        .digest('hex'),
    ).toBe(packed.sha256);
    expect(JSON.parse(await readFile(packed.indexEntry, 'utf8'))).toEqual({
      version: '0.2.0',
      platform: '^1.0.0',
      sdk: '^1.0.0',
      requires: { packages: {}, services: [] },
      provides: [],
      artifact: {
        url: 'https://github.com/nebula-home/pkg-weather/releases/download/v0.2.0/weather-0.2.0.tgz',
        sha256: packed.sha256,
        size: packed.size,
      },
      publishedAt: '2026-10-02T08:00:00.000Z',
    });

    await rm(packed.archive);
    await rm(packed.indexEntry);
  });

  it('says through its command whether the package holds together', async () => {
    const written: string[] = [];
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => written.push(String(chunk)) > 0);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(await run(['validate', '--root', root])).toBe(0);
    expect(await run(['pack', '--root', path.join(root, 'src')])).toBe(1);
    expect(await run(['launch'])).toBe(1);
    write.mockRestore();
    out.mockRestore();
    expect(written.join('')).toContain('There is no command launch');
  });
});
