/**
 * `buildPackage` against a real package (`tests/fixture`): both halves built through its own
 * `vite.config.ts`, the release staged as the platform unpacks it, the interface's entry and
 * chunks loadable with the interface's React, the server free of the interface.
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  it('scopes the interface’s stylesheet to the package', async () => {
    const css = await readFile(path.join(dist, 'ui', 'index.css'), 'utf8');

    expect(css).toContain(':where([data-nebula-package="weather"]) .forecast');
  });
});
