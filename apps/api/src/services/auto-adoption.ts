/**
 * Adding on its own what a vendor says is added on its own.
 *
 * Most devices discovery finds are proposed, and the owner adopts the ones they want. A vendor
 * whose devices were already chosen somewhere the owner set up - a Zigbee device paired with
 * Zigbee2MQTT - says so (`"adopt": "automatic"` in its `discovery.json`), and asking again would
 * only be a second step to forget. Those are added here as soon as the hub proposes them: named
 * as they named themselves, with the id the add form would have suggested, the way the owner
 * adopting them would have added them, through the same `createDevice`.
 *
 * The hub's list is read whenever it says it changed, and once a minute besides - `api` may have
 * started after the hub proposed them, and an event missed is a device never added. A device that
 * cannot be added - the vendor not set up yet, a driver that asks for something - is tried again
 * each time, and said in the log once per reason, not once a minute.
 *
 * A device removed here is added again while the vendor still has it: it is the vendor's list that
 * decides, so a Zigbee device is removed for good in Zigbee2MQTT.
 */
import { ulid, type BusClient, type BusSubscription } from '@nebulahome/bus';
import {
  BUS_PATTERNS,
  discoveryEventSchema,
  suggestDeviceId,
  type DiscoveredDevice,
} from '@nebulahome/contracts';
import { schema } from '@nebulahome/db';

import type { AuditLog } from './audit.js';
import { rehomeMatterDevices } from './brokers.js';
import type { DevicesContext } from './devices.js';
import { adoptDiscovered, listDiscovered } from './discovery.js';
import { offerTwins } from './links.js';

/** How often the list is read without being told it changed. */
const SWEEP_MS = 60_000;

/** How long after a change the list is read: one pairing is several changes in a row. */
const SETTLE_MS = 500;

/** What adding on its own needs. */
export type AutoAdoptionOptions = {
  /**
   * The collaborators a device is added with, for one pass.
   *
   * @param traceId - The pass's trace id.
   * @returns The context.
   */
  readonly contextFor: (traceId: string) => DevicesContext;

  readonly audit: Pick<AuditLog, 'record'>;

  /** Reads what the hub proposes; the hub's list when not said. */
  readonly list?: typeof listDiscovered;

  /** Adds one device found; `adoptDiscovered` when not said. */
  readonly adopt?: typeof adoptDiscovered;

  /** Reads the device ids already in use; the registry's when not said. */
  readonly takenIds?: (context: DevicesContext) => Promise<string[]>;

  /** Hands Matter devices to the integration installed since; `rehomeMatterDevices` when not said. */
  readonly rehome?: typeof rehomeMatterDevices;

  /** Offers to link devices reached two ways; `offerTwins` when not said. */
  readonly offerTwins?: typeof offerTwins;
};

/** The key a failure to hand Matter devices over is said once under. */
const REHOME_FAILURE = 'matter';

/** The key a failure to look for twins is said once under. */
const TWINS_FAILURE = 'twins';

/**
 * The device ids already in use.
 *
 * @param context - The collaborators.
 * @returns Every device's id.
 */
async function registryIds(context: DevicesContext): Promise<string[]> {
  const rows = await context.db
    .select({ id: schema.registry.integrations.id })
    .from(schema.registry.integrations);

  return rows.map((row) => row.id);
}

/**
 * The name a device found is added under: what it called itself, else its model, else the driver.
 *
 * @param candidate - The device found.
 * @returns The name, at most as long as a device name may be.
 */
function nameOf(candidate: DiscoveredDevice): string {
  const name = candidate.name?.trim() ?? '';

  return (name === '' ? (candidate.model ?? candidate.driverId) : name).slice(0, 128);
}

/** Adds, as they are found, the devices of the vendors that add their own. */
export class AutoAdoption {
  readonly #options: AutoAdoptionOptions;
  readonly #subscriptions: BusSubscription[] = [];

  /** Why each device could not be added the last time, so a reason is logged once. */
  readonly #failures = new Map<string, string>();

  #sweep: NodeJS.Timeout | undefined;
  #settle: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;
  #isAgain = false;

