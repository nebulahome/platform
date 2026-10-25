/**
 * `pnpm release:beta` / `pnpm release:stable` [--dry-run]: cuts a release of the platform
 * (docs/releases-and-updates.md 3).
 *
 * Checks the checkout, works out the version, bumps every private workspace, runs the gates,
 * builds the image, commits and tags (a stable release also merges `dev` into `main`), then
 * publishes: the push, the image's tags, the GitHub release. Nothing is public before the push;
 * when a step after it fails, the commands still to run are printed. `--dry-run` prints the
 * version, the files and every command, and changes nothing.
 */
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nextVersion, type Channel } from './release-version.js';

/** The platform's folder. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The image, as Docker Hub names it. */
const IMAGE = 'nebulahome/platform';

/** One command. */
type Command = { readonly cmd: string; readonly args: readonly string[] };

/**
 * Writes a command as it would be typed.
 *
 * @param command - The command.
 * @returns It, arguments with spaces quoted.
 */
function show(command: Command): string {
  const args = command.args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg));

  return [command.cmd, ...args].join(' ');
}

/**
 * Runs a command in the platform's folder, its output on the terminal.
 *
 * @param command - What to run.
 * @throws {Error} When it fails.
 */
function run(command: Command): void {
  // pnpm is a .cmd on Windows, which only a shell starts; its arguments here have no spaces.
  const result = spawnSync(command.cmd, command.args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: command.cmd === 'pnpm' && process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`${show(command)} failed`);
  }
}

/**
 * Runs a command that only reads, and returns what it printed.
 *
 * @param cmd - The program.
 * @param args - Its arguments.
 * @returns Its output, trimmed, or null when it failed.
 */
function read(cmd: string, ...args: string[]): string | null {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });

  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Says whether a ref exists.
 *
 * @param ref - The full ref, `refs/heads/main`.
 * @returns True when it does.
 */
function hasRef(ref: string): boolean {
  return read('git', 'rev-parse', '--verify', '--quiet', ref) !== null;
}

/**
 * Checks the checkout before anything is changed.
 *
 * @param channel - Beta or stable.
 * @throws {Error} With every problem found.
 */
function preflight(channel: Channel): void {
  const problems: string[] = [];

  if (read('git', 'rev-parse', '--abbrev-ref', 'HEAD') !== 'dev') {
    problems.push('Releases are cut from dev: switch to it.');
  }

  if (read('git', 'status', '--porcelain') !== '') {
    problems.push('The working tree has changes: commit or stash them.');
  }

  run({ cmd: 'git', args: ['fetch', '--quiet', '--tags', 'origin'] });

  if (read('git', 'rev-parse', 'dev') !== read('git', 'rev-parse', 'origin/dev')) {
    problems.push('dev is not the same as origin/dev: pull or push first.');
  }

  if (
    channel === 'stable' &&
    hasRef('refs/heads/main') &&
    hasRef('refs/remotes/origin/main') &&
    read('git', 'rev-parse', 'main') !== read('git', 'rev-parse', 'origin/main')
  ) {
    problems.push('main is not the same as origin/main: bring it in step first.');
  }

  if (read('gh', 'auth', 'status') === null) {
    problems.push('The GitHub CLI is not signed in: run gh auth login.');
  }

  if (read('docker', 'info', '--format', '{{.ServerVersion}}') === null) {
    problems.push('Docker is not running.');
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

/**
 * Lists the package.json files the release bumps: the root's and every private workspace's.
 * The published SDKs keep versions of their own (RULES.md 17.4).
 *
 * @returns Their paths, relative to the platform's folder.
 */
async function manifests(): Promise<string[]> {
  const groups = await Promise.all(
    ['apps', 'packages'].map(async (group) =>
      (await readdir(path.join(ROOT, group), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.posix.join(group, entry.name, 'package.json')),
    ),
  );
  const workspaces = await Promise.all(
    groups.flat().map(async (file) => {
      const text = await readFile(path.join(ROOT, file), 'utf8').catch(() => null);

      return text !== null && (JSON.parse(text) as { private?: boolean }).private === true
        ? file
        : null;
    }),
  );

  return ['package.json', ...workspaces.filter((file) => file !== null)];
}

/**
 * Sets the version in each file, leaving the rest of it as it is.
 *
 * @param files - The package.json files.
 * @param version - The version.
 */
async function bump(files: readonly string[], version: string): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      const text = await readFile(path.join(ROOT, file), 'utf8');

      await writeFile(
        path.join(ROOT, file),
        text.replace(/"version": "[^"]*"/, `"version": "${version}"`),
      );
    }),
  );
}

/**
 * The image's tags: the version, and the moving tags of its channel. The beta channel always has
 * the newest of the two.
 *
 * @param version - The version.
 * @param channel - Beta or stable.
 * @returns The tags.
 */
