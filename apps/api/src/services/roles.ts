/**
 * Roles: the named permission sets people are given.
 *
 * The five built-in roles are read-only - what `owner` or `guest` means is the platform's answer,
 * the same in every house. Custom roles are the owner's: made new or from another role, renamed,
 * redrawn, their permissions switched one by one, and deleted once their people have somewhere
 * to go (`users.role_id` is `RESTRICT`, so a role with people cannot simply disappear).
 *
 * Nobody grants what they do not hold. `role:manage` is a permission like any other, and whoever
 * has it without being the owner could otherwise write themselves a role with everything in it
 * and ask for it; so a role may only gain permissions the caller holds unscoped.
 *
 * A change reaches signed-in people at their next token refresh: the grants travel in the access
 * token, which lives a quarter of an hour.
 */
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';

import {
  ConflictError,
  NotFoundError,
  PermissionError,
  ValidationError,
  roleViewSchema,
  toTagKey,
  type Identity,
  type RoleCreate,
  type RoleUpdate,
  type RoleView,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { isPermitted } from '../auth/permissions.js';

import { checkIcon, type IconLookup } from './icon-lookup.js';
import { chooseFreeKey, isUniqueViolation } from './keys.js';

/** What a database handle or a transaction inside one can do, as far as this file needs. */
type Writer = Pick<Database, 'select' | 'insert' | 'delete' | 'update'>;

/** The key a name gives when it gives nothing usable. */
const FALLBACK_KEY = 'role';

/** How much of a slug a role key keeps, leaving room for `_` and a number under the CHECK's 32. */
const KEY_BASE_LENGTH = 26;

/**
 * Lists every role with what it grants and how many people hold it.
 *
 * @param db - The database.
 * @returns The roles, built-in first in their own order, then custom ones oldest first.
 */
export async function listRoles(db: Writer): Promise<RoleView[]> {
  const rows = await db
    .select({
      id: schema.auth.roles.id,
      key: schema.auth.roles.key,
      name: schema.auth.roles.name,
      description: schema.auth.roles.description,
      icon: schema.auth.roles.icon,
      isBuiltin: schema.auth.roles.isBuiltin,
      sortOrder: schema.auth.roles.sortOrder,
      userCount: sql<number>`count(${schema.auth.users.id})::int`,
    })
    .from(schema.auth.roles)
    .leftJoin(
      schema.auth.users,
      and(eq(schema.auth.users.roleId, schema.auth.roles.id), isNull(schema.auth.users.deletedAt)),
    )
    .groupBy(schema.auth.roles.id)
    .orderBy(asc(schema.auth.roles.sortOrder), asc(schema.auth.roles.createdAt));

  const grants = await db
    .select({
      roleId: schema.auth.rolePermissions.roleId,
      key: schema.auth.permissions.key,
      scope: schema.auth.rolePermissions.scope,
    })
    .from(schema.auth.rolePermissions)
    .innerJoin(
      schema.auth.permissions,
      eq(schema.auth.permissions.id, schema.auth.rolePermissions.permissionId),
    );

  const byRole = new Map<string, { key: string; scope: string; effect: 'allow' }[]>();

  for (const grant of grants) {
    byRole.set(grant.roleId, [
      ...(byRole.get(grant.roleId) ?? []),
      { key: grant.key, scope: grant.scope, effect: 'allow' },
    ]);
  }

  return rows.map((row) => roleViewSchema.parse({ ...row, permissions: byRole.get(row.id) ?? [] }));
}

/**
 * Reads one role.
 *
 * @param db - The database.
 * @param id - Which role.
 * @returns The role.
 * @throws {NotFoundError} When no role has that id.
 */
async function readRole(db: Writer, id: string): Promise<RoleView> {
  const found = (await listRoles(db)).find((role) => role.id === id);

  if (found === undefined) {
    throw new NotFoundError('No role has that id', { details: { id } });
  }

  return found;
}

/**
 * Finds a role by its key.
 *
 * @param db - The database.
 * @param key - The role key.
 * @param field - The request field that named it, for the refusal.
 * @returns The role's id.
 * @throws {ValidationError} When no role has that key.
 */
async function roleIdByKey(db: Writer, key: string, field: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .where(eq(schema.auth.roles.key, key))
    .limit(1);

  if (row === undefined) {
    throw new ValidationError(`No role ${key}`, {
      details: { issues: [{ path: field, message: `No role has the key ${key}` }] },
    });
  }

  return row.id;
}

/**
 * Turns permission keys into permission ids.
 *
 * @param db - The database.
 * @param keys - The keys.
 * @returns The ids, in no particular order.
 * @throws {ValidationError} When a key names no permission.
 */
async function permissionIds(db: Writer, keys: readonly string[]): Promise<string[]> {
  const unique = [...new Set(keys)];

  if (unique.length === 0) {
    return [];
  }

  const rows = await db
    .select({ id: schema.auth.permissions.id, key: schema.auth.permissions.key })
    .from(schema.auth.permissions)
    .where(inArray(schema.auth.permissions.key, unique));

  const known = new Set(rows.map((row) => row.key));
  const unknown = unique.filter((key) => !known.has(key));

  if (unknown.length > 0) {
    throw new ValidationError('Some permissions do not exist', {
      details: { issues: [{ path: 'permissions', message: `Unknown: ${unknown.join(', ')}` }] },
    });
  }

  return rows.map((row) => row.id);
}

/**
 * Refuses a role gaining a permission the caller does not hold unscoped.
 *
 * @param identity - Who is asking.
 * @param gained - The permissions the role would gain.
 * @throws {PermissionError} Naming the first one.
 */
function refuseEscalation(identity: Identity, gained: readonly string[]): void {
  const missing = gained.filter((key) => !isPermitted(identity.permissions, key));

  if (missing.length > 0) {
    throw new PermissionError(
      `A role can only be given permissions you hold: ${missing.join(', ')}`,
      {
        details: { permission: missing[0] },
      },
    );
  }
}

/**
 * Refuses a change to a built-in role.
 *
 * @param role - The role.
 * @throws {ConflictError} When it is built in.
 */
function refuseBuiltin(role: RoleView): void {
  if (role.isBuiltin) {
    throw new ConflictError('Built-in roles cannot be changed; duplicate one instead', {
      details: { key: role.key },
    });
  }
}

/**
 * The key a new role gets: the name's slug, or the slug with a number when it is taken.
 *
 * @param db - The database.
 * @param name - What the owner typed.
 * @returns A key no role has.
 */
async function freeKeyFor(db: Writer, name: string): Promise<string> {
  const slug = toTagKey(name).slice(0, KEY_BASE_LENGTH).replace(/_+$/, '');
  const base = slug.length >= 2 ? slug : FALLBACK_KEY;
  const taken = new Set(
    (
      await db
        .select({ key: schema.auth.roles.key })
        .from(schema.auth.roles)
        .where(like(schema.auth.roles.key, `${base}%`))
    ).map((row) => row.key),
  );

  return chooseFreeKey(base, taken);
}

/**
 * Creates a custom role, with the permissions of `from` when it names one.
 *
 * @param db - The database.
 * @param icons - The catalogue, to refuse an icon that is not in it.
 * @param identity - Who is asking, who may only hand on what they hold.
 * @param body - The name, the description, perhaps an icon and a role to start from.
 * @returns The role.
 * @throws {ValidationError} When the icon or the starting role does not exist.
 * @throws {PermissionError} When the starting role grants something the caller does not hold.
 * @throws {ConflictError} When two requests raced for the same key.
 */
export async function createRole(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  body: RoleCreate,
): Promise<RoleView> {
  if (body.icon !== undefined) {
    checkIcon(icons, body.icon);
  }

  const copied =
    body.from === undefined
      ? []
      : await db
          .select({
            permissionId: schema.auth.rolePermissions.permissionId,
            scope: schema.auth.rolePermissions.scope,
            key: schema.auth.permissions.key,
          })
          .from(schema.auth.rolePermissions)
          .innerJoin(
            schema.auth.permissions,
            eq(schema.auth.permissions.id, schema.auth.rolePermissions.permissionId),
          )
          .where(eq(schema.auth.rolePermissions.roleId, await roleIdByKey(db, body.from, 'from')));

  refuseEscalation(
    identity,
    copied.map((grant) => grant.key),
  );

  const key = await freeKeyFor(db, body.name);

  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.auth.roles)
        .values({
          key,
          name: body.name,
          description: body.description,
          icon: body.icon ?? null,
          isBuiltin: false,
        })
        .returning({ id: schema.auth.roles.id });

      if (row === undefined) {
        throw new Error('The role insert returned nothing');
      }

      if (copied.length > 0) {
        await tx.insert(schema.auth.rolePermissions).values(
          copied.map((grant) => ({
            roleId: row.id,
            permissionId: grant.permissionId,
            scope: grant.scope,
          })),
        );
      }

      return row.id;
    });

    return await readRole(db, id);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A role was just made with that key; try again', {
        cause: error,
        details: { key },
      });
    }

    throw error;
  }
}

