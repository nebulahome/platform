/**
 * Managing people, roles, sessions and personal access tokens.
 *
 * All of this is `api`'s own: DATABASE.md 12 gives no other service a grant on the `auth`
 * schema, so these endpoints are the only way any of it changes.
 */
import { z } from 'zod';

import { grantedPermissionSchema, scopedPermissionSchema } from './auth.js';
import { iconIdSchema } from './icons.js';
import { supportedLocaleSchema } from './locale.js';
import { permissionKeySchema, permissionScopeSchema } from './permissions.js';
import { timestampSchema } from './timestamp.js';

/** One person with an account. */
export const userViewSchema = z.object({
  id: z.uuid(),
  username: z.string(),

  /** Null when they never gave one; it is not required to have an account. */
  email: z.email().nullable(),

  displayName: z.string(),

  /** The role key. */
  role: z.string(),

  /** The language they chose; null when they follow the house's. */
  locale: supportedLocaleSchema.nullable(),
  timezone: z.string(),

  /** False disables sign-in without deleting the account or its audit trail. */
  isActive: z.boolean(),

  /** Whether they have confirmed a second factor. */
  isTwoFactorEnabled: z.boolean(),

  /** Whether they must set a new password before doing anything else. */
  mustChangePassword: z.boolean(),

  /**
   * Their picture, as a `data:` URL, or null when they have not set one.
   *
   * Inlined rather than served from a URL of its own, because an `<img>` cannot send an
   * `Authorization` header and this installation has no anonymous route to an avatar. The size
   * cap is what makes that affordable: 64 KiB at the very most, and a few kilobytes in practice.
   */
  avatarUrl: z.string().nullable(),

  /** When they last signed in. Null means never. */
  lastLoginAt: timestampSchema.nullable(),

  /** Until when sign-in is refused after repeated failures. */
  lockedUntil: timestampSchema.nullable(),

  createdAt: timestampSchema,
});

/** One person with an account. */
export type UserView = z.output<typeof userViewSchema>;

/** What `POST /api/v1/users` accepts. */
export const createUserRequestSchema = z.object({
  /** Lower case letters, digits, dot, dash and underscore. */
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'Lower case letters, digits, dot, dash and underscore only'),

  /** Optional; used for nothing but recognising the person. */
  email: z.email().max(254).optional(),

  displayName: z.string().min(1).max(128),

  /**
   * The initial password.
   *
   * A floor of twelve characters and nothing else: composition rules push people towards
   * `Password1!` and no further, while length is the axis that actually costs an attacker.
   */
  password: z.string().min(12).max(1024),

  /** Which role they get. */
  role: z.string().min(1).max(64),

  /** Their own language; left out or null, they follow the house's. */
  locale: supportedLocaleSchema.nullable().default(null),
  timezone: z.string().min(1).max(64).default('UTC'),

  /** Make them choose their own password on first sign-in. */
  mustChangePassword: z.boolean().default(true),
});

/** What `POST /api/v1/users` accepts. */
export type CreateUserRequest = z.output<typeof createUserRequestSchema>;

/**
 * What `PATCH /api/v1/users/:userId` accepts.
 *
 * No password field: changing someone else's password is a different act from editing their
 * profile, and it belongs at its own endpoint where it can be audited as itself.
 */
export const updateUserRequestSchema = z.object({
  email: z.email().max(254).nullable().optional(),
  displayName: z.string().min(1).max(128).optional(),
  role: z.string().min(1).max(64).optional(),
  /** Null goes back to following the house language. */
  locale: supportedLocaleSchema.nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  isActive: z.boolean().optional(),
});

/** What `PATCH /api/v1/users/:userId` accepts. */
export type UpdateUserRequest = z.output<typeof updateUserRequestSchema>;

/** What `POST /api/v1/users/me/password` accepts. */
export const changePasswordRequestSchema = z.object({
  /**
   * The password in use now.
   *
   * Required even though the caller is already authenticated: an access token left open on a
   * shared machine should not be enough to take an account over permanently.
   */
  currentPassword: z.string().min(1).max(1024),

  newPassword: z.string().min(12).max(1024),
});

