/**
 * What alias code reads from the database rather than from the live states: the names and units
 * of entities, and a summary of an entity's recent readings.
 *
 * The telemetry hypertable is keyed on the registry row, not on the entity id, so a caller
 * resolves the id first.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import type { HistoryKind } from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** An entity's name and unit. */
export type EntityLabel = { readonly name: string; readonly unit: string | null };

/** Each summary of a stretch of readings; null when there was no reading in it. */
export type TelemetrySummary = Readonly<Record<HistoryKind, number | null>>;

/**
 * Reads the names and units of entities.
 *
 * @param db - The database.
 * @param entityIds - The entities.
 * @returns Each one found, by entity id.
 */
export async function loadEntityLabels(
  db: Database,
  entityIds: readonly string[],
): Promise<Map<string, EntityLabel>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  const { entities } = schema.registry;
  const rows = await db
    .select({ entityId: entities.entityId, name: entities.name, unit: entities.unitOfMeasurement })
    .from(entities)
    .where(inArray(entities.entityId, [...entityIds]));

  return new Map(rows.map((row) => [row.entityId, { name: row.name, unit: row.unit }]));
}

/**
 * Sums up an entity's readings since an instant: their mean, lowest, highest, and last minus
 * first.
 *
 * @param db - The database.
 * @param rowId - The entity's `registry.entities.id`.
 * @param since - The start of the stretch.
 * @returns The summary.
 */
export async function readTelemetrySummary(
  db: Database,
  rowId: string,
  since: Date,
): Promise<TelemetrySummary> {
  const { telemetry } = schema.history;
  const [row] = await db
    .select({
      // Aggregates come back as Postgres wrote them: text for a numeric, a number for a double.
      avg: sql<string | number | null>`avg(${telemetry.value})`,
      min: sql<string | number | null>`min(${telemetry.value})`,
      max: sql<string | number | null>`max(${telemetry.value})`,
      change: sql<
        string | number | null
      >`last(${telemetry.value}, ${telemetry.time}) - first(${telemetry.value}, ${telemetry.time})`,
    })
    .from(telemetry)
    .where(and(eq(telemetry.entityId, rowId), gte(telemetry.time, since)));

  /**
   * One aggregate as a number.
   *
   * @param value - As the driver gave it.
   * @returns The number, or null when there was no reading.
   */
  const numberOf = (value: string | number | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value);

  return {
    avg: numberOf(row?.avg),
    min: numberOf(row?.min),
    max: numberOf(row?.max),
    change: numberOf(row?.change),
  };
}
