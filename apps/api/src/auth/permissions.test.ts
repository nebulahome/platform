/**
 * The authorisation rules.
 *
 * The most security-critical code in the service, and the cheapest to test exhaustively because
 * every function in it is pure. Each case below is a sentence from ARCHITECTURE.md 12.2 turned
 * into an assertion: deny beats allow, narrower beats wider, expired grants are ignored.
 */
import { describe, expect, it } from 'vitest';

import { PermissionError, type GrantedPermission } from '@nebula-home/contracts';

import {
  entityScopes,
  intersectGrants,
  isPermitted,
  isScopable,
  requirePermission,
  resolveGrants,
  type StoredGrant,
} from './permissions.js';

/**
 * Builds a grant without restating the shape each time.
 *
 * @param key - The permission key.
 * @param scope - Where it applies.
 * @param effect - Whether it allows or denies.
 * @returns The grant.
 */
function grant(
  key: string,
  scope: GrantedPermission['scope'] = '*',
  effect: 'allow' | 'deny' = 'allow',
): GrantedPermission {
  return { key, scope, effect };
}

/**
 * Builds a stored grant with an expiry.
 *
 * @param key - The permission key.
 * @param scope - Where it applies.
 * @param effect - Whether it allows or denies.
 * @param expiresAt - When it lapses.
 * @returns The stored grant.
 */
function stored(
  key: string,
  scope: GrantedPermission['scope'] = '*',
  effect: 'allow' | 'deny' = 'allow',
  expiresAt: Date | null = null,
): StoredGrant {
  return { ...grant(key, scope, effect), expiresAt };
}

/**
 * An identity carrying the given grants.
 *
 * @param permissions - What it may and may not do.
 * @returns The identity.
 */
const identityWith = (
  permissions: GrantedPermission[],
): Parameters<typeof requirePermission>[0] => ({
  userId: '00000000-0000-4000-8000-000000000001',
  username: 'tester',
  role: 'member',
  permissions,
  credential: 'session',
});

describe('resolveGrants', () => {
  it('turns role grants into allows', () => {
    const resolved = resolveGrants([{ key: 'entity:read', scope: '*' }], []);

    expect(resolved).toEqual([{ key: 'entity:read', scope: '*', effect: 'allow' }]);
  });

  it('keeps a denial rather than subtracting it', () => {
    const resolved = resolveGrants(
      [{ key: 'entity:control', scope: '*' }],
      [stored('entity:control', 'area.garage', 'deny')],
    );

    expect(resolved).toContainEqual({ key: 'entity:control', scope: '*', effect: 'allow' });
    expect(resolved).toContainEqual({
      key: 'entity:control',
      scope: 'area.garage',
      effect: 'deny',
    });
  });

  it('drops a grant that has already expired', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const resolved = resolveGrants(
      [],
      [stored('package:install', '*', 'allow', new Date('2025-12-31T00:00:00Z'))],
      now,
    );

    expect(resolved).toEqual([]);
  });

  it('keeps a grant that expires later', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const resolved = resolveGrants(
      [],
      [stored('package:install', '*', 'allow', new Date('2026-06-01T00:00:00Z'))],
      now,
    );

    expect(resolved).toHaveLength(1);
  });

  it('collapses a grant the role and the user both give', () => {
    const resolved = resolveGrants([{ key: 'entity:read', scope: '*' }], [stored('entity:read')]);

    expect(resolved).toHaveLength(1);
  });
});

