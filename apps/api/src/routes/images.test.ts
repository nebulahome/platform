/**
 * The image route against a hub that holds one picture, and a database that lists its entity.
 *
 * What is asserted is who may read the picture, that it is served as the integration drew it and
 * with the headers that keep it inert, and that a browser holding it already is told so.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  bearer,
  buildTestServer,
  databaseAnswering,
  HALL_MAP_SVG,
  stopHub,
} from '../testing/hub-harness.js';

/** The map's entity, as the registry lists it. */
const MAP_ROW = { rowId: 'row-map', entityId: 'image.hall_map', deviceId: null, areaKey: null };

let server: FastifyInstance | undefined;

afterEach(async () => {
  stopHub();
  await server?.close();
  server = undefined;
});

/**
 * A server whose registry lists the map.
 *
 * @returns The server.
 */
async function serving(): Promise<FastifyInstance> {
  server = await buildTestServer(true, databaseAnswering([MAP_ROW]));

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

    expect(hidden.statusCode).toBe(404);

    stopHub();
    await app.close();

    const listed = await buildTestServer(
      true,
      databaseAnswering([{ ...MAP_ROW, entityId: 'image.garden_map' }]),
    );

    server = listed;

    const blank = await listed.inject({
      method: 'GET',
      url: '/api/v1/entities/image.garden_map/image',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(blank.statusCode).toBe(404);
  });
});
