/**
 * What an automation actually says: when this happens, if these hold, do this.
 *
 * `registry.automations.definition` is a `jsonb` column, and the comment beside it in the schema
 * has always promised that the document inside is validated against a schema of this name. This
 * is that schema. Until it existed the column was validated by nothing at all, which is the kind
 * of gap that only shows up as an engine crashing on a document written a year earlier.
 *
 * The shape is [ARCHITECTURE.md §6.1](../../../../ARCHITECTURE.md#61-automation-engine) and
 * nothing more. The saved document is `{ triggers, if, then }`: a list of triggers, any of which
 * wakes the automation; a list of conditions, all of which must hold (AND and OR groups nest
 * inside it, NOT turns any block around); and the actions, in order. Every block can be named and
 * turned off. The blocks live in their own files - `automation-triggers.ts`,
 * `automation-conditions.ts`, `automation-actions.ts` - and the vocabulary they share in
 * `automation-meta.ts`; this file puts them together and re-exports them.
 *
 * Older shapes are still read: {@link migrateDefinition} rewrites them before anything is checked.
 *
 * **This validates the document, not the world it refers to.** That an entity exists, that a
 * scene is real, that a package offers the service being called: none of that can be known from
 * the document, and all of it can stop being true after it is written. The engine resolves those
 * when it runs, and a run that cannot resolve one is a traced failure rather than a rejected
 * save - otherwise renaming an entity would make every automation mentioning it unsaveable.
 */
import { z } from 'zod';

import { automationActionSchema, type AutomationAction } from './automation-actions.js';
import { conditionListSchema, type ConditionNode } from './automation-conditions.js';
import { migrateDefinition } from './automation-migrate.js';
import { automationTriggerSchema, type AutomationTrigger } from './automation-triggers.js';

export * from './automation-actions.js';
export * from './automation-conditions.js';
export * from './automation-meta.js';
export * from './automation-migrate.js';
export * from './automation-triggers.js';
export * from './automation-walk.js';

/** What an automation says. */
export type AutomationDefinition = {
  /** What wakes it: any one of these. */
  readonly triggers: readonly AutomationTrigger[];

  /** What must hold before `then` runs: all of these. Absent or empty means nothing to check. */
  readonly if?: readonly ConditionNode[] | undefined;

  /** What it does, in order. */
  readonly then: readonly AutomationAction[];
};

/**
 * The whole document: `{ triggers, if, then }`.
 *
 * At least one trigger and at least one action in `then`, because an automation with neither is
 * a row that can never do anything and saving one is a way of losing work quietly. `if` is
 * optional: plenty of useful automations are "when this happens, do that". The ceilings are
 * there so a document cannot be used to exhaust the engine.
 */
const automationDefinitionObjectSchema = z.object({
  triggers: z.array(automationTriggerSchema).min(1).max(20),
  if: conditionListSchema(0).optional(),
  then: z.array(automationActionSchema).min(1).max(50),
});

/** The whole document, older shapes rewritten first. */
export const automationDefinitionSchema: z.ZodType<AutomationDefinition> = z.preprocess(
  migrateDefinition,
  automationDefinitionObjectSchema,
);
