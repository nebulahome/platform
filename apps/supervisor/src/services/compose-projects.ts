/**
 * The compose projects the owner writes or uploads on the containers page.
 *
 * Run by `docker compose` itself - the plugin the image installs - rather than read and made
 * container by container here: a compose file means what the plugin makes of it, dependencies,
 * networks, health checks and all, and anything less would be a second, smaller compose that
 * surprises whoever wrote the file for the real one.
 *
 * Each project is a folder of the data directory, `containers/compose/<project>/`, holding the
 * file as it was written, its `.env`, and every folder its services keep beside it - so a backup
 * takes all of it. A file is checked before anything runs: `docker compose config` reads it the
 * way `up` will, and what it refuses, a service that builds its image, a name or a port another
 * container holds are said with the line where the plugin said one. The project's own folders are
 * then pointed at where Docker finds them (`compose-paths.ts`) and the result handed to `up` on
 * its standard input.
 *
 * Every operation - deploy, start, stop, pull, remove - answers at once and runs after, one at a
 * time per project, keeping the last lines the plugin wrote for the project's page.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { COMPOSE_PROJECTS_DIRECTORY, CONTAINERS_DIRECTORY } from '@nebulahome/config';
import {
  COMPOSE_LOG_LINES,
  ConflictError,
  isNebulaError,
  NotFoundError,
  PLATFORM_COMPOSE_PROJECT,
  ValidationError,
  type ComposeAction,
  type ComposeDefinition,
  type ComposeDocument,
  type ComposeOperation,
  type ComposePhase,
  type ComposeProblem,
  type ComposeValidation,
  type JsonObject,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import {
  composeConflicts,
  problemsOf,
  rewriteComposePaths,
  type ComposeNeighbours,
} from '../domain/compose-paths.js';
import type { PlatformContext } from '../domain/managed.js';

/** The file a project is kept in. */
const COMPOSE_FILE = 'compose.yaml';

/** The values the file interpolates. */
const ENV_FILE = '.env';

/** Where a file being checked is written, beside the projects. */
const STAGING_DIRECTORY = '.staging';

/** The phase each operation begins in. */
const FIRST_PHASE: Readonly<Record<ComposeAction, ComposePhase>> = {
  deploy: 'pulling',
  pull: 'pulling',
  start: 'starting',
  stop: 'stopping',
  remove: 'removing',
};

/** Colours and cursor moves, which a log shown in a page does without. */
// eslint-disable-next-line no-control-regex -- the escape character is exactly what is matched
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;

/** What running the plugin once gives. */
export type ComposeRun = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs `docker compose` with some arguments: the real command, or a test's fake. */
export type ComposeRunner = (
  args: readonly string[],
  options: {
    readonly stdin?: string;

    /** Handed each line written, standard output and error alike. */
    readonly onLine?: (line: string) => void;
  },
) => Promise<ComposeRun>;

/**
 * The Docker socket as the command line names it.
 *
 * @param socketPath - The socket the supervisor's engine uses.
 * @returns `unix:///var/run/docker.sock`, or a named pipe on a Windows development machine.
 */
export function dockerHostOf(socketPath: string): string {
  return socketPath.startsWith('//./pipe/') ? `npipe:${socketPath}` : `unix://${socketPath}`;
}

/**
 * Runs the plugin as a child process: arguments as a list, never through a shell.
 *
 * @param cli - The `docker` command.
 * @param dockerHost - Where Docker is.
 * @returns The runner.
 */
