/**
 * The containers the integrations run.
 *
 * `hub` says, whole, which containers the loaded vendors declare (`reconcile`), and again for one
 * vendor when its settings change (`ensure`). Each declared container is then made to exist and to
 * run: pulled at the newest release the vendor accepts when it is missing or too old, made again
 * when what it was made from changed, started when it stopped. The work is done one container at
 * a time, after the reply - a pull can take minutes - and where each stands is kept for the
 * vendor's page to show.
 *
 * A managed container is locked: the owner cannot start, stop or update it, because the vendor
 * does. One no vendor declares any more - its bundle is gone - is **released** once `hub` has said
 * so, and is the owner's again. Until `hub` has spoken after a start, every managed container
 * stays locked: not having heard is not the same as having been told.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  isNebulaError,
  NotFoundError,
  type ContainerManager,
  type ContainerOwnerKind,
  type ManagedContainerSpec,
  type ManagedReply,
  type ManagedStatus,
  type ReconcileRequest,
  type VendorContainers,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

import type { InspectedContainer } from '../docker/engine-schemas.js';
import type { DockerEngine } from '../docker/engine.js';
import { parseImageReference } from '../domain/image-ref.js';
import {
  fillPlaceholders,
  MANAGED_LABELS,
  managedCreateBody,
  managedName,
  ownerKindOf,
  NETWORK_LABELS,
  isAnotherInstallations,
  platformValues,
  volumeFolder,
  type PlatformContext,
} from '../domain/managed.js';
import { PullProgressTracker } from '../domain/pull-progress.js';
import { newestSatisfying, satisfiesMinimum, versionOf } from '../domain/versions.js';
import type { RegistryClient } from '../registry/registry-client.js';

import { replaceContainer } from './replace.js';

/** What the managed containers need. */
export type ManagedContainersOptions = {
  readonly engine: DockerEngine;
  readonly registry: RegistryClient;
  readonly logger: PlatformLogger;

  /** The data directory, as this process reaches it: the volumes' folders are made in it. */
  readonly dataRoot: string;

  /** The platform as the containers see it; null while Docker cannot be reached. */
  readonly context: () => PlatformContext | null;

  /** Which installation this is: a managed container another one made is left to it. */
  readonly installationId: string;

  /** The platform's own container, to put on the shared network. */
  readonly selfId: () => string | null;

  /** Told whenever a container was made, replaced or started, so the lists read again. */
  readonly onChange: (name: string) => void;

  /**
   * The broker one container reaches, with a username of its own; undefined for the platform's.
   *
   * @param spec - The container's declaration.
   * @returns The broker, or undefined to keep the platform's.
   */
  readonly brokerFor?: (spec: ManagedContainerSpec) => Promise<PlatformContext['mqtt'] | undefined>;
};

/** The key an owner's declarations are kept under. */
type OwnerKey = `${ContainerOwnerKind}:${string}`;

/** The key a declared container is kept under. */
type Key = `${OwnerKey}/${string}`;

/**
 * The key of an owner: a vendor, or a package.
 *
 * @param ownerKind - Which kind.
 * @param vendorId - The vendor's id, or the package's.
 * @returns `vendor:<id>` or `package:<id>`.
 */
function ownerKeyOf(ownerKind: ContainerOwnerKind, vendorId: string): OwnerKey {
  return `${ownerKind}:${vendorId}`;
}

/**
 * The key of a declared container.
 *
 * @param ownerKind - Who declares it.
 * @param vendorId - Its vendor, or its package.
 * @param dependencyId - Its id among the owner's.
 * @returns `vendor:<id>/<dependency>`.
 */
function keyOf(ownerKind: ContainerOwnerKind, vendorId: string, dependencyId: string): Key {
  return `${ownerKeyOf(ownerKind, vendorId)}/${dependencyId}`;
}

/** The containers the integrations run. */
export class ManagedContainers {
  readonly #options: ManagedContainersOptions;
  readonly #desired = new Map<OwnerKey, ManagedContainerSpec[]>();
  readonly #status = new Map<Key, ManagedStatus>();

  /** The kinds of owner whose whole set was handed over: `hub`'s vendors, the packages. */
  readonly #reconciled = new Set<ContainerOwnerKind>();
  #isSuspended = false;
  #suspended: string[] = [];
  #queue: Promise<void> = Promise.resolve();

  /**
   * Creates the set, empty until `hub` says what it holds.
   *
   * @param options - The engine, the registry, the logger, the data directory and the platform.
   */
  public constructor(options: ManagedContainersOptions) {
    this.#options = options;
  }

