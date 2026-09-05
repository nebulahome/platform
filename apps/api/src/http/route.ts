/**
 * Declaring a route once, so that validation, authorisation and the published contract cannot
 * disagree with each other.
 *
 * RULES.md 14 says the OpenAPI document is generated and never hand-written. That only holds if
 * there is one declaration to generate it from, which is what this file is: a route names its
 * schemas and its required permission, and the same object becomes the Fastify handler, the
 * validation, the permission check and the OpenAPI operation.
 *
 * Validation happens here rather than through Fastify's own JSON Schema pipeline because the
 * schemas are Zod (RULES.md 3): parsing gives the handler a typed, defaulted, transformed value
 * instead of the raw body, and there is exactly one definition rather than one for validating
 * and another for documenting.
 */
import type { Identity } from '@nebula-home/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { requireIdentity } from './guard.js';

/** The HTTP methods routes are declared with. */
export const ROUTE_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

/** One of the HTTP methods routes are declared with. */
export type RouteMethod = (typeof ROUTE_METHODS)[number];

/** What a handler is given. */
export type RouteContext<TBody, TQuery, TParams> = {
  /** The parsed body. `undefined` when the route declares none. */
  readonly body: TBody;

  /** The parsed query string. */
  readonly query: TQuery;

  /** The parsed path parameters. */
  readonly params: TParams;

  /** Who is asking. Absent only on routes declared public. */
  readonly identity: Identity;

  /** The raw request, for headers and the trace id. */
  readonly request: FastifyRequest;

  /** The reply, for setting a status or a header. */
  readonly reply: FastifyReply;
};

/** The same, for a route that does not require a credential. */
export type PublicRouteContext<TBody, TQuery, TParams> = Omit<
  RouteContext<TBody, TQuery, TParams>,
  'identity'
>;

/** What a route declares about itself. */
export type RouteDefinition = {
  /** The method. */
  readonly method: RouteMethod;

  /** The path, relative to the version prefix, in Fastify's `:param` form. */
  readonly url: string;

  /** One line for the OpenAPI operation. */
  readonly summary: string;

  /** Which group it belongs to in the published document. */
  readonly tag: string;

  /** The permission it requires, or null when it needs only a valid credential. */
  readonly permission: string | null;

  /** Whether it can be called without one at all. */
  readonly isPublic: boolean;

  /** The status a success returns. */
  readonly successStatus: number;

  /** What the body must satisfy. */
  readonly body?: z.ZodType;

  /** What the query string must satisfy. */
  readonly query?: z.ZodType;

  /** What the path parameters must satisfy. */
  readonly params?: z.ZodType;

  /** What a success returns. */
  readonly response?: z.ZodType;
};

/**
 * Everything the server serves, in declaration order.
 *
 * Collected so the OpenAPI document is a projection of the routes that actually exist, rather
 * than a second list that has to be kept in step with them.
 */
export class RouteRegistry {
  /** The declarations, in the order they were registered. */
  readonly #routes: (RouteDefinition & { readonly basePath: string })[] = [];

  /**
   * Records one route.
   *
   * @param basePath - The version prefix it is mounted under.
   * @param definition - What it declares.
   */
  public add(basePath: string, definition: RouteDefinition): void {
    this.#routes.push({ ...definition, basePath });
  }

  /**
   * Every route, in declaration order.
   *
   * @returns The declarations, for the OpenAPI generator.
   */
  public get routes(): readonly (RouteDefinition & { readonly basePath: string })[] {
    return this.#routes;
  }
}

/** What both route builders need from the surrounding server. */
export type RouteEnvironment = {
  /** The instance to register on. */
  readonly server: FastifyInstance;

  /** Where the OpenAPI document is assembled. */
  readonly registry: RouteRegistry;

  /** The version prefix routes are mounted under. */
  readonly basePath: string;
};

/** A route with schemas, before its handler is bound. */
type Shapes = {
  readonly body?: z.ZodType;
  readonly query?: z.ZodType;
  readonly params?: z.ZodType;
  readonly response?: z.ZodType;
};

/**
 * Parses one part of a request, or hands back undefined when the route declares no schema.
 *
 * @param schema - What it must satisfy.
 * @param value - What arrived.
 * @returns The parsed value.
 * @throws {z.ZodError} When it does not satisfy the schema. Converted to the error envelope by
 * the error handler, which is the only place that knows about HTTP.
 */
function parsePart<TSchema extends z.ZodType>(
  schema: TSchema | undefined,
  value: unknown,
): z.output<TSchema> | undefined {
  return schema === undefined ? undefined : schema.parse(value);
}

