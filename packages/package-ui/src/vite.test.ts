/**
 * The Vite preset, building a package's interface for real.
 *
 * What is asserted is that what the interface shares is not bundled - each import of it reads the
 * interface's copy, named imports included - that what is not shared is, and that the build is the
 * one module and the one stylesheet the manifest points at.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nebulaPackageUi } from './vite.js';

let root: string;
let built: string;

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'package-ui-'));
  mkdirSync(path.join(root, 'src', 'ui'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'ui', 'helper.js'),
    'export function shout(text) { return `${text}!`; }\n',
  );
  writeFileSync(path.join(root, 'src', 'ui', 'styles.css'), '.broker { color: red; }\n');
  writeFileSync(
    path.join(root, 'src', 'ui', 'index.tsx'),
    [
      "import './styles.css';",
      "import { useState } from 'react';",
      "import { jsx } from 'react/jsx-runtime';",
      "import { Button } from '@nebula-home/ui';",
      "import { definePackageUi, usePackageRpc } from '@nebula-home/package-ui';",
      "import { shout } from './helper.js';",
      '',
      'function Page() {',
      '  const [count] = useState(0);',
      "  const clients = usePackageRpc('clients');",
      '  return jsx(Button, { children: shout(String(count + (clients.data ?? 0))) });',
      '}',
      '',
      'export default definePackageUi({ page: Page });',
      '',
    ].join('\n'),
  );

  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [nebulaPackageUi()],
  });

  built = readFileSync(path.join(root, 'ui', 'index.js'), 'utf8');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the build of a package interface', () => {
  it('reads what the interface shares instead of bundling it', () => {
    expect(built).toContain('globalThis.__nebula');
    expect(built).toContain('does not share react');
    expect(built).toContain('does not share @nebula-home/ui');
    expect(built).toContain('does not share @nebula-home/package-ui');
    expect(built).not.toContain('react.production');
    expect(built).not.toMatch(/from\s*["']react["']/u);
  });

  it('bundles what is its own', () => {
    expect(built).toContain('!');
    expect(built).not.toContain('./helper.js');
  });

  it('is one module and one stylesheet where the manifest points', () => {
    expect(existsSync(path.join(root, 'ui', 'index.js'))).toBe(true);
    expect(readFileSync(path.join(root, 'ui', 'index.css'), 'utf8')).toContain('.broker');
  });

  it("works against the interface's copies, named imports and all", async () => {
    const calls: string[] = [];
    const nebula = {
      modules: {
        react: { useState: (value: unknown) => [value, () => undefined] },
        'react/jsx-runtime': {
          jsx: (type: unknown, props: { children: string }) => ({ type, props }),
        },
        '@nebula-home/ui': { Button: 'button' },
        '@nebula-home/package-ui': {
          definePackageUi: (definition: unknown) => definition,
          usePackageRpc: (method: string) => {
            calls.push(method);

            return { data: 2 };
          },
        },
      },
    };

    (globalThis as { __nebula?: unknown }).__nebula = nebula;

    try {
      const url = `data:text/javascript;base64,${Buffer.from(built).toString('base64')}`;
      const module = (await import(/* @vite-ignore */ url)) as {
        default: { page: () => { props: { children: string } } };
      };

      expect(module.default.page().props.children).toBe('2!');
      expect(calls).toEqual(['clients']);
    } finally {
      delete (globalThis as { __nebula?: unknown }).__nebula;
    }
  });
});
