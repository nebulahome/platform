/**
 * The image route against a hub that holds one picture, and a registry that knows its entity.
 *
 * What is asserted is who may read the picture, that it is served as the integration drew it and
 * with the headers that keep it inert, and that a browser holding it already is told so.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Entities from '../services/entities.js';
import {
  bearer,
  buildTestServer,
  emptyDatabase,
  HALL_MAP_SVG,
  scopedBearer,
  stopHub,
} from '../testing/hub-harness.js';

// The one entity is looked up by itself, as the entity route does, rather than out of all of them.
vi.mock('../services/entities.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Entities>()),
  findEntity: vi.fn((db: unknown, entityId: string) =>
    Promise.resolve(
      entityId === 'image.hall_map' || entityId === 'image.garden_map'
        ? { view: {}, scopes: [`entity.${entityId}`], rowId: 'row-map' }
        : undefined,
    ),
  ),
}));

let server: FastifyInstance | undefined;

afterEach(async () => {
  stopHub();
  await server?.close();
  server = undefined;
});

/**
 * A server whose registry lists the maps.
 *
 * @returns The server.
 */
async function serving(): Promise<FastifyInstance> {
  server = await buildTestServer(true, emptyDatabase());

  return server;
}

describe('an image entity’s picture', () => {
  it('is served as it was drawn, inert, with its revision as the ETag', async () => {
    const response = await (
      await serving()
    ).inject({
      method: 'GET',
      url: '/api/v1/entities/image.hall_map/image',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(HALL_MAP_SVG);
    expect(response.headers).toMatchObject({
      'content-type': 'image/svg+xml',
      etag: '"a1b2c3d4"',
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
    });
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('tells a browser that holds that revision already so', async () => {
    const response = await (
      await serving()
    ).inject({
      method: 'GET',
      url: '/api/v1/entities/image.hall_map/image',
      headers: { authorization: await bearer('entity:read'), 'if-none-match': '"a1b2c3d4"' },
    });

    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
  });

  it('is not found for somebody who may not read the entity, nor for one never drawn', async () => {
    const app = await serving();
    const hidden = await app.inject({
      method: 'GET',
      url: '/api/v1/entities/image.hall_map/image',
      headers: { authorization: await bearer('device:read') },
    });
    const elsewhere = await app.inject({
      method: 'GET',
      url: '/api/v1/entities/image.hall_map/image',
      headers: {
        authorization: await scopedBearer({ key: 'entity:read', scope: 'entity.image.garden_map' }),
      },
    });
    const blank = await app.inject({
      method: 'GET',
      url: '/api/v1/entities/image.garden_map/image',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(hidden.statusCode).toBe(404);
    expect(elsewhere.statusCode).toBe(404);
    expect(blank.statusCode).toBe(404);
  });
});