/** What `POST /api/v1/users/me/password` accepts. */
export type ChangePasswordRequest = z.output<typeof changePasswordRequestSchema>;

/** A named permission template. */
export const roleViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),

  /** The catalogue icon it is drawn with, or null for the interface's role glyph. */
  icon: iconIdSchema.nullable(),

  /** Built-in roles can be neither changed nor deleted. */
  isBuiltin: z.boolean(),

  sortOrder: z.int(),

  /** What the role grants. */
  permissions: z.array(grantedPermissionSchema),

  /** How many people hold it. */
  userCount: z.int().min(0),
});

/** A named permission template. */
export type RoleView = z.output<typeof roleViewSchema>;

/** Validates a role's name, trimmed. */
const roleNameSchema = z.string().trim().min(1).max(64);

/** Validates a role's one-line description, trimmed. */
const roleDescriptionSchema = z.string().trim().max(200);

/**
 * What `POST /api/v1/roles` accepts. The key is derived from the name; `from` names the role whose
 * permissions are copied, and without it the new role grants nothing.
 */
export const roleCreateSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema.default(''),
  icon: iconIdSchema.optional(),
  from: z.string().min(1).max(64).optional(),
});

/** What `POST /api/v1/roles` accepts. */
export type RoleCreate = z.output<typeof roleCreateSchema>;

/**
 * What `PATCH /api/v1/roles/:roleId` accepts: any of the details, where a null icon takes it away,
 * and `permissions` as the whole new set. Only a custom role can be changed.
 */
