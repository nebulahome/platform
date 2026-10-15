/**
 * The bodies of the sign-in endpoints.
 *
 * The flow has two steps because two-factor authentication is optional per user: the password
 * endpoint either finishes the sign-in or hands back a challenge, and the caller cannot tell in
 * advance which it will be. Modelling that as a discriminated union rather than as a nullable
 * token field means a client that forgets to handle the challenge fails to compile instead of
 * signing someone in without their second factor.
 */
import { z } from 'zod';

import { grantedPermissionSchema } from './auth.js';
import { supportedLocaleSchema } from './locale.js';

/** What `POST /api/v1/auth/login` accepts. */
export const loginRequestSchema = z.object({
  /** Case-insensitive; the column is `citext`. */
  username: z.string().min(1).max(64),

  /** Checked against the argon2id hash. Never logged, never echoed. */
  password: z.string().min(1).max(1024),
});

/** What `POST /api/v1/auth/login` accepts. */
export type LoginRequest = z.output<typeof loginRequestSchema>;

/** The pair of tokens a completed sign-in produces. */
export const tokenPairSchema = z.object({
  /** The JWT to send as `Authorization: Bearer`. */
  accessToken: z.string(),

  /** Always `Bearer`. Present so a generic client does not have to hard-code it. */
  tokenType: z.literal('Bearer'),

  /** Seconds until the access token expires. */
  expiresIn: z.int().min(1),

  /**
   * The opaque refresh token.
   *
   * Rotated on every use: the value returned here is dead the moment it is exchanged, and
   * presenting it twice revokes the whole session (ARCHITECTURE.md 12.1).
   */
  refreshToken: z.string(),
});

/** The pair of tokens a completed sign-in produces. */
export type TokenPair = z.output<typeof tokenPairSchema>;

/** Who is signed in, as the interface needs them. */
export const sessionUserSchema = z.object({
  /** The user id. */
  id: z.uuid(),

  /** Their username. */
  username: z.string(),

  /** The name shown in the interface. */
  displayName: z.string(),

  /** The role key they hold. */
  role: z.string(),

  /**
   * Everything they are allowed to do.
   *
   * Sent so the interface can hide controls that would fail. It is a convenience, never a
   * security boundary: authorisation is enforced on every request regardless
   * (ARCHITECTURE.md 12.3).
   */
  permissions: z.array(grantedPermissionSchema),

  /** Their picture as a `data:` URL, or null when they have not set one. */
  avatarUrl: z.string().nullable(),

  /** The language they chose for themselves; null when they follow the house's. */
  locale: supportedLocaleSchema.nullable(),

  /**
   * The house language (`house.locale`), sent with them because it is what they read while
   * `locale` is null, and the setting itself is not theirs to read.
   */
  houseLocale: supportedLocaleSchema,

  /** Their IANA time zone. */
  timezone: z.string(),

  /** Whether they have confirmed a second factor. */
  isTwoFactorEnabled: z.boolean(),

  /** Whether they must set a new password before doing anything else. */
  mustChangePassword: z.boolean(),
});

/** Who is signed in, as the interface needs them. */
export type SessionUser = z.output<typeof sessionUserSchema>;

/**
 * What `POST /api/v1/auth/login` answers.
 *
 * `two_factor_required` carries no token of any kind: the challenge id is a pointer to a
 * short-lived server-side record, so intercepting it grants nothing without the code.
 */
export const loginResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('authenticated'),
    tokens: tokenPairSchema,
    user: sessionUserSchema,
  }),
  z.object({
    status: z.literal('two_factor_required'),

    /** Present this to `POST /auth/two-factor` along with the code. */
    challengeId: z.string().min(1).max(128),

    /** When the challenge stops being usable. */
    expiresAt: z.iso.datetime({ offset: true }),
  }),
]);

/** What `POST /api/v1/auth/login` answers. */
export type LoginResponse = z.output<typeof loginResponseSchema>;

/** What `POST /api/v1/auth/two-factor` accepts. */
export const twoFactorRequestSchema = z.object({
  /** From the login response. */
  challengeId: z.string().min(1).max(128),

  /**
   * A six-digit TOTP code, or one recovery code.
   *
   * Both go in the same field because from the user's side they are the same act: proving the
   * second factor. Which one it was is decided by matching, not by asking.
   */
  code: z.string().min(6).max(32),
});

/** What `POST /api/v1/auth/two-factor` accepts. */
export type TwoFactorRequest = z.output<typeof twoFactorRequestSchema>;

/** What a completed sign-in answers. */
export const authenticatedResponseSchema = z.object({
  tokens: tokenPairSchema,
  user: sessionUserSchema,
});

/** What a completed sign-in answers. */
export type AuthenticatedResponse = z.output<typeof authenticatedResponseSchema>;

/** What `POST /api/v1/auth/refresh` accepts. */
export const refreshRequestSchema = z.object({
  /** The opaque token from the previous token pair. */
  refreshToken: z.string().min(1).max(512),
});

/** What `POST /api/v1/auth/refresh` accepts. */
export type RefreshRequest = z.output<typeof refreshRequestSchema>;

/** What `POST /api/v1/auth/logout` accepts. */
export const logoutRequestSchema = z.object({
  /**
   * Revoke every session this user has, not only the current one.
   *
   * The "sign out everywhere" button, which is what a person reaches for after losing a laptop.
   */
  allSessions: z.boolean().default(false),
});

/** What `POST /api/v1/auth/logout` accepts. */
export type LogoutRequest = z.output<typeof logoutRequestSchema>;
