/**
 * The map's tiles, one picture at a time, for the browser's map to draw.
 *
 * Registered on the server directly rather than through `defineRoute`: that helper speaks JSON
 * both ways and describes what it speaks to OpenAPI, and a tile is neither JSON nor worth a
 * schema. The request is still authenticated by the hook every route shares, still answers
 * errors in the envelope, and still asks for a permission - `area:read`, the same one that
 * lets somebody see where the house is.
 *
 * Given a budget of its own rather than the one every other route shares. Panning a map asks
 * for a few dozen tiles in a second, and a budget sized for forms would empty in one zoom; but
 * a tile that is not on disk is fetched from somebody else's server, which asks its guests not
 * to download in bulk, so the route is not unlimited either - a person panning around never
 * reaches the ceiling, a script walking the world does.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ValidationError } from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { requireIdentity } from '../http/guard.js';
import { isTileInRange } from '../services/map-tile-geometry.js';

/** How long the browser may keep a tile before asking again. A week: streets do not move. */
const TILE_CACHE_CONTROL = 'private, max-age=604800';

/** How many tiles one person may ask for in {@link TILE_RATE_WINDOW_MS}: twenty a second, on average. */
const TILE_RATE_MAX = 1200;

/** The window the tile budget is counted over. */
const TILE_RATE_WINDOW_MS = 60_000;

/** A tile address: three integers in the path. */
const tileParamsSchema = z.object({
  z: z.coerce.number().int(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
});

/**
 * Registers the tile route.
 *
 * @param server - The server.
 * @param context - The service's collaborators.
 * @param basePath - The versioned prefix every route sits under.
 */
export function registerMapRoutes(
  server: FastifyInstance,
  context: ApiContext,
  basePath: string,
): void {
  server.get(
    `${basePath}/map/tiles/:z/:x/:y`,
    { config: { rateLimit: { max: TILE_RATE_MAX, timeWindow: TILE_RATE_WINDOW_MS } } },

    /**
     * Serves one tile: from disk when it is there, through the tile server when it is not.
     *
     * @param request - Which tile, and who is asking.
     * @param reply - Where the picture goes.
     * @returns The picture.
     */
    async (request: FastifyRequest, reply: FastifyReply): Promise<Buffer> => {
      requirePermission(requireIdentity(request), 'area:read');

      const parsed = tileParamsSchema.safeParse(request.params);

      if (!parsed.success || !isTileInRange(parsed.data)) {
        throw new ValidationError('That is not a tile on the map', {
          details: { params: request.params },
        });
      }

      const tile = parsed.data;
      const bytes =
        (await context.mapTiles.read(tile)) ?? (await context.mapTiles.fetchThrough(tile));

      void reply.type('image/png').header('cache-control', TILE_CACHE_CONTROL);

      return bytes;
    },
  );
}
