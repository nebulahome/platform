/**
 * The supervisor: what it knows about every container, and what it does to them.
 *
 * It keeps the host's containers in memory - listed, inspected, measured - and keeps that picture
 * current from Docker's event stream, with a full listing every minute behind it in case an event
 * was missed. Four things follow from the picture:
 *
 * - `core` is handed every container but the system ones - the platform's own and the rest of its
 *   compose file - whenever the set changes, and writes a device for each
 *   (`svc.core.sync_containers`);
 * - every running container is measured every sample interval, and its entities take the mean of
 *   the samples once a publish interval, the way the system monitor's do;
 * - the registries are asked every few hours whether a newer image is out;
 * - the containers the integrations declare are run (`managed-containers.ts`).
 *
 * Beside them, what the owner adds: a container installed from a registry (`installs.ts`), and a
 * compose project written or uploaded (`compose-projects.ts`).
 *
 * Docker being unreachable - no socket mounted, the daemon restarting - is a state, not a crash:
 * the service answers that it cannot see Docker, and tries again every half minute.
 */
import { readFile } from 'node:fs/promises';
import os from 'node:os';

import type { BusClient } from '@nebulahome/bus';
import { PACKAGE_COMPOSE_DIRECTORY, resolveDataLayout } from '@nebulahome/config';
import {
  busSubjects,
  COMPOSE_LABEL,
  CONTAINER_HEALTH,
  CONTAINER_SAMPLE_WINDOW,
  CONTAINER_STATES,
  ConflictError,
  containerDeviceId,
  CORE_SERVICE,
  CORE_SYNC_CONTAINERS_METHOD,
  INSTALLED_LABEL,
  isNebulaError,
  isSecretName,
  NotFoundError,
  syncContainersReplySchema,
  type AdapterAck,
  type AdapterCommand,
  type ComposeDefinition,
  type ComposeDocument,
  type ComposeValidation,
  type ContainerAction,
  type ContainerDetail,
  type ContainerInstallRequest,
  type ContainerListReply,
  type ContainerLogsReply,
  type ContainerSample,
  type ContainerState,
  type ContainerSummary,
  type ContainerUpdate,
  type DockerStatus,
  type EntityId,
  type ImageDescription,
  type ImageSearchReply,
  type ImageTagsReply,
  type ContainerOwnerKind,
  type ManagedReply,
  type ReconcileRequest,
  type ResyncReply,
  type StateReport,
  type VendorContainers,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { SupervisorConfig } from './config.js';
import type { InspectedContainer, ListedContainer } from './docker/engine-schemas.js';
import { compareApiVersions, DockerEngine, SUBPATH_API_VERSION } from './docker/engine.js';
import type { ComposeNeighbours } from './domain/compose-paths.js';
import { displayNameOf } from './domain/display-name.js';
import { registrationOf, reportsOf, type ContainerFacts } from './domain/entities.js';
import { imageName, parseImageReference, registryPageOf } from './domain/image-ref.js';
import { takenPorts } from './domain/install.js';
import { logsReplyOf, parseLogEntries } from './domain/log-frames.js';
import type { DataMount, PlatformContext } from './domain/managed.js';
import { shapePackageCompose } from './domain/package-compose.js';
import { PullProgressTracker } from './domain/pull-progress.js';
import { planRecreate } from './domain/recreate.js';
import { containerIdFromCgroup, containerIdFromMountinfo, findSelf } from './domain/self.js';
import {
  cpuCountersOf,
  cpuPercent,
  meanOf,
  memoryLimitOf,
  memoryUsedOf,
  type CpuCounters,
} from './domain/stats.js';
import { COMPOSE_LABELS, composeOf, isSystemContainer } from './domain/system.js';
import { versionOf } from './domain/versions.js';
import { registryArchitecture, RegistryClient } from './registry/registry-client.js';
import { brokerFor } from './services/broker-credentials.js';
import { commandRunner, ComposeProjects, dockerHostOf } from './services/compose-projects.js';
import { Installs } from './services/installs.js';
import { ManagedContainers } from './services/managed-containers.js';
import { PackageCompose } from './services/package-compose.js';
import { replaceContainer } from './services/replace.js';
import { checkImage } from './services/update-check.js';

/** How long Docker is left before it is asked again, after it could not be reached. */
const RECONNECT_DELAY_MS = 30_000;

/** How often every container is listed, behind the event stream. */
const INVENTORY_INTERVAL_MS = 60_000;

/** How long after an event the list is read again, so a burst of events reads it once. */
const REFRESH_DEBOUNCE_MS = 400;

/** How long after starting the first check for updates runs. */
const FIRST_UPDATE_CHECK_MS = 60_000;

/** How long `core` has to take the list of containers. */
const CORE_TIMEOUT_MS = 10_000;

/** The events that change something a page shows; health checks run `exec_*` every few seconds. */
const NOTABLE_ACTIONS = new Set([
  'create',
  'start',
  'stop',
  'die',
  'kill',
  'pause',
  'unpause',
  'restart',
  'destroy',
  'rename',
  'update',
  'oom',
]);

/** What the supervisor keeps about one container. */
type Tracked = {
  readonly id: string;
  name: string;
  listed: ListedContainer;
  inspected: InspectedContainer | null;
  image: { labels: Record<string, string>; repoDigests: string[] } | null;
  counters: CpuCounters | null;
  samples: ContainerSample[];
  update: ContainerUpdate;

  /** The tag an update installs, from the last check. */
  targetTag: string | null;

  /** Whether the last check found the image in no registry: built here, never pushed. */
  isUnpublished: boolean;
};

/** An update's state before anything was asked. */
const NO_UPDATE: ContainerUpdate = {
  installedVersion: null,
  latestVersion: null,
  isAvailable: false,
  checkedAt: null,
  error: null,
  isInstalling: false,
  progress: null,
};

/**
 * A container's name without the slash Docker's API puts in front.
 *
 * @param names - What the list says.
 * @returns The first name.
 */
function nameOf(names: readonly string[]): string {
  return (names[0] ?? '').replace(/^\//, '');
}

/**
 * A container's state, as the contract names them.
 *
 * @param state - Docker's word.
 * @returns The state, `dead` for a word this build does not know.
 */
function stateOf(state: string): ContainerState {
  return (CONTAINER_STATES as readonly string[]).includes(state)
    ? (state as ContainerState)
    : 'dead';
}

/**
 * A time Docker gives as text, where a container never started says the year 1.
 *
 * @param value - The text.
 * @returns The time, or null.
 */
function timeOf(value: string | undefined): Date | null {
  if (value === undefined || value.startsWith('0001-')) {
    return null;
  }

  const time = new Date(value);

  return Number.isNaN(time.getTime()) ? null : time;
}

/**
 * Reads a file of `/proc`, or nothing where there is none.
 *
 * @param file - The file.
 * @returns Its text, or an empty string.
 */
async function readProc(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    // Not Linux, or not allowed: the platform is then simply not found to be in a container.
    return '';
  }
}

/** What the supervisor is handed. */
export type SupervisorServiceOptions = {
  readonly config: SupervisorConfig;
  readonly client: BusClient;
  readonly logger: PlatformLogger;
};

/** The supervisor. */
export class SupervisorService {
  readonly #config: SupervisorConfig;
  readonly #client: BusClient;
  readonly #logger: PlatformLogger;
  readonly #engine: DockerEngine;
  readonly #registry: RegistryClient;
  readonly #managed: ManagedContainers;
  readonly #installs: Installs;
  readonly #compose: ComposeProjects;
  readonly #packageProjects: ComposeProjects;
  readonly #packageCompose: PackageCompose;
  readonly #dataRoot: string;
  readonly #containers = new Map<string, Tracked>();
  readonly #entityOwners = new Map<EntityId, string>();
  readonly #installing = new Set<string>();
  readonly #timers: NodeJS.Timeout[] = [];
  readonly #shutdown = new AbortController();

  #status: DockerStatus = {
    isAvailable: false,
    version: null,
    apiVersion: null,
    reason: 'Not asked yet',
    platformNetwork: null,
    composeVersion: null,
  };

  #selfId: string | null = null;
  #context: PlatformContext | null = null;
  #machineMemory = os.totalmem();
  #syncedFingerprint: string | null = null;
  #registeredNames = new Set<string>();
  #lastPublishedAt = new Date();
  #refreshTimer: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #isRefreshing = false;

  /**
   * Creates the service. Nothing is asked of Docker until {@link start}.
   *
   * @param options - The configuration, the bus client and the logger.
   */
  public constructor(options: SupervisorServiceOptions) {
    this.#config = options.config;
    this.#client = options.client;
    this.#logger = options.logger;
    this.#dataRoot = resolveDataLayout(options.config).root;
    this.#engine = new DockerEngine({
      socketPath: options.config.SUPERVISOR_DOCKER_SOCKET,
      timeoutMs: options.config.SUPERVISOR_DOCKER_TIMEOUT_MS,
    });
    this.#registry = new RegistryClient({
      timeoutMs: 15_000,
      architecture: registryArchitecture(process.arch),
    });
    this.#managed = new ManagedContainers({
      engine: this.#engine,
      registry: this.#registry,
      logger: options.logger,
      dataRoot: this.#dataRoot,

      /**
       * The platform as the containers see it.
       *
       * @returns The context, or null while Docker cannot be reached.
       */
      context: () => this.#context,
      installationId: this.#config.NEBULA_INSTALLATION_ID,

      /**
       * The platform's own container.
       *
       * @returns Its id, or null outside a container.
       */
      selfId: () => this.#selfId,

      /**
       * The broker a container reaches, from the house's broker.
       *
       * @param spec - The container's declaration.
       * @returns The broker with the container's username, or undefined for the platform's.
       */
      brokerFor: async (spec) => brokerFor(this.#client, spec, options.logger),

      /**
       * Whether a package's compose project declares a container: it is the package's, locked
       * as its declared containers are.
       *
       * @param ownerKind - Who the container says declares it.
       * @param vendorId - The package.
       * @returns True for a service of a package's project.
       */
      isDeclaredElsewhere: (ownerKind, vendorId) =>
        ownerKind === 'package' && this.#packageCompose.runs(vendorId),

      /**
       * Announces a managed container that was made, replaced or started.
       *
       * @param name - The container.
       */
      onChange: (name) => {
        this.#changed(name, 'changed');
      },
    });
    this.#installs = new Installs({
      engine: this.#engine,
      logger: options.logger,
      dataRoot: this.#dataRoot,

      /**
       * Makes the network the platform shares with the containers it makes.
       *
       * @param context - The platform.
       * @returns Once it exists.
       */
      ensureNetwork: async (context) => this.#managed.ensureNetwork(context),

      /**
       * Says an install moved, and reads the list again: a finished one is a container now.
       *
       * @param name - The container.
       */
      onChange: (name) => {
        this.#changed(name, 'changed');
        this.#scheduleRefresh();
      },
    });
    this.#compose = new ComposeProjects({
      runner: commandRunner(
        options.config.SUPERVISOR_DOCKER_CLI,
        dockerHostOf(options.config.SUPERVISOR_DOCKER_SOCKET),
      ),
      logger: options.logger,
      dataRoot: this.#dataRoot,

      /**
       * The platform as the containers see it.
       *
       * @returns The context, or null while Docker cannot be reached.
       */
      context: () => this.#context,

      /**
       * Says a project's operation moved, and reads the list again.
       *
       * @param project - The project.
       */
      onChange: (project) => {
        this.#changed(project, 'changed');
        this.#scheduleRefresh();
      },
    });
    this.#packageProjects = new ComposeProjects({
      runner: commandRunner(
        options.config.SUPERVISOR_DOCKER_CLI,
        dockerHostOf(options.config.SUPERVISOR_DOCKER_SOCKET),
      ),
      logger: options.logger,
      dataRoot: this.#dataRoot,
      directory: PACKAGE_COMPOSE_DIRECTORY,
      transform: shapePackageCompose,

      /**
       * The platform as the containers see it.
       *
       * @returns The context, or null while Docker cannot be reached.
       */
      context: () => this.#context,

      /**
       * Says a package project's operation moved, and reads the list again.
       *
       * @param project - The project.
       */
      onChange: (project) => {
        this.#changed(project, 'changed');
        this.#scheduleRefresh();
      },
    });
    this.#packageCompose = new PackageCompose({
      projects: this.#packageProjects,
      client: this.#client,
      logger: options.logger,

      /**
       * The platform as the containers see it.
       *
       * @returns The context, or null while Docker cannot be reached.
       */
      context: () => this.#context,

      /**
       * What the other containers hold.
       *
       * @param project - The project.
       * @returns What the others hold.
       */
      neighbours: (project) => this.#neighboursOf(project),
    });
  }

  /**
   * Connects to Docker and starts measuring, publishing and checking.
   */
  public async start(): Promise<void> {
    await this.#installs.load();
    await this.#compose.start();
    await this.#packageProjects.start();
    await this.#connect();

    this.#timers.push(
      setInterval(() => {
        void this.#sample();
      }, this.#config.SUPERVISOR_SAMPLE_INTERVAL_MS),
      setInterval(() => {
        this.#publish();
      }, this.#config.SUPERVISOR_PUBLISH_INTERVAL_MS),
      setInterval(() => {
        void this.#refresh();
      }, INVENTORY_INTERVAL_MS),
      setInterval(() => {
        void this.#checkUpdates();
      }, this.#config.SUPERVISOR_UPDATE_CHECK_INTERVAL_MS),
      setTimeout(() => {
        void this.#checkUpdates();
      }, FIRST_UPDATE_CHECK_MS),
    );
  }

  /**
   * Stops every timer and the event stream.
   */
  public stop(): void {
    this.#shutdown.abort();
    this.#managed.stop();

    for (const timer of this.#timers) {
      clearInterval(timer);
    }

    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
    }

    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
    }
  }

  /**
   * Whether Docker can be reached, and how the platform runs.
   *
   * @returns The status.
   */
  public status(): DockerStatus {
    return this.#status;
  }

  /**
   * Every container, as the list shows it.
   *
   * @returns The status and the containers, the platform's own first, then by name.
   */
  public list(): ContainerListReply {
    /**
     * Where a container comes in the list: the platform, the rest of the system, the others.
     *
     * @param summary - The container.
     * @returns Its rank.
     */
    const rank = (summary: ContainerSummary): number =>
      summary.isSelf ? 0 : summary.isSystem ? 1 : 2;
    const containers = [...this.#containers.values()]
      .map((tracked) => this.#summaryOf(tracked))
      .sort(
        (left, right) =>
          rank(left) - rank(right) || left.displayName.localeCompare(right.displayName),
      );

    return {
      docker: this.#status,
      containers,
      installs: this.#installs.list(),
      composeOperations: this.#compose.operations(),
    };
  }

  /**
   * One container, with everything its page shows, inspected afresh.
   *
   * @param name - Its name.
   * @returns The detail.
   * @throws {NotFoundError} When no container has that name.
   */
  public async inspect(name: string): Promise<ContainerDetail> {
    const tracked = this.#require(name);
    const inspected = await this.#engine.inspectContainer(tracked.id);

    tracked.inspected = inspected;

    return this.#detailOf(tracked, inspected);
  }

  /**
   * The last lines a container wrote.
   *
   * @param name - Its name.
   * @param tail - How many lines.
   * @param since - Only the lines after this cursor, which the last read answered.
   * @returns The lines, oldest first, and where the next read carries on.
   */
  public async logs(name: string, tail: number, since?: string): Promise<ContainerLogsReply> {
    const tracked = this.#require(name);
    // One more line than asked, after a cursor: Docker sends the line at the cursor again.
    const bytes = await this.#engine.logs(tracked.id, since === undefined ? tail : tail + 1, since);

    return logsReplyOf(parseLogEntries(bytes, tracked.inspected?.Config.Tty === true), {
      tail,
      since,
    });
  }

  /**
   * Starts, stops or restarts a container the owner may control.
   *
   * @param name - Its name.
   * @param action - What to do.
   * @returns The container as it now is.
   * @throws {ConflictError} For the platform's own container, one an integration runs, or one
   * being updated.
   */
  public async control(name: string, action: ContainerAction): Promise<ContainerSummary> {
    const tracked = this.#requireControllable(name);

    await this.#engine.control(tracked.id, action);
    this.#logger.info({ container: name, action }, 'Controlled a container');
    await this.#refresh();

    return this.#summaryOf(this.#require(name));
  }

  /**
   * Updates a container to the newest image on offer: pulls it, and makes the container again
   * on it. Answers at once; the pull goes on, reported through the container's image entity.
   *
   * @param name - Its name.
   * @throws {ConflictError} When it cannot be controlled, or nothing newer is known to be out.
   */
  public update(name: string): void {
    const tracked = this.#requireControllable(name);
    const tag = tracked.targetTag;

    if (!tracked.update.isAvailable || tag === null) {
      throw new ConflictError(`No newer image is known for ${name}; check for updates first`, {
        details: { name, reason: 'up-to-date' },
      });
    }

    this.#installing.add(name);
    void this.#install(tracked, tag).finally(() => {
      this.#installing.delete(name);
    });
  }

  /**
   * Asks the registries now, rather than at the next scheduled check.
   */
  public checkUpdatesNow(): void {
    void this.#checkUpdates();
  }

  /**
   * Looks for images on Docker Hub.
   *
   * @param query - What to look for.
   * @returns What Docker Hub found.
   */
  public async searchImages(query: string): Promise<ImageSearchReply> {
    return { results: await this.#registry.searchHub(query) };
  }

  /**
   * The tags of an image worth offering.
   *
   * @param image - The image, without a tag.
   * @returns The tags, the newest first.
   */
  public async imageTags(image: string): Promise<ImageTagsReply> {
    return { tags: await this.#registry.offeredTags(parseImageReference(image)) };
  }

  /**
   * What an image declares.
   *
   * @param image - The image, without a tag.
   * @param tag - The tag.
   * @returns Its ports, environment and volumes.
   */
  public async describeImage(image: string, tag: string): Promise<ImageDescription> {
    return this.#registry.describe(parseImageReference(`${image}:${tag}`));
  }

  /**
   * Installs a container: answers once the request is checked, and pulls, makes and starts it
   * after.
   *
   * @param request - What the form said.
   * @throws {ConflictError} When Docker cannot be reached, the name is taken, or a port is.
   */
  public install(request: ContainerInstallRequest): void {
    const context = this.#context;

    if (!this.#status.isAvailable || context === null) {
      throw new ConflictError('Docker cannot be reached', { details: { reason: 'unreachable' } });
    }

    if (
      this.#installs.isInstalling(request.name) ||
      [...this.#containers.values()].some((tracked) => tracked.name === request.name)
    ) {
      throw new ConflictError(`A container is already called ${request.name}`, {
        details: { name: request.name, reason: 'name-taken' },
      });
    }

    const taken = takenPorts(request, this.#neighboursOf(null).ports);

    if (taken.length > 0) {
      throw new ConflictError(`Another container already publishes ${taken.join(', ')}`, {
        details: { name: request.name, reason: 'port-taken', ports: taken },
      });
    }

    this.#installs.dismiss(request.name);
    this.#installs.start(request, context);
    this.#logger.info(
      { container: request.name, image: `${request.image}:${request.tag}` },
      'Installing a container',
    );
  }

  /**
   * Forgets an install that failed.
   *
   * @param name - The container's name.
   */
  public dismissInstall(name: string): void {
    this.#installs.dismiss(name);
  }

  /**
   * Stops and removes a container the owner may control.
   *
   * @param name - Its name.
   * @param removeVolumes - Also the volumes Docker made for it alone.
   * @throws {ConflictError} For a system container, one an integration runs, or one being updated.
   */
  public async remove(name: string, removeVolumes: boolean): Promise<void> {
    const tracked = this.#requireControllable(name);

    await this.#engine.removeContainer(tracked.id, removeVolumes);

    if (tracked.listed.Labels[INSTALLED_LABEL] === 'true') {
      await this.#installs.forget(name);
    }

    this.#logger.info({ container: name, removeVolumes }, 'Removed a container');
    await this.#refresh();
    this.#changed(name, 'removed');
  }

  /**
   * Checks a compose file without running anything.
   *
   * @param definition - The project, its file and its `.env`.
   * @returns What is wrong, and the services it declares.
   */
  public async composeValidate(definition: ComposeDefinition): Promise<ComposeValidation> {
    return this.#compose.validate(definition, this.#neighboursOf(definition.project));
  }

  /**
   * Keeps a compose file and brings its project up with it.
   *
   * @param definition - The project, its file and its `.env`.
   */
  public async composeDeploy(definition: ComposeDefinition): Promise<void> {
    await this.#compose.deploy(definition, this.#neighboursOf(definition.project));
    this.#logger.info({ project: definition.project }, 'Deploying a compose project');
  }

  /**
   * The file and `.env` of a project deployed from here.
   *
   * @param project - The project.
   * @returns Them.
   */
  public async composeGet(project: string): Promise<ComposeDocument> {
    return this.#compose.get(project);
  }

  /**
   * Starts, stops, or pulls newer images for a project deployed from here.
   *
   * @param project - The project.
   * @param action - What to do.
   */
  public composeControl(project: string, action: 'start' | 'stop' | 'pull'): void {
    this.#compose.control(project, action, this.#neighboursOf(project));
  }

  /**
   * Takes a project deployed from here down, and forgets it.
   *
   * @param project - The project.
   * @param removeVolumes - Also its volumes.
   * @param removeFiles - Also its folder.
   */
  public composeRemove(project: string, removeVolumes: boolean, removeFiles: boolean): void {
    this.#compose.remove(project, removeVolumes, removeFiles);
  }

  /**
   * Takes in every container every loaded vendor declares.
   *
   * @param request - The whole set.
   * @returns Where each stands.
   */
  public reconcile(request: ReconcileRequest): ManagedReply {
    const reply = this.#managed.reconcile(request);

    if (request.ownerKind === 'package' && request.composeProjects !== undefined) {
      void this.#packageCompose.reconcile(request.composeProjects).catch((error: unknown) => {
        this.#logger.warn({ err: error }, "Could not bring the packages' compose projects up");
      });
    }

    this.#resyncWithCore();

    return reply;
  }

  /**
   * Takes in one vendor's containers.
   *
   * @param request - The vendor's containers.
   * @returns Where they stand.
   */
  public ensure(request: VendorContainers): ManagedReply {
    const reply = this.#managed.ensure(request);

    this.#resyncWithCore();

    return reply;
  }

  /**
   * Stops every container that keeps its data in the data directory - the integrations', the
   * compose projects', the owner's installs - for a restore that swaps it.
   */
  public async suspendManaged(): Promise<void> {
    const tracked = [...this.#containers.values()];

    await this.#managed.suspend(
      tracked.map((each) => ({
        name: each.name,
        labels: each.listed.Labels,
        isRunning: each.listed.State === 'running',
      })),
    );
    await this.#compose.suspend();
    await this.#packageProjects.suspend();
    await this.#installs.suspend(
      tracked
        .filter(
          (each) =>
            each.listed.Labels[INSTALLED_LABEL] === 'true' && each.listed.State === 'running',
        )
        .map((each) => each.name),
    );
  }

  /**
   * Starts them again after it, from what it restored: a compose project or an install the
   * archive has and Docker does not is made again.
   */
  public async resumeManaged(): Promise<void> {
    await this.#managed.resume();
    await this.#compose.resume((project) => this.#neighboursOf(project));
    await this.#packageProjects.resume((project) => this.#neighboursOf(project));

    // Without a listing, nothing is installed again: it could be a second container of a name.
    const listed = this.#status.isAvailable
      ? await this.#engine.listContainers().catch(() => null)
      : null;

    await this.#installs.resume(
      new Set((listed ?? []).map((each) => nameOf(each.Names))),
      listed === null ? null : this.#context,
    );
  }

  /**
   * Performs a command `core` routed to a container entity: installing the image's update.
   *
   * @param command - The entity, the capability and what to do.
   * @returns The acknowledgement, once the update has begun.
   * @throws {NotFoundError} When no container has that entity, or it takes no such command.
   */
  public command(command: AdapterCommand): AdapterAck {
    const name = this.#entityOwners.get(command.entityId);

    if (name === undefined || command.capability !== 'update') {
      throw new NotFoundError(`${command.entityId} takes no ${command.capability} command here`, {
        details: { entityId: command.entityId },
      });
    }

    if (this.#installing.has(name)) {
      throw new ConflictError(`${name} is already being updated`, { details: { name } });
    }

    this.update(name);

    return { acceptedAt: new Date() };
  }

  /**
   * Republishes what every container entity says now, for `core` after it started.
   *
   * @returns How many entities were republished.
   */
  public resync(): ResyncReply {
    const reports = [...this.#containers.values()]
      .filter((tracked) => this.#registeredNames.has(tracked.name))
      .flatMap((tracked) => reportsOf(this.#factsOf(tracked, tracked.samples.slice(-1))));

    this.#publishReports(reports);

    return { entityCount: reports.length };
  }

  /**
   * Where each container a vendor, or a package, declares stands, for its page.
   *
   * @param vendorId - The vendor, or the package.
   * @param ownerKind - Which of the two.
   * @returns The statuses.
   */
  public managedStatuses(vendorId: string, ownerKind: ContainerOwnerKind = 'vendor'): ManagedReply {
    // What the work last did, with the state Docker gives the container now: one that was made
    // and then keeps restarting says so.
    return {
      containers: this.#managed.statusesOf(vendorId, ownerKind).map((status) => {
        const tracked = [...this.#containers.values()].find(
          (each) => each.name === status.containerName,
        );

        return tracked === undefined || status.state === 'pulling'
          ? status
          : { ...status, state: stateOf(tracked.listed.State) };
      }),
    };
  }

  /**
   * Asks Docker what it is, then reads everything; on failure, says so and tries again later.
   */
  async #connect(): Promise<void> {
    try {
      const version = await this.#engine.negotiate();
      const info = await this.#engine.info();

      this.#machineMemory = info.MemTotal ?? os.totalmem();
      this.#status = {
        isAvailable: true,
        version: version.Version,
        apiVersion: this.#engine.apiVersion,
        reason: null,
        platformNetwork: null,
        composeVersion: this.#compose.version,
      };

      await this.#refresh();
      void this.#followEvents();
      await this.#rejoinNetwork();
      this.#managed.retry();
      void this.#packageCompose.retry().catch((error: unknown) => {
        this.#logger.warn({ err: error }, "Could not bring the packages' compose projects up");
      });
      this.#logger.info(
        {
          version: version.Version,
          api: this.#engine.apiVersion,
          platform: this.#status.platformNetwork,
        },
        'Docker is reachable',
      );
    } catch (error: unknown) {
      this.#unreachable(error);
    }
  }

  /**
   * Puts the platform back on the network its containers reach it by, when it is on a bridge.
   *
   * At every start, not only when an integration's container is made: the platform's container
   * made again from a new image starts off that network, and the containers already running there
   * - an integration's, one the owner installed beside the platform - would look for it under a
   * name nothing answers to until something else put it back.
   */
  async #rejoinNetwork(): Promise<void> {
    const context = this.#context;

    if (context?.network !== 'bridge') {
      return;
    }

    try {
      await this.#managed.ensureNetwork(context);
    } catch (error: unknown) {
      this.#logger.warn(
        { err: error, network: context.networkName },
        'Could not put the platform on the network its containers reach it by',
      );
    }
  }

  /**
   * Records that Docker cannot be reached, and asks again later.
   *
   * @param error - Why.
   */
  #unreachable(error: unknown): void {
    const reason = isNebulaError(error) || error instanceof Error ? error.message : String(error);

    if (this.#status.isAvailable || this.#status.reason !== reason) {
      this.#logger.warn({ reason }, 'Docker cannot be reached; asking again in a while');
    }

    this.#status = {
      isAvailable: false,
      version: null,
      apiVersion: null,
      reason,
      platformNetwork: null,
      composeVersion: this.#compose.version,
    };
    this.#context = null;

    if (this.#reconnectTimer === null && !this.#shutdown.signal.aborted) {
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = null;
        void this.#connect();
      }, RECONNECT_DELAY_MS);
    }
  }

  /**
   * Follows Docker's events until the service stops or the stream breaks.
   */
  async #followEvents(): Promise<void> {
    try {
      for await (const event of this.#engine.events(this.#shutdown.signal)) {
        const action = event.Action.split(':')[0] ?? '';

        if (
          event.Type !== 'container' ||
          (!NOTABLE_ACTIONS.has(action) && action !== 'health_status')
        ) {
          continue;
        }

        this.#scheduleRefresh();

        const name = event.Actor.Attributes['name'];

        if (name !== undefined) {
          this.#changed(name, action === 'destroy' ? 'removed' : 'changed');
        }
      }
    } catch (error: unknown) {
      if (!this.#shutdown.signal.aborted) {
        this.#unreachable(error);
      }
    }
  }

  /**
   * Reads the list again shortly: a burst of events reads it once.
   */
  #scheduleRefresh(): void {
    if (this.#refreshTimer !== null) {
      return;
    }

    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /**
   * Announces that a container changed or went away.
   *
   * @param name - The container.
   * @param event - What happened.
   */
  #changed(name: string, event: 'changed' | 'removed'): void {
    this.#client.publish(busSubjects.containerEvent(), { name, event });
  }

  /**
   * Lists every container, inspects the new and the changed, finds the platform's own, and hands
   * `core` the set when it changed.
   */
  async #refresh(): Promise<void> {
    if (!this.#status.isAvailable || this.#isRefreshing) {
      return;
    }

    this.#isRefreshing = true;

    try {
      const listed = await this.#engine.listContainers();
      const seen = new Set<string>();
      const changedState: Tracked[] = [];

      for (const entry of listed) {
        seen.add(entry.Id);

        const known = this.#containers.get(entry.Id);

        if (known === undefined) {
          const tracked: Tracked = {
            id: entry.Id,
            name: nameOf(entry.Names),
            listed: entry,
            inspected: null,
            image: null,
            counters: null,
            samples: [],
            update: NO_UPDATE,
            targetTag: null,
            isUnpublished: false,
          };

          this.#containers.set(entry.Id, tracked);
          // eslint-disable-next-line no-await-in-loop -- one at a time, not a burst at the daemon
          await this.#inspectInto(tracked);
          changedState.push(tracked);
          continue;
        }

        const stateMoved = known.listed.State !== entry.State;

        known.listed = entry;
        known.name = nameOf(entry.Names);

        if (stateMoved || known.inspected === null) {
          // eslint-disable-next-line no-await-in-loop -- one at a time, not a burst at the daemon
          await this.#inspectInto(known);
        }

        if (stateMoved) {
          known.counters = null;
          changedState.push(known);
        }
      }

      for (const id of this.#containers.keys()) {
        if (!seen.has(id)) {
          this.#containers.delete(id);
        }
      }

      if (this.#selfId === null || !this.#containers.has(this.#selfId)) {
        await this.#findSelf();
      }

      await this.#syncWithCore();

      this.#publishReports(
        changedState
          .filter((tracked) => this.#registeredNames.has(tracked.name))
          .flatMap((tracked) => reportsOf(this.#factsOf(tracked, []))),
      );
    } catch (error: unknown) {
      if (isNebulaError(error) && error.code === 'DEVICE_UNAVAILABLE') {
        this.#unreachable(error);
      } else {
        this.#logger.warn({ err: error }, 'Could not read the containers');
      }
    } finally {
      this.#isRefreshing = false;
    }
  }

  /**
   * Inspects a container and its image into what is kept about it.
   *
   * @param tracked - The container.
   */
  async #inspectInto(tracked: Tracked): Promise<void> {
    try {
      const inspected = await this.#engine.inspectContainer(tracked.id);
      const image = await this.#engine.inspectImage(inspected.Image);

      tracked.inspected = inspected;
      tracked.image =
        image === undefined
          ? null
          : { labels: image.Config?.Labels ?? {}, repoDigests: image.RepoDigests };
    } catch (error: unknown) {
      // Removed between the list and the inspect: the next list drops it.
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
    }
  }

  /**
   * Finds which container is the platform's, and how the platform reaches the others.
   */
  async #findSelf(): Promise<void> {
    const fromKernel =
      containerIdFromMountinfo(await readProc('/proc/self/mountinfo')) ??
      containerIdFromCgroup(await readProc('/proc/self/cgroup'));

    this.#selfId = findSelf([...this.#containers.keys()], { fromKernel, hostname: os.hostname() });

    const self = this.#selfId === null ? undefined : this.#containers.get(this.#selfId)?.inspected;
    const network =
      self === undefined || self === null
        ? 'native'
        : self.HostConfig.NetworkMode === 'host'
          ? 'host'
          : 'bridge';

    this.#status = { ...this.#status, platformNetwork: network };
    this.#context = {
      network,
      installationId: this.#config.NEBULA_INSTALLATION_ID,
      networkName: this.#config.SUPERVISOR_NETWORK,
      platformAlias: this.#config.SUPERVISOR_PLATFORM_ALIAS,
      mqtt:
        this.#config.NEBULA_MQTT_URL === undefined
          ? null
          : {
              url: this.#config.NEBULA_MQTT_URL,
              username: this.#config.NEBULA_MQTT_USERNAME,
              password: this.#config.NEBULA_MQTT_PASSWORD,
            },
      timezone: this.#config.TZ,
      dataMount: this.#dataMountOf(self ?? null),
    };
  }

  /**
   * How the platform's data directory reaches Docker, so a container's volume can live in it.
   *
   * @param self - The platform's container, inspected; null outside one.
   * @returns The mount.
   */
  #dataMountOf(self: InspectedContainer | null): DataMount {
    if (self === null) {
      return { kind: 'bind', hostPath: this.#dataRoot };
    }

    const mount = self.Mounts.find((each) => each.Destination === this.#dataRoot);

    if (mount?.Type === 'bind' && mount.Source !== undefined) {
      return { kind: 'bind', hostPath: mount.Source };
    }

    const apiVersion = this.#engine.apiVersion ?? '0.0';

    if (
      mount?.Type === 'volume' &&
      mount.Name !== undefined &&
      compareApiVersions(apiVersion, SUBPATH_API_VERSION) >= 0
    ) {
      return { kind: 'volume', volume: mount.Name };
    }

    return { kind: 'separate' };
  }

  /**
   * Hands `core` every container but the system ones, when the set changed or the last handing
   * failed.
   */
  async #syncWithCore(): Promise<void> {
    const taken = new Set<string>();
    const registrations = [];

    for (const tracked of this.#containers.values()) {
      if (this.#isSystem(tracked)) {
        continue;
      }

      // Two names can slug alike; the second gets no device rather than the first one's.
      const deviceId = containerDeviceId(tracked.name);

      if (taken.has(deviceId)) {
        this.#logger.warn(
          { container: tracked.name },
          'Its name is too like another container’s to get a device',
        );
        continue;
      }

      taken.add(deviceId);
      registrations.push(registrationOf(this.#factsOf(tracked, [])));
    }

    const fingerprint = JSON.stringify(registrations);

    if (fingerprint === this.#syncedFingerprint) {
      return;
    }

    try {
      await this.#client.request(
        busSubjects.service(CORE_SERVICE, CORE_SYNC_CONTAINERS_METHOD),
        { containers: registrations },
        syncContainersReplySchema,
        { timeoutMs: CORE_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      // `core` may not be up yet; the next listing hands the set over again.
      this.#logger.debug({ err: error }, 'Could not hand the containers to core yet');

      return;
    }

    this.#syncedFingerprint = fingerprint;
    this.#registeredNames = new Set(registrations.map((registration) => registration.name));
    this.#entityOwners.clear();

    for (const registration of registrations) {
      for (const entity of registration.entities) {
        this.#entityOwners.set(entity.entityId, registration.name);
      }
    }

    this.resync();
  }

  /**
   * Makes the next listing hand `core` the set again: a vendor's declaration changed which
   * containers may be updated from here.
   */
  #resyncWithCore(): void {
    this.#syncedFingerprint = null;
    this.#scheduleRefresh();
  }

  /**
   * Measures every running container once.
   */
  async #sample(): Promise<void> {
    if (!this.#status.isAvailable) {
      return;
    }

    const running = [...this.#containers.values()].filter(
      (tracked) => tracked.listed.State === 'running',
    );

    await Promise.allSettled(
      running.map(async (tracked) => {
        const stats = await this.#engine.stats(tracked.id);
        const counters = cpuCountersOf(stats);
        const previous = tracked.counters;
        const memoryUsedBytes = memoryUsedOf(stats);

        tracked.counters = counters;

        if (previous === null || memoryUsedBytes === null) {
          return;
        }

        const share = cpuPercent(previous, counters);

        if (share === null) {
          return;
        }

        tracked.samples.push({
          at: new Date(),
          cpuPercent: share,
          memoryUsedBytes,
          memoryLimitBytes: memoryLimitOf(stats, this.#machineMemory),
        });

        if (tracked.samples.length > CONTAINER_SAMPLE_WINDOW) {
          tracked.samples.splice(0, tracked.samples.length - CONTAINER_SAMPLE_WINDOW);
        }
      }),
    );
  }

  /**
   * Gives every container entity the mean of the samples since the last time.
   */
  #publish(): void {
    const since = this.#lastPublishedAt;

    this.#lastPublishedAt = new Date();
    this.#publishReports(
      [...this.#containers.values()]
        .filter((tracked) => this.#registeredNames.has(tracked.name))
        .flatMap((tracked) =>
          reportsOf(
            this.#factsOf(
              tracked,
              tracked.samples.filter((sample) => sample.at > since),
            ),
          ),
        ),
    );
  }

  /**
   * Publishes state reports.
   *
   * @param reports - The reports.
   */
  #publishReports(reports: readonly StateReport[]): void {
    for (const report of reports) {
      this.#client.publish(busSubjects.stateReport(report.entityId), report);
    }
  }

  /**
   * Asks the registries about every image the containers run.
   */
  async #checkUpdates(): Promise<void> {
    const tags = new Map<string, Promise<string[]>>();

    for (const tracked of this.#containers.values()) {
      const reference = tracked.inspected?.Config.Image ?? tracked.listed.Image;

      // One image after another: a registry that limits anonymous reads is asked at a walk.
      // eslint-disable-next-line no-await-in-loop -- see above
      const finding = await checkImage(
        {
          reference,
          labels: tracked.image?.labels ?? {},
          repoDigests: tracked.image?.repoDigests ?? [],
        },
        this.#registry,
        async (image) => {
          const key = `${image.registry}/${image.repository}`;
          const known = tags.get(key) ?? this.#registry.tags(image);

          tags.set(key, known);

          return known;
        },
      );

      tracked.targetTag = finding.targetTag;
      tracked.isUnpublished = finding.isUnpublished;
      tracked.update = {
        ...tracked.update,
        installedVersion: finding.installedVersion,
        latestVersion: finding.latestVersion,
        isAvailable: finding.isAvailable,
        checkedAt: new Date(),
        error: finding.error,
      };

      this.#publishImage(tracked);
      this.#changed(tracked.name, 'changed');
    }
  }

  /**
   * Publishes a container's image entity alone, after its update state moved.
   *
   * @param tracked - The container.
   */
  #publishImage(tracked: Tracked): void {
    if (!this.#registeredNames.has(tracked.name)) {
      return;
    }

    this.#publishReports(reportsOf(this.#factsOf(tracked, [])).slice(-1));
  }

  /**
   * Pulls the newer image and makes the container again on it, reporting as it goes.
   *
   * @param tracked - The container.
   * @param tag - The tag to install.
   */
  async #install(tracked: Tracked, tag: string): Promise<void> {
    const reference = parseImageReference(tracked.inspected?.Config.Image ?? tracked.listed.Image);
    const image = imageName(reference);
    const tracker = new PullProgressTracker();
    let lastPercent: number | null = null;

    tracked.update = { ...tracked.update, isInstalling: true, progress: null, error: null };
    this.#publishImage(tracked);
    this.#changed(tracked.name, 'changed');

    try {
      await this.#engine.pull(image, tag, (progress) => {
        tracker.add(progress);

        const percent = tracker.percent();

        if (percent !== null && (lastPercent === null || percent - lastPercent >= 5)) {
          lastPercent = percent;
          tracked.update = { ...tracked.update, progress: percent };
          this.#publishImage(tracked);
          this.#changed(tracked.name, 'changed');
        }
      });

      const inspected = await this.#engine.inspectContainer(tracked.id);
      const oldImage = await this.#engine.inspectImage(inspected.Image);
      const plan = planRecreate(inspected, oldImage, `${image}:${tag}`);

      await replaceContainer({
        engine: this.#engine,
        logger: this.#logger,
        id: tracked.id,
        name: tracked.name,
        wasRunning: inspected.State.Running === true,
        body: plan.body,
        networks: plan.networks,
      });

      this.#logger.info(
        { container: tracked.name, image: `${image}:${tag}` },
        'Updated a container',
      );

      if (tracked.listed.Labels[INSTALLED_LABEL] === 'true') {
        await this.#installs.retag(tracked.name, tag);
      }
    } catch (error: unknown) {
      const message =
        isNebulaError(error) || error instanceof Error ? error.message : String(error);

      this.#logger.error({ err: error, container: tracked.name }, 'Could not update a container');
      tracked.update = {
        ...tracked.update,
        isInstalling: false,
        progress: null,
        error: message.slice(0, 500),
      };
      this.#publishImage(tracked);
      this.#changed(tracked.name, 'changed');

      return;
    }

    // The new container is another id under the same name; the next listing takes it in with no
    // update pending, and the next check says what is on offer after it.
    this.#syncedFingerprint = null;
    await this.#refresh();

    const replaced = [...this.#containers.values()].find((each) => each.name === tracked.name);

    if (replaced !== undefined) {
      replaced.update = {
        ...NO_UPDATE,
        installedVersion: tag,
        latestVersion: tag,
        checkedAt: new Date(),
      };
      this.#publishImage(replaced);
    }

    this.#changed(tracked.name, 'changed');
  }

  /**
   * A container by name.
   *
   * @param name - Its name.
   * @returns It.
   * @throws {NotFoundError} When no container has that name.
   */
  #require(name: string): Tracked {
    const tracked = [...this.#containers.values()].find((each) => each.name === name);

    if (tracked === undefined) {
      throw new NotFoundError(`No container is called ${name}`, { details: { name } });
    }

    return tracked;
  }

  /**
   * A container the owner may control.
   *
   * @param name - Its name.
   * @returns It.
   * @throws {ConflictError} Naming why not, in `details.reason`.
   */
  #requireControllable(name: string): Tracked {
    const tracked = this.#require(name);
    const refusal = this.#refusalOf(tracked);

    if (refusal === 'self') {
      throw new ConflictError('The platform’s own container is not controlled from here', {
        details: { name, reason: 'self' },
      });
    }

    if (refusal === 'system') {
      throw new ConflictError(`${name} is part of the platform, and is not controlled from here`, {
        details: { name, reason: 'system' },
      });
    }

    if (refusal === 'managed') {
      throw new ConflictError(
        `${name} is run by an integration, which starts, stops and updates it`,
        {
          details: { name, reason: 'managed' },
        },
      );
    }

    if (this.#installing.has(name)) {
      throw new ConflictError(`${name} is being updated`, {
        details: { name, reason: 'installing' },
      });
    }

    return tracked;
  }

  /**
   * Why a container cannot be controlled from here.
   *
   * @param tracked - The container.
   * @returns The reason, or null.
   */
  #refusalOf(tracked: Tracked): 'self' | 'system' | 'managed' | null {
    if (tracked.id === this.#selfId) {
      return 'self';
    }

    if (this.#isSystem(tracked)) {
      return 'system';
    }

    const manager = this.#managed.managerOf(tracked.listed.Labels);

    return manager !== null && !manager.isReleased ? 'managed' : null;
  }

  /**
   * Whether a container is one of the platform's: its own, or one of its compose file.
   *
   * @param tracked - The container.
   * @returns True for a system container.
   */
  #isSystem(tracked: Tracked): boolean {
    const self = this.#selfId === null ? undefined : this.#containers.get(this.#selfId);

    return isSystemContainer(
      { id: tracked.id, labels: tracked.listed.Labels },
      self === undefined ? null : { id: self.id, labels: self.listed.Labels },
    );
  }

  /**
   * What a container is called on the page.
   *
   * @param tracked - The container.
   * @returns Its name for people.
   */
  #displayNameOf(tracked: Tracked): string {
    return displayNameOf({
      name: tracked.name,
      labels: tracked.listed.Labels,
      isSelf: tracked.id === this.#selfId,
      managedName: this.#managed.nameOf(tracked.listed.Labels),
    });
  }

  /**
   * What the containers outside a compose project hold, for a new container or a project to
   * check its names and ports against.
   *
   * @param project - The project, whose own containers are left out; null for a lone container.
   * @returns Their names, and every port they publish on the machine.
   */
  #neighboursOf(project: string | null): ComposeNeighbours {
    const names = new Set<string>();
    const ports = new Set<string>();

    for (const tracked of this.#containers.values()) {
      if (project !== null && tracked.listed.Labels[COMPOSE_LABELS.project] === project) {
        continue;
      }

      names.add(tracked.name);

      for (const port of tracked.listed.Ports) {
        if (port.PublicPort !== undefined) {
          ports.add(`${String(port.PublicPort)}/${port.Type}`);
        }
      }
    }

    return { names, ports };
  }

  /**
   * What the entities of a container are made from.
   *
   * @param tracked - The container.
   * @param samples - The samples to average: those since the last report, or the last one.
   * @returns The facts.
   */
  #factsOf(tracked: Tracked, samples: readonly ContainerSample[]): ContainerFacts {
    const isRunning = tracked.listed.State === 'running';
    const reference = tracked.inspected?.Config.Image ?? tracked.listed.Image;

    return {
      name: tracked.name,
      displayName: this.#displayNameOf(tracked),
      image: reference,
      version: this.#versionOf(tracked),
      isRunning,
      canUpdate: this.#refusalOf(tracked) === null,
      cpuPercent: isRunning ? meanOf(samples.map((sample) => sample.cpuPercent)) : null,
      memoryUsedBytes: isRunning ? meanOf(samples.map((sample) => sample.memoryUsedBytes)) : null,
      memoryLimitBytes: isRunning ? meanOf(samples.map((sample) => sample.memoryLimitBytes)) : null,
      update: {
        latestVersion: tracked.update.latestVersion,
        isInstalling: tracked.update.isInstalling,
        progress: tracked.update.progress,
      },
    };
  }

  /**
   * The version a container runs.
   *
   * @param tracked - The container.
   * @returns The image's label, a pinning tag, the last check's word for it, or null.
   */
  #versionOf(tracked: Tracked): string | null {
    const reference = parseImageReference(tracked.inspected?.Config.Image ?? tracked.listed.Image);

    return versionOf(tracked.image?.labels ?? {}, reference.tag) ?? tracked.update.installedVersion;
  }

  /**
   * A container as the list shows it.
   *
   * @param tracked - The container.
   * @returns The summary.
   */
  #summaryOf(tracked: Tracked): ContainerSummary {
    const reference = tracked.inspected?.Config.Image ?? tracked.listed.Image;
    const isSelf = tracked.id === this.#selfId;
    const last = tracked.listed.State === 'running' ? tracked.samples.at(-1) : undefined;
    const health = tracked.inspected?.State.Health?.Status;

    return {
      id: tracked.id,
      name: tracked.name,
      displayName: this.#displayNameOf(tracked),
      deviceId: this.#registeredNames.has(tracked.name) ? containerDeviceId(tracked.name) : null,
      image: reference,
      version: this.#versionOf(tracked),
      state: stateOf(tracked.listed.State),
      status: tracked.listed.Status,
      health:
        health !== undefined && (CONTAINER_HEALTH as readonly string[]).includes(health)
          ? (health as ContainerSummary['health'])
          : null,
      createdAt: new Date(tracked.listed.Created * 1000),
      startedAt: timeOf(tracked.inspected?.State.StartedAt),
      isSelf,
      isSystem: this.#isSystem(tracked),
      managedBy: this.#managed.managerOf(tracked.listed.Labels),
      compose: composeOf(
        tracked.listed.Labels,
        (project) =>
          tracked.listed.Labels[COMPOSE_LABEL] === 'true' && this.#compose.isEditable(project),
      ),
      // An image built on this machine has no page anywhere.
      registryUrl:
        tracked.isUnpublished || (tracked.image?.repoDigests.length ?? 0) === 0
          ? null
          : registryPageOf(parseImageReference(reference)),
      cpuPercent: last?.cpuPercent ?? null,
      memoryUsedBytes: last?.memoryUsedBytes ?? null,
      memoryLimitBytes: last?.memoryLimitBytes ?? null,
      update: tracked.update,
      refusal: this.#refusalOf(tracked),
    };
  }

  /**
   * A container with everything its page shows.
   *
   * @param tracked - The container.
   * @param inspected - It, inspected afresh.
   * @returns The detail.
   */
  #detailOf(tracked: Tracked, inspected: InspectedContainer): ContainerDetail {
    const raw = inspected as InspectedContainer & {
      Path?: string;
      Args?: string[];
      HostConfig: { Mounts?: { Target?: string; VolumeOptions?: { Subpath?: string } }[] };
    };
    const subpaths = new Map(
      (raw.HostConfig.Mounts ?? []).map((mount) => [
        mount.Target ?? '',
        mount.VolumeOptions?.Subpath,
      ]),
    );
    const command = [raw.Path ?? '', ...(raw.Args ?? [])].join(' ').trim();
    const warnings: string[] = [];

    if (
      this.#managed.managerOf(tracked.listed.Labels) !== null &&
      this.#context?.dataMount.kind === 'separate'
    ) {
      warnings.push(
        'Its data is in a Docker volume of its own, outside the backups: this Docker is too old to mount a folder of the data volume (26 or newer is)',
      );
    }

    return {
      ...this.#summaryOf(tracked),
      command: command.length === 0 ? null : command.slice(0, 4096),
      restartPolicy: inspected.HostConfig.RestartPolicy?.Name ?? null,
      networkMode: inspected.HostConfig.NetworkMode ?? 'default',
      hostname: inspected.Config.Hostname ?? null,
      networks: Object.entries(inspected.NetworkSettings.Networks).map(([name, endpoint]) => ({
        name,
        ipAddress:
          endpoint.IPAddress === undefined || endpoint.IPAddress === '' ? null : endpoint.IPAddress,
        gateway:
          endpoint.Gateway === undefined || endpoint.Gateway === '' ? null : endpoint.Gateway,
        aliases: endpoint.Aliases,
      })),
      ports: Object.entries(inspected.NetworkSettings.Ports).flatMap(([key, bindings]) => {
        const [port = '0', protocol = 'tcp'] = key.split('/');

        return bindings === null || bindings.length === 0
          ? [{ containerPort: Number(port), protocol, hostIp: null, hostPort: null }]
          : bindings.map((binding) => ({
              containerPort: Number(port),
              protocol,
              hostIp: binding.HostIp ?? null,
              hostPort: binding.HostPort === undefined ? null : Number(binding.HostPort),
            }));
      }),
      mounts: inspected.Mounts.map((mount) => ({
        type: mount.Type,
        source: mount.Name ?? mount.Source ?? null,
        destination: mount.Destination,
        isReadOnly: mount.RW === false,
        subpath: subpaths.get(mount.Destination) ?? null,
      })),
      devices: inspected.HostConfig.Devices.map((device) => ({
        host: device.PathOnHost,
        container: device.PathInContainer,
      })),
      env: inspected.Config.Env.map((entry) => {
        const equals = entry.indexOf('=');
        const name = equals === -1 ? entry : entry.slice(0, equals);
        const isHidden = isSecretName(name);

        return {
          name,
          value: isHidden || equals === -1 ? null : entry.slice(equals + 1).slice(0, 8192),
          isHidden,
        };
      }),
      labels: inspected.Config.Labels,
      sampleIntervalMs: this.#config.SUPERVISOR_SAMPLE_INTERVAL_MS,
      samples: tracked.listed.State === 'running' ? tracked.samples : [],
      warnings,
      webPort: this.#managed.webPortOf(tracked.listed.Labels),
    };
  }
}
