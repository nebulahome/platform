/**
 * The command as it is published, run where Vite is not installed - `npx` in an empty folder, or a
 * package that has not added its build tools yet: the help and a mistyped command work, and a
 * command that builds says what to install instead of failing to load.
 *
 * It builds the command the way `tsdown.config.ts` does, into a folder outside the repository, so
 * nothing the SDK is developed with is there to be found.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import configs from '../tsdown.config.js';

/** What the command did. */
type Ran = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
let folder = '';

/**
 * Says whether Node would find Vite from a folder: in a `node_modules` of it or of a folder above.
 *
 * @param from - The folder.
 * @returns True when it would.
 */
function viteFoundFrom(from: string): boolean {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'node_modules', 'vite'))) {
      return true;
    }

    if (path.dirname(dir) === dir) {
      return false;
    }
  }
}

/**
 * Runs the built command in the folder.
 *
 * @param args - Its arguments.
 * @returns Its exit code and what it wrote.
 */
async function command(...args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(folder, 'dist', 'cli.js'), ...args],
      { cwd: folder },
      (error, stdout, stderr) => {
        resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
      },
    );
  });
}

beforeAll(async () => {
  const node = configs.find((config) => typeof config.entry === 'object' && 'cli' in config.entry);

  if (node === undefined) {
    throw new Error('tsdown.config.ts builds the command');
  }

  folder = await mkdtemp(path.join(os.tmpdir(), 'nebulahome-package-'));

  if (viteFoundFrom(folder)) {
    throw new Error(`${folder} finds a Vite above it: the test would prove nothing`);
  }

  await build({
    ...node,
    config: false,
    cwd: packageRoot,
    outDir: path.join(folder, 'dist'),
    dts: false,
    logLevel: 'silent',
  });
}, 120_000);

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('the command without Vite', () => {
  it('prints its help', async () => {
    const ran = await command('--help');

    expect(ran).toMatchObject({ code: 0, stderr: '' });
    expect(ran.stdout).toContain('Usage: nebulahome-package');
  });

  it('says there is no such command', async () => {
    const ran = await command('launch');

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain('There is no command launch.');
  });

  it.each(['validate', 'build', 'pack'])('says what %s needs installed', async (name) => {
    const ran = await command(name);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(`nebulahome-package ${name} needs Vite`);
    expect(ran.stderr).toContain(
      'pnpm add -D vite typescript react @types/react @vitejs/plugin-react tailwindcss @tailwindcss/vite',
    );
    expect(ran.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  });
});