export function commandRunner(cli: string, dockerHost: string): ComposeRunner {
  return async (args, options) =>
    new Promise<ComposeRun>((resolve, reject) => {
      // `--host` rather than `DOCKER_HOST`: the plugin is handed the command line's own host.
      const child = spawn(cli, ['--host', dockerHost, 'compose', '--ansi', 'never', ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output = { stdout: '', stderr: '' };
      const partial = { stdout: '', stderr: '' };

      /**
       * Keeps what a stream wrote, and hands on each whole line.
       *
       * @param stream - Which stream.
       * @param chunk - What it wrote.
       */
      const take = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        const text = chunk.toString('utf8');

        output[stream] += text;

        if (options.onLine === undefined) {
          return;
        }

        const lines = `${partial[stream]}${text}`.split(/\r?\n/);

        partial[stream] = lines.pop() ?? '';

        for (const line of lines) {
          options.onLine(line);
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        take('stdout', chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        take('stderr', chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        for (const rest of [partial.stdout, partial.stderr]) {
          if (rest !== '') {
            options.onLine?.(rest);
          }
        }

        resolve({ code: code ?? 1, ...output });
      });
      child.stdin.on('error', () => {
        // The plugin closed its input early - it failed before reading it - and says why.
      });
      child.stdin.end(options.stdin ?? '');
    });
}

/** What the compose projects need. */
export type ComposeProjectsOptions = {
  readonly runner: ComposeRunner;
  readonly logger: PlatformLogger;

  /** The data directory, as this process reaches it. */
  readonly dataRoot: string;

  /** The platform as the containers see it; null while Docker cannot be reached. */
  readonly context: () => PlatformContext | null;

  /** Told whenever an operation moved, so the lists read again. */
  readonly onChange: (project: string) => void;
};

/** A checked file, ready to run. */
type Checked = {
  readonly validation: ComposeValidation;

  /** The configuration to bring the project up with; null when the file cannot run. */
  readonly config: JsonObject | null;

  /** The folders of the data directory to make first, relative to it. */
  readonly folders: readonly string[];
};

/** The compose projects the owner deployed from here. */
export class ComposeProjects {
  readonly #options: ComposeProjectsOptions;
  readonly #known = new Set<string>();
  readonly #operations = new Map<string, ComposeOperation>();
  readonly #queues = new Map<string, Promise<void>>();
  #version: string | null = null;
  #suspended: string[] = [];

  /**
   * Creates the set. Nothing is read until {@link start}.
   *
   * @param options - The runner, the logger, the data directory, the platform and whom to tell.
   */
  public constructor(options: ComposeProjectsOptions) {
    this.#options = options;
  }

  /**
   * The plugin's version.
   *
   * @returns It, or null where it is not installed.
   */
  public get version(): string | null {
    return this.#version;
  }

  /**
   * Asks the plugin its version, and reads which projects were deployed from here.
   */
  public async start(): Promise<void> {
    try {
      const run = await this.#options.runner(['version', '--short'], {});

      this.#version = run.code === 0 ? run.stdout.trim().replace(/^v/, '').slice(0, 64) : null;
    } catch {
      // No `docker` where the platform runs: the rest of the page works without compose.
      this.#version = null;
    }

    if (this.#version === null) {
      this.#options.logger.warn({}, 'docker compose is not installed; compose projects are off');
    }

    await this.#load();
  }

  /**
   * Whether a project was deployed from here, and its file is kept.
   *
   * @param project - The project.
   * @returns True when it can be edited from here.
   */
  public isEditable(project: string): boolean {
    return this.#known.has(project);
  }

  /**
   * The last operation on each project deployed from here.
   *
   * @returns The operations.
   */
  public operations(): ComposeOperation[] {
    return [...this.#operations.values()];
  }

  /**
   * The projects deployed from here.
   *
   * @returns Their names.
   */
  public projects(): string[] {
    return [...this.#known];
  }

  /**
   * Checks a file without running anything.
   *
   * @param definition - The project, its file and its `.env`.
   * @param neighbours - What the other containers hold.
   * @returns What is wrong, and the services it declares.
   */
  public async validate(
    definition: ComposeDefinition,
    neighbours: ComposeNeighbours,
  ): Promise<ComposeValidation> {
    return (await this.#check(definition, neighbours)).validation;
  }

  /**
   * Keeps a file and brings the project up with it. Answers once the file is checked and kept;
   * the pull and the start go on after.
   *
   * @param definition - The project, its file and its `.env`.
   * @param neighbours - What the other containers hold.
   * @throws {ValidationError} When the file cannot run, with the problems in `details.problems`.
   * @throws {ConflictError} When the project is busy, or compose is not installed.
   */
  public async deploy(definition: ComposeDefinition, neighbours: ComposeNeighbours): Promise<void> {
    this.#requireIdle(definition.project);

    const checked = await this.#check(definition, neighbours);

    if (checked.config === null) {
      throw new ValidationError('The compose file cannot be run', {
        details: { problems: checked.validation.problems },
      });
    }

    const folder = this.#folderOf(definition.project);

    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, COMPOSE_FILE), definition.file, 'utf8');
    await writeFile(path.join(folder, ENV_FILE), definition.env, { encoding: 'utf8', mode: 0o600 });
    this.#known.add(definition.project);

    this.#enqueue(definition.project, 'deploy', async (log) => {
      await this.#up(definition.project, checked, true, log);
    });
  }

  /**
   * The file and `.env` of a project deployed from here.
   *
   * @param project - The project.
   * @returns Them, and when they were last written.
   * @throws {NotFoundError} When it was not deployed from here.
   */
  public async get(project: string): Promise<ComposeDocument> {
    this.#requireKnown(project);

    const folder = this.#folderOf(project);
    const file = await readFile(path.join(folder, COMPOSE_FILE), 'utf8');
    const env = await readFile(path.join(folder, ENV_FILE), 'utf8').catch(() => '');
    const { mtime } = await stat(path.join(folder, COMPOSE_FILE));

    return { project, file, env, updatedAt: mtime };
  }

  /**
   * Starts, stops, or pulls newer images for every service of a project and starts it on them.
   *
   * @param project - The project.
   * @param action - What to do.
   * @param neighbours - What the other containers hold, for the pull's start.
   */
  public control(
    project: string,
    action: 'start' | 'stop' | 'pull',
    neighbours: ComposeNeighbours,
  ): void {
    this.#requireKnown(project);
    this.#requireIdle(project);

    this.#enqueue(project, action, async (log) => {
      if (action === 'pull') {
        await this.#up(project, await this.#checkStored(project, neighbours), true, log);

        return;
      }

      await this.#run(project, action === 'start' ? 'starting' : 'stopping', [action], log);
    });
  }

  /**
   * Takes a project down, and forgets it.
   *
   * @param project - The project.
   * @param removeVolumes - Also its volumes, named ones included.
   * @param removeFiles - Also its folder: the file and every folder its services kept there.
   */
  public remove(project: string, removeVolumes: boolean, removeFiles: boolean): void {
    this.#requireKnown(project);
    this.#requireIdle(project);

    this.#enqueue(project, 'remove', async (log) => {
      await this.#run(
        project,
        'removing',
        ['down', '--remove-orphans', ...(removeVolumes ? ['--volumes'] : [])],
        log,
      );

      if (removeFiles) {
        await rm(this.#folderOf(project), { recursive: true, force: true });
      } else {
        // The folders stay the owner's; only the platform's claim on the project goes.
        await rm(path.join(this.#folderOf(project), COMPOSE_FILE), { force: true });
      }

      this.#known.delete(project);
    });
  }

  /**
   * Stops every project deployed from here, before a restore swaps the folders they keep.
   */
  public async suspend(): Promise<void> {
    this.#suspended = [...this.#known];

    for (const project of this.#suspended) {
      // eslint-disable-next-line no-await-in-loop -- one at a time, so the log says which failed
      const run = await this.#runPlugin(project, ['stop'], () => undefined);

      if (run.code !== 0) {
        this.#options.logger.warn({ project, output: run.stderr.slice(-500) }, 'Could not stop it');
      }
    }

    this.#options.logger.info({ projects: this.#suspended }, 'Stopped the compose projects');
  }

  /**
   * Brings every project deployed from here up again after a restore, from the files it restored.
   *
   * @param neighbours - What the other containers hold.
   */
  public async resume(neighbours: (project: string) => ComposeNeighbours): Promise<void> {
    this.#suspended = [];
    this.#known.clear();
    await this.#load();

    for (const project of this.#known) {
      this.#enqueue(project, 'deploy', async (log) => {
        await this.#up(project, await this.#checkStored(project, neighbours(project)), false, log);
      });
    }
  }

  /**
   * Reads which projects were deployed from here: every folder with a file in it.
   */
  async #load(): Promise<void> {
    const root = path.join(
      this.#options.dataRoot,
      CONTAINERS_DIRECTORY,
      COMPOSE_PROJECTS_DIRECTORY,
    );
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(async (entry) => {
          const hasFile = await stat(path.join(root, entry.name, COMPOSE_FILE))
            .then(() => true)
            .catch(() => false);

          if (hasFile) {
            this.#known.add(entry.name);
          }
        }),
    );
  }

  /**
   * The folder of a project, as this process reaches it.
   *
   * @param project - The project.
   * @returns The folder.
   */
  #folderOf(project: string): string {
    return path.join(
      this.#options.dataRoot,
      CONTAINERS_DIRECTORY,
      COMPOSE_PROJECTS_DIRECTORY,
      project,
    );
  }

  /**
   * Checks a file: what the plugin makes of it, what cannot run here, and the configuration to
   * run with its folders where Docker finds them.
   *
   * @param definition - The project, its file and its `.env`.
   * @param neighbours - What the other containers hold.
   * @returns The check.
   */
  async #check(definition: ComposeDefinition, neighbours: ComposeNeighbours): Promise<Checked> {
    this.#requireCompose();

    if (definition.project === PLATFORM_COMPOSE_PROJECT) {
      return refused([
        { line: null, message: `${PLATFORM_COMPOSE_PROJECT} is the platform's own project` },
      ]);
    }

    const context = this.#options.context();

    if (context === null) {
      throw new ConflictError('Docker cannot be reached', { details: { reason: 'unreachable' } });
    }

    const staging = path.join(
      this.#options.dataRoot,
      CONTAINERS_DIRECTORY,
      COMPOSE_PROJECTS_DIRECTORY,
      STAGING_DIRECTORY,
      randomUUID(),
    );

    await mkdir(staging, { recursive: true });

    try {
      const file = path.join(staging, COMPOSE_FILE);
      const env = path.join(staging, ENV_FILE);

      await writeFile(file, definition.file, 'utf8');
      await writeFile(env, definition.env, { encoding: 'utf8', mode: 0o600 });

      const run = await this.#options.runner(
        [
          '-p',
          definition.project,
          '--project-directory',
          this.#folderOf(definition.project),
          '-f',
          file,
          '--env-file',
          env,
          'config',
          '--format',
          'json',
        ],
        {},
      );

      if (run.code !== 0) {
        return refused(problemsOf(run.stderr));
      }

      const config = JSON.parse(run.stdout) as JsonObject;
      const services = Object.keys((config['services'] ?? {}) as JsonObject);
      const rewritten = rewriteComposePaths(config, {
        projectDir: toPosix(this.#folderOf(definition.project)),
        dataRoot: toPosix(this.#options.dataRoot),
        dataMount: context.dataMount,
      });
      const problems = [
        ...(services.length === 0 ? [{ line: null, message: 'The file declares no service' }] : []),
        ...composeConflicts(config, neighbours),
        ...rewritten.problems,
      ];

      return problems.length > 0
        ? { ...refused(problems), validation: { problems, services } }
        : {
            validation: { problems: [], services },
            config: rewritten.config,
            folders: rewritten.folders,
          };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Checks the file kept for a project.
   *
   * @param project - The project.
   * @param neighbours - What the other containers hold.
   * @returns The check.
   * @throws {ValidationError} When the kept file no longer runs.
   */
  async #checkStored(project: string, neighbours: ComposeNeighbours): Promise<Checked> {
    const document = await this.get(project);
    const checked = await this.#check(
      { project, file: document.file, env: document.env },
      neighbours,
    );

    if (checked.config === null) {
      throw new ValidationError(
        checked.validation.problems.map((problem) => problem.message).join('; ') ||
          'The compose file cannot be run',
        { details: { problems: checked.validation.problems } },
      );
    }

    return checked;
  }

  /**
   * Pulls, when asked, and brings the project up with a checked configuration.
   *
   * @param project - The project.
   * @param checked - The check, with the configuration to run.
   * @param pull - Whether to pull the images first.
   * @param log - Where the plugin's lines go.
   */
  async #up(
    project: string,
    checked: Checked,
    pull: boolean,
    log: (line: string) => void,
  ): Promise<void> {
    const config = JSON.stringify(checked.config);

    await Promise.all(
      checked.folders.map(async (folder) =>
        mkdir(path.join(this.#options.dataRoot, folder), { recursive: true }),
      ),
    );

    if (pull) {
      await this.#run(project, 'pulling', ['-f', '-', 'pull'], log, config);
    }

    await this.#run(project, 'starting', ['-f', '-', 'up', '-d', '--remove-orphans'], log, config);
  }

  /**
   * Runs one command of the plugin for a project, as one phase of its operation.
   *
   * @param project - The project.
   * @param phase - The phase it is.
   * @param args - What follows the project's own arguments.
   * @param log - Where its lines go.
   * @param stdin - The configuration, for a command that reads it.
   * @throws {Error} When the plugin fails, with the end of what it wrote.
   */
  async #run(
    project: string,
    phase: ComposePhase,
    args: readonly string[],
    log: (line: string) => void,
    stdin?: string,
  ): Promise<void> {
    this.#record(project, { phase });

    const run = await this.#runPlugin(project, args, log, stdin);

    if (run.code !== 0) {
      const last = run.stderr.replaceAll(ANSI, '').trim().split(/\r?\n/).at(-1);

      throw new Error(
        last === undefined || last === '' ? `docker compose ${args.at(-1) ?? ''} failed` : last,
      );
    }
  }

  /**
   * Runs the plugin for a project, in its folder.
   *
   * @param project - The project.
   * @param args - What follows the project's own arguments.
   * @param log - Where its lines go.
   * @param stdin - What to hand it.
   * @returns What it did.
   */
  async #runPlugin(
    project: string,
    args: readonly string[],
    log: (line: string) => void,
    stdin?: string,
  ): Promise<ComposeRun> {
    return this.#options.runner(
      ['-p', project, '--project-directory', this.#folderOf(project), ...args],
      { ...(stdin === undefined ? {} : { stdin }), onLine: log },
    );
  }

  /**
   * Queues an operation behind the project's last one, and records how it goes.
   *
   * @param project - The project.
   * @param action - What it is.
   * @param work - The work, handed where its lines go.
   */
  #enqueue(
    project: string,
    action: ComposeAction,
    work: (log: (line: string) => void) => Promise<void>,
  ): void {
    this.#operations.set(project, {
      project,
      action,
      phase: FIRST_PHASE[action],
      log: [],
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    });
    this.#options.onChange(project);

    /**
     * Keeps one line the plugin wrote.
     *
     * @param line - The line.
     */
    const log = (line: string): void => {
      const text = line.replaceAll(ANSI, '').trimEnd();
      const operation = this.#operations.get(project);

      if (text === '' || operation === undefined) {
        return;
      }

      operation.log.push(text.slice(0, 2048));

      if (operation.log.length > COMPOSE_LOG_LINES) {
        operation.log.splice(0, operation.log.length - COMPOSE_LOG_LINES);
      }
    };

    const previous = this.#queues.get(project) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        await work(log);
        this.#record(project, { phase: 'done', finishedAt: new Date() });
        this.#options.logger.info({ project, action }, 'Ran a compose project');

        if (action === 'remove') {
          this.#operations.delete(project);
        }
      } catch (error: unknown) {
        const message =
          isNebulaError(error) || error instanceof Error ? error.message : String(error);

        this.#options.logger.error({ err: error, project, action }, 'A compose project failed');
        this.#record(project, {
          phase: 'failed',
          error: message.slice(0, 4096),
          finishedAt: new Date(),
        });
      }

      this.#options.onChange(project);
    });

    this.#queues.set(project, next);
  }

  /**
   * Records where a project's operation stands, and says so.
   *
   * @param project - The project.
   * @param fields - What changed.
   */
  #record(project: string, fields: Partial<ComposeOperation>): void {
    const operation = this.#operations.get(project);

    if (operation !== undefined) {
      this.#operations.set(project, { ...operation, ...fields });
      this.#options.onChange(project);
    }
  }

  /**
   * Refuses when the plugin is not installed.
   *
   * @throws {ConflictError} Then.
   */
  #requireCompose(): void {
    if (this.#version === null) {
      throw new ConflictError('docker compose is not installed where NebulaHome runs', {
        details: { reason: 'no-compose' },
      });
    }
  }

  /**
   * Refuses a project not deployed from here.
   *
   * @param project - The project.
   * @throws {NotFoundError} Then.
   */
  #requireKnown(project: string): void {
    if (!this.#known.has(project)) {
      throw new NotFoundError(`No compose project called ${project} was deployed from here`, {
        details: { project },
      });
    }
  }

  /**
   * Refuses while an operation on the project is still going.
   *
   * @param project - The project.
   * @throws {ConflictError} Then.
   */
  #requireIdle(project: string): void {
    const phase = this.#operations.get(project)?.phase;

    if (phase !== undefined && phase !== 'done' && phase !== 'failed') {
      throw new ConflictError(`${project} is busy`, { details: { project, reason: 'busy' } });
    }
  }
}

/**
 * A check that found the file cannot run.
 *
 * @param problems - Why.
 * @returns The check.
 */
function refused(problems: readonly ComposeProblem[]): Checked {
  return { validation: { problems: [...problems], services: [] }, config: null, folders: [] };
}

/**
 * A path with forward slashes, the way the container's paths are written.
 *
 * @param value - The path.
 * @returns It, with forward slashes.
 */
function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}
