/**
 * What the API tells `core` about automations and the house.
 *
 * `core` runs automations; the API writes their rows. After a write the API asks `core` to take
 * the row in, and after a delete to let it go - best effort, as for an alias: the write has
 * happened and is not undone by a silence, and a `core` that does not answer reads every row when
 * it next starts. Running one now is different: the person pressing Run is waiting for an answer,
 * so a `core` that is away is an error they see.
 *
 * The house's zone and position live in a setting and on the house area; neither is re-read by
 * `core` on its own, so the API says when either changed.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_REMOVE_AUTOMATION_METHOD,
  CORE_SERVICE,
  CORE_SYNC_AUTOMATION_METHOD,
  CORE_SYNC_HOUSE_METHOD,
  CORE_TRIGGER_AUTOMATION_METHOD,
  DeviceUnavailableError,
  removeAutomationReplySchema,
  syncAutomationReplySchema,
  syncHouseReplySchema,
  triggerAutomationReplySchema,
  type TriggerAutomationReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** What a request to `core` needs. */
export type CoreLink = {
  /** The bus, or undefined while it is unreachable. */
  readonly bus: BusClient | undefined;

  /** The request's trace id, carried onto the bus. */
  readonly traceId: string;

  /** How long `core` has to answer. */
  readonly timeoutMs: number;

  readonly logger: PlatformLogger;
};

/**
 * Asks `core` to take in an automation whose row was just written or changed.
 *
 * @param link - The bus, the trace id and the log.
 * @param automationId - The automation.
 */
export async function syncAutomationOnCore(link: CoreLink, automationId: string): Promise<void> {
  if (link.bus === undefined) {
    link.logger.warn(
      { automationId },
      'The bus is away; core will load the automation on its next start',
    );

    return;
  }

  try {
    const reply = await link.bus.request(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_AUTOMATION_METHOD),
      { automationId },
      syncAutomationReplySchema,
      { traceId: link.traceId, timeoutMs: link.timeoutMs },
    );

    if (reply.problems.length > 0) {
      link.logger.info(
        { automationId, problems: reply.problems },
        'Core took the automation in, with problems',
      );
    }
  } catch (error: unknown) {
    link.logger.warn(
      { automationId, err: error },
      'Core did not take the automation in; it will on its next start',
    );
  }
}

/**
 * Asks `core` to let a deleted automation go.
 *
 * @param link - The bus, the trace id and the log.
 * @param automationId - The automation.
 */
export async function removeAutomationOnCore(link: CoreLink, automationId: string): Promise<void> {
  if (link.bus === undefined) {
    return;
  }

  try {
    await link.bus.request(
      busSubjects.service(CORE_SERVICE, CORE_REMOVE_AUTOMATION_METHOD),
      { automationId },
      removeAutomationReplySchema,
      { traceId: link.traceId, timeoutMs: link.timeoutMs },
    );
  } catch (error: unknown) {
    link.logger.warn(
      { automationId, err: error },
      'Core did not let the automation go; its row is gone, so it will not run again after a restart',
    );
  }
}

/**
 * Asks `core` to run an automation now.
 *
 * @param link - The bus, the trace id and the log.
 * @param automationId - The automation.
 * @param userId - Who pressed Run.
 * @returns What became of it.
 * @throws {DeviceUnavailableError} When the bus is away or `core` does not answer.
 */
export async function triggerAutomationOnCore(
  link: CoreLink,
  automationId: string,
  userId: string,
): Promise<TriggerAutomationReply> {
  if (link.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { automationId },
    });
  }

  return link.bus.request(
    busSubjects.service(CORE_SERVICE, CORE_TRIGGER_AUTOMATION_METHOD),
    { automationId, userId },
    triggerAutomationReplySchema,
    { traceId: link.traceId, timeoutMs: link.timeoutMs },
  );
}

/**
 * Asks `core` to read the house again: its zone or its position changed.
 *
 * @param link - The bus, the trace id and the log.
 */
export async function syncHouseOnCore(link: CoreLink): Promise<void> {
  if (link.bus === undefined) {
    return;
  }

  try {
    await link.bus.request(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_HOUSE_METHOD),
      {},
      syncHouseReplySchema,
      { traceId: link.traceId, timeoutMs: link.timeoutMs },
    );
  } catch (error: unknown) {
    link.logger.warn(
      { err: error },
      'Core did not read the house again; it will on its next start',
    );
  }
}
