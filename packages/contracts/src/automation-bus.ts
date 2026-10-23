/**
 * What the API and `core` say to each other about automations, scenes and the house.
 *
 * `core` runs automations and applies scenes ([ARCHITECTURE.md §6](../../../../ARCHITECTURE.md#6-core-engines));
 * the API writes their rows and checks who may do what. These are the requests that bring the
 * first in line with the second, the way `sync_alias` does for an alias: `core` reads the rows
 * back itself rather than being handed them, so what it runs is what was committed.
 */
import { z } from 'zod';

import { AUTOMATION_RUN_RESULTS, traceStepSchema } from './api-history.js';
import { sceneApplyMemberResultSchema, sceneApplyResultSchema } from './api-registry.js';
import { WEBHOOK_CALL_OUTCOMES } from './api-webhooks.js';
import {
  automationActionSchema,
  automationTriggerSchema,
  conditionNodeSchema,
  webhookIdSchema,
} from './automation-definition.js';
import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { changeContextSchema } from './entity-state.js';
import { jsonObjectSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/** Takes in an automation the API has just written or changed. */
export const CORE_SYNC_AUTOMATION_METHOD = 'sync_automation';

/** Forgets an automation the API has just deleted, cancelling its runs. */
export const CORE_REMOVE_AUTOMATION_METHOD = 'remove_automation';

/** Runs an automation now, as somebody pressing Run does. */
export const CORE_TRIGGER_AUTOMATION_METHOD = 'trigger_automation';

/** Applies a scene. */
export const CORE_APPLY_SCENE_METHOD = 'apply_scene';

/** Reads the house again: its time zone and where it stands. */
export const CORE_SYNC_HOUSE_METHOD = 'sync_house';

/** Tries one block of an automation being edited: runs an action, checks a condition. */
export const CORE_TEST_AUTOMATION_BLOCK_METHOD = 'test_automation_block';

/** Stops a test still running. */
export const CORE_CANCEL_AUTOMATION_TEST_METHOD = 'cancel_automation_test';

/** Hands `core` a call to a webhook address, for it to decide, run and record. */
export const CORE_WEBHOOK_CALL_METHOD = 'webhook_call';

/**
 * A call to `/api/hooks/<hookId>`, as the API received it. Its body is never passed on.
 *
 * `ip` is the caller's address as `proxy` saw the socket; `isLocal` says whether it is on the
 * house's network. `headers` already have the values of `authorization` and `cookie` hidden.
 */
export const webhookCallRequestSchema = z.strictObject({
  hookId: webhookIdSchema,
  method: z.string().min(1).max(16),
  path: z.string().max(2_000),
  ip: z.string().max(64),
  isLocal: z.boolean(),
  userAgent: z.string().max(500).nullable(),
  headers: z.record(z.string().max(100), z.string().max(2_000)),
});

/** A call to a webhook address. */
export type WebhookCallRequest = z.output<typeof webhookCallRequestSchema>;

/** What to answer the caller, and what became of the call. */
export const webhookCallReplySchema = z.object({
  status: z.int().min(200).max(599),
  outcome: z.enum(WEBHOOK_CALL_OUTCOMES),
  runId: z.uuid().nullable(),
});

/** What to answer the caller. */
export type WebhookCallReply = z.output<typeof webhookCallReplySchema>;

/** Asks `core` to take in an automation the API has just written or changed. */
export const syncAutomationRequestSchema = z.strictObject({ automationId: z.uuid() });

/** Asks `core` to take in an automation. */
export type SyncAutomationRequest = z.output<typeof syncAutomationRequestSchema>;

/**
 * Whether `core` loaded it, and what it found wrong with it.
 *
 * `isLoaded` is false when the row is gone or disabled. `problems` are what the engine cannot do
 * with an automation it did load: a sun trigger in a house with no position, a cron expression
 * its parser refuses, an event trigger nothing reports yet.
 */
export const syncAutomationReplySchema = z.object({
  isLoaded: z.boolean(),
  problems: z.array(z.string().max(300)).max(50),
});

/** Whether `core` loaded it, and what it found wrong with it. */
export type SyncAutomationReply = z.output<typeof syncAutomationReplySchema>;

/** Asks `core` to forget an automation. */
export const removeAutomationRequestSchema = z.strictObject({ automationId: z.uuid() });

/** Asks `core` to forget an automation. */
export type RemoveAutomationRequest = z.output<typeof removeAutomationRequestSchema>;

/** What `core` forgot. */
export const removeAutomationReplySchema = z.object({ automationId: z.uuid() });

/** What `core` forgot. */
export type RemoveAutomationReply = z.output<typeof removeAutomationReplySchema>;

/** Asks `core` to run an automation now. */
export const triggerAutomationRequestSchema = z.strictObject({
  automationId: z.uuid(),

  /** Who pressed Run. Absent when it is not a person. */
  userId: z.uuid().optional(),
});

/** Asks `core` to run an automation now. */
export type TriggerAutomationRequest = z.output<typeof triggerAutomationRequestSchema>;

/**
 * What became of the request.
 *
 * `started` and `queued` carry the run's id. `ignored` is a run the automation's mode turned
 * away (single, already running) or its loop guard refused; `reason` says which.
 */
export const TRIGGER_OUTCOMES = ['started', 'queued', 'ignored'] as const;

/** What became of a request to run. */
export type TriggerOutcome = (typeof TRIGGER_OUTCOMES)[number];

/** What became of a request to run. */
export const triggerAutomationReplySchema = z.object({
  runId: z.uuid().nullable(),
  outcome: z.enum(TRIGGER_OUTCOMES),
  reason: z.string().max(300).optional(),
});

/** What became of a request to run. */
export type TriggerAutomationReply = z.output<typeof triggerAutomationReplySchema>;

/** A member the caller may not command, so `core` sends it nothing. */
export const sceneSkipSchema = z.object({
  entityId: entityIdSchema,
  reason: z.string().min(1).max(200),
});

/** A member to leave alone. */
export type SceneSkip = z.output<typeof sceneSkipSchema>;

/**
 * Asks `core` to apply a scene.
 *
 * The API checks who may command which member and hands over the ones they may not as `skip`;
 * `core` knows nothing of people. `deadlineMs` bounds the whole apply, rollback included.
 */
export const applySceneRequestSchema = z.strictObject({
  sceneId: z.uuid(),
  skip: z.array(sceneSkipSchema).max(200).default([]),
  context: changeContextSchema,
  deadlineMs: z.int().min(1_000).max(600_000),
});

/** Asks `core` to apply a scene. */
export type ApplySceneRequest = z.output<typeof applySceneRequestSchema>;

/** One command `core` sent to a member and the member's adapter accepted. */
export const sceneSentCommandSchema = z.object({
  capability: capabilityNameSchema,
  command: jsonObjectSchema,
});

/** One command `core` sent. */
export type SceneSentCommand = z.output<typeof sceneSentCommandSchema>;

/**
 * How the apply went, with what was sent to each member - so the API can audit a lock moved by
 * a scene as it audits one moved by hand.
 */
export const applySceneReplySchema = sceneApplyResultSchema.extend({
  members: z.array(
    sceneApplyMemberResultSchema.extend({ sent: z.array(sceneSentCommandSchema).max(50) }),
  ),
});

/** How the apply went. */
export type ApplySceneReply = z.output<typeof applySceneReplySchema>;

/** Asks `core` to read the house again. Empty, so it can grow a field. */
export const syncHouseRequestSchema = z.strictObject({});

/** What `core` now keeps the house's time in, and whether it knows where the house is. */
export const syncHouseReplySchema = z.object({
  timeZone: z.string().min(1).max(64),
  hasPosition: z.boolean(),
});

/** What `core` now knows of the house. */
export type SyncHouseReply = z.output<typeof syncHouseReplySchema>;

/** What `core` announces about a run on `event.automation.<id>`. */
export const AUTOMATION_EVENT_KINDS = ['started', 'finished'] as const;

/** What `core` announces about a run. */
export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number];

