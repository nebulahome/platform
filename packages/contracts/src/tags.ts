/**
 * Tags: the words an owner puts on devices and entities to pick a group of them at once.
 *
 * A tag is a name, a colour and, when the owner wants one, an icon; it sits on any number of
 * devices and entities. It exists
 * for automations and scenes, which will select "every light tagged exterior" rather than list
 * the lights one by one; until they do, it is how the devices page and the tags page group
 * things.
 *
 * Two decisions are visible in the shape:
 *
 * - **The colour is a key into a fixed palette**, not a hex. The interface draws each key with a
 *   token that is one shade in the dark theme and another in the light one, and a hex could
 *   only be right in one of the two. Twelve keys is enough to tell tags apart at a glance and
 *   few enough that a chip's meaning stays "a tag the owner made" rather than "something red".
 * - **The key is fixed at creation.** It is a slug of the name the tag was made with, unique,
 *   and it is what a permission scope (`tag.exterior`) names. Renaming a tag changes `name`
 *   only, so a scope granted on it keeps meaning the same tag.
 * - **The icon is a catalogue id, like a device's**, and optional. A chip draws the tag's icon
 *   and shows the name beside it on hover, so a row of tags reads as a row of glyphs; a tag
 *   without one is drawn with the interface's own tag glyph.
 */
import { z } from 'zod';

import { iconIdSchema } from './icons.js';

/** The palette, in the order the swatches are shown. Each key has a `--color-tag-<key>` token. */
export const TAG_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const;

/** One of the palette's colours. */
export type TagColor = (typeof TAG_COLORS)[number];

/** Validates a colour: one of the palette's keys. */
export const tagColorSchema = z.enum(TAG_COLORS);

/** The shape of a key: the scope alphabet, letter-first. Mirrors `tags_key_format`. */
export const TAG_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Validates a key. */
export const tagKeySchema = z.string().regex(TAG_KEY_PATTERN, 'Must be a tag key');

/** How long a name may be, once trimmed. */
export const TAG_NAME_MAXIMUM_LENGTH = 64;

/** How many tags one device or entity may carry: a bound on a request, not a feature. */
export const TAGS_PER_ROW_MAXIMUM = 64;

/** Validates a name, trimmed. */
export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAXIMUM_LENGTH);

/** What the API says about a tag. */
export const tagViewSchema = z.object({
  id: z.uuid(),

  /** The stable identifier, e.g. `exterior` in the scope `tag.exterior`. */
  key: tagKeySchema,

  /** What the owner calls it. */
  name: z.string(),
  color: tagColorSchema,

  /** The catalogue icon it is drawn with, or null for the interface's tag glyph. */
  icon: iconIdSchema.nullable(),

  /** How many devices carry it. */
  deviceCount: z.int().min(0),

  /** How many entities carry it. */
  entityCount: z.int().min(0),
});

/** What the API says about a tag. */
export type TagView = z.output<typeof tagViewSchema>;

/** What creating a tag takes: a name, a colour and perhaps an icon. The key is derived from the name. */
export const tagCreateSchema = z.object({
  name: tagNameSchema,
  color: tagColorSchema,
  icon: iconIdSchema.optional(),
});

/** What creating a tag takes. */
export type TagCreate = z.output<typeof tagCreateSchema>;

/**
 * What changing a tag takes: any of the name, the colour and the icon, where null takes the icon
 * away. Never a key.
 */
export const tagUpdateSchema = z
  .object({
    name: tagNameSchema,
    color: tagColorSchema,
    icon: iconIdSchema.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** What changing a tag takes. */
export type TagUpdate = z.output<typeof tagUpdateSchema>;

/** What the key alphabet has no room for, to be folded into underscores. */
const NOT_KEY_CHARACTERS = /[^a-z0-9]+/g;

/** What the key alphabet does not allow first: anything but a letter. */
const NOT_A_LETTER_FIRST = /^[^a-z]/;

/**
 * Derives a key from a name: lower case, accents stripped, every run of anything else folded
 * into one underscore, letter-first, and no longer than the column allows.
 *
 * A name with nothing usable in it - `***` - gives an empty string, and the caller decides what
 * to fall back on; the API uses `tag`. Uniqueness is the caller's too: the API suffixes a number
 * when the key is taken.
 *
 * @param name - What the owner typed.
 * @returns The key, possibly empty.
 */
export function toTagKey(name: string): string {
  const folded = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(NOT_KEY_CHARACTERS, '_')
    .replace(/^_+|_+$/g, '');

  if (folded === '') {
    return '';
  }

  const lettered = NOT_A_LETTER_FIRST.test(folded) ? `tag_${folded}` : folded;

  return lettered.slice(0, 64).replace(/_+$/, '');
}
