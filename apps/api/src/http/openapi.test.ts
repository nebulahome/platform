/**
 * The generated contract.
 *
 * These assertions are what stop the document drifting from the routes: it is built from the
 * registry the server registered its handlers from, so a route that exists appears, one that
 * does not cannot, and the direction each schema is converted in is fixed here rather than
 * discovered by a client that generated the wrong types from it.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildOpenApiDocument } from './openapi.js';
import { RouteRegistry } from './route.js';

/**
 * A registry holding one of each interesting kind of route.
 *
 * @returns The registry.
 */
function registryWithRoutes(): RouteRegistry {
  const registry = new RouteRegistry();

  registry.add('/api/v1', {
    method: 'GET',
    url: '/entities/:entityId',
    summary: 'Read one entity',
    tag: 'Entities',
    permission: 'entity:read',
    isPublic: false,
    successStatus: 200,
    params: z.object({ entityId: z.string() }),
    response: z.object({ entityId: z.string(), name: z.string() }),
  });

  registry.add('/api/v1', {
    method: 'POST',
    url: '/auth/login',
    summary: 'Sign in',
    tag: 'Authentication',
    permission: null,
    isPublic: true,
    successStatus: 200,
    body: z.object({ username: z.string(), password: z.string() }),
  });

  registry.add('/api/v1', {
    method: 'GET',
    url: '/entities',
    summary: 'List entities',
    tag: 'Entities',
    permission: 'entity:read',
    isPublic: false,
    successStatus: 200,
    query: z.object({ area: z.string().optional(), limit: z.coerce.number().default(50) }),
  });

  return registry;
}

describe('buildOpenApiDocument', () => {
  it('declares the version of the specification it follows', () => {
    expect(buildOpenApiDocument(registryWithRoutes(), 'v1')['openapi']).toBe('3.1.0');
  });

  it('writes path parameters the way OpenAPI does, not the way Fastify does', () => {
    const paths = buildOpenApiDocument(registryWithRoutes(), 'v1')['paths'] as Record<
      string,
      unknown
    >;

    expect(Object.keys(paths)).toContain('/api/v1/entities/{entityId}');
    expect(Object.keys(paths).some((path) => path.includes(':'))).toBe(false);
  });

  it('marks a protected route as needing a bearer credential', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;

    expect(paths['/api/v1/entities/{entityId}']?.['get']?.['security']).toEqual([
      { bearerAuth: [] },
    ]);
  });

  it('leaves a public route without one', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;

    expect(paths['/api/v1/auth/login']?.['post']?.['security']).toBeUndefined();
  });

  it('publishes the permission each operation needs', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;

    expect(paths['/api/v1/entities/{entityId}']?.['get']?.['x-nebula-permission']).toBe(
      'entity:read',
    );
  });

  it('turns each query field into its own parameter', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const parameters = paths['/api/v1/entities']?.['get']?.['parameters'] as {
      name: string;
      in: string;
      required: boolean;
    }[];

    expect(parameters.map((parameter) => parameter.name).sort()).toEqual(['area', 'limit']);
    expect(parameters.every((parameter) => parameter.in === 'query')).toBe(true);
  });

  it('says a field with a default is optional on the way in', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const parameters = paths['/api/v1/entities']?.['get']?.['parameters'] as {
      name: string;
      required: boolean;
    }[];

    expect(parameters.find((parameter) => parameter.name === 'limit')?.required).toBe(false);
  });

  it('documents the error envelope on every operation', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/api/v1/entities/{entityId}']?.['get']?.['responses'] as Record<
      string,
      unknown
    >;

    expect(Object.keys(responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '429',
      '500',
    ]);
  });

  it('omits 401 from a route that needs no credential', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/api/v1/auth/login']?.['post']?.['responses'] as Record<
      string,
      unknown
    >;

    expect(Object.keys(responses)).not.toContain('401');
  });

  it('describes a request body from the declared schema', () => {
    const document = buildOpenApiDocument(registryWithRoutes(), 'v1');
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    const body = paths['/api/v1/auth/login']?.['post']?.['requestBody'] as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
    };

    expect(Object.keys(body.content['application/json'].schema.properties).sort()).toEqual([
      'password',
      'username',
    ]);
  });

  it('contains only the routes the registry holds', () => {
    const document = buildOpenApiDocument(new RouteRegistry(), 'v1');

    expect(document['paths']).toEqual({});
  });
});