/**
 * Changes a custom role's details or its whole set of permissions.
 *
 * @param db - The database.
 * @param icons - The catalogue, to refuse an icon that is not in it.
 * @param identity - Who is asking, who may only hand on what they hold.
 * @param id - Which role.
 * @param body - What changes.
 * @returns The role as it now stands.
 * @throws {NotFoundError} When no role has that id.
 * @throws {ConflictError} When the role is built in.
 * @throws {ValidationError} When the icon or a permission does not exist.
 * @throws {PermissionError} When the role would gain something the caller does not hold.
 */
export async function updateRole(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  id: string,
  body: RoleUpdate,
): Promise<RoleView> {
  const role = await readRole(db, id);

  refuseBuiltin(role);

  if (body.icon !== undefined && body.icon !== null) {
    checkIcon(icons, body.icon);
  }

  const permissions = body.permissions;
  const ids = permissions === undefined ? undefined : await permissionIds(db, permissions);

  if (permissions !== undefined) {
    const held = new Set(role.permissions.map((grant) => grant.key));

    refuseEscalation(
      identity,
      permissions.filter((key) => !held.has(key)),
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.auth.roles)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        updatedAt: new Date(),
      })
      .where(eq(schema.auth.roles.id, id));

    if (ids !== undefined) {
      await tx
        .delete(schema.auth.rolePermissions)
        .where(eq(schema.auth.rolePermissions.roleId, id));

      if (ids.length > 0) {
        await tx
          .insert(schema.auth.rolePermissions)
          .values(ids.map((permissionId) => ({ roleId: id, permissionId })));
      }
    }
  });

  return readRole(db, id);
}