  /**
   * Takes in every container every owner of one kind declares - every loaded vendor, from `hub`,
   * or every installed package, from the packet-manager - and sets to work on them. The other
   * kind's are left as they are.
   *
   * @param request - The whole set of one kind.
   * @returns Where each declared container stands now.
   */
  public reconcile(request: ReconcileRequest): ManagedReply {
    const { ownerKind } = request;

    for (const key of [...this.#desired.keys()]) {
      if (key.startsWith(`${ownerKind}:`)) {
        this.#desired.delete(key);
      }
    }

    for (const vendor of request.vendors) {
      this.#desired.set(
        ownerKeyOf(ownerKind, vendor.vendorId),
        vendor.containers.map((spec) => ({ ...spec, ownerKind })),
      );
    }

    this.#reconciled.add(ownerKind);

    for (const vendor of request.vendors) {
      this.#schedule(ownerKeyOf(ownerKind, vendor.vendorId));
    }

    return {
      containers: request.vendors.flatMap((vendor) => this.statusesOf(vendor.vendorId, ownerKind)),
    };
  }

  /**
   * Takes in one owner's containers, after its settings changed.
   *
   * @param request - The owner's containers.
   * @returns Where they stand now.
   */
  public ensure(
    request: VendorContainers & { readonly ownerKind?: ContainerOwnerKind },
  ): ManagedReply {
    const ownerKind = request.ownerKind ?? 'vendor';
    const key = ownerKeyOf(ownerKind, request.vendorId);

    this.#desired.set(
      key,
      request.containers.map((spec) => ({ ...spec, ownerKind })),
    );
    this.#schedule(key);

