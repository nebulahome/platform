/**
 * A package's compose file: the rules it is held to, and how the platform hands it its values.
 *
 * A package that runs an existing compose project ships its file (PACKAGES.md 7), and the
 * supervisor runs it as the project `nebulahome-pkg-<id>`, owned as a package's containers are.
 * What a backup must take and the platform must keep control of is not the file's to decide:
 *
 * - its folders are relative bind mounts inside the project's folder, so a backup takes them -
 *   never named volumes, which a backup cannot see, nor paths of the host other than devices;
 * - its images are pulled, never built; its containers are named by the platform;
 * - the platform's network and labels are put on every service, whatever the file says.
 *
 * The same rules read the file as written - at build time, by the SDK, which has only the YAML -
 * and as `docker compose config` normalizes it, in the supervisor, where a relative path has
 * become one inside the project's folder.
 *
 * The package's settings reach the file as compose's own variables, `${NEBULA_SETUP_<KEY>}`, from
 * the project's `.env`: never pasted into the file, so a value cannot change what the file says.
 */
import { z } from 'zod';

import { DEPENDENCY_ID_PATTERN } from './container-dependencies.js';
import { packageIdSchema } from './package-id.js';

/** The largest compose file a package carries. */
export const PACKAGE_COMPOSE_MAXIMUM_BYTES = 64 * 1024;

/** The prefix of a setting's variable in a package's compose file. */
export const COMPOSE_SETTING_PREFIX = 'NEBULA_SETUP_';

/** The variables the platform gives a package's compose file, besides its settings. */
export const COMPOSE_PLATFORM_VARIABLES = [
  'NEBULA_PLATFORM_MQTT_URL',
  'NEBULA_PLATFORM_MQTT_USERNAME',
  'NEBULA_PLATFORM_MQTT_PASSWORD',
  'NEBULA_PLATFORM_TIMEZONE',
] as const;

/**
 * The variable a setting is in a compose file: its key in upper snake case.
 *
 * @param key - The setting's key, `apiToken`.
 * @returns The variable, `NEBULA_SETUP_API_TOKEN`.
 */
export function composeVariableOf(key: string): string {
  return `${COMPOSE_SETTING_PREFIX}${key.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/** One package's compose project, as the packet-manager hands it to the supervisor. */
export const packageComposeProjectSchema = z.strictObject({
  packageId: packageIdSchema,

  /** The file, as the release carries it. */
  file: z.string().min(1).max(PACKAGE_COMPOSE_MAXIMUM_BYTES),

  /** The package's settings, as the file's variables: `NEBULA_SETUP_<KEY>` and their values. */
  values: z.record(z.string().regex(/^NEBULA_SETUP_[A-Z0-9_]{1,64}$/), z.string().max(4096)),
});

/** One package's compose project. */
export type PackageComposeProject = z.output<typeof packageComposeProjectSchema>;

/**
 * Says whether a value is a record.
 *
 * @param value - The value.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One volume of a service, as written or as normalized. */
type Mount = { readonly type: string; readonly source: string | undefined };

/**
 * A service's volume entry, read the way compose reads it.
 *
 * @param entry - `./data:/data`, or `{ type, source, target }`.
 * @returns Its type and source.
 */
function mountOf(entry: unknown): Mount {
  if (typeof entry === 'string') {
    const parts = entry.split(':');
    const source = parts.length > 1 ? parts[0] : undefined;

    return {
      type:
        source === undefined
          ? 'volume'
          : source.startsWith('.') || source.startsWith('/') || source.startsWith('~')
            ? 'bind'
            : 'volume',
      source,
    };
  }

  if (isRecord(entry)) {
    return {
      type: typeof entry['type'] === 'string' ? entry['type'] : 'volume',
      source: typeof entry['source'] === 'string' ? entry['source'] : undefined,
    };
  }

  return { type: 'unknown', source: undefined };
}

/**
 * Says whether a bind mount's source is one a package may have: inside its project's folder, or
 * a device of the host.
 *
 * @param source - The source.
 * @param projectDir - The project's folder, once compose normalized the file; undefined as written.
 * @returns True when it may.
 */
function isAllowedSource(source: string, projectDir: string | undefined): boolean {
  if (source.startsWith('/dev/')) {
    return !source.split('/').includes('..');
  }

  if (projectDir === undefined) {
    return source.startsWith('./') && !source.split('/').includes('..');
  }

  const inside = `${projectDir.replace(/\/$/, '')}/`;

  return (source === projectDir || source.startsWith(inside)) && !source.split('/').includes('..');
}

/**
 * What is wrong with a package's compose file, one sentence each.
 *
 * @param document - The file, parsed: as written, or as `docker compose config` gave it.
 * @param options - The project's folder, when the file was normalized.
 * @param options.projectDir - Where its relative paths now point.
 * @returns The problems; empty when it may run.
 */
export function packageComposeProblems(
  document: unknown,
  options: { readonly projectDir?: string } = {},
): string[] {
  const problems: string[] = [];

  if (!isRecord(document) || !isRecord(document['services'])) {
    return ['The compose file declares no service'];
  }

  const services = Object.entries(document['services']);

  if (services.length === 0) {
    problems.push('The compose file declares no service');
  }

  if (isRecord(document['volumes']) && Object.keys(document['volumes']).length > 0) {
    problems.push('Named volumes are not kept by a backup: use a folder beside the file, ./data');
  }

  for (const [name, service] of services) {
    if (!DEPENDENCY_ID_PATTERN.test(name)) {
      problems.push(`${name}: a service is named like a container, a short lower-case id`);
    }

    if (!isRecord(service)) {
      problems.push(`${name}: is not a service`);
      continue;
    }

    if (service['build'] !== undefined) {
      problems.push(`${name}: a package's images are pulled, never built: name an image`);
    }

    if (typeof service['image'] !== 'string') {
      problems.push(`${name}: names no image`);
    }

    if (service['container_name'] !== undefined) {
      problems.push(`${name}: the platform names a package's containers; leave out container_name`);
    }

    if (service['network_mode'] !== undefined) {
      problems.push(
        `${name}: the platform puts a package's services on its network; leave out network_mode`,
      );
    }

    for (const entry of Array.isArray(service['volumes']) ? service['volumes'] : []) {
      const mount = mountOf(entry);

      if (mount.type === 'volume') {
        problems.push(
          `${name}: ${mount.source ?? 'an anonymous volume'} is a volume a backup does not keep: use a folder beside the file, ./data`,
        );
      } else if (
        mount.type === 'bind' &&
        !isAllowedSource(mount.source ?? '', options.projectDir)
      ) {
        problems.push(
          `${name}: ${mount.source ?? ''} is outside the project's folder; only ./folders and devices under /dev`,
        );
      }
    }
  }

  return problems;
}
