/**
 * The subjects the API keeps the automation engine in line on.
 *
 * The API writes an automation's row and then asks `core` to take it in, the way it does an
 * alias; deleting one is the API's write followed by `remove_automation`. Run now is a request
 * here, after the API has checked who pressed it. The house - its zone and its position - is read
 * again when the API says either changed, since nothing else re-reads a saved setting.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_REMOVE_AUTOMATION_METHOD,
  CORE_SERVICE,
  CORE_SYNC_AUTOMATION_METHOD,
  CORE_SYNC_HOUSE_METHOD,
  CORE_TRIGGER_AUTOMATION_METHOD,
  removeAutomationRequestSchema,
  syncAutomationRequestSchema,
  syncHouseRequestSchema,
  triggerAutomationRequestSchema,
  type RemoveAutomationReply,
  type RemoveAutomationRequest,
  type SyncAutomationReply,
  type SyncAutomationRequest,
  type SyncHouseReply,
  type TriggerAutomationReply,
  type TriggerAutomationRequest,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { AutomationEngine } from './automation-engine.js';

/** What the automation service needs. */
export type AutomationServiceOptions = {
  readonly client: BusClient;
  readonly engine: AutomationEngine;
  readonly logger: PlatformLogger;
};

/**
 * Serves the subjects the API syncs, removes and runs automations on, and re-reads the house on.
 *
 * @param options - The bus client, the engine and the logger.
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

        logger.info(reply, 'Read the house again');

        return reply;
      },
    ),
  ];
}