/** A run starting or ending, as `core` announces it and the live channel passes it on. */
export const automationEventSchema = z.object({
  kind: z.enum(AUTOMATION_EVENT_KINDS),
  runId: z.uuid(),

  /** When the run started. */
  time: timestampSchema,

  /** How it ended. Present on `finished`. */
  result: z.enum(AUTOMATION_RUN_RESULTS).optional(),
  finishedAt: timestampSchema.optional(),
  durationMs: z.int().min(0).optional(),
  error: z.string().max(500).optional(),
});

/** A run starting or ending. */
export type AutomationEvent = z.output<typeof automationEventSchema>;

/**
 * The longest a tested block may run. A test is somebody watching the editor, not a run: a
 * block that waits ten minutes is stopped here and reported as having timed out.
 */
export const AUTOMATION_TEST_MAX_MS = 60_000;

/** How many tests `core` runs at once; a further one is refused until one ends. */
export const AUTOMATION_TEST_MAX_CONCURRENT = 4;

/** The block a test is about, as the editor holds it - saved or not. */
export const automationTestTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trigger'), trigger: automationTriggerSchema }),
  z.object({ kind: z.literal('condition'), condition: conditionNodeSchema }),
  z.object({ kind: z.literal('action'), action: automationActionSchema }),
]);

