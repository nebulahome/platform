import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEY_PATTERN,
  PERMISSIONS,
  permissionScopeSchema,
} from './permissions.js';

describe('the permission catalogue', () => {
  it('gives every permission a key the database will accept', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.key).toMatch(PERMISSION_KEY_PATTERN);
    }
  });

  it('keeps the key equal to resource:action, as the CHECK constraint requires', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.key).toBe(`${permission.resource}:${permission.action}`);
    }
  });

  it('has no duplicate keys', () => {
    const keys = PERMISSIONS.map((permission) => permission.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('default role grants', () => {
  const known = new Set(PERMISSIONS.map((permission) => permission.key));

  it.each(Object.entries(DEFAULT_ROLE_PERMISSIONS))(
    'grants %s only permissions that exist',
    (role, granted) => {
      for (const key of granted) {
        expect(known.has(key)).toBe(true);
      }
    },
  );

  it('gives a guest no way to change configuration', () => {
    const writeLike = DEFAULT_ROLE_PERMISSIONS.guest.filter(
      (key) => key.endsWith(':write') || key.endsWith(':manage') || key.endsWith(':install'),
    );

    expect(writeLike).toEqual([]);
  });

  it('gives a service identity nothing until it is granted explicitly', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.service).toEqual([]);
  });
});

describe('scopes', () => {
  it('accepts the unscoped form', () => {
    expect(permissionScopeSchema.safeParse('*').success).toBe(true);
  });

  it.each(['area.living_room', 'entity.light_kitchen_ceiling', 'tag.exterior'])(
    'accepts %s',
    (scope) => {
      expect(permissionScopeSchema.safeParse(scope).success).toBe(true);
    },
  );

  it.each(['room.living', 'area', 'area.', 'Area.living_room', 'entity.Light'])(
    'rejects %s',
    (scope) => {
      expect(permissionScopeSchema.safeParse(scope).success).toBe(false);
    },
  );
});

describe('integration permissions', () => {
  it('lets a member see integrations and only an admin configure them', () => {
    const keys = PERMISSIONS.map((permission) => permission.key);

    expect(keys).toContain('integration:read');
    expect(keys).toContain('integration:configure');
    expect(DEFAULT_ROLE_PERMISSIONS.member).toContain('integration:read');
    expect(DEFAULT_ROLE_PERMISSIONS.member).not.toContain('integration:configure');
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain('integration:configure');
  });
});

describe('dashboard permissions', () => {
  it('lets an admin manage dashboards, and nobody below', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain('dashboard:manage');
    expect(DEFAULT_ROLE_PERMISSIONS.member).not.toContain('dashboard:manage');
    expect(DEFAULT_ROLE_PERMISSIONS.guest).not.toContain('dashboard:manage');
  });
});
