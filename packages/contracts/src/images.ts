/**
 * The pictures image entities show: a robot's map, drawn by its integration.
 *
 * An image entity's state says which picture it is (`revision`); the picture itself is kept by
 * the hub, in memory, as its integration last drew it, and read with `svc.hub.entity_image` by
 * `api` for whoever shows it. So the state stays a short string however large the picture, and a
 * map redrawn every few seconds costs the bus a revision each time, not a megabyte.
 */
import { z } from 'zod';

import { IMAGE_CONTENT_TYPES } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';

/** `svc.hub.entity_image`: the picture an image entity shows now. */
export const HUB_ENTITY_IMAGE_METHOD = 'entity_image';

/**
 * The largest picture kept: under NATS' one megabyte once it is base64, with room for the
 * envelope. A larger one is not kept, and its integration is told so in the log.
 */
export const IMAGE_MAXIMUM_BYTES = 700_000;

/** `svc.hub.entity_image`: which entity. */
export const entityImageRequestSchema = z.strictObject({ entityId: entityIdSchema });

/** The picture an image entity shows now. */
export const entityImageReplySchema = z.object({
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  revision: z.string().min(1).max(64),

  /** The picture, in base64. */
  data: z.string().max(Math.ceil((IMAGE_MAXIMUM_BYTES * 4) / 3) + 4),
});

/** The picture an image entity shows now. */
export type EntityImageReply = z.output<typeof entityImageReplySchema>;
