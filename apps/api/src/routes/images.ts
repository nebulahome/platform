/**
 * The pictures image entities show: a robot's map, drawn by its integration.
 *
 * The entity's state says which picture it is (`revision`); the bytes are here, asked of the hub,
 * which keeps the latest one each integration drew. Served with its own content type - an SVG, a
 * PNG - with the revision as its ETag, so a browser asked again for the picture it already has is
 * answered `304` and nothing else. Reading one needs to be allowed to read the entity, as reading
 * its state does.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  busSubjects,
  DeviceUnavailableError,
  entityIdSchema,
  entityImageReplySchema,
  HUB_ENTITY_IMAGE_METHOD,
  HUB_SERVICE,
  NotFoundError,
} from '@nebula-home/contracts';

import type { ApiContext } from '../context.js';
import { requireIdentity } from '../http/guard.js';
import { readableEntityIds } from '../services/entities.js';

/** How long the hub has to answer: the picture is in its memory. */
const IMAGE_TIMEOUT_MS = 5000;

/** The entity, in the path. */
const imageParamsSchema = z.object({ entityId: entityIdSchema });

/**
 * Registers the image route.
 *
 * @param server - The server.
 * @param context - The service's collaborators.
 * @param basePath - The versioned prefix every route sits under.
 */
export function registerImageRoutes(
  server: FastifyInstance,
  context: ApiContext,
  basePath: string,
): void {
  server.get(
    `${basePath}/entities/:entityId/image`,

    /**
     * Serves the picture an image entity shows now.
     *
     * @param request - Which entity, and who is asking.
     * @param reply - Where the picture goes.
     * @returns The picture, or nothing for one the browser already has.
     */
    async (request: FastifyRequest, reply: FastifyReply): Promise<Buffer | undefined> => {
      const identity = requireIdentity(request);
      const { entityId } = imageParamsSchema.parse(request.params);

      if (!(await readableEntityIds(context.db, identity)).has(entityId)) {
        throw new NotFoundError('No entity has that id', { details: { entityId } });
      }

      if (context.bus === undefined) {
        throw new DeviceUnavailableError('The hub cannot be reached', { details: { entityId } });
      }

      const picture = await context.bus.request(
        busSubjects.service(HUB_SERVICE, HUB_ENTITY_IMAGE_METHOD),
        { entityId },
        entityImageReplySchema,
        { timeoutMs: IMAGE_TIMEOUT_MS },
      );
      const etag = `"${picture.revision}"`;

      void reply
        .type(picture.contentType)
        .header('etag', etag)
        .header('cache-control', 'private, no-cache')
        // An SVG drawn by an integration is shown, never run: no script in it, no page around it.
        .header(
          'content-security-policy',
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        )
        .header('x-content-type-options', 'nosniff');

      if (request.headers['if-none-match'] === etag) {
        void reply.status(304);

        return undefined;
      }

      return Buffer.from(picture.data, 'base64');
    },
  );
}
