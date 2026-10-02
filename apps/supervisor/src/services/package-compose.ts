/**
 * The packages' compose projects: what the packet-manager says every installed package runs,
 * brought up, kept in step, and taken down when a package no longer runs one.
 *
 * Each runs through a `ComposeProjects` of its own, over `containers/packages/` - the same checks
 * and the same plugin as the owner's projects, with the package's rules and the platform's network
 * and labels put on it (`domain/package-compose.ts`). A project is deployed again only when its
 * file or its values changed, so a reconcile that changes nothing touches nothing.
 */
import type { BusClient } from '@nebulahome/bus';
import type { PackageComposeProject } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { ComposeNeighbours } from '../domain/compose-paths.js';
import type { PlatformContext } from '../domain/managed.js';
import {
  composeEnv,
  packageIdOfProject,
  packageProjectOf,
  platformVariables,
} from '../domain/package-compose.js';

import { brokerForPackage } from './broker-credentials.js';
import type { ComposeProjects } from './compose-projects.js';

/** What the packages' compose projects need. */
export type PackageComposeOptions = {
  /** The projects, over `containers/packages/`: what of them a reconcile uses. */
  readonly projects: Pick<ComposeProjects, 'projects' | 'isEditable' | 'get' | 'deploy' | 'remove'>;

  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /** The platform as the containers see it; null while Docker cannot be reached. */
  readonly context: () => PlatformContext | null;

  /**
   * What the other containers hold, for a project's ports and names.
   *
   * @param project - The project.
   * @returns What the others hold.
   */
  readonly neighbours: (project: string) => ComposeNeighbours;
};

/** The packages' compose projects. */
export class PackageCompose {
  readonly #options: PackageComposeOptions;
  #desired: readonly PackageComposeProject[] = [];

  /**
   * Creates the set.
   *
   * @param options - The projects, the bus, the logger, the platform and the neighbours.
   */
  public constructor(options: PackageComposeOptions) {
    this.#options = options;
  }

  /**
   * Says whether a package runs a compose project of its own.
   *
   * @param packageId - The package.
   * @returns True when one is declared.
   */
  public runs(packageId: string): boolean {
    return this.#desired.some((project) => project.packageId === packageId);
  }

  /**
   * Takes in every package's compose project, and sets to work: each brought up when new or
   * changed, each no longer declared taken down - its folder kept, as a package's data is.
   *
   * @param desired - Every package's project.
   * @returns Once every project was handed to the plugin.
   */
  public async reconcile(desired: readonly PackageComposeProject[]): Promise<void> {
    this.#desired = desired;

    const wanted = new Set(desired.map((project) => packageProjectOf(project.packageId)));

    for (const declared of desired) {
      // eslint-disable-next-line no-await-in-loop -- one project at a time, one pull at a time
      await this.#bringUp(declared);
    }

    for (const project of this.#options.projects.projects()) {
      if (!wanted.has(project) && packageIdOfProject(project) !== undefined) {
        try {
          this.#options.projects.remove(project, false, false);
        } catch (error: unknown) {
          this.#options.logger.warn(
            { err: error, project },
            'Could not take a package project down',
          );
        }
      }
    }
  }

  /**
   * Hands every project to the plugin again: after Docker came back.
   *
   * @returns Once handed.
   */
  public async retry(): Promise<void> {
    await this.reconcile(this.#desired);
  }

  /**
   * Brings one project up when it is new, or its file or values changed.
   *
   * @param declared - The project.
   */
  async #bringUp(declared: PackageComposeProject): Promise<void> {
    const project = packageProjectOf(declared.packageId);
    const context = this.#options.context();

    if (context === null) {
      return;
    }

    // A broker the environment names is the one; the house's is asked only without it.
    const broker =
      context.mqtt === null && declared.file.includes('NEBULA_PLATFORM_MQTT')
        ? await brokerForPackage(this.#options.client, declared.packageId)
        : undefined;
    const env = composeEnv({
      ...platformVariables(broker === undefined ? context : { ...context, mqtt: broker }),
      ...declared.values,
    });
    const stored = this.#options.projects.isEditable(project)
      ? await this.#options.projects.get(project).catch(() => undefined)
      : undefined;

    if (stored?.file === declared.file && stored.env === env) {
      return;
    }

    try {
      await this.#options.projects.deploy(
        { project, file: declared.file, env },
        this.#options.neighbours(project),
      );
    } catch (error: unknown) {
      this.#options.logger.warn(
        { err: error, package: declared.packageId },
        'Could not bring a package project up',
      );
    }
  }
}
