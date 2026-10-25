/**
 * The permission catalogue.
 *
 * A permission exists because the code checks for it, so the list is a constant here rather than
 * rows created at runtime. The initial migration seeds `auth.permissions` from exactly this
 * list, and a test asserts the two still agree - a permission the database knows about and the
 * code never checks is a control that does nothing.
 *
 * Defined in ARCHITECTURE.md 12.2.
 */
import { z } from 'zod';

/**
 * The shape of a permission key.
 *
 * Mirrors `permissions_key_format` in DATABASE.md: exactly `<resource>:<action>`. Note that
 * ARCHITECTURE.md 12.2 writes examples such as `system:logs:read`, which cannot be a key under
 * this constraint - in that three-part form the last segment is the **scope**, not part of the
 * key. The equivalents here are `logs:read` and `settings:write`.
 */
export const PERMISSION_KEY_PATTERN = /^[a-z_]+:[a-z_]+$/;

/**
 * The shape of a scope.
 *
 * `*` means unscoped. Anything else narrows the grant to one area, one entity or one tag.
 * Mirrors the scope CHECK on `auth.role_permissions` and `auth.user_permissions`.
 */
export const PERMISSION_SCOPE_PATTERN = /^(area|entity|tag)\.[a-z0-9_.]+$/;

/** Validates a permission key. */
export const permissionKeySchema = z
  .string()
  .regex(PERMISSION_KEY_PATTERN, 'Must be <resource>:<action>');

/** Validates a scope, including the unscoped `*`. */
export const permissionScopeSchema = z
  .string()
  .refine((scope) => scope === '*' || PERMISSION_SCOPE_PATTERN.test(scope), {
    message: 'Must be * or <area|entity|tag>.<key>',
  });

/** Whether a grant allows or denies. Denials exist so one entity can be withheld from a role. */
export const PERMISSION_EFFECTS = ['allow', 'deny'] as const;

/** Whether a grant allows or denies. */
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

/** One entry in the catalogue. */
export type PermissionDefinition = {
  /** `<resource>:<action>`, the value stored in `auth.permissions.key`. */
  readonly key: string;

  /** The thing being acted on. */
  readonly resource: string;

  /** What is being done to it. */
  readonly action: string;

  /** Whether this permission may be narrowed to an area, entity or tag. */
  readonly isScopable: boolean;

  /** What holding it allows, in English, shown in the role editor. */
  readonly description: string;
};

/**
 * Every permission the platform checks.
 *
 * Scopable permissions are the ones where narrowing is meaningful: controlling entities in one
 * room, reading history for one sensor. Administrative permissions are deliberately not
 * scopable - a half-granted ability to install packages is not a useful thing to express.
 */
