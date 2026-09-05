/**
 * The one-time first-boot flow.
 *
 * DATABASE.md 14 states the rule this exists to keep: the first user is never seeded, because
 * shipping a default administrator password is how appliances end up on the public internet with
 * `admin`/`admin`. Instead, an installation whose `auth.users` is empty serves this flow once,
 * and stops serving it the moment it is used.
 */
import { z } from 'zod';

import { authenticatedResponseSchema } from './api-auth.js';

/** What `GET /api/v1/setup` answers. */
export const setupStatusSchema = z.object({
  /**
   * Whether the installation still needs its first account.
   *
   * False forever after the first one exists. A client polls this once, at start-up, to decide
   * between showing a sign-in form and showing the setup form.
   */
  isRequired: z.boolean(),
});

/** What `GET /api/v1/setup` answers. */
export type SetupStatus = z.output<typeof setupStatusSchema>;

/** What `POST /api/v1/setup` accepts. */
export const setupRequestSchema = z.object({
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
   * The owner's password.
   *
   * The same twelve-character floor as every other account, and no composition rules, for the
   * reason given in `api-users.ts`: length is the axis that costs an attacker anything.
   */
  password: z.string().min(12).max(1024),

  locale: z.string().min(2).max(16).default('en'),
  timezone: z.string().min(1).max(64).default('UTC'),
});

/** What `POST /api/v1/setup` accepts. */
export type SetupRequest = z.output<typeof setupRequestSchema>;

/**
 * What `POST /api/v1/setup` answers.
 *
 * The same body a sign-in produces. Creating the account and then asking the person to type the
 * password they chose four seconds ago would be ceremony: they have just proved they know it.
 */
export const setupResponseSchema = authenticatedResponseSchema;

/** What `POST /api/v1/setup` answers. */
export type SetupResponse = z.output<typeof setupResponseSchema>;
