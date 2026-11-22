/**
 * What the API tells `core` about automations and the house.
 *
 * `core` runs automations; the API writes their rows. After a write the API asks `core` to take
 * the row in, and after a delete to let it go - best effort, as for an alias: the write has
 * happened and is not undone by a silence; a `core` that does not answer is asked again in the
 * background a few times, and reads every row when it next starts. Running one now is different: the person pressing Run is waiting for an answer,
 * so a `core` that is away is an error they see. So is testing one block from the editor.
 *
 * The house's zone and position live in a setting and on the house area; neither is re-read by
 * `core` on its own, so the API says when either changed.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  AUTOMATION_TEST_MAX_MS,
  automationTestReplySchema,
  busSubjects,
  cancelAutomationTestReplySchema,
  CORE_CANCEL_AUTOMATION_TEST_METHOD,
  CORE_REMOVE_AUTOMATION_METHOD,
  CORE_SERVICE,
  CORE_SYNC_AUTOMATION_METHOD,
  CORE_SYNC_HOUSE_METHOD,
  CORE_TEST_AUTOMATION_BLOCK_METHOD,
  CORE_TRIGGER_AUTOMATION_METHOD,
  removeAutomationReplySchema,
  syncAutomationReplySchema,
  syncHouseReplySchema,
  triggerAutomationReplySchema,
  type AutomationTestReply,
  type AutomationTestRequest,
  type TriggerAutomationReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import { requireBus } from './ask-service.js';
import { askCore } from './core-retry.js';

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
  const { bus } = link;

  if (bus === undefined) {
    link.logger.warn(
      { automationId },
      'The bus is away; core will load the automation on its next start',
    );

    return;
  }

  await askCore(
    async () => {
      const reply = await bus.request(
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
    },
    (error) => {
      link.logger.warn(
        { automationId, err: error },
        'Core did not take the automation in; it is asked again',
      );
    },
  );
}

/**
 * Asks `core` to let a deleted automation go.
 *
 * @param link - The bus, the trace id and the log.
 * @param automationId - The automation.
 */
export async function removeAutomationOnCore(link: CoreLink, automationId: string): Promise<void> {
  const { bus } = link;

  if (bus === undefined) {
    return;
  }

  await askCore(
    async () => {
      await bus.request(
        busSubjects.service(CORE_SERVICE, CORE_REMOVE_AUTOMATION_METHOD),
        { automationId },
        removeAutomationReplySchema,
        { traceId: link.traceId, timeoutMs: link.timeoutMs },
      );
    },
    (error) => {
      link.logger.warn(
        { automationId, err: error },
        'Core did not let the automation go; it is asked again',
      );
    },
  );
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
  return requireBus(link, { automationId }).request(
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
  const { bus } = link;

  if (bus === undefined) {
    return;
  }

  await askCore(
    async () => {
      await bus.request(
        busSubjects.service(CORE_SERVICE, CORE_SYNC_HOUSE_METHOD),
        {},
        syncHouseReplySchema,
        { traceId: link.traceId, timeoutMs: link.timeoutMs },
      );
    },
    (error) => {
      link.logger.warn({ err: error }, 'Core did not read the house again; it is asked again');
    },
  );
}

/** How much longer than a test may run the API waits for `core` to say how it went. */
const TEST_REPLY_MARGIN_MS = 5_000;

/**
 * Asks `core` to test one block of an automation being edited.
 *
 * An action really runs, so the request waits as long as a test may take, and a little more.
 *
 * @param link - The bus, the trace id and the log.
 * @param request - The block and the test's id.
 * @param userId - Who asked, whom its commands are sent on behalf of.
 * @returns What the test found.
 * @throws {DeviceUnavailableError} When the bus is not reachable.
 */
export async function testBlockOnCore(
  link: CoreLink,
  request: AutomationTestRequest,
  userId: string,
): Promise<AutomationTestReply> {
  return requireBus(link, { testId: request.testId }).request(
    busSubjects.service(CORE_SERVICE, CORE_TEST_AUTOMATION_BLOCK_METHOD),
    { ...request, userId },
    automationTestReplySchema,
    { traceId: link.traceId, timeoutMs: AUTOMATION_TEST_MAX_MS + TEST_REPLY_MARGIN_MS },
  );
}

/**
 * Asks `core` to stop a test still going.
 *
 * @param link - The bus, the trace id and the log.
 * @param testId - Which.
 * @returns Whether there was one to stop.
 * @throws {DeviceUnavailableError} When the bus is not reachable.
 */
export async function cancelTestOnCore(link: CoreLink, testId: string): Promise<boolean> {
  const reply = await requireBus(link, { testId }).request(
    busSubjects.service(CORE_SERVICE, CORE_CANCEL_AUTOMATION_TEST_METHOD),
    { testId },
    cancelAutomationTestReplySchema,
    { traceId: link.traceId, timeoutMs: link.timeoutMs },
  );

  return reply.wasRunning;
}
