/**
 * Dashboards: each person's own pages of cards.
 *
 * Every query here is narrowed to the caller's own rows. A dashboard is not a shared description
 * of the house, so there is no permission that reaches someone else's: asking for another
 * account's dashboard by id is answered exactly as asking for one that does not exist.
 *
 * The layout is stored as the validated document the editor sends. What a card shows is decided
 * when it is drawn, against what the reader may see - a dashboard naming an entity grants nothing.
 */
import { and, asc, eq, sql } from 'drizzle-orm';

import {
  ConflictError,
  DASHBOARD_LAYOUT_VERSION,
  DASHBOARDS_PER_USER_MAXIMUM,
  dashboardViewSchema,
  EMPTY_DASHBOARD_LAYOUT,
  InternalError,
  NotFoundError,
  type DashboardCreate,
  type DashboardUpdate,
  type DashboardView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

/** The columns a dashboard is served from. */
const COLUMNS = {
  id: schema.registry.dashboards.id,
  name: schema.registry.dashboards.name,
  icon: schema.registry.dashboards.icon,
  layout: schema.registry.dashboards.layout,
  layoutVersion: schema.registry.dashboards.layoutVersion,
  createdAt: schema.registry.dashboards.createdAt,
  updatedAt: schema.registry.dashboards.updatedAt,
};

/**
 * Says a dashboard is not there - the same words whether it never existed or is somebody else's.
 *
 * @param id - The id that was asked for.
 * @returns The error to throw.
 */
function notFound(id: string): NotFoundError {
  return new NotFoundError('No dashboard of yours has that id', { details: { id } });
}

/**
 * Lists the caller's dashboards, oldest first, which is the order their tabs are in.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @returns The dashboards.
 */
export async function listDashboards(db: Database, userId: string): Promise<DashboardView[]> {
  const rows = await db
    .select(COLUMNS)
    .from(schema.registry.dashboards)
    .where(eq(schema.registry.dashboards.userId, userId))
    .orderBy(asc(schema.registry.dashboards.createdAt), asc(schema.registry.dashboards.id));

  return rows.map((row) => dashboardViewSchema.parse(row));
}

/**
 * Reads one of the caller's dashboards.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @param id - Which one.
 * @returns The dashboard.
 * @throws {NotFoundError} When the caller has no dashboard with that id.
 */
export async function readDashboard(
  db: Database,
  userId: string,
  id: string,
): Promise<DashboardView> {
  const [row] = await db
    .select(COLUMNS)
    .from(schema.registry.dashboards)
    .where(
      and(eq(schema.registry.dashboards.id, id), eq(schema.registry.dashboards.userId, userId)),
    )
    .limit(1);

  if (row === undefined) {
    throw notFound(id);
  }

  return dashboardViewSchema.parse(row);
}

/**
 * Creates a dashboard for the caller.
 *
 * The limit is counted before the insert rather than enforced by the database: it is there so a
 * runaway script cannot fill the table, not as an invariant two simultaneous presses must never
 * cross.
 *
 * @param db - The database.
 * @param userId - Whose it will be.
 * @param body - Its name, and optionally its icon and first cards.
 * @returns The dashboard as it now stands.
 * @throws {ConflictError} When the caller already keeps as many dashboards as one account may.
 */
export async function createDashboard(
  db: Database,
  userId: string,
  body: DashboardCreate,
): Promise<DashboardView> {
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.registry.dashboards)
    .where(eq(schema.registry.dashboards.userId, userId));

  if ((counted?.total ?? 0) >= DASHBOARDS_PER_USER_MAXIMUM) {
    throw new ConflictError(
      `You already have ${String(DASHBOARDS_PER_USER_MAXIMUM)} dashboards; remove one first`,
      { details: { maximum: DASHBOARDS_PER_USER_MAXIMUM } },
    );
  }

  const [row] = await db
    .insert(schema.registry.dashboards)
    .values({
      userId,
      name: body.name,
      icon: body.icon ?? null,
      layout: body.layout ?? EMPTY_DASHBOARD_LAYOUT,
      layoutVersion: DASHBOARD_LAYOUT_VERSION,
    })
    .returning(COLUMNS);

  if (row === undefined) {
    throw new InternalError('The dashboard insert returned no row');
  }

  return dashboardViewSchema.parse(row);
}

/**
 * Changes one of the caller's dashboards.
 *
 * A present `layout` replaces the stored one whole.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @param id - Which one.
 * @param body - The fields to change.
 * @returns The dashboard as it now stands.
 * @throws {NotFoundError} When the caller has no dashboard with that id.
 */
export async function updateDashboard(
  db: Database,
  userId: string,
  id: string,
  body: DashboardUpdate,
): Promise<DashboardView> {
  const [row] = await db
    .update(schema.registry.dashboards)
    .set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.icon === undefined ? {} : { icon: body.icon }),
      ...(body.layout === undefined
        ? {}
        : { layout: body.layout, layoutVersion: DASHBOARD_LAYOUT_VERSION }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.registry.dashboards.id, id), eq(schema.registry.dashboards.userId, userId)),
    )
    .returning(COLUMNS);

  if (row === undefined) {
    throw notFound(id);
  }

  return dashboardViewSchema.parse(row);
}

/**
 * Deletes one of the caller's dashboards.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @param id - Which one.
 * @returns The dashboard as it was, so the caller can say what went.
 * @throws {NotFoundError} When the caller has no dashboard with that id.
 */
export async function deleteDashboard(
  db: Database,
  userId: string,
  id: string,
): Promise<DashboardView> {
  const [row] = await db
    .delete(schema.registry.dashboards)
    .where(
      and(eq(schema.registry.dashboards.id, id), eq(schema.registry.dashboards.userId, userId)),
    )
    .returning(COLUMNS);

  if (row === undefined) {
    throw notFound(id);
  }

  return dashboardViewSchema.parse(row);
}
