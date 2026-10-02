/**
 * A package's compose project, as the supervisor runs it (PACKAGES.md 7): named after the package,
 * held to the rules of `@nebulahome/contracts`' `packageComposeProblems`, and given the platform's
 * network and labels whatever its file says - the labels that make its containers the package's,
 * locked as a package's declared containers are.
 */
import {
  packageComposeProblems,
  type ComposeProblem,
  type JsonObject,
} from '@nebulahome/contracts';

import { MANAGED_LABELS, platformValues, type PlatformContext } from './managed.js';

/** The prefix of a package's compose project. */
const PROJECT_PREFIX = 'nebulahome-pkg-';

/**
 * The compose project a package runs.
 *
 * @param packageId - The package.
 * @returns `nebulahome-pkg-<id>`.
 */
export function packageProjectOf(packageId: string): string {
  return `${PROJECT_PREFIX}${packageId}`;
}

/**
 * The package a compose project is.
 *
 * @param project - The project.
 * @returns The package's id, or undefined for a project that is no package's.
 */
export function packageIdOfProject(project: string): string | undefined {
  return project.startsWith(PROJECT_PREFIX) ? project.slice(PROJECT_PREFIX.length) : undefined;
}

/**
 * Says whether a value is a record.
 *
 * @param value - The value.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A package's configuration, made the platform's: its rules checked, every service given the
 * platform's labels and network.
 *
 * @param config - The configuration, as `docker compose config` gave it.
 * @param project - The project.
 * @param context - The platform.
 * @param projectDir - The project's folder, as compose wrote its paths.
 * @returns The configuration to run, and what cannot run.
 */
export function shapePackageCompose(
  config: JsonObject,
  project: string,
  context: PlatformContext,
  projectDir: string,
): { readonly config: JsonObject; readonly problems: readonly ComposeProblem[] } {
  const packageId = packageIdOfProject(project) ?? project;
  const problems = packageComposeProblems(config, { projectDir }).map(
    (message): ComposeProblem => ({ line: null, message }),
  );
  const services = isRecord(config['services']) ? config['services'] : {};
  const isHost = context.network === 'host';
  const shaped: JsonObject = Object.fromEntries(
    Object.entries(services).map(([name, service]) => {
      const written: JsonObject = isRecord(service) ? { ...service } : {};
      const labels = isRecord(written['labels']) ? written['labels'] : {};

      delete written['networks'];
      delete written['network_mode'];

      return [
        name,
        {
          ...written,
          labels: {
            ...labels,
            [MANAGED_LABELS.managed]: 'true',
            [MANAGED_LABELS.ownerKind]: 'package',
            [MANAGED_LABELS.vendor]: packageId,
            [MANAGED_LABELS.dependency]: name,
            [MANAGED_LABELS.installation]: context.installationId,
          },
          ...(isHost
            ? { network_mode: 'host' }
            : {
                networks: {
                  [context.networkName]: { aliases: [`pkg-${packageId}-${name}`] },
                },
              }),
        },
      ];
    }),
  );
  const rest: JsonObject = Object.fromEntries(
    Object.entries(config).filter(([key]) => key !== 'networks'),
  );

  return {
    config: {
      ...rest,
      services: shaped,
      ...(isHost
        ? {}
        : { networks: { [context.networkName]: { name: context.networkName, external: true } } }),
    },
    problems,
  };
}

/** The platform's values, as a compose file's variables. */
const PLATFORM_VARIABLES: Readonly<Record<string, string>> = {
  'platform.mqtt.url': 'NEBULA_PLATFORM_MQTT_URL',
  'platform.mqtt.username': 'NEBULA_PLATFORM_MQTT_USERNAME',
  'platform.mqtt.password': 'NEBULA_PLATFORM_MQTT_PASSWORD',
  'platform.timezone': 'NEBULA_PLATFORM_TIMEZONE',
};

/**
 * The platform's values for a package's compose file.
 *
 * @param context - The platform, with the broker the package's containers reach.
 * @returns `NEBULA_PLATFORM_*` and their values.
 */
export function platformVariables(context: PlatformContext): Record<string, string> {
  return Object.fromEntries(
    Object.entries(platformValues(context)).flatMap(([key, value]): [string, string][] => {
      const variable = PLATFORM_VARIABLES[key];

      return variable === undefined ? [] : [[variable, value]];
    }),
  );
}

/**
 * A `.env` file, each value quoted so compose reads it as it is.
 *
 * @param values - The variables and their values.
 * @returns The file's text.
 */
export function composeEnv(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) =>
      value.includes("'") || value.includes('\n')
        ? `${name}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
        : `${name}='${value}'`,
    )
    .map((line) => `${line}\n`)
    .join('');
}
