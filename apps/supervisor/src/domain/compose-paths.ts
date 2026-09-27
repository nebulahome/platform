/**
 * A compose project's folders, where Docker can find them.
 *
 * `docker compose` runs inside the platform's container, so the paths it resolves are the
 * container's: `./html` of a project kept in `/data/containers/compose/web` becomes
 * `/data/containers/compose/web/html`. Docker, which mounts it, is on the host, where that path
 * means nothing. So every folder of a service that is inside the project's own folder is pointed
 * at the same folder the way the host sees it - a folder of the host when the data directory is
 * bound from one, a part of the data volume (`volume.subpath`) when it is a named volume - exactly
 * as the volumes of an integration's containers are. A path outside the project is the host's own,
 * as the owner wrote it, and is left alone.
 *
 * The configuration read and written here is `docker compose config --format json`'s: every path
 * already absolute, every short form already long.
 */
import path from 'node:path';

import { COMPOSE_LABEL, type ComposeProblem, type JsonObject } from '@nebula-home/contracts';

import type { DataMount } from './managed.js';

/** The name the data volume is given among a project's volumes, where it is mounted in part. */
export const DATA_VOLUME_KEY = 'nebulahome-platform-data';

/** One volume entry of a service, in the long form `config` writes. */
type ServiceVolume = {
  type?: string;
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: JsonObject;
  volume?: JsonObject;
  [key: string]: unknown;
};

/** What rewriting the paths needs. */
export type ComposePathsOptions = {
  /** The project's folder, as the supervisor sees it. */
  readonly projectDir: string;

  /** The data directory, as the supervisor sees it. */
  readonly dataRoot: string;

  /** How the data directory reaches Docker. */
  readonly dataMount: DataMount;
};

/** What rewriting gives. */
export type RewrittenCompose = {
  readonly config: JsonObject;

  /** The folders of the data directory to make before Docker mounts them, relative to it. */
  readonly folders: readonly string[];
  readonly problems: readonly ComposeProblem[];
};

/**
 * Whether a path is the folder or inside it.
 *
 * @param child - The path.
 * @param parent - The folder.
 * @returns True when it is.
 */
function isInside(child: string, parent: string): boolean {
  const relative = path.posix.relative(parent, child);

  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}

/**
 * Points the project's own folders at where Docker finds them, and labels every service as the
 * platform's.
 *
 * @param config - What `docker compose config --format json` wrote.
 * @param options - The project's folder, the data directory, and how it reaches Docker.
 * @returns The configuration to bring the project up with, the folders to make, and what cannot
 * be done.
 */
export function rewriteComposePaths(
  config: JsonObject,
  options: ComposePathsOptions,
): RewrittenCompose {
  const folders: string[] = [];
  const problems: ComposeProblem[] = [];
  const services = (config['services'] ?? {}) as Record<string, JsonObject>;
  const rewritten: Record<string, JsonObject> = {};

  for (const [name, service] of Object.entries(services)) {
    const volumes = ((service['volumes'] ?? []) as ServiceVolume[]).map((volume) => {
      if (
        volume.type !== 'bind' ||
        volume.source === undefined ||
        !isInside(volume.source, options.projectDir)
      ) {
        return volume;
      }

      const folder = path.posix.relative(options.dataRoot, volume.source);

      folders.push(folder);

      switch (options.dataMount.kind) {
        case 'bind': {
          return {
            ...volume,
            source: `${options.dataMount.hostPath.replace(/[/\\]+$/, '')}/${folder}`,
          };
        }

        case 'volume': {
          // A bind's own options mean nothing to a volume, and the plugin refuses them there.
          return {
            type: 'volume',
            source: DATA_VOLUME_KEY,
            target: volume.target,
            ...(volume.read_only === undefined ? {} : { read_only: volume.read_only }),
            volume: { subpath: folder },
          };
        }

        case 'separate': {
          problems.push({
            line: null,
            message: `${name}: ${volume.target ?? 'a folder'} is a folder of the project, and this Docker is too old to mount a folder of NebulaHome's data (26 or newer is). Use a named volume instead.`,
          });

          return volume;
        }
      }
    });
    const labels = (service['labels'] ?? {}) as Record<string, string>;

    rewritten[name] = {
      ...service,
      ...(service['volumes'] === undefined ? {} : { volumes: volumes as JsonObject[] }),
      labels: { ...labels, [COMPOSE_LABEL]: 'true' },
    };
  }

  const topVolumes = (config['volumes'] ?? {}) as Record<string, JsonObject>;

  return {
    config: {
      ...config,
      services: rewritten,
      ...(folders.length > 0 && options.dataMount.kind === 'volume'
        ? {
            volumes: {
              ...topVolumes,
              [DATA_VOLUME_KEY]: { external: true, name: options.dataMount.volume },
            },
          }
        : {}),
    },
    folders: [...new Set(folders)],
    problems,
  };
}