export const PERMISSIONS = [
  {
    key: 'entity:read',
    resource: 'entity',
    action: 'read',
    isScopable: true,
    description: 'See entities and their current state',
  },
  {
    key: 'entity:control',
    resource: 'entity',
    action: 'control',
    isScopable: true,
    description: 'Send commands to entities',
  },
  {
    key: 'entity:write',
    resource: 'entity',
    action: 'write',
    isScopable: true,
    description: 'Rename entities and change their configuration',
  },
  {
    key: 'entity:delete',
    resource: 'entity',
    action: 'delete',
    isScopable: false,
    description: 'Remove entities from the registry',
  },
  {
    key: 'device:read',
    resource: 'device',
    action: 'read',
    isScopable: true,
    description: 'See devices and how they are connected',
  },
  {
    key: 'device:write',
    resource: 'device',
    action: 'write',
    isScopable: false,
    description: 'Pair devices, rename them and assign them to areas',
  },
  {
    key: 'device:delete',
    resource: 'device',
    action: 'delete',
    isScopable: false,
    description: 'Unpair and remove devices',
  },
  {
    key: 'area:read',
    resource: 'area',
    action: 'read',
    isScopable: false,
    description: 'See the area hierarchy',
  },
  {
    key: 'area:write',
    resource: 'area',
    action: 'write',
    isScopable: false,
    description: 'Create, rename and rearrange areas',
  },
  {
    key: 'tag:read',
    resource: 'tag',
    action: 'read',
    isScopable: false,
    description: 'See tags',
  },
  {
    // Putting a tag on a device or an entity is `device:write` or `entity:write`: it is a change
    // to that row. This is about the tags themselves.
    key: 'tag:write',
    resource: 'tag',
    action: 'write',
    isScopable: false,
    description: 'Create, rename, recolour and delete tags',
  },
  {
    key: 'automation:read',
    resource: 'automation',
    action: 'read',
    isScopable: false,
    description: 'See automations and their run history',
  },
  {
    key: 'automation:write',
    resource: 'automation',
    action: 'write',
    isScopable: false,
    description: 'Create, edit, enable and delete automations',
  },
  {
    key: 'automation:trigger',
    resource: 'automation',
    action: 'trigger',
    isScopable: true,
    description: 'Run an automation manually',
  },
  {
    key: 'scene:read',
    resource: 'scene',
    action: 'read',
    isScopable: false,
    description: 'See scenes',
  },
  {
    key: 'scene:apply',
    resource: 'scene',
    action: 'apply',
    isScopable: true,
    description: 'Apply a scene',
  },
  {
    key: 'scene:write',
    resource: 'scene',
    action: 'write',
    isScopable: false,
    description: 'Create, edit and delete scenes',
  },
  {
    key: 'alias:read',
    resource: 'alias',
    action: 'read',
    isScopable: false,
    description: 'See derived entities and their definitions',
  },
  {
    key: 'alias:write',
    resource: 'alias',
    action: 'write',
    isScopable: false,
    description: 'Create, edit and delete derived entities',
  },
  {
    // Seeing the dashboards assigned to you needs nothing; this is about making them, laying
    // them out and deciding who sees each.
    key: 'dashboard:manage',
    resource: 'dashboard',
    action: 'manage',
    isScopable: false,
    description: 'Create, edit, assign and delete dashboards',
  },
  {
    key: 'history:read',
    resource: 'history',
    action: 'read',
    isScopable: true,
    description: 'Read state history and telemetry',
  },
  {
    key: 'package:read',
    resource: 'package',
    action: 'read',
    isScopable: false,
    description: 'See installed packages and the package store',
  },
  {
    key: 'package:install',
    resource: 'package',
    action: 'install',
    isScopable: false,
    description: 'Install, update and remove packages',
  },
  {
    key: 'package:configure',
    resource: 'package',
    action: 'configure',
    isScopable: false,
    description: 'Change a package configuration and start or stop it',
  },
  {
    key: 'integration:read',
    resource: 'integration',
    action: 'read',
    isScopable: false,
    description: 'See configured integrations and the bundles available',
  },
  {
    key: 'integration:configure',
    resource: 'integration',
    action: 'configure',
    isScopable: false,
    description: 'Add integrations, change their configuration and start or stop them',
  },
  {
    key: 'integration:install',
    resource: 'integration',
    action: 'install',
    isScopable: false,
    description: 'Install, update and remove integrations',
  },
  {
    key: 'user:read',
    resource: 'user',
    action: 'read',
    isScopable: false,
    description: 'See the list of users',
  },
  {
    key: 'user:manage',
    resource: 'user',
    action: 'manage',
    isScopable: false,
    description: 'Create, edit, disable and delete users',
  },
  {
    key: 'role:manage',
    resource: 'role',
    action: 'manage',
    isScopable: false,
    description: 'Create roles and change what they grant',
  },
  {
    key: 'logs:read',
    resource: 'logs',
    action: 'read',
    isScopable: false,
    description: 'Read logs and use the live tail',
  },
  {
    key: 'settings:read',
    resource: 'settings',
    action: 'read',
    isScopable: false,
    description: 'See system settings',
  },
  {
    key: 'settings:write',
    resource: 'settings',
    action: 'write',
    isScopable: false,
    description: 'Change system settings, including history retention',
  },
  {
    key: 'audit:read',
    resource: 'audit',
    action: 'read',
    isScopable: false,
    description: 'Read the audit log',
  },
  {
    key: 'system:read',
    resource: 'system',
    action: 'read',
    isScopable: false,
    description: 'See the system monitor: processor, memory, disk and network',
  },
  {
    key: 'system:update',
    resource: 'system',
    action: 'update',
    isScopable: false,
    description: 'Update Nebula Home, its packages and its integrations',
  },
  {
    key: 'system:power',
    resource: 'system',
    action: 'power',
    isScopable: false,
    description: 'Restart Nebula Home and shut it down',
  },
  {
    key: 'container:read',
    resource: 'container',
    action: 'read',
    isScopable: false,
    description: 'See the containers the machine runs, their settings and their logs',
  },
  {
    key: 'container:control',
    resource: 'container',
    action: 'control',
    isScopable: false,
    description: 'Start, stop, restart and update the containers the machine runs',
  },
  {
    key: 'container:install',
    resource: 'container',
    action: 'install',
    isScopable: false,
    description: 'Install and remove containers and compose projects',
  },
  {
    key: 'backup:restore',
    resource: 'backup',
    action: 'restore',
    isScopable: false,
    description: 'Restore the installation from a backup and download the backup key',
  },
] as const satisfies readonly PermissionDefinition[];

/** Every permission key the platform checks. */
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

/** The built-in roles seeded by the initial migration. */
export const BUILTIN_ROLES = ['owner', 'admin', 'member', 'guest', 'service'] as const;

/** One of the built-in roles. */
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

/**
 * What each built-in role grants out of the box.
 *
 * `owner` is absent from this table on purpose: the application pins it to the **full** set, so
 * a permission added in a later release is granted to the owner automatically. Listing it here
 * would mean a new permission silently missing from the one role that must never lack it.
 *
 * `service` starts empty. A machine identity gets exactly what it is granted explicitly, since
 * a token is far more likely than a person to be copied somewhere it should not be.
 */
export const DEFAULT_ROLE_PERMISSIONS = {
  // Not `role:manage`, which would let an admin make themselves owner, nor `backup:restore`: the
  // backup key opens every archive - password hashes, sealed credentials - and a restore replaces
  // the users and roles themselves.
  admin: PERMISSIONS.filter(
    (permission) => permission.key !== 'role:manage' && permission.key !== 'backup:restore',
  ).map((permission) => permission.key),
  member: [
    'entity:read',
    'entity:control',
    'device:read',
    'area:read',
    'tag:read',
    'automation:read',
    'automation:trigger',
    'scene:read',
    'scene:apply',
    'alias:read',
    'history:read',
    'package:read',
    'integration:read',
  ],
  guest: ['entity:read', 'entity:control', 'area:read', 'scene:read', 'scene:apply'],
  service: [],
} as const satisfies Record<Exclude<BuiltinRole, 'owner'>, readonly string[]>;
