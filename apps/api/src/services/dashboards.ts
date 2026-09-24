/**
 * Dashboards: the house's pages of cards, and who each is shown to.
 *
 * A dashboard belongs to the house, not to whoever made it. It is made, laid out and assigned by
 * someone holding `dashboard:manage`, and shown on the Dashboards page of every account it is
 * assigned to. The two ways in are kept apart here: {@link listAssignedDashboards} and
 * {@link readVisibleDashboard} serve a person their own page, and answer a dashboard that is not
 * theirs exactly as one that does not exist; everything else is management, and the route has
 * checked the permission before it calls in.
 *
 * The layout is stored as the validated document the editor sends. What a card shows is decided
 * when it is drawn, against what the reader may see - a dashboard naming an entity grants nothing.
 */
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import {
  ConflictError,
  DASHBOARD_LAYOUT_VERSION,
  DASHBOARDS_MAXIMUM,
  dashboardAssigneeSchema,
  dashboardViewSchema,
  EMPTY_DASHBOARD_LAYOUT,
  InternalError,
  NotFoundError,
  ValidationError,
  type DashboardAssignee,
  type DashboardCreate,
  type DashboardUpdate,
  type DashboardView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { readAvatarUrls } from './avatars.js';

/** What a database handle or a transaction inside one can do, as far as this file needs. */
type Writer = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

const { dashboards, dashboardUsers } = schema.registry;

/** The columns a dashboard is served from, its assignments aggregated beside them. */
const COLUMNS = {
  id: dashboards.id,
  name: dashboards.name,
  icon: dashboards.icon,
  layout: dashboards.layout,
  layoutVersion: dashboards.layoutVersion,
  createdAt: dashboards.createdAt,
  updatedAt: dashboards.updatedAt,
  userIds: sql<string[]>`coalesce(
    (select array_agg(${dashboardUsers.userId} order by ${dashboardUsers.userId})
       from ${dashboardUsers}
      where ${dashboardUsers.dashboardId} = ${dashboards.id}),
    '{}'::uuid[]
  )`,
};

/**
 * Says a dashboard is not there - the same words whether it never existed or is not the caller's
 * to see.
 *
 * @param id - The id that was asked for.
 * @returns The error to throw.
 */
function notFound(id: string): NotFoundError {
  return new NotFoundError('No dashboard has that id', { details: { id } });
}

/**
 * Reads dashboards by a condition, oldest first, which is the order their tabs are in.
 *
 * @param db - The database.
 * @param where - Which ones, or every one.
 * @returns The dashboards.
 */
async function selectDashboards(db: Writer, where?: SQL): Promise<DashboardView[]> {
  const query = db.select(COLUMNS).from(dashboards);
  const rows = await (where === undefined ? query : query.where(where)).orderBy(
    asc(dashboards.createdAt),
    asc(dashboards.id),
  );

  return rows.map((row) => dashboardViewSchema.parse(row));
}

/**
 * Lists the dashboards assigned to one person, oldest first.
 *
 * @param db - The database.
 * @param userId - Whose page.
 * @returns What they are shown.
 */
export async function listAssignedDashboards(
  db: Database,
  userId: string,
): Promise<DashboardView[]> {
  return selectDashboards(
    db,
    inArray(
      dashboards.id,
      db
        .select({ id: dashboardUsers.dashboardId })
        .from(dashboardUsers)
        .where(eq(dashboardUsers.userId, userId)),
    ),
  );
}

/**
 * Lists every dashboard in the house, oldest first, with who each is shown to.
 *
 * @param db - The database.
 * @returns The dashboards.
 */
export async function listAllDashboards(db: Database): Promise<DashboardView[]> {
  return selectDashboards(db);
}

/**
 * Reads one dashboard, whoever it is shown to.
 *
 * @param db - The database.
 * @param id - Which one.
 * @returns The dashboard.
 * @throws {NotFoundError} When no dashboard has that id.
 */
export async function readDashboard(db: Writer, id: string): Promise<DashboardView> {
  const [found] = await selectDashboards(db, eq(dashboards.id, id));

  if (found === undefined) {
    throw notFound(id);
  }

  return found;
}

/**
 * Reads one dashboard for someone looking at it: theirs to see when it is assigned to them, or
 * when they manage every dashboard.
 *
 * @param db - The database.
 * @param id - Which one.
 * @param userId - Who is looking.
 * @param canManage - Whether they hold `dashboard:manage`.
 * @returns The dashboard.
 * @throws {NotFoundError} When there is none, or it is not theirs to see.
 */
export async function readVisibleDashboard(
  db: Database,
  id: string,
  userId: string,
  canManage: boolean,
): Promise<DashboardView> {
  const dashboard = await readDashboard(db, id);

  if (!canManage && !dashboard.userIds.includes(userId)) {
    throw notFound(id);
  }

  return dashboard;
}

/**
 * Refuses an assignment to an account that is not there.
 *
 * @param db - The database.
 * @param userIds - Who the dashboard is to be shown to.
 * @throws {ValidationError} Naming the ids that are nobody.
 */
async function checkAssignees(db: Writer, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const found = await db
    .select({ id: schema.auth.users.id })
    .from(schema.auth.users)
    .where(and(inArray(schema.auth.users.id, [...userIds]), isNull(schema.auth.users.deletedAt)));
  const known = new Set(found.map((row) => row.id));
  const unknown = userIds.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new ValidationError('A dashboard can only be assigned to people with an account', {
      details: {
        issues: [{ path: 'userIds', message: `No account has the id ${unknown.join(', ')}` }],
      },
    });
  }
}

