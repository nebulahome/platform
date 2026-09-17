/**
 * Icons: the catalogue every icon the platform shows is drawn from.
 *
 * An icon is addressed by an id, never by a file or a component. What the id draws is decided
 * on the server - a built-in drawing, or one the owner uploaded to stand in for it - so changing
 * what `light` looks like is one change, seen everywhere the id is used: a device, an area, the
 * interface's own chrome.
 *
 * A drawing travels as a **node**: the flat list of SVG elements the icon is made of, the shape
 * the built-in set ships in. The interface puts them inside its own `<svg>`, sized and coloured
 * its own way, which is what keeps a custom icon looking like the built-in ones - and what
 * keeps an uploaded file from carrying anything but shapes. The **frame** is the square of the
 * drawing's own coordinate system to show, so an upload with an odd `viewBox` can be re-centred
 * to the padding every other icon uses without touching the paths.
 */
import { z } from 'zod';

/**
 * Icon identifier: the lucide shape, so a built-in id is its own name in the set it came from.
 *
 * A digit is allowed first - `3d-printer` is a real icon - and the length matches what the
 * registry columns for icons hold.
 */
export const ICON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Validates an icon identifier. */
export const iconIdSchema = z.string().regex(ICON_ID_PATTERN, 'Must be an icon id');

/**
 * The SVG elements a line icon may be drawn with.
 *
 * Everything else - `image`, `use`, `script`, `foreignObject` - is either a way to load
 * something or a way to run something, and a node is rendered in every browser that shows the
 * catalogue. The list is the whole defence, so it is enforced at every boundary the node crosses.
 */
export const ICON_ELEMENTS = [
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
] as const;

/** One SVG element a line icon may be drawn with. */
export type IconElement = (typeof ICON_ELEMENTS)[number];

/** How many elements one drawing may have: a line icon has a handful, a logo has thousands. */
export const ICON_MAXIMUM_ELEMENTS = 500;

/** How large an uploaded drawing may be, in bytes - the same ceiling a vendor logo has. */
export const ICON_SVG_MAXIMUM_BYTES = 65_536;

/** The most icons one page of the catalogue lists. */
export const ICONS_MAXIMUM_LIMIT = 200;

/** How many icons a page lists when the caller does not say. */
const DEFAULT_ICONS_LIMIT = 60;

/** One element of a drawing: its tag and its attributes, every value a string. */
export const iconElementSchema = z.tuple([z.enum(ICON_ELEMENTS), z.record(z.string(), z.string())]);

/** The elements a drawing is made of, in drawing order. */
export const iconNodeSchema = z.array(iconElementSchema).max(ICON_MAXIMUM_ELEMENTS);

/** The elements a drawing is made of. */
export type IconNode = z.output<typeof iconNodeSchema>;

/**
 * The square of the drawing's coordinate system to show.
 *
 * Square, because every icon is drawn in a square box; `size` is the side, `x` and `y` the top
 * left corner. Built-in icons use `0 0 24`.
 */
export const iconFrameSchema = z.object({
  x: z.number().min(-100_000).max(100_000),
  y: z.number().min(-100_000).max(100_000),
  size: z.number().positive().max(100_000),
});

/** The square of the drawing's coordinate system to show. */
export type IconFrame = z.output<typeof iconFrameSchema>;

/** Where an icon comes from: shipped with the platform, or added by the owner. */
export const ICON_ORIGINS = ['builtin', 'custom'] as const;

/** Where an icon comes from. */
export type IconOrigin = (typeof ICON_ORIGINS)[number];

/** A name as the owner reads it: `Lightbulb`, `3D printer`. */
const iconNameSchema = z.string().trim().min(1).max(64);

/**
 * The words a search finds an icon by, beside its id and name, as an owner may write them.
 *
 * Wide enough to hold what a built-in icon already carries: lucide tags one icon with up to
 * sixty-odd words, and an owner redrawing it keeps them.
 */
const iconKeywordsSchema = z.array(z.string().trim().min(1).max(64)).max(64);

/**
 * One icon as the catalogue serves it.
 *
 * `isOverridden` says the drawing is the owner's rather than the built-in one, so the settings
 * page can offer to put the original back. A custom icon is never "overridden": it is its own
 * original.
 */
export const iconViewSchema = z.object({
  id: iconIdSchema,
  name: iconNameSchema,

  /** As the catalogue holds them: what is served is not bounded the way what is written is. */
  keywords: z.array(z.string()),
  origin: z.enum(ICON_ORIGINS),
  isOverridden: z.boolean(),
  node: iconNodeSchema,
  frame: iconFrameSchema,
});

/** One icon as the catalogue serves it. */
export type IconView = z.output<typeof iconViewSchema>;

/** A page of the catalogue. */
export const iconsResponseSchema = z.object({ items: z.array(iconViewSchema) });

/** A page of the catalogue. */
export type IconsResponse = z.output<typeof iconsResponseSchema>;

/**
 * What `GET /icons` takes: a search, or a list of ids, and how many to answer with.
 *
 * `ids` is what a page showing devices asks with: the icons of the rows on screen, in one
 * request. `q` is what the picker asks with while somebody types.
 */
export const iconsQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  ids: z
    .string()
    .min(1)
    .transform((value) => value.split(','))
    .pipe(z.array(iconIdSchema).min(1).max(ICONS_MAXIMUM_LIMIT))
    .optional(),
  limit: z.coerce.number().int().min(1).max(ICONS_MAXIMUM_LIMIT).default(DEFAULT_ICONS_LIMIT),
});

/** What `GET /icons` takes. */
export type IconsQuery = z.output<typeof iconsQuerySchema>;

/**
 * What adding an icon needs.
 *
 * The drawing goes up as the SVG file it came from, and the server reads the elements out of it
 * itself: a node the browser had already parsed would be a node the server has to trust. The
 * frame is required beside it because the server cannot measure a path - the editor computed
 * it from the drawing on screen, and an icon saved without one renders at whatever the file
 * said its `viewBox` was.
 */
export const iconCreateSchema = z.object({
  id: iconIdSchema,
  name: iconNameSchema,
  keywords: iconKeywordsSchema.default([]),
  svg: z.string().min(1).max(ICON_SVG_MAXIMUM_BYTES),
  frame: iconFrameSchema,
});

/** What adding an icon needs. */
export type IconCreate = z.output<typeof iconCreateSchema>;

/**
 * What changing an icon accepts.
 *
 * A partial map. Which fields a given icon lets through is the catalogue's decision, not the
 * schema's: a built-in icon keeps its id and its name and takes a new drawing or keywords; a
 * custom icon takes anything. The frame travels with the drawing for the reason it does on
 * create.
 */
export const iconUpdateSchema = z
  .object({
    id: iconIdSchema,
    name: iconNameSchema,
    keywords: iconKeywordsSchema,
    svg: z.string().min(1).max(ICON_SVG_MAXIMUM_BYTES),
    frame: iconFrameSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' })
  .refine((body) => body.svg === undefined || body.frame !== undefined, {
    message: 'A new drawing needs the frame it was fitted in',
    path: ['frame'],
  });

/** What changing an icon accepts. */
export type IconUpdate = z.output<typeof iconUpdateSchema>;