describe('isPermitted', () => {
  it('allows an unscoped grant anywhere', () => {
    expect(isPermitted([grant('entity:control')], 'entity:control', ['entity.light.a'])).toBe(true);
  });

  it('allows a scoped grant only where it applies', () => {
    const grants = [grant('entity:control', 'area.hallway')];

    expect(isPermitted(grants, 'entity:control', ['area.hallway'])).toBe(true);
    expect(isPermitted(grants, 'entity:control', ['area.kitchen'])).toBe(false);
  });

  it('lets a narrow denial beat a wide allow', () => {
    const grants = [grant('entity:control'), grant('entity:control', 'area.garage', 'deny')];

    expect(isPermitted(grants, 'entity:control', ['area.hallway'])).toBe(true);
    expect(isPermitted(grants, 'entity:control', ['entity.cover.door', 'area.garage'])).toBe(false);
  });

  it('lets a wide denial beat a narrow allow', () => {
    const grants = [grant('entity:control', 'area.garage'), grant('entity:control', '*', 'deny')];

    expect(isPermitted(grants, 'entity:control', ['area.garage'])).toBe(false);
  });

  it('refuses a scoped grant when the action has no scope to match', () => {
    // An unscopable action is checked with no candidates, so only `*` can satisfy it. A grant
    // narrowed to one area must not be a way to install packages.
    expect(isPermitted([grant('package:install', 'area.garage')], 'package:install')).toBe(false);
  });

  it('refuses a permission that was never granted', () => {
    expect(isPermitted([grant('entity:read')], 'entity:control', ['entity.light.a'])).toBe(false);
  });

  it('does not confuse one permission for another', () => {
    expect(isPermitted([grant('entity:read')], 'entity:write')).toBe(false);
  });
});

describe('intersectGrants', () => {
  it('narrows a token to what its owner may do', () => {
    const owner = [grant('entity:read'), grant('entity:control', 'area.hallway')];
    const token = intersectGrants(owner, [
      { key: 'entity:read', scope: '*' },
      { key: 'entity:control', scope: 'area.hallway' },
      { key: 'package:install', scope: '*' },
    ]);

    expect(token).toContainEqual({ key: 'entity:read', scope: '*', effect: 'allow' });
    expect(token).toContainEqual({
      key: 'entity:control',
      scope: 'area.hallway',
      effect: 'allow',
    });
    expect(token.some((entry) => entry.key === 'package:install')).toBe(false);
  });

  it('lets a wide owner grant cover a narrow token grant', () => {
    const token = intersectGrants(
      [grant('entity:control')],
      [{ key: 'entity:control', scope: 'area.bedroom' }],
    );

    expect(token).toEqual([{ key: 'entity:control', scope: 'area.bedroom', effect: 'allow' }]);
  });

  it('carries the owner denials through, so a token cannot escape one', () => {
    const token = intersectGrants(
      [grant('entity:control'), grant('entity:control', 'area.garage', 'deny')],
      [{ key: 'entity:control', scope: '*' }],
    );

    expect(isPermitted(token, 'entity:control', ['area.garage'])).toBe(false);
    expect(isPermitted(token, 'entity:control', ['area.hallway'])).toBe(true);
  });
});

describe('entityScopes', () => {
  it('names the entity, its area and its tags', () => {
    expect(entityScopes('light.hallway_ceiling', 'hallway', ['exterior'])).toEqual([
      'entity.light.hallway_ceiling',
      'area.hallway',
      'tag.exterior',
    ]);
  });

  it('omits the area when the entity is not in one', () => {
    expect(entityScopes('light.spare', null)).toEqual(['entity.light.spare']);
  });
});

describe('isScopable', () => {
  it('knows which permissions may be narrowed', () => {
    expect(isScopable('entity:control')).toBe(true);
    expect(isScopable('package:install')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('passes silently when the permission is held', () => {
    expect(() => {
      requirePermission(identityWith([grant('entity:read')]), 'entity:read');
    }).not.toThrow();
  });

  it('throws a permission error naming what is missing', () => {
    expect(() => {
      requirePermission(identityWith([]), 'package:install');
    }).toThrow(PermissionError);

    try {
      requirePermission(identityWith([]), 'package:install');
    } catch (error: unknown) {
      expect((error as PermissionError).details).toEqual({ permission: 'package:install' });
    }
  });
});