/**
 * Replaces who a dashboard is shown to.
 *
 * @param db - The transaction the dashboard is written in.
 * @param dashboardId - Which dashboard.
 * @param userIds - Everyone it is to be shown to, and nobody else.
 */
async function assign(db: Writer, dashboardId: string, userIds: readonly string[]): Promise<void> {
  await db.delete(dashboardUsers).where(eq(dashboardUsers.dashboardId, dashboardId));

  if (userIds.length > 0) {
    await db.insert(dashboardUsers).values(userIds.map((userId) => ({ dashboardId, userId })));
  }
}

/**
 * Creates a dashboard.
 *
 * The limit is counted before the insert rather than enforced by the database: it is there so a
 * runaway script cannot fill the table, not as an invariant two simultaneous presses must never
 * cross.
 *
 * @param db - The database.
 * @param createdBy - Who made it.
 * @param body - Its name, and optionally its icon, first cards and who it is shown to.
 * @returns The dashboard as it now stands.
 * @throws {ConflictError} When the house already keeps as many dashboards as it may.
 * @throws {ValidationError} When it is assigned to someone with no account.
 */
export async function createDashboard(
  db: Database,
  createdBy: string,
  body: DashboardCreate,
): Promise<DashboardView> {
  const [counted] = await db.select({ total: sql<number>`count(*)::int` }).from(dashboards);

  if ((counted?.total ?? 0) >= DASHBOARDS_MAXIMUM) {
    throw new ConflictError(
      `The house already has ${String(DASHBOARDS_MAXIMUM)} dashboards; remove one first`,
      { details: { maximum: DASHBOARDS_MAXIMUM } },
    );
  }

  const userIds = body.userIds ?? [];

  await checkAssignees(db, userIds);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dashboards)
      .values({
        name: body.name,
        icon: body.icon ?? null,
        layout: body.layout ?? EMPTY_DASHBOARD_LAYOUT,
        layoutVersion: DASHBOARD_LAYOUT_VERSION,
        createdBy,
      })
      .returning({ id: dashboards.id });

    if (row === undefined) {
      throw new InternalError('The dashboard insert returned no row');
    }

    await assign(tx, row.id, userIds);

    return readDashboard(tx, row.id);
  });
}

/**
 * Changes a dashboard.
 *
 * A present `layout` replaces the stored one whole, and a present `userIds` replaces who it is
 * shown to; both in one transaction with the rest.
 *
 * @param db - The database.
 * @param id - Which one.
 * @param body - The fields to change.
 * @returns The dashboard as it now stands.
 * @throws {NotFoundError} When no dashboard has that id.
 * @throws {ValidationError} When it is assigned to someone with no account.
 */
export async function updateDashboard(
  db: Database,
  id: string,
  body: DashboardUpdate,
): Promise<DashboardView> {
  // Read first, so an id with nothing behind it is a 404 before anything else is judged.
  await readDashboard(db, id);

  if (body.userIds !== undefined) {
    await checkAssignees(db, body.userIds);
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(dashboards)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(body.layout === undefined
          ? {}
          : { layout: body.layout, layoutVersion: DASHBOARD_LAYOUT_VERSION }),
        updatedAt: new Date(),
      })
      .where(eq(dashboards.id, id))
      .returning({ id: dashboards.id });

    if (row === undefined) {
      throw notFound(id);
    }

    if (body.userIds !== undefined) {
      await assign(tx, id, body.userIds);
    }

    return readDashboard(tx, id);
  });
}

/**
 * Deletes a dashboard; its assignments go with it.
 *
 * @param db - The database.
 * @param id - Which one.
 * @returns The dashboard as it was, so the caller can say what went.
 * @throws {NotFoundError} When no dashboard has that id.
 */
export async function deleteDashboard(db: Database, id: string): Promise<DashboardView> {
  const dashboard = await readDashboard(db, id);

  await db.delete(dashboards).where(eq(dashboards.id, id));

  return dashboard;
}

/**
 * Lists everyone a dashboard can be assigned to: every active account, by name.
 *
 * @param db - The database.
 * @returns The people.
 */
export async function listAssignees(db: Database): Promise<DashboardAssignee[]> {
  const { users } = schema.auth;
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.isActive, true)))
    .orderBy(asc(users.displayName), asc(users.username));
  const avatars = await readAvatarUrls(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) =>
    dashboardAssigneeSchema.parse({ ...row, avatarUrl: avatars.get(row.id) ?? null }),
  );
}