/**
 * Declares a route that requires a credential.
 *
 * @param environment - The server, the registry and the prefix.
 * @param definition - What the route declares, minus the parts the builder fills in.
 * @param handler - What it does.
 */
export function defineRoute<TShapes extends Shapes>(
  environment: RouteEnvironment,
  definition: Omit<RouteDefinition, 'isPublic' | 'successStatus'> &
    TShapes & { readonly successStatus?: number },
  handler: (
    context: RouteContext<
      TShapes['body'] extends z.ZodType ? z.output<TShapes['body']> : undefined,
      TShapes['query'] extends z.ZodType ? z.output<TShapes['query']> : undefined,
      TShapes['params'] extends z.ZodType ? z.output<TShapes['params']> : undefined
    >,
  ) => Promise<unknown>,
): void {
  const successStatus = definition.successStatus ?? (definition.method === 'POST' ? 201 : 200);

  environment.registry.add(environment.basePath, { ...definition, isPublic: false, successStatus });

  environment.server.route({
    method: definition.method,
    url: `${environment.basePath}${definition.url}`,

    /**
     * Validates, authorises and runs the route.
     *
     * @param request - The incoming request.
     * @param reply - The reply being built.
     * @returns Whatever the handler produced.
     */
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const identity = requireIdentity(request);

      // The values are typed by the schemas this route declared, but the compiler cannot follow
      // that through `parsePart`'s conditional return type, so an annotation is rejected where
      // the assertion is accepted. The declaration is what makes the assertion true.
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- see above */
      const context = {
        body: parsePart(definition.body, request.body),
        query: parsePart(definition.query, request.query),
        params: parsePart(definition.params, request.params),
        identity,
        request,
        reply,
      } as RouteContext<
        TShapes['body'] extends z.ZodType ? z.output<TShapes['body']> : undefined,
        TShapes['query'] extends z.ZodType ? z.output<TShapes['query']> : undefined,
        TShapes['params'] extends z.ZodType ? z.output<TShapes['params']> : undefined
      >;

      const result = await handler(context);

      // A handler that already set a status keeps it: `202 Accepted` and `204 No Content` are
      // decided by what happened, not by the shape of the route.
      if (!reply.sent && reply.statusCode === 200 && successStatus !== 200) {
        void reply.status(successStatus);
      }

      return result;
    },
  });
}

/**
 * Declares a route that anyone may call.
 *
 * Separate from {@link defineRoute} rather than a flag on it, so that a public route's context
 * simply has no `identity` field to read - a route cannot forget to check for one it does not
 * have.
 *
 * @param environment - The server, the registry and the prefix.
 * @param definition - What the route declares.
 * @param handler - What it does.
 */
export function definePublicRoute<TShapes extends Shapes>(
  environment: RouteEnvironment,
  definition: Omit<RouteDefinition, 'isPublic' | 'permission' | 'successStatus'> &
    TShapes & { readonly successStatus?: number },
  handler: (
    context: PublicRouteContext<
      TShapes['body'] extends z.ZodType ? z.output<TShapes['body']> : undefined,
      TShapes['query'] extends z.ZodType ? z.output<TShapes['query']> : undefined,
      TShapes['params'] extends z.ZodType ? z.output<TShapes['params']> : undefined
    >,
  ) => Promise<unknown>,
): void {
  const successStatus = definition.successStatus ?? (definition.method === 'POST' ? 200 : 200);

  environment.registry.add(environment.basePath, {
    ...definition,
    permission: null,
    isPublic: true,
    successStatus,
  });

  environment.server.route({
    method: definition.method,
    url: `${environment.basePath}${definition.url}`,

    /**
     * Validates and runs the route.
     *
     * @param request - The incoming request.
     * @param reply - The reply being built.
     * @returns Whatever the handler produced.
     */
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- as above */
      const context = {
        body: parsePart(definition.body, request.body),
        query: parsePart(definition.query, request.query),
        params: parsePart(definition.params, request.params),
        request,
        reply,
      } as PublicRouteContext<
        TShapes['body'] extends z.ZodType ? z.output<TShapes['body']> : undefined,
        TShapes['query'] extends z.ZodType ? z.output<TShapes['query']> : undefined,
        TShapes['params'] extends z.ZodType ? z.output<TShapes['params']> : undefined
      >;

      const result = await handler(context);

      if (!reply.sent && reply.statusCode === 200 && successStatus !== 200) {
        void reply.status(successStatus);
      }

      return result;
    },
  });
}
