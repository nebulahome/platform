/**
 * Hearing from the device an instance was added for, and having `core` complete its row.
 *
 * An owner adds a device by its address. The address says where to listen, not what is there:
 * the serial a printer announces on its broker, the id a relay answers a probe with, is what
 * the row needs before the device has entities. So a started instance listens - with the same
 * scan its transport uses to find things - takes the first device its integration claims,
 * asks `core` to write the serial, the claim and the entities against the row the API created,
 * and binds it. One device per instance: a second one answering is logged and left alone.
 *
 * `core` stays the only writer of the registry. What is asked of it here is an update of a row
 * the API wrote, which is why a row that is not there is an error the loop stops on rather than
 * one it retries: nothing this service can do will make the row appear.
 *
 * Not every device answers on its own. A P1 or an A1 printer reports on change and when asked,
 * and it cannot be asked before its serial is known - so a pass that hears nothing is followed
 * by another almost at once, and only a pass that failed waits the longer while.
 */
import type { BusClient } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  NotFoundError,
  registerDeviceReplySchema,
  type EntityId,
  type JsonObject,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';
import type { Claim, Integration, Registry, Transport } from '@nebula-home/package-runtime';

import { describeDevice, type DeviceBinding } from '../domain/devices.js';
import { configOf } from '../persistence/devices.js';

/** One started instance whose device is not bound yet, as identification needs to see it. */
export type IdentifiableInstance = {
  readonly instanceId: string;
  readonly integration: Integration;
  readonly options: JsonObject;
  readonly transportId: string;

  /** The transport's settings, secrets opened. */
  readonly transportConfig: JsonObject;

  /**
   * What the row already says the device is, when it was identified before and could not be
   * bound from what was kept. Null for a device nothing has been heard from yet.
   */
  readonly expectedExternalId: string | null;
};

/** What identification needs. */
export type IdentificationOptions = {
  readonly client: BusClient;
  readonly transports: Registry<Transport>;
  readonly logger: PlatformLogger;

  /** How long one pass listens before it is counted as having heard nothing. */
  readonly attemptTimeoutMs: number;

  /** How long to wait after a pass that failed - the transport threw, `core` did not answer. */
  readonly retryMs: number;

  /** How long to wait after a pass that heard nothing. Short, for the printers that only answer when asked. */
  readonly pauseMs?: number;
};

/** What identifying a device produced. */
export type Identified = {
  readonly binding: DeviceBinding;
  readonly externalId: string;
  readonly entityIds: readonly EntityId[];
};

/** How long to wait after a pass that heard nothing, when the caller does not say. */
const DEFAULT_PAUSE_MS = 1000;

/**
 * Waits, or stops waiting the moment the signal says so.
 *
 * @param ms - How long.
 * @param signal - What cuts the wait short.
 * @returns A promise that settles either way.
 */
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref();

    /** Ends the wait early. */
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** How many of a payload's top-level scalars a log line shows. */
const SUMMARY_FIELDS = 12;

/** How long a summarised string may be. */
const SUMMARY_LENGTH = 64;

/**
 * The top-level scalars of what a device answered, for a log line.
 *
 * Not the payload: a status is kilobytes, and a log line is read by a person looking for the
 * model string a claim compares against.
 *
 * @param payload - What the scan saw.
 * @returns Up to a dozen top-level strings, numbers and booleans, strings cut short.
 */
function summarise(payload: unknown): Record<string, string | number | boolean> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {};
  }

  const summary: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (Object.keys(summary).length >= SUMMARY_FIELDS) {
      break;
    }

    if (typeof value === 'string') {
      summary[key] = value.slice(0, SUMMARY_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
    }
  }

  return summary;
}

/**
 * Reads whether a search has been told to stop.
 *
 * A function rather than the property, because the property is read again after every `await`
 * and the type checker, not knowing an abort can happen meanwhile, would narrow it to false.
 *
 * @param signal - The search's signal.
 * @returns True once it has been aborted.
 */
