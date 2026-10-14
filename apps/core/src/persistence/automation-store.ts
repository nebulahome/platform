/**
 * What the automation engine reads and writes: the automations, the house it keeps time for, and
 * the record of every run.
 *
 * Automations are read at startup and again one at a time when the API says one changed. The
 * house is read at startup and when the API says its zone or position changed. A run is written
 * once, when it ends: the table has no "running" result, so a run cut off by a crash of `core`
 * itself leaves no row - its `started` event is all that was said of it.
 */
import { eq } from 'drizzle-orm';

import {
  automationDefinitionSchema,
  AUTOMATION_MODES,
  type AutomationDefinition,
  type AutomationMode,
  type AutomationRunResult,
  type AutomationRunTrigger,
  type TraceStep,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { House } from '../domain/automation/schedule.js';

/** One automation, as the engine runs it. */
export type AutomationRecord = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly definition: AutomationDefinition;
  readonly mode: AutomationMode;
  readonly maxRuntimeMs: number;
  readonly isEnabled: boolean;
};

/** One run, as it is recorded. */
export type AutomationRunRow = {
  readonly id: string;
  readonly automationId: string;
  readonly time: Date;
  readonly trigger: AutomationRunTrigger;
  readonly result: AutomationRunResult;
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly trace: readonly TraceStep[];
  readonly error: string | null;
};

/**
 * Narrows a stored mode to the format's.
 *
 * @param mode - The column's value.
 * @returns The mode, or `single` for anything the column should not have held.
 */
function modeOf(mode: string): AutomationMode {
  return (AUTOMATION_MODES as readonly string[]).includes(mode)
    ? (mode as AutomationMode)
    : 'single';
}

/** The columns the engine reads. */
const COLUMNS = {
  id: schema.registry.automations.id,
  key: schema.registry.automations.key,
  name: schema.registry.automations.name,
  definition: schema.registry.automations.definition,
  mode: schema.registry.automations.mode,
  maxRuntimeMs: schema.registry.automations.maxRuntimeMs,
  isEnabled: schema.registry.automations.isEnabled,
};

/** A row as selected. */
type AutomationRow = {
  id: string;
  key: string;
  name: string;
  definition: unknown;
  mode: string;
  maxRuntimeMs: number;
  isEnabled: boolean;
};

/**
 * Turns a row into a record, or says why its document cannot be run.
 *
 * @param row - The row.
 * @param logger - Where a document that no longer parses is reported.
 * @returns The record, or undefined.
 */
function recordOf(row: AutomationRow, logger: PlatformLogger): AutomationRecord | undefined {
  const parsed = automationDefinitionSchema.safeParse(row.definition);

  if (!parsed.success) {
    logger.warn(
      { automation: row.key, issue: parsed.error.issues[0]?.message },
      'An automation’s definition no longer parses; it will not run',
    );

    return undefined;
  }

  return { ...row, definition: parsed.data, mode: modeOf(row.mode) };
}

/**
 * Reads every enabled automation.
 *
 * @param db - The database.
 * @param logger - Where a document that no longer parses is reported.
 * @returns The automations that can run.
 */
export async function loadAutomations(
  db: Database,
  logger: PlatformLogger,
): Promise<AutomationRecord[]> {
  const rows = await db
    .select(COLUMNS)
    .from(schema.registry.automations)
    .where(eq(schema.registry.automations.isEnabled, true));

  return rows.flatMap((row) => recordOf(row, logger) ?? []);
}

/**
 * Reads one automation, enabled or not.
 *
 * @param db - The database.
 * @param automationId - Which.
 * @param logger - Where a document that no longer parses is reported.
 * @returns It, or undefined when it is gone or cannot run.
 */
export async function loadAutomation(
  db: Database,
  automationId: string,
  logger: PlatformLogger,
): Promise<AutomationRecord | undefined> {
  const [row] = await db
    .select(COLUMNS)
    .from(schema.registry.automations)
    .where(eq(schema.registry.automations.id, automationId))
    .limit(1);

  return row === undefined ? undefined : recordOf(row, logger);
}

/**
 * Finds an automation by its key, enabled or not.
 *
 * @param db - The database.
 * @param automationKey - The key.
 * @returns Its id, or undefined when there is none.
 */
export async function automationIdByKey(
  db: Database,
  automationKey: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: schema.registry.automations.id })
    .from(schema.registry.automations)
    .where(eq(schema.registry.automations.key, automationKey))
    .limit(1);

  return row?.id;
}

/**
 * Reads the house: the zone its clock keeps and where it stands.
 *
 * @param db - The database.
 * @returns The house; UTC and no position when neither is set.
 */
export async function loadHouse(db: Database): Promise<House> {
  const [setting] = await db
    .select({ value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(eq(schema.system.settings.key, 'house.timezone'))
    .limit(1);

  const [house] = await db
    .select({
      latitude: schema.registry.areas.latitude,
      longitude: schema.registry.areas.longitude,
    })
    .from(schema.registry.areas)
    .where(eq(schema.registry.areas.kind, 'house'))
    .limit(1);

  const timeZone = typeof setting?.value === 'string' ? setting.value : 'UTC';
  const position =
    house?.latitude === null || house?.latitude === undefined || house.longitude === null
      ? null
      : { latitude: house.latitude, longitude: house.longitude };

  return { timeZone, position };
}

/**
 * Records that an automation fired.
 *
 * @param db - The database.
 * @param automationId - Which.
 * @param at - When.
 */
export async function markTriggered(db: Database, automationId: string, at: Date): Promise<void> {
  await db
    .update(schema.registry.automations)
    .set({ lastTriggeredAt: at })
    .where(eq(schema.registry.automations.id, automationId));
}

/**
 * Records a run that ended.
 *
 * @param db - The database.
 * @param run - The run.
 */
export async function insertRun(db: Database, run: AutomationRunRow): Promise<void> {
  await db.insert(schema.history.automationRuns).values({
    id: run.id,
    automationId: run.automationId,
    time: run.time,
    trigger: run.trigger,
    result: run.result,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    trace: run.trace,
    error: run.error,
  });
}