/** The block a test is about. */
export type AutomationTestTarget = z.output<typeof automationTestTargetSchema>;

/**
 * Asks to test a block, as the editor sends it to the API.
 *
 * The editor picks the id, so it can stop the test while the request is still open.
 */
export const automationTestRequestSchema = z.strictObject({
  testId: z.uuid(),
  target: automationTestTargetSchema,
});

/** Asks to test a block. */
export type AutomationTestRequest = z.output<typeof automationTestRequestSchema>;

/** Asks `core` to test a block, on behalf of a person. */
export const testAutomationBlockRequestSchema = automationTestRequestSchema.extend({
  userId: z.uuid(),
});

/** Asks `core` to test a block. */
export type TestAutomationBlockRequest = z.output<typeof testAutomationBlockRequestSchema>;

/** How a tested action went. */
export const AUTOMATION_TEST_RESULTS = ['ok', 'partial', 'failed', 'timeout', 'cancelled'] as const;

/** How a tested action went. */
export type AutomationTestResult = (typeof AUTOMATION_TEST_RESULTS)[number];

/**
 * What a test found.
 *
 * A trigger says whether what it waits for holds now (`matches`, null when it is not that kind
 * of trigger) and when it next fires (`nextAt`, null when it is not a time). A condition says
 * whether it holds now. An action says how it ran. Step paths start at the tested block: `0`, then
 * `0.then.1` and so on.
 */
export const automationTestReplySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('trigger'),
    matches: z.boolean().nullable(),
    nextAt: timestampSchema.nullable(),
    detail: z.string().max(300),
    problem: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal('condition'),
    value: z.boolean(),
    steps: z.array(traceStepSchema).max(1_000),
  }),
  z.object({
    kind: z.literal('action'),
    result: z.enum(AUTOMATION_TEST_RESULTS),
    durationMs: z.int().min(0),
    error: z.string().max(500).optional(),
    steps: z.array(traceStepSchema).max(1_000),
  }),
]);

/** What a test found. */
export type AutomationTestReply = z.output<typeof automationTestReplySchema>;

/** Asks `core` to stop a test. */
export const cancelAutomationTestRequestSchema = z.strictObject({ testId: z.uuid() });

/** Asks `core` to stop a test. */
export type CancelAutomationTestRequest = z.output<typeof cancelAutomationTestRequestSchema>;

/** Whether there was a test of that id still running. */
export const cancelAutomationTestReplySchema = z.object({ wasRunning: z.boolean() });

/** Whether there was a test of that id still running. */
export type CancelAutomationTestReply = z.output<typeof cancelAutomationTestReplySchema>;
