/**
 * Reading and changing the settings an owner controls while the system runs.
 *
 * The catalogue itself lives in `settings.ts`, which is where the schemas and the defaults are
 * declared. This file is only the shape those values take on the wire.
 *
 * The response repeats the description and the default rather than leaving the caller to look
 * them up. A browser gets this package and could do without them, but the OpenAPI document is
 * the contract for everyone else, and a settings endpoint that answers with bare keys and
 * untyped values is one nobody can use without reading the source.
 *
 * A change is submitted as a partial map rather than as the whole set. Two people editing
 * different settings at the same time then do not overwrite each other, which a whole-document
 * PUT guarantees they would.
 */
import { z } from 'zod';

import { jsonValueSchema } from './json.js';
import { SETTING_KEY_PATTERN } from './settings.js';
import { timestampSchema } from './timestamp.js';

/** Validates a settings key. */
export const settingKeySchema = z
  .string()
  .regex(SETTING_KEY_PATTERN, 'Must be a dotted lower-case key');

/** Who last changed a setting. */
export const settingAuthorSchema = z.object({
  id: z.uuid(),

  /** Their name at the time the change is read, not at the time it was made. */
  displayName: z.string(),
});

/** Who last changed a setting. */
export type SettingAuthor = z.output<typeof settingAuthorSchema>;

/** One setting, as the interface sees it. */
export const settingViewSchema = z.object({
  /** The key in `system.settings`. */
  key: z.string(),

  /** What it is set to now. */
  value: jsonValueSchema,

  /**
   * What the initial migration seeded.
   *
   * Sent so the interface can say "back to default" without holding a second copy of the
   * catalogue, and so it can mark a value that has been moved off it.
   */
  defaultValue: jsonValueSchema,

  /** What the setting controls, in English. */
  description: z.string(),

  /** When it last changed. */
  updatedAt: timestampSchema,

  /** Who changed it. Null when nobody has: it is still what the migration seeded. */
  updatedBy: settingAuthorSchema.nullable(),
});

/** One setting, as the interface sees it. */
export type SettingView = z.output<typeof settingViewSchema>;

/** What `GET /api/v1/settings` answers, and what a successful `PATCH` answers too. */
export const settingsResponseSchema = z.object({ items: z.array(settingViewSchema) });

/** What `GET /api/v1/settings` answers. */
export type SettingsResponse = z.output<typeof settingsResponseSchema>;

/**
 * What `PATCH /api/v1/settings` accepts.
 *
 * The values are validated twice and both times matter. Here they are only checked to be JSON,
 * because this schema cannot know which key carries which shape; the endpoint then validates
 * each one against the schema its key names in the catalogue, and validates the retention keys
 * against each other as a group.
 */
export const updateSettingsRequestSchema = z.object({
  changes: z
    .record(settingKeySchema, jsonValueSchema)
    .refine((changes) => Object.keys(changes).length > 0, {
      message: 'Name at least one setting to change',
    }),
});

/** What `PATCH /api/v1/settings` accepts. */
export type UpdateSettingsRequest = z.output<typeof updateSettingsRequestSchema>;