  /**
   * Prepares the service without reading anything.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: AutoAdoptionOptions) {
    this.#options = options;
  }

  /**
   * Starts listening for the hub's list to change, and reads it once now.
   *
   * @param client - The bus.
   */
  public start(client: BusClient): void {
    this.#subscriptions.push(
      client.subscribe(BUS_PATTERNS.allDiscoveryEvents, discoveryEventSchema, () => {
        this.#schedule();
      }),
    );
    this.#sweep = setInterval(() => {
      this.#schedule();
    }, SWEEP_MS);
    this.#sweep.unref();
    this.#schedule();
  }

  /** Stops listening. A pass under way finishes on its own. */
  public stop(): void {
    clearInterval(this.#sweep);
    clearTimeout(this.#settle);

    for (const subscription of this.#subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
  }

  /**
   * Reads the list once more, now or after the pass under way.
   *
   * @returns Once the pass it scheduled is over.
   */
  public async settle(): Promise<void> {
    clearTimeout(this.#settle);
    await this.#run();
  }

  /** Reads the list a moment from now, once however many changes come in that moment. */
  #schedule(): void {
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => {
      void this.#run();
    }, SETTLE_MS);
    this.#settle.unref();
  }

  /**
   * Runs a pass, or asks for one more after the one under way: two at once would add a device
   * twice under two ids.
   *
   * @returns Once the passes asked for are over.
   */
  async #run(): Promise<void> {
    if (this.#running !== undefined) {
      this.#isAgain = true;

      return this.#running;
    }

    this.#running = (async (): Promise<void> => {
      do {
        this.#isAgain = false;
        // One pass at a time, by design: see above.
        // eslint-disable-next-line no-await-in-loop -- see above
        await this.#pass();
      } while (this.#isAskedAgain());
    })().finally(() => {
      this.#running = undefined;
    });

    return this.#running;
  }

  /**
   * Whether another pass was asked for while one ran.
   *
   * @returns True when one was.
   */
  #isAskedAgain(): boolean {
    return this.#isAgain;
  }

  /**
   * Offers to link the devices that look like one reached two ways, once each pair.
   *
   * @param context - The collaborators.
   */
  async #offerTwins(context: DevicesContext): Promise<void> {
    try {
      const offered = await (this.#options.offerTwins ?? offerTwins)(context);

      this.#failures.delete(TWINS_FAILURE);

      if (offered > 0) {
        context.logger.info({ offered }, 'Offered to link devices that look like one');
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);

      if (this.#failures.get(TWINS_FAILURE) !== reason) {
        this.#failures.set(TWINS_FAILURE, reason);
        context.logger.warn({ err: error }, 'Could not look for devices reached two ways');
      }
    }
  }

  /**
   * Hands each Matter device the platform holds to the integration installed since that takes it,
   * as adding it would have if the integration had come first.
   *
   * @param context - The pass's collaborators.
   * @param rehome - What hands them over.
   */
  async #rehome(context: DevicesContext, rehome: typeof rehomeMatterDevices): Promise<void> {
    let rehomed: Awaited<ReturnType<typeof rehomeMatterDevices>>;

    try {
      rehomed = await rehome(context);
      this.#failures.delete(REHOME_FAILURE);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);

      if (this.#failures.get(REHOME_FAILURE) !== reason) {
        this.#failures.set(REHOME_FAILURE, reason);
        context.logger.warn({ err: error }, 'Could not hand Matter devices to their integrations');
      }

      return;
    }

    for (const { deviceId, kind } of rehomed) {
      context.logger.info(
        { deviceId, kind },
        'Handed a Matter device to the integration that takes it',
      );
      // eslint-disable-next-line no-await-in-loop -- recorded as it happens, in order
      await this.#options.audit.record({
        action: 'device.update',
        resourceType: 'device',
        resourceId: deviceId,
        result: 'success',
        isSystem: true,
        traceId: context.traceId,
        details: { via: 'discovery', kind },
      });
    }
  }

  /** Adds every device the hub proposes for a vendor that adds its own. */
  async #pass(): Promise<void> {
    const {
      list = listDiscovered,
      adopt = adoptDiscovered,
      takenIds = registryIds,
      rehome = rehomeMatterDevices,
    } = this.#options;
    const context = this.#options.contextFor(ulid());

    await this.#rehome(context, rehome);
    await this.#offerTwins(context);

    const candidates = (await list(context)).filter(
      (candidate) => candidate.adoption === 'automatic' && candidate.movedFrom === null,
    );

    if (candidates.length === 0) {
      return;
    }

    const taken = await takenIds(context);

    for (const candidate of candidates) {
      const name = nameOf(candidate);
      const id = suggestDeviceId(candidate.vendorId, name, taken);

      try {
        // One after the other, by design: each takes an id the next must not.
        // eslint-disable-next-line no-await-in-loop -- see above
        const { device } = await adopt(context, candidate.id, {
          id,
          name,
          transportConfig: {},
          options: {},
          tagIds: [],
        });

        taken.push(device.id);
        this.#failures.delete(candidate.id);
        context.logger.info(
          { deviceId: device.id, kind: device.kind, externalId: candidate.externalId },
          'Added a device its vendor adds on its own',
        );
        // eslint-disable-next-line no-await-in-loop -- recorded as it happens, in order
        await this.#options.audit.record({
          action: 'device.create',
          resourceType: 'device',
          resourceId: device.id,
          result: 'success',
          isSystem: true,
          traceId: context.traceId,
          details: {
            via: 'discovery',
            adoption: 'automatic',
            kind: device.kind,
            model: device.model,
            source: candidate.source,
          },
        });
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);

        if (this.#failures.get(candidate.id) !== reason) {
          this.#failures.set(candidate.id, reason);
          context.logger.warn(
            { err: error, candidateId: candidate.id, kind: candidate.kind },
            'Could not add a device its vendor adds on its own',
          );
        }
      }
    }
  }
}
