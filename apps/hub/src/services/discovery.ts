/**
 * Finding devices, and turning the ones an owner wants into registry rows.
 *
 * Candidates are **not persisted**. A candidate is something a scan saw a moment ago; storing one
 * would create a table whose rows go stale the instant a device is unplugged, and a second
 * definition of "device" competing with `registry.devices`. Only what an owner adopts is written,
 * and it is `core` that writes it.
 *
 * Adoption goes through `core` rather than straight to the database on purpose. `core` is the
 * single writer of the registry and holds the directory it routes commands against; a row written
 * behind its back would leave that directory stale until the next restart, and a command routed
 * at an entity `core` had never heard of.
 *
 * Releasing a device is deliberately **not served here yet**. It is a registry write, so it
 * belongs to `core` the same way adoption does, and `hub` cannot match the registry identifier a
 * caller would name against the device keys it holds until `core` publishes that mapping.
 * Answering such a call today would tell the caller a device had been released when nothing had
 * happened, which is worse than not answering at all.
 */
import { ulid, type BusClient, type BusSubscription } from '@nebula-home/bus';
import {
  adoptRequestSchema,
  busSubjects,
  candidatesRequestSchema,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  discoverRequestSchema,
  HUB_ADOPT_METHOD,
  HUB_CANDIDATES_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_SERVICE,
  NotFoundError,
  registerDeviceReplySchema,
  type AdoptReply,
  type AdoptRequest,
  type CandidatesReply,
  type DiscoverReply,
  type DiscoverRequest,
  type DiscoveredCandidate,
  type EntityId,
  type JsonObject,
  type CapabilityName,
  type DeclaredCapabilities,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';
import type { Claim, Integration, Registry, Transport } from '@nebula-home/package-runtime';

import type { DeviceBinding, DeviceBook } from '../domain/devices.js';
import { composeEntityId } from '../domain/entity-ids.js';
import { configOf } from '../persistence/devices.js';

/**
 * Lists the capabilities an entity declares.
 *
 * @param declared - What the descriptor declared, keyed by capability.
 * @returns The capability names, typed rather than cast: the keys of a partial record over the
 * capability enum are capability names, and saying so once here is better than a cast at the one
 * place a preview is built.
 */
function capabilityNames(declared: DeclaredCapabilities): CapabilityName[] {
  return Object.keys(declared) as CapabilityName[];
}

/** One running instance, as discovery needs to see it. */
export type DiscoverableInstance = {
  readonly instanceId: string;
  readonly integration: Integration;
  readonly options: JsonObject;
  readonly transportId: string;
  readonly transportConfig: JsonObject;
  readonly book: DeviceBook;
};

/** What discovery needs. */
export type DiscoveryOptions = {
  readonly client: BusClient;
  readonly transports: Registry<Transport>;
  readonly logger: PlatformLogger;

  /** The instances to scan with, read at the moment a scan starts rather than held. */
  readonly instances: () => DiscoverableInstance[];

  /** How long a pass runs when the caller does not say. */
  readonly defaultTimeoutMs: number;

  /**
   * Told when a device has been adopted.
   *
   * Adoption changes what its connection has to carry - a newly adopted device needs polling, or
   * a topic subscribing - and the set is per connection rather than per instance, so recomputing
   * it belongs to whoever holds them all.
   *
   * @param instanceId - The instance that gained a device.
   * @returns A promise that settles once the connection has been told.
   */
  readonly onAdopted?: (instanceId: string) => Promise<void>;
};

/** A candidate, with everything needed to adopt it. */
type Held = {
  readonly candidate: DiscoveredCandidate;
  readonly claim: Claim;
  readonly instance: DiscoverableInstance;
};

/** Finding devices, and turning the ones an owner wants into registry rows. */
export class DiscoveryService {
  readonly #options: DiscoveryOptions;
  readonly #held = new Map<string, Held>();
  #scanning: AbortController | undefined = undefined;

  /**
   * Prepares discovery.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: DiscoveryOptions) {
    this.#options = options;
  }

  /**
   * Starts a pass.
   *
   * Replaces whatever the previous pass found, rather than adding to it. A candidate list that
   * accumulated would keep offering devices that have since been unplugged, and an owner would
   * adopt one and wonder why it never reports.
   *
   * @param request - Which instance to scan with, and for how long.
   * @returns The scan identifier and the instances actually scanning.
   */
  public discover(request: DiscoverRequest): DiscoverReply {
    this.#scanning?.abort();
    this.#held.clear();

    const scanId = ulid();
    const abort = new AbortController();
    this.#scanning = abort;

    const timer = setTimeout(() => {
      abort.abort();
    }, request.timeoutMs);
    timer.unref();

    const instances = this.#options
      .instances()
      .filter(
        (instance) =>
          request.integrationId === undefined || instance.instanceId === request.integrationId,
      );

    // Deliberately not awaited. A scan of a house takes long enough that the interface should be
    // filling in while it runs, so the caller gets the identifier now and polls for candidates.
    void Promise.allSettled(
      instances.map(async (instance) => this.#scanWith(instance, scanId, abort.signal)),
    ).finally(() => {
      clearTimeout(timer);

      if (this.#scanning === abort) {
        this.#scanning = undefined;
      }
    });

    return { scanId, integrationIds: instances.map((instance) => instance.instanceId) };
  }

  /**
   * Reports what the current pass has found.
   *
   * @returns The candidates and whether the pass is still running.
   */
  public candidates(): CandidatesReply {
    return {
      candidates: [...this.#held.values()].map((held) => held.candidate),
      isScanning: this.#scanning !== undefined,
    };
  }

  /**
   * Turns a candidate into a registered device.
   *
   * @param request - Which candidate, and what to call it.
   * @returns What was created.
   * @throws {NotFoundError} When the candidate is not from the current pass. Candidate
   * identifiers are scan-scoped, so a stale one fails here rather than adopting whatever now
   * happens to sit at that position.
   */
  public async adopt(request: AdoptRequest): Promise<AdoptReply> {
    const held = this.#held.get(request.candidateId);

    if (held === undefined) {
      throw new NotFoundError(`No candidate ${request.candidateId} in the current scan`, {
        details: { candidateId: request.candidateId },
      });
    }

    const descriptor = held.instance.integration.describe(held.claim, held.instance.options);
    const entities = descriptor.entities.map((entity) => ({
      entityId: composeEntityId(entity.domain, descriptor.externalId, entity.objectId),
      name: entity.name,
      capabilities: entity.capabilities,
      ...(entity.unitOfMeasurement === undefined
        ? {}
        : { unitOfMeasurement: entity.unitOfMeasurement }),
      ...(entity.deviceClass === undefined ? {} : { deviceClass: entity.deviceClass }),
      ...(entity.stateClass === undefined ? {} : { stateClass: entity.stateClass }),
      ...(entity.displayPrecision === undefined
        ? {}
        : { displayPrecision: entity.displayPrecision }),
    }));

    const reply = await this.#options.client.request(
      busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
      {
        integrationId: held.instance.instanceId,
        externalId: descriptor.externalId,
        name: request.name ?? descriptor.name,
        ...(descriptor.manufacturer === undefined ? {} : { manufacturer: descriptor.manufacturer }),
        ...(descriptor.model === undefined ? {} : { model: descriptor.model }),
        ...(descriptor.viaExternalId === undefined
          ? {}
          : { viaExternalId: descriptor.viaExternalId }),
        ...(request.areaId === undefined ? {} : { areaId: request.areaId }),

        // The claim goes with the row, so the instance can bind this device again on its next
        // start instead of waiting for somebody to find it a second time.
        config: configOf(held.claim),
        entities,
      },
      registerDeviceReplySchema,
    );

    const binding: DeviceBinding = {
      claim: held.claim,
      entities: new Map<string, EntityId>(
        descriptor.entities.flatMap((entity, index) => {
          const entityId = reply.entityIds[index];

          //  answers with one identifier per entity, in the order they were sent. A short
          // reply would mean the two disagree about what was registered, and binding a device to
          // an identifier that is not its own is worse than binding nothing.
          return entityId === undefined ? [] : [[entity.objectId ?? '', entityId] as const];
        }),
      ),
    };

    held.instance.book.bind(binding);
    this.#held.delete(request.candidateId);

    // After binding, not before: the subscription plan is built from what the instance owns, and
    // a device that is not in the book yet would be left unpolled until the next adoption.
    await this.#options.onAdopted?.(held.instance.instanceId);

    return { deviceId: reply.deviceId, entityIds: reply.entityIds };
  }

  /**
   * Serves the management subjects.
   *
   * @returns The subscriptions, to unsubscribe on shutdown.
   */
  public serve(): BusSubscription[] {
    const { client } = this.#options;

    return [
      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_DISCOVER_METHOD),
        discoverRequestSchema,

        /**
         * Starts a pass.
         *
         * @param request - Which instance, and for how long.
         * @returns The scan identifier.
         */
        (request: DiscoverRequest): DiscoverReply => this.discover(request),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_CANDIDATES_METHOD),
        candidatesRequestSchema,

        /**
         * Reports what has been found.
         *
         * @returns The candidates and whether the pass is still running.
         */
        (): CandidatesReply => this.candidates(),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_ADOPT_METHOD),
        adoptRequestSchema,

        /**
         * Adopts one candidate.
         *
         * @param request - Which candidate, and what to call it.
         * @returns What was created.
         */
        async (request: AdoptRequest): Promise<AdoptReply> => this.adopt(request),
      ),
    ];
  }

  /**
   * Scans with one instance and records what it claims.
   *
   * @param instance - The instance to scan with.
   * @param scanId - The pass this belongs to.
   * @param signal - Ends the scan.
   * @returns A promise that settles when the scan ends.
   */
  async #scanWith(
    instance: DiscoverableInstance,
    scanId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const transport = this.#options.transports.require(instance.transportId);

    for await (const discovered of transport.scan(
      instance.transportConfig,
      instance.integration.discovery,
      signal,
    )) {
      const claim = instance.integration.claim(discovered, instance.options);

      if (claim === null) {
        continue;
      }

      if (instance.book.claims().some((held) => held.externalId === claim.externalId)) {
        // Already adopted. Offering it again would let an owner adopt one device twice, and the
        // second registration would collide on `UNIQUE (integration_id, external_id)`.
        continue;
      }

      const descriptor = instance.integration.describe(claim, instance.options);
      const candidateId = `${scanId}:${instance.instanceId}:${descriptor.externalId}`;

      this.#held.set(candidateId, {
        claim,
        instance,
        candidate: {
          candidateId,
          integrationId: instance.instanceId,
          externalId: descriptor.externalId,
          name: descriptor.name,
          ...(descriptor.manufacturer === undefined
            ? {}
            : { manufacturer: descriptor.manufacturer }),
          ...(descriptor.model === undefined ? {} : { model: descriptor.model }),
          entities: descriptor.entities.map((entity) => ({
            entityId: composeEntityId(entity.domain, descriptor.externalId, entity.objectId),
            name: entity.name,
            capabilities: capabilityNames(entity.capabilities),
          })),
          evidence: {},
        },
      });
    }
  }
}