/**
 * Deletes a custom role, moving its people to another role first.
 *
 * @param db - The database.
 * @param id - Which role.
 * @param moveTo - The key of the role its people move to; needed when it has any.
 * @returns The deleted role, for the audit.
 * @throws {NotFoundError} When no role has that id.
 * @throws {ConflictError} When the role is built in.
 * @throws {ValidationError} When people would be left without a role.
 */
export async function deleteRole(
  db: Database,
  id: string,
  moveTo: string | undefined,
): Promise<RoleView> {
  const role = await readRole(db, id);

  refuseBuiltin(role);

  const target = moveTo === undefined ? undefined : await roleIdByKey(db, moveTo, 'moveTo');

  if (target === id || (target === undefined && role.userCount > 0)) {
    throw new ValidationError('Its people need another role to move to', {
      details: { issues: [{ path: 'moveTo', message: 'Name a different role' }] },
    });
  }

  // Deleted accounts keep their row, and so their role: with nobody living to move, they go to
  // guest rather than holding the role in place.
  const heir = target ?? (await roleIdByKey(db, 'guest', 'moveTo'));

  await db.transaction(async (tx) => {
    await tx
      .update(schema.auth.users)
      .set({ roleId: heir })
      .where(eq(schema.auth.users.roleId, id));
    await tx.delete(schema.auth.roles).where(eq(schema.auth.roles.id, id));
  });

  return role;
}