function imageTags(version: string, channel: Channel): string[] {
  const moving = channel === 'beta' ? ['beta'] : ['stable', 'latest', 'beta'];

  return [version, ...moving].map((tag) => `${IMAGE}:${tag}`);
}

/**
 * The commands that put a stable release on `main`: the branch (made the first time), the merge
 * commit, and the tag on it.
 *
 * @param version - The version.
 * @param tag - Its tag.
 * @returns The commands.
 */
function toMain(version: string, tag: string): Command[] {
  const branch = hasRef('refs/heads/main')
    ? ['switch', '--quiet', 'main']
    : hasRef('refs/remotes/origin/main')
      ? ['switch', '--quiet', '-c', 'main', '--track', 'origin/main']
      : ['switch', '--quiet', '-c', 'main'];

  return [
    { cmd: 'git', args: branch },
    {
      cmd: 'git',
      args: ['merge', '--no-ff', '--quiet', 'dev', '-m', `chore(repo): merge ${version} into main`],
    },
    { cmd: 'git', args: ['tag', '-a', tag, '-m', `Nebula Home ${version}`] },
    { cmd: 'git', args: ['switch', '--quiet', 'dev'] },
  ];
}

/**
 * Says what an error says.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cuts the release.
 *
 * @param channel - Beta or stable.
 * @param isDryRun - Whether to only print what would be done.
 */
async function release(channel: Channel, isDryRun: boolean): Promise<void> {
  preflight(channel);

  const tags = (read('git', 'tag', '--list', 'v*') ?? '').split('\n');
  const version = nextVersion(tags, channel, new Date());
  const tag = `v${version}`;
  const files = await manifests();
  const images = imageTags(version, channel);

  const prepare: Command[] = [
    { cmd: 'pnpm', args: ['lint'] },
    { cmd: 'pnpm', args: ['typecheck'] },
    { cmd: 'pnpm', args: ['test'] },
    {
      cmd: 'docker',
      args: [
        'build',
        '--platform',
        'linux/amd64',
        '--build-arg',
        `NEBULA_VERSION=${version}`,
        ...images.flatMap((image) => ['-t', image]),
        '.',
      ],
    },
  ];
  const commit: Command[] = [
    { cmd: 'git', args: ['add', ...files] },
    { cmd: 'git', args: ['commit', '--quiet', '-m', `chore(repo): release ${version}`] },
    ...(channel === 'stable'
      ? toMain(version, tag)
      : [{ cmd: 'git', args: ['tag', '-a', tag, '-m', `Nebula Home ${version}`] }]),
  ];
  const publish: Command[] = [
    {
      cmd: 'git',
      args: ['push', '--atomic', 'origin', 'dev', ...(channel === 'stable' ? ['main'] : []), tag],
    },
    ...images.map((image) => ({ cmd: 'docker', args: ['push', image] })),
    {
      cmd: 'gh',
      args: [
        'release',
        'create',
        tag,
        '--verify-tag',
        '--generate-notes',
        '--title',
        `Nebula Home ${version}`,
        channel === 'beta' ? '--prerelease' : '--latest',
      ],
    },
  ];

  process.stdout.write(
    `Nebula Home ${version} (${channel})\n\nBumps:\n  ${files.join('\n  ')}\n\n`,
  );

  if (isDryRun) {
    const all = [...prepare, ...commit, ...publish].map((command) => `  ${show(command)}`);

    process.stdout.write(`${all.join('\n')}\n`);

    return;
  }

  await bump(files, version);

  try {
    prepare.forEach(run);
  } catch (error) {
    run({ cmd: 'git', args: ['checkout', '--', ...files] });

    throw new Error(`${messageOf(error)}. Nothing was changed.`, { cause: error });
  }

  try {
    commit.forEach(run);
  } catch (error) {
    throw new Error(
      `${messageOf(error)}. Nothing is published. To undo it locally: git switch dev, ` +
        `git reset --hard origin/dev, git tag -d ${tag}` +
        `${channel === 'stable' ? ', and reset main to origin/main' : ''}.`,
      { cause: error },
    );
  }

  for (const [index, command] of publish.entries()) {
    try {
      run(command);
    } catch (error) {
      const left = publish.slice(index).map((each) => `  ${show(each)}`);

      throw new Error(`${messageOf(error)}. Still to run:\n${left.join('\n')}`, { cause: error });
    }
  }

  process.stdout.write(`\nReleased Nebula Home ${version}.\n`);
}

const [channel, ...flags] = process.argv.slice(2);

if (channel === 'beta' || channel === 'stable') {
  release(channel, flags.includes('--dry-run')).catch((error: unknown) => {
    process.stderr.write(`\n${messageOf(error)}\n`);
    process.exitCode = 1;
  });
} else {
  process.stderr.write('Usage: tsx scripts/release.ts <beta|stable> [--dry-run]\n');
  process.exitCode = 1;
}
