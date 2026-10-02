/**
 * Generating the OpenAPI 3.1 document from the routes that exist.
 *
 * RULES.md 14: the document is generated and never hand-written, so that the published contract
 * cannot drift from the implementation. It is generated from {@link RouteRegistry}, which is the
 * same object the server registered its handlers from - there is no second list to forget to
 * update.
 *
 * Schemas are converted with Zod's own JSON Schema emitter. Request bodies are converted in
 * `input` mode and responses in `output` mode, which is not a detail: a field with a default is
 * optional going in and guaranteed coming out, and a document that says otherwise in either
 * direction is wrong for every client that generates code from it.
 */
import { z } from 'zod';

import { API_VERSIONS, apiErrorSchema, type ApiVersion } from '@nebulahome/contracts';

import type { RouteDefinition, RouteRegistry } from './route.js';

/** The JSON Schema dialect OpenAPI 3.1 uses. */
const JSON_SCHEMA_TARGET = 'draft-2020-12';

/** A JSON Schema fragment, as the emitter produces it. */
type JsonSchema = Record<string, unknown>;

/**
 * Converts one Zod schema.
 *
 * @param schema - What to convert.
 * @param io - Whether this is what a client sends or what it receives.
 * @returns The JSON Schema fragment.
 */
function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  return z.toJSONSchema(schema, {
    target: JSON_SCHEMA_TARGET,
    io,

    // A schema the emitter cannot express - a transform, a branded refinement - becomes a
    // permissive `{}` rather than throwing. The alternative is a build that fails because one
    // endpoint documents a value JSON Schema has no word for, which would be a poor reason to
    // publish nothing at all.
    unrepresentable: 'any',
  });
}

/**
 * Turns a Fastify path into an OpenAPI one.
 *
 * @param url - The path in `:param` form.
 * @returns The path in `{param}` form.
 */
function toOpenApiPath(url: string): string {
  return url.replaceAll(/:(?<name>[A-Za-z0-9_]+)/g, '{$<name>}');
}

/**
 * Reads the parameter names out of a path.
 *
 * @param url - The path in `:param` form.
 * @returns Each parameter name, in order.
 */
function pathParameterNames(url: string): string[] {
  return [...url.matchAll(/:(?<name>[A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '');
}

/**
 * Builds the `parameters` array for one operation.
 *
 * @param route - The route being documented.
 * @returns Path and query parameters, each with its own schema.
 */
function buildParameters(route: RouteDefinition): unknown[] {
  const parameters: unknown[] = [];
  const pathSchema = route.params === undefined ? undefined : toJsonSchema(route.params, 'input');
  const pathProperties = (pathSchema?.['properties'] ?? {}) as Record<string, JsonSchema>;

  for (const name of pathParameterNames(route.url)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: pathProperties[name] ?? { type: 'string' },
    });
  }

  if (route.query !== undefined) {
    const querySchema = toJsonSchema(route.query, 'input');
    const properties = (querySchema['properties'] ?? {}) as Record<string, JsonSchema>;
    const required = (querySchema['required'] ?? []) as string[];

    for (const [name, schema] of Object.entries(properties)) {
      parameters.push({
        name,
        in: 'query',
        required: required.includes(name),
        schema,
      });
    }
  }

  return parameters;
}

/**
 * Builds the responses for one operation.
 *
 * Every operation documents the error envelope for the statuses it can actually produce, because
 * a document that only describes the happy path is a document that leaves every client to guess
 * what a failure looks like.
 *
 * @param route - The route being documented.
 * @returns The `responses` object.
 */
function buildResponses(route: RouteDefinition): Record<string, unknown> {
  const errorContent = {
    description: 'The request failed',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
  };

  const responses: Record<string, unknown> = {
    [String(route.successStatus)]:
      route.response === undefined
        ? { description: 'Success' }
        : {
            description: 'Success',
            content: {
              'application/json': { schema: toJsonSchema(route.response, 'output') },
            },
          },
    '400': errorContent,
    '429': errorContent,
    '500': errorContent,
  };

  if (!route.isPublic) {
    responses['401'] = errorContent;
  }

  if (route.permission !== null) {
    responses['403'] = errorContent;
  }

  if (route.url.includes(':')) {
    responses['404'] = errorContent;
  }

  return responses;
}

/**
 * Assembles the whole document.
 *
 * @param registry - Every route the server registered.
 * @param version - The build version, reported as the document's version.
 * @returns The OpenAPI 3.1 document.
 */
export function buildOpenApiDocument(
  registry: RouteRegistry,
  version: string,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of registry.routes) {
    const path = toOpenApiPath(`${route.basePath}${route.url}`);
    const operation: Record<string, unknown> = {
      summary: route.summary,
      tags: [route.tag],
      operationId: `${route.method.toLowerCase()}${path.replaceAll(/[^A-Za-z0-9]/g, '_')}`,
      parameters: buildParameters(route),
      responses: buildResponses(route),
    };

    if (route.permission !== null) {
      // Not part of the OpenAPI vocabulary, which is exactly why it is worth publishing: the
      // permission a call needs is the single most useful thing a client integrator wants to
      // know before making it, and nothing in the specification carries it.
      operation['x-nebula-permission'] = route.permission;
    }

    if (!route.isPublic) {
      operation['security'] = [{ bearerAuth: [] }];
    }

    if (route.body !== undefined) {
      operation['requestBody'] = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(route.body, 'input') } },
      };
    }

    const entry = (paths[path] ??= {});

    entry[route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'NebulaHome API',
      version,
      description:
        'The only door into a NebulaHome instance. Every endpoint is authenticated and ' +
        'authorised; see the x-nebula-permission extension on each operation for what it needs.',
    },
    servers: API_VERSIONS.map((entry: ApiVersion) => ({
      url: entry.basePath,
      description: entry.status === 'current' ? 'Current version' : 'Deprecated version',
    })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT or personal access token',
        },
      },
      schemas: {
        ApiError: toJsonSchema(apiErrorSchema, 'output'),
      },
    },
    paths,
  };
}