export const roleUpdateSchema = z
  .object({
    name: roleNameSchema,
    description: roleDescriptionSchema,
    icon: iconIdSchema.nullable(),
    permissions: z.array(permissionKeySchema).max(200),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** What `PATCH /api/v1/roles/:roleId` accepts. */
export type RoleUpdate = z.output<typeof roleUpdateSchema>;

/** What `DELETE /api/v1/roles/:roleId` accepts: where its people go, needed when it has any. */
export const roleDeleteQuerySchema = z.object({
  moveTo: z.string().min(1).max(64).optional(),
});

/** What `DELETE /api/v1/roles/:roleId` accepts. */
export type RoleDeleteQuery = z.output<typeof roleDeleteQuerySchema>;

/** One grant layered on top of a user's role. */
export const userGrantRequestSchema = z.object({
  key: permissionKeySchema,
  scope: z.union([z.literal('*'), permissionScopeSchema]).default('*'),
  effect: z.enum(['allow', 'deny']).default('allow'),

  /** When the grant lapses. Null means never. */
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

/** One grant layered on top of a user's role. */
export type UserGrantRequest = z.output<typeof userGrantRequestSchema>;

/** One signed-in browser or app. */
export const sessionViewSchema = z.object({
  id: z.uuid(),

  /** Where it signed in from. */
  ipAddress: z.string().nullable(),

  /** What signed in. Shown so a person can recognise a session as theirs. */
  userAgent: z.string().nullable(),

  createdAt: timestampSchema,
  lastSeenAt: timestampSchema,
  expiresAt: timestampSchema,

  /** Whether this is the session making the request. */
  isCurrent: z.boolean(),
});

/** One signed-in browser or app. */
export type SessionView = z.output<typeof sessionViewSchema>;

/** One personal access token, as listed. The secret itself is never shown again. */
export const accessTokenViewSchema = z.object({
  id: z.uuid(),

  /** What the owner called it. */
  name: z.string(),

  /** The first few characters, so a row can be matched to a token in hand. */
  tokenPrefix: z.string(),

  /** What it may do. A token grants; it never denies. */
  permissions: z.array(scopedPermissionSchema),

  /** When it was last used. Null means never. */
  lastUsedAt: timestampSchema.nullable(),

  /** When it stops working. Null means never. */
  expiresAt: timestampSchema.nullable(),

  createdAt: timestampSchema,
});

/** One personal access token, as listed. */
export type AccessTokenView = z.output<typeof accessTokenViewSchema>;

/** What `POST /api/v1/users/me/tokens` accepts. */
export const createAccessTokenRequestSchema = z.object({
  name: z.string().min(1).max(128),

  /**
   * What the token may do.
   *
   * Intersected with the owner's own permissions at every request, so a token can never do more
   * than the person who made it can do now (ARCHITECTURE.md 12.1).
   */
  permissions: z.array(scopedPermissionSchema).min(1),

  /** When it should stop working. Null means never, which is discouraged but allowed. */
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

/** What `POST /api/v1/users/me/tokens` accepts. */
export type CreateAccessTokenRequest = z.output<typeof createAccessTokenRequestSchema>;

/**
 * What creating a personal access token answers.
 *
 * The only response that ever carries the secret. It is not stored in a form that can produce
 * it again, so a caller that does not save it here has to make a new token.
 */
export const createAccessTokenResponseSchema = z.object({
  token: accessTokenViewSchema,

  /** The secret, shown exactly once. */
  secret: z.string(),
});

/** What creating a personal access token answers. */
export type CreateAccessTokenResponse = z.output<typeof createAccessTokenResponseSchema>;

/**
 * What starting two-factor enrolment answers.
 *
 * Nothing is enforced yet at this point: the secret is stored unconfirmed, and only confirming
 * a generated code turns it on. An enrolment that started enforcing here would lock out anyone
 * who mistyped the setup.
 */
export const twoFactorSetupResponseSchema = z.object({
  /** The base32 secret, for typing in by hand. */
  secret: z.string(),

  /** The `otpauth://` URI an authenticator app scans. */
  uri: z.string(),
});

/** What starting two-factor enrolment answers. */
export type TwoFactorSetupResponse = z.output<typeof twoFactorSetupResponseSchema>;

/** What confirming two-factor enrolment accepts. */
export const twoFactorConfirmRequestSchema = z.object({
  /** A code from the authenticator, proving it was set up correctly. */
  code: z.string().min(6).max(8),
});

/** What confirming two-factor enrolment accepts. */
export type TwoFactorConfirmRequest = z.output<typeof twoFactorConfirmRequestSchema>;

/** What confirming two-factor enrolment answers. */
export const twoFactorConfirmResponseSchema = z.object({
  /** Single-use codes for when the authenticator is unavailable. Shown exactly once. */
  recoveryCodes: z.array(z.string()),
});

/** What confirming two-factor enrolment answers. */
export type TwoFactorConfirmResponse = z.output<typeof twoFactorConfirmResponseSchema>;

/** The image formats an avatar may be stored in. */
export const AVATAR_MIME_TYPES = ['image/webp', 'image/png', 'image/jpeg'] as const;

/**
 * The image formats an avatar may be stored in.
 *
 * SVG is deliberately absent. It is a document rather than a picture: it can carry script, and
 * this file would be served back to every other person in the installation.
 */
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/** The largest avatar the database will hold, in bytes. Mirrors `user_avatars_size`. */
export const AVATAR_MAXIMUM_BYTES = 65_536;

/**
 * The square an avatar is resized to before it is sent.
 *
 * Done in the browser, so what crosses the wire is already small. 128 is twice the largest place
 * one is drawn, which covers a high-density screen and nothing more.
 */
export const AVATAR_PIXELS = 128;

/**
 * What `PUT /api/v1/users/:userId/avatar` accepts.
 *
 * Base64 in a JSON body rather than multipart, for one reason worth stating: multipart means a
 * parser, a parser means a dependency, and a dependency that handles untrusted uploads is a
 * larger thing to trust than `Buffer.from(text, 'base64')`. The size that makes this reasonable
 * is the point - a 128-pixel square is kilobytes, and an endpoint that took whole photographs
 * would deserve the other answer.
 */
export const setAvatarRequestSchema = z.object({
  /** The format the bytes are in. */
  mime: z.enum(AVATAR_MIME_TYPES),

  /**
   * The image, base64 encoded.
   *
   * Bounded here so an oversized body is refused before it is decoded; the decoded length is
   * checked again after, because base64 length is an upper bound on the bytes and not the bytes.
   */
  data: z.base64().max(Math.ceil(AVATAR_MAXIMUM_BYTES / 3) * 4),
});

/** What `PUT /api/v1/users/:userId/avatar` accepts. */
export type SetAvatarRequest = z.output<typeof setAvatarRequestSchema>;
