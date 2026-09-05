/**
 * Deciding whether a caller may do a thing.
 *
 * ARCHITECTURE.md 12.2 states the policy in one line - deny beats allow, narrower beats wider,
 * expired grants are ignored - and DATABASE.md says why it is implemented here in TypeScript
 * rather than in SQL: two implementations of one security policy diverge, and the one that
 * diverges silently is the one nobody unit-tests.
 *
 * Every function here is pure. The database reads that feed them live in `repository.ts`, so
 * these rules can be tested exhaustively without a database.
 */
import {
  PERMISSIONS,
  PermissionError,
  type GrantedPermission,
  type Identity,
  type ScopedPermission,
} from '@nebula-home/contracts';

/** The scope that means "everywhere". */
const EVERYWHERE = '*';

/** Every permission that may be narrowed to an area, entity or label. */
const SCOPABLE_KEYS: ReadonlySet<string> = new Set<string>(
  PERMISSIONS.filter((permission) => permission.isScopable).map((permission) => permission.key),
);

/** One row as the database holds it, before expiry has been considered. */
export type StoredGrant = GrantedPermission & {
  /** When the grant lapses. Null means never. */
  readonly expiresAt: Date | null;
};

/**
 * Combines a role's grants with a user's own into the set an identity carries.
 *
 * Duplicates are collapsed so the token stays small, and expired user grants are dropped here
 * rather than at check time: a grant that lapsed an hour ago should not be in the token at all,
 * and leaving it in would mean every check re-deriving the same conclusion.
 *
 * @param roleGrants - What the user's role allows. Roles never deny.
 * @param userGrants - Grants layered on the role, which may allow or deny.
 * @param now - The clock, injectable for tests.
 * @returns The grants to embed in the access token, denials included.
 */
export function resolveGrants(
  roleGrants: readonly ScopedPermission[],
  userGrants: readonly StoredGrant[],
  now: Date = new Date(),
): GrantedPermission[] {
  const seen = new Map<string, GrantedPermission>();

  for (const grant of roleGrants) {
    seen.set(`allow ${grant.key} ${grant.scope}`, { ...grant, effect: 'allow' });
  }

  for (const grant of userGrants) {
    if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) {
      continue;
    }

    seen.set(`${grant.effect} ${grant.key} ${grant.scope}`, {
      key: grant.key,
      scope: grant.scope,
      effect: grant.effect,
    });
  }

  return [...seen.values()];
}

/**
 * Narrows a set of grants to what a personal access token is also allowed to do.
 *
 * The intersection ARCHITECTURE.md 12.1 requires: a token can never do more than the person who
 * issued it can do *now*, so demoting a user immediately narrows every token they made. Denials
 * from the user's own grants are carried through unchanged - a token cannot escape a denial by
 * declaring a permission the user is denied.
 *
 * @param userGrants - What the owner may do.
 * @param tokenGrants - What the token declares.
 * @returns The grants the token actually carries.
 */
export function intersectGrants(
  userGrants: readonly GrantedPermission[],
  tokenGrants: readonly ScopedPermission[],
): GrantedPermission[] {
  const denials = userGrants.filter((grant) => grant.effect === 'deny');
  const allowed: GrantedPermission[] = [];

  for (const declared of tokenGrants) {
    const covered = userGrants.some(
      (grant) =>
        grant.effect === 'allow' &&
        grant.key === declared.key &&
        (grant.scope === EVERYWHERE || grant.scope === declared.scope),
    );

    if (covered) {
      allowed.push({ ...declared, effect: 'allow' });
    }
  }

  return [...allowed, ...denials];
}

/**
 * Says whether a set of grants permits one action.
 *
 * `candidateScopes` is every scope under which the target falls: for a light in the hallway
 * that is its own `entity.light.hallway_ceiling`, its area `area.hallway`, and each label on it.
 * A grant matches when it names any of them, or when it is unscoped. Building that list is the
 * caller's job because only the caller knows where the target sits.
 *
 * @param grants - What the identity carries.
 * @param key - The permission being checked, `<resource>:<action>`.
 * @param candidateScopes - Every scope the target falls under. Empty for an unscopable action.
 * @returns True when the action is permitted.
 */
export function isPermitted(
  grants: readonly GrantedPermission[],
  key: string,
  candidateScopes: readonly string[] = [],
): boolean {
  const relevant = grants.filter((grant) => grant.key === key);

  // Denials first and unconditionally: a deny at any scope the target falls under beats an
  // allow at any scope at all, including `*`. That is what "narrower beats wider" means in
  // practice - the narrow thing being expressed is nearly always the exception.
  for (const grant of relevant) {
    if (
      grant.effect === 'deny' &&
      (grant.scope === EVERYWHERE || candidateScopes.includes(grant.scope))
    ) {
      return false;
    }
  }

  return relevant.some(
    (grant) =>
      grant.effect === 'allow' &&
      (grant.scope === EVERYWHERE || candidateScopes.includes(grant.scope)),
  );
}

/**
 * Says whether a permission may be narrowed at all.
 *
 * @param key - The permission key.
 * @returns True when a scope other than `*` is meaningful for it.
 */
export function isScopable(key: string): boolean {
  return SCOPABLE_KEYS.has(key);
}

/**
 * Builds the scopes an entity falls under.
 *
 * @param entityId - The entity being acted on.
 * @param areaKey - The area it is in, when it is in one.
 * @param labelKeys - The labels on it.
 * @returns Every scope a grant could name to cover this entity.
 */
export function entityScopes(
  entityId: string,
  areaKey: string | null,
  labelKeys: readonly string[] = [],
): string[] {
  const scopes = [`entity.${entityId}`];

  if (areaKey !== null) {
    scopes.push(`area.${areaKey}`);
  }

  for (const label of labelKeys) {
    scopes.push(`label.${label}`);
  }

  return scopes;
}

/**
 * Checks a permission and fails loudly when it is missing.
 *
 * @param identity - Who is asking.
 * @param key - The permission required.
 * @param candidateScopes - Every scope the target falls under.
 * @throws {PermissionError} When the identity does not hold the permission. The message names
 * the permission, which is safe: it tells the caller what to ask an administrator for, and
 * reveals nothing about the resource they could not reach.
 */
export function requirePermission(
  identity: Identity,
  key: string,
  candidateScopes: readonly string[] = [],
): void {
  if (!isPermitted(identity.permissions, key, candidateScopes)) {
    throw new PermissionError(`This action requires ${key}`, {
      details: { permission: key },
    });
  }
}