/** What checking a project against the machine needs. */
export type ComposeNeighbours = {
  /** The names of every container of another project, or of none. */
  readonly names: ReadonlySet<string>;

  /** Every `port/protocol` a container of another project, or of none, publishes. */
  readonly ports: ReadonlySet<string>;
};

/**
 * What in a project cannot be run here: a service that builds its image, a name or a port another
 * container already has.
 *
 * @param config - What `docker compose config --format json` wrote.
 * @param neighbours - What the other containers hold.
 * @returns The problems, none when it can run.
 */
export function composeConflicts(
  config: JsonObject,
  neighbours: ComposeNeighbours,
): ComposeProblem[] {
  const problems: ComposeProblem[] = [];
  const services = (config['services'] ?? {}) as Record<string, JsonObject>;

  for (const [name, service] of Object.entries(services)) {
    if (service['build'] !== undefined) {
      problems.push({
        line: null,
        message: `${name} builds its image: only an image from a registry can be run here`,
      });
    }

    if (service['image'] === undefined && service['build'] === undefined) {
      problems.push({ line: null, message: `${name} names no image` });
    }

    const containerName = service['container_name'];

    if (typeof containerName === 'string' && neighbours.names.has(containerName)) {
      problems.push({
        line: null,
        message: `${name}: another container is already called ${containerName}`,
      });
    }

    if (service['network_mode'] === 'host') {
      continue;
    }

    for (const port of (service['ports'] ?? []) as JsonObject[]) {
      const published = port['published'];
      const protocol = typeof port['protocol'] === 'string' ? port['protocol'] : 'tcp';

      if ((typeof published !== 'string' && typeof published !== 'number') || published === '') {
        continue;
      }

      const key = `${String(published)}/${protocol}`;

      if (neighbours.ports.has(key)) {
        problems.push({
          line: null,
          message: `${name}: port ${key} of the machine is already published by another container`,
        });
      }
    }
  }

  return problems;
}

/**
 * What `docker compose` wrote when it refused a file, as problems a person can act on.
 *
 * @param output - Its error output.
 * @returns One problem per line worth reading, with the line of the file when it said.
 */
export function problemsOf(output: string): ComposeProblem[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) =>
      line
        // The staging file's path means nothing to the owner.
        .replace(/^(?:validating|failed to parse) .+?\.ya?ml: /, '')
        .replace(/^(?:error|Error): /, '')
        .trim(),
    )
    .filter((line) => line !== '');

  return (lines.length === 0 ? ['docker compose refused the file'] : lines).map((message) => {
    // `yaml: line 4: …` from an older plugin, `… at L4.C17: …` from a newer one.
    const found = /\bline (\d+)\b|\bL(\d+)\.C\d+\b/.exec(message);
    const line = found?.[1] ?? found?.[2];

    return { line: line === undefined ? null : Number(line), message: message.slice(0, 2048) };
  });
}
