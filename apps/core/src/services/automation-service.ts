/**
 * The subjects the API keeps the automation engine in line on.
 *
 * The API writes an automation's row and then asks `core` to take it in, the way it does an
 * alias; deleting one is the API's write followed by `remove_automation`. Run now is a request
 * here, after the API has checked who pressed it, and so is testing one block of an automation
 * being edited, and a call to a webhook address, whose body the API keeps to itself. The house - its zone and its position - is read again when the API says either
 * changed, since nothing else re-reads a saved setting; a position given or cleared also brings
 * the sun's entities or takes them away.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  cancelAutomationTestRequestSchema,
  CORE_CANCEL_AUTOMATION_TEST_METHOD,
  CORE_REMOVE_AUTOMATION_METHOD,
  CORE_SERVICE,
  CORE_SYNC_AUTOMATION_METHOD,
  CORE_SYNC_HOUSE_METHOD,
  CORE_TEST_AUTOMATION_BLOCK_METHOD,
  CORE_TRIGGER_AUTOMATION_METHOD,
  CORE_WEBHOOK_CALL_METHOD,
  removeAutomationRequestSchema,
  syncAutomationRequestSchema,
  syncHouseRequestSchema,
  testAutomationBlockRequestSchema,
  triggerAutomationRequestSchema,
  webhookCallRequestSchema,
  type AutomationTestReply,
  type CancelAutomationTestReply,
  type CancelAutomationTestRequest,
  type RemoveAutomationReply,
  type RemoveAutomationRequest,
  type SyncAutomationReply,
  type SyncAutomationRequest,
  type SyncHouseReply,
  type TestAutomationBlockRequest,
  type TriggerAutomationReply,
  type TriggerAutomationRequest,
  type WebhookCallReply,
  type WebhookCallRequest,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { AutomationEngine } from './automation-engine.js';
import type { QuietTimeMonitor } from './quiet-time-monitor.js';
import type { SunMonitor } from './sun-monitor.js';

/** What the automation service needs. */
export type AutomationServiceOptions = {
  readonly client: BusClient;
  readonly engine: AutomationEngine;

  /** The sun's entities, which follow the house's position. Absent in tests that need none. */
  readonly sun?: SunMonitor;

  /** The quietest time's entity, learned in the house's zone. Absent in tests that need none. */
  readonly quietTime?: QuietTimeMonitor;

  readonly logger: PlatformLogger;
};

/**
 * Serves the subjects the API syncs, removes, runs and tests automations on, and re-reads the
 * house on.
 *
 * @param options - The bus client, the engine, the sun's entities and the logger.
 * @returns The subscriptions, to unsubscribe on shutdown.
 */
export function startAutomationService(options: AutomationServiceOptions): BusSubscription[] {
  const { client, engine, logger } = options;

  return [
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_AUTOMATION_METHOD),
      syncAutomationRequestSchema,

      /**
       * Takes in one automation the API has just written or changed.
       *
       * @param request - Which.
       * @returns Whether it is loaded, and what it cannot do.
       */
      async (request: SyncAutomationRequest): Promise<SyncAutomationReply> => {
        const reply = await engine.sync(request.automationId);

        logger.info({ automationId: request.automationId, ...reply }, 'Synced an automation');

        return reply;
      },
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_REMOVE_AUTOMATION_METHOD),
      removeAutomationRequestSchema,

      /**
       * Forgets one automation.
       *
       * @param request - Which.
       * @returns What was forgotten.
       */
      (request: RemoveAutomationRequest): RemoveAutomationReply => {
        logger.info({ automationId: request.automationId }, 'Removed an automation');

        return engine.remove(request.automationId);
      },
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_TRIGGER_AUTOMATION_METHOD),
      triggerAutomationRequestSchema,

      /**
       * Runs one automation now.
       *
       * @param request - Which, and who asked.
       * @returns What became of it.
       */
      (request: TriggerAutomationRequest): TriggerAutomationReply =>
        engine.trigger(request.automationId, request.userId),
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_HOUSE_METHOD),
      syncHouseRequestSchema,

      /**
       * Reads the house again.
       *
       * @returns Its zone and whether it has a position.
       */
      async (): Promise<SyncHouseReply> => {
        const reply = await engine.syncHouse();

        await options.sun?.sync(engine.house.position);
        await options.quietTime?.sync(engine.house.timeZone);
        logger.info(reply, 'Read the house again');

        return reply;
      },
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_TEST_AUTOMATION_BLOCK_METHOD),
      testAutomationBlockRequestSchema,

      /**
       * Tries one block of an automation being edited.
       *
       * @param request - The block, who asked, and the test's id.
       * @returns What the test found.
       */
      async (request: TestAutomationBlockRequest): Promise<AutomationTestReply> => {
        logger.info(
          { testId: request.testId, userId: request.userId, kind: request.target.kind },
          'Testing a block',
        );

        return engine.test(request);
      },
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_CANCEL_AUTOMATION_TEST_METHOD),
      cancelAutomationTestRequestSchema,

      /**
       * Stops a test still going.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      (request: CancelAutomationTestRequest): CancelAutomationTestReply => ({
        wasRunning: engine.cancelTest(request.testId),
      }),
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_WEBHOOK_CALL_METHOD),
      webhookCallRequestSchema,

      /**
       * Takes a call to a webhook address.
       *
       * @param request - The call, as the API received it.
       * @returns What to answer it.
       */
      (request: WebhookCallRequest): Promise<WebhookCallReply> => engine.webhookCall(request),
    ),
  ];
}