function stopped(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Hearing from the device an instance was added for. */
export class IdentificationService {
  readonly #options: IdentificationOptions;

  /**
   * Prepares identification.
   *
   * @param options - Its collaborators and its patience.
   */
  public constructor(options: IdentificationOptions) {
    this.#options = options;
  }

  /**
   * Listens once, for as long as a pass lasts, and completes the device if one is claimed.
   *
   * The scan is left as soon as a device is accepted. A broker subscription never ends on its
   * own, and finishing the pass would hold a second session open for nothing.
   *
   * @param instance - The instance to listen with.
   * @param signal - Ends the pass early.
   * @returns What was identified and bound, or undefined when the pass heard nothing it could
   * take.
   * @throws {Error} When the transport failed, or `core` did not answer or refused.
   */
  public async attempt(
    instance: IdentifiableInstance,
    signal: AbortSignal,
  ): Promise<Identified | undefined> {
    const { transports, logger, attemptTimeoutMs } = this.#options;
    const transport = transports.require(instance.transportId);
    const pass = AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]);
    let claimed: Claim | undefined;

    for await (const found of transport.scan(
      instance.transportConfig,
      instance.integration.discovery,
      pass,
    )) {
      const claim = instance.integration.claim(found, instance.options);

      if (claim === null) {
        logger.info(
          {
            instanceId: instance.instanceId,
            deviceKey: found.deviceKey,
            answered: summarise(found.payload),
          },
          'Heard from a device the driver did not claim',
        );

        continue;
      }

      if (
        instance.expectedExternalId !== null &&
        claim.externalId !== instance.expectedExternalId
      ) {
        logger.warn(
          {
            instanceId: instance.instanceId,
            externalId: claim.externalId,
            expectedExternalId: instance.expectedExternalId,
          },
          'Heard from a device that is not the one on the row; ignored',
        );

        continue;
      }

      claimed = claim;

      break;
    }

    if (claimed === undefined || stopped(signal)) {
      return undefined;
    }

    const described = describeDevice(
      instance.instanceId,
      instance.integration,
      claimed,
      instance.options,
    );
    const { descriptor } = described;

    const reply = await this.#options.client.request(
      busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
      {
        integrationId: instance.instanceId,
        externalId: descriptor.externalId,
        ...(descriptor.manufacturer === undefined ? {} : { manufacturer: descriptor.manufacturer }),
        ...(descriptor.model === undefined ? {} : { model: descriptor.model }),
        ...(descriptor.swVersion === undefined ? {} : { swVersion: descriptor.swVersion }),
        ...(descriptor.hwVersion === undefined ? {} : { hwVersion: descriptor.hwVersion }),

        // The claim goes with the row, so the instance can bind this device again on its next
        // start instead of listening for it a second time.
        config: configOf(claimed),
        entities: described.registrations,
      },
      registerDeviceReplySchema,
    );

    const composed = [...described.binding.entities.values()];

    if (reply.entityIds.length !== composed.length) {
      // Sanity, not routing: the identifiers are composed here and `core` writes what it was
      // sent, so the two can only disagree if one side changed. Binding uses what was composed.
      logger.warn(
        { instanceId: instance.instanceId, sent: composed.length, written: reply.entityIds.length },
        'core wrote a different number of entities than were sent',
      );
    }

    return { binding: described.binding, externalId: descriptor.externalId, entityIds: composed };
  }

  /**
   * Listens until the device is identified, or until told to stop.
   *
   * Never rejects. A pass that heard nothing is followed by another almost at once; a pass that
   * failed waits the longer while and says why. A row that is not there ends the search: nothing
   * this service can do makes the API's row appear, and the state stays `identifying` for the
   * owner to see.
   *
   * @param instance - The instance to listen with.
   * @param signal - Ends the search.
   * @returns What was identified, or undefined when stopped or given up.
   */
  public async identify(
    instance: IdentifiableInstance,
    signal: AbortSignal,
  ): Promise<Identified | undefined> {
    const { logger, retryMs } = this.#options;
    const pauseMs = this.#options.pauseMs ?? DEFAULT_PAUSE_MS;

    logger.info(
      {
        instanceId: instance.instanceId,
        kind: instance.integration.id,
        expectedExternalId: instance.expectedExternalId,
      },
      'Listening for the device',
    );

    for (let pass = 1; !stopped(signal); pass += 1) {
      try {
        // Each pass exists because the one before it heard nothing, so they are sequential by
        // nature; the wait between them is what the loop is for.
        // eslint-disable-next-line no-await-in-loop -- see above
        const found = await this.attempt(instance, signal);

        if (found !== undefined) {
          logger.info(
            {
              instanceId: instance.instanceId,
              externalId: found.externalId,
              entities: found.entityIds.length,
              pass,
            },
            'Device identified',
          );

          return found;
        }

        if (stopped(signal)) {
          break;
        }

        logger.debug({ instanceId: instance.instanceId, pass }, 'Nothing heard in this pass');
        // eslint-disable-next-line no-await-in-loop -- a pause before listening again, same reason
        await delay(pauseMs, signal);
      } catch (error: unknown) {
        if (stopped(signal)) {
          break;
        }

        if (error instanceof NotFoundError) {
          logger.error(
            { instanceId: instance.instanceId, err: error },
            'core has no device row for this instance; it was not created through the API',
          );

          return undefined;
        }

        logger.warn(
          { instanceId: instance.instanceId, pass, retryMs, err: error },
          'Identification pass failed; will try again',
        );
        // eslint-disable-next-line no-await-in-loop -- the longer pause after a failure, same reason
        await delay(retryMs, signal);
      }
    }

    logger.debug({ instanceId: instance.instanceId }, 'Identification stopped');

    return undefined;
  }
}