    return { containers: this.statusesOf(request.vendorId, ownerKind) };
  }

  /**
   * Starts the work again for every vendor: after Docker came back, or a restore ended.
   */
  public retry(): void {
    for (const key of this.#desired.keys()) {
      this.#schedule(key);
    }
  }

  /**
   * Where each container a vendor, or a package, declares stands.
   *
   * @param vendorId - The vendor, or the package.
   * @param ownerKind - Which of the two.
   * @returns One status per declared container, in the declaration's order.
   */
  public statusesOf(vendorId: string, ownerKind: ContainerOwnerKind = 'vendor'): ManagedStatus[] {
    return (this.#desired.get(ownerKeyOf(ownerKind, vendorId)) ?? []).map(
      (spec) =>
        this.#status.get(keyOf(ownerKind, vendorId, spec.dependencyId)) ?? {
          ownerKind,
          vendorId,
          dependencyId: spec.dependencyId,
          containerName: null,
          state: 'missing',
          version: null,
          error: null,
        },
    );
  }

  /**
   * Which integration runs a container, from its labels.
   *
   * @param labels - The container's labels.
   * @returns The manager, or null for a container no integration made.
   */
  public managerOf(labels: Readonly<Record<string, string>>): ContainerManager | null {
    const vendorId = labels[MANAGED_LABELS.vendor];
    const dependencyId = labels[MANAGED_LABELS.dependency];

    if (
      labels[MANAGED_LABELS.managed] !== 'true' ||
      vendorId === undefined ||
      dependencyId === undefined ||
      isAnotherInstallations(labels, this.#options.installationId)
    ) {
      return null;
    }

    const ownerKind = ownerKindOf(labels);
    const isDeclared = (this.#desired.get(ownerKeyOf(ownerKind, vendorId)) ?? []).some(
      (spec) => spec.dependencyId === dependencyId,
    );

    return {
      ownerKind,
      vendorId,
      dependencyId,
      isReleased: this.#reconciled.has(ownerKind) && !isDeclared,
    };
  }

  /**
   * What the integration running a container calls it, from its labels.
   *
   * @param labels - The container's labels.
   * @returns The declared name - `Zigbee2MQTT` - or null for a container no declaration names.
   */
  public nameOf(labels: Readonly<Record<string, string>>): string | null {
    const manager = this.managerOf(labels);

    return (
      (manager === null
        ? []
        : (this.#desired.get(ownerKeyOf(manager.ownerKind, manager.vendorId)) ?? [])
      ).find((spec) => spec.dependencyId === manager?.dependencyId)?.name ?? null
    );
  }

  /**
   * The web page a managed container serves on the machine, when its vendor published one.
   *
   * @param labels - The container's labels.
   * @returns The host port, or null.
   */
  public webPortOf(labels: Readonly<Record<string, string>>): number | null {
    const manager = this.managerOf(labels);
    const spec = (
      manager === null
        ? []
        : (this.#desired.get(ownerKeyOf(manager.ownerKind, manager.vendorId)) ?? [])
    ).find((each) => each.dependencyId === manager?.dependencyId);

    if (spec?.webPort === null || spec?.webPort === undefined) {
      return null;
    }

    return spec.ports.find((port) => port.container === spec.webPort)?.host ?? null;
  }

  /**
   * Stops every container an integration runs, before a restore swaps the folders their volumes
   * are in. Nothing is started again until {@link resume}.
   *
   * @param running - Every container's name, labels and whether it runs.
   */
  public async suspend(
    running: readonly {
      name: string;
      labels: Readonly<Record<string, string>>;
      isRunning: boolean;
    }[],
  ): Promise<void> {
    this.#isSuspended = true;
    this.#suspended = running
      .filter((container) => container.isRunning && this.managerOf(container.labels) !== null)
      .map((container) => container.name);

    // One at a time, so the log says which one failed.
    for (const name of this.#suspended) {
      // eslint-disable-next-line no-await-in-loop -- see above
      await this.#options.engine.control(name, 'stop');
      this.#options.onChange(name);
    }

    this.#options.logger.info({ containers: this.#suspended }, 'Stopped the managed containers');
  }

  /**
   * Starts again what {@link suspend} stopped, and looks at every declaration again.
   */
  public async resume(): Promise<void> {
    const names = this.#suspended;

    this.#isSuspended = false;
    this.#suspended = [];

    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop -- one at a time, as they were stopped
      await this.#options.engine.control(name, 'start').catch((error: unknown) => {
        this.#options.logger.warn({ err: error, container: name }, 'Could not start it again');
      });
      this.#options.onChange(name);
    }

    this.retry();
  }

  /**
   * Queues the work for one owner behind whatever is already queued.
   *
   * @param key - The owner.
   */
  #schedule(key: OwnerKey): void {
    this.#queue = this.#queue.then(async () => {
      if (this.#isSuspended) {
        return;
      }

      for (const spec of this.#desired.get(key) ?? []) {
        // eslint-disable-next-line no-await-in-loop -- one container at a time, one pull at a time
        await this.#ensureOne(spec);
      }
    });
  }

  /**
   * Makes one declared container exist, at a release the vendor accepts, made from what the
   * vendor declared, and running.
   *
   * @param spec - The declaration.
   */
  async #ensureOne(spec: ManagedContainerSpec): Promise<void> {
    const key = keyOf(spec.ownerKind, spec.vendorId, spec.dependencyId);
    const name = managedName(spec);
    const platform = this.#options.context();
    const broker = platform === null ? undefined : await this.#options.brokerFor?.(spec);
    const context =
      platform === null || broker === undefined ? platform : { ...platform, mqtt: broker };

    /**
     * Records where it stands.
     *
     * @param fields - What changed.
     */
    const record = (fields: Partial<ManagedStatus>): void => {
      this.#status.set(key, {
        ownerKind: spec.ownerKind,
        vendorId: spec.vendorId,
        dependencyId: spec.dependencyId,
        containerName: name,
        state: 'missing',
        version: null,
        error: null,
        ...this.#status.get(key),
        ...fields,
      });
    };

    if (context === null) {
      record({ state: 'missing', error: 'Docker cannot be reached' });

      return;
    }

    try {
      // Before anything else, the container up to date too: the platform's own container made
      // again - a new image - is no longer on the network, and a container already running would
      // then look for the broker under a name nothing answers to.
      if (context.network !== 'host') {
        await this.ensureNetwork(context);
      }

      const existing = await this.#inspect(name);

      if (
        existing !== undefined &&
        isAnotherInstallations(existing.Config.Labels, this.#options.installationId)
      ) {
        record({
          state: 'missing',
          error: `Another NebulaHome on this Docker runs ${name}, so this one leaves it alone. Stop that one, or remove its container, to run it from here.`,
        });

        return;
      }

      const installedTag =
        existing === undefined ? null : parseImageReference(existing.Config.Image).tag;
      const labels =
        existing === undefined
          ? {}
          : ((await this.#options.engine.inspectImage(existing.Image))?.Config?.Labels ?? {});
      const installedVersion = installedTag === null ? null : versionOf(labels, installedTag);
      const isTooOld = !satisfiesMinimum(installedVersion ?? installedTag, spec.minVersion);
      const tag = installedTag !== null && !isTooOld ? installedTag : await this.#releaseFor(spec);
      const { body, hash } = managedCreateBody(spec, tag, context);

      if (
        existing !== undefined &&
        !isTooOld &&
        existing.Config.Labels[MANAGED_LABELS.spec] === hash
      ) {
        if (existing.State.Running !== true) {
          await this.#options.engine.control(existing.Id, 'start');
          this.#options.onChange(name);
        }

        record({ state: 'running', version: installedVersion ?? tag, error: null });

        return;
      }

      record({ state: 'pulling', error: null });

      const tracker = new PullProgressTracker();

      await this.#options.engine.pull(spec.image, tag, (progress) => {
        tracker.add(progress);
      });

      await this.#prepareVolumes(spec, context);

      if (existing === undefined) {
        const id = await this.#options.engine.createContainer(name, body);

        await this.#options.engine.control(id, 'start');
      } else {
        await replaceContainer({
          engine: this.#options.engine,
          logger: this.#options.logger,
          id: existing.Id,
          name,
          wasRunning: true,
          body,
        });
      }

      this.#options.logger.info(
        { container: name, vendor: spec.vendorId, image: `${spec.image}:${tag}` },
        existing === undefined ? 'Made a container an integration runs' : 'Made it again',
      );
      record({ state: 'running', version: tag, error: null });
      this.#options.onChange(name);
    } catch (error: unknown) {
      const message =
        isNebulaError(error) || error instanceof Error ? error.message : String(error);

      this.#options.logger.error(
        { err: error, container: name, vendor: spec.vendorId },
        'Could not run a container an integration needs',
      );
      record({ state: 'missing', error: message.slice(0, 1000) });
    }
  }

  /**
   * Reads a container by name.
   *
   * @param name - Its name.
   * @returns It, or undefined when there is none.
   */
  async #inspect(name: string): Promise<InspectedContainer | undefined> {
    try {
      return await this.#options.engine.inspectContainer(name);
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * The release to install: the newest the vendor accepts, or its minimum when the registry
   * cannot be asked - a pull of a release that does not exist then says so.
   *
   * @param spec - The declaration.
   * @returns The tag.
   */
  async #releaseFor(spec: ManagedContainerSpec): Promise<string> {
    try {
      const tags = await this.#options.registry.tags(parseImageReference(spec.image));

      return newestSatisfying(spec.minVersion, tags) ?? spec.minVersion;
    } catch (error: unknown) {
      this.#options.logger.warn(
        { err: error, image: spec.image },
        'Could not list the releases; installing the minimum',
      );

      return spec.minVersion;
    }
  }

  /**
   * Makes the network the managed containers share, and puts the platform on it under its name.
   * A container the owner installs on the platform's network joins the same one.
   *
   * Asked every time, not only when a container is made: the platform's container made again - a
   * new image - starts off the network, and one put on it by hand may lack the name the others
   * reach it by. Either way the containers already running look for the broker under a name that
   * answers nothing, or answers wrong.
   *
   * @param context - The platform.
   */
  public async ensureNetwork(context: PlatformContext): Promise<void> {
    const { engine, logger } = this.#options;
    const network = await engine.inspectNetwork(context.networkName);

    if (network === undefined) {
      await engine.createNetwork(context.networkName, NETWORK_LABELS);
    }

    const selfId = this.#options.selfId();

    if (context.network !== 'bridge' || selfId === null) {
      return;
    }

    const self = await this.#inspect(selfId);
    const endpoint = self?.NetworkSettings.Networks[context.networkName];

    if (endpoint?.Aliases.includes(context.platformAlias) === true) {
      return;
    }

    // On the network under other names only: off, and on again under the one the others use.
    if (endpoint !== undefined) {
      await engine.disconnectNetwork(context.networkName, selfId);
    }

    await engine.connectNetwork(context.networkName, selfId, [context.platformAlias]);
    logger.info(
      { network: context.networkName, alias: context.platformAlias },
      'Put the platform on the network its containers reach it by',
    );
  }

  /**
   * Makes each volume's folder, and writes the files a first start needs.
   *
   * @param spec - The declaration.
   * @param context - The platform: a volume kept apart has no folder here.
   */
  async #prepareVolumes(spec: ManagedContainerSpec, context: PlatformContext): Promise<void> {
    if (context.dataMount.kind === 'separate') {
      return;
    }

    await Promise.all(
      spec.volumes.map(async (volume) =>
        mkdir(path.join(this.#options.dataRoot, volumeFolder(spec, volume)), { recursive: true }),
      ),
    );

    // A first configuration may name the broker the way the container reaches it.
    const values = platformValues(context);

    await Promise.all(
      spec.seed.map(async (seed) => {
        const volume = spec.volumes.find((each) => each.name === seed.volume);

        if (volume === undefined) {
          return;
        }

        const file = path.join(this.#options.dataRoot, volumeFolder(spec, volume), seed.path);

        await mkdir(path.dirname(file), { recursive: true });

        try {
          // `wx`: written once, never over what the container has since made of it.
          await writeFile(file, fillPlaceholders(seed.content, values), { flag: 'wx' });
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
          }
        }
      }),
    );
  }
}
