/**
 * The JSON value type used wherever the platform stores or transports free-form data.
 *
 * Several columns are `jsonb` and several bus payloads carry caller-defined objects. Typing
 * those as `unknown` pushes a cast onto every reader; typing them as `any` disables the rules
 * that make this codebase safe. `JsonValue` is the honest middle: it says exactly what can be
 * there, and it round-trips through `JSON.stringify` without loss.
 */
import { z } from 'zod';

/**
 * A JSON object, the shape most `jsonb` columns actually hold.
 *
 * Written as an index signature rather than `Record<string, JsonValue>` because `Record` is a
 * mapped type, which TypeScript resolves eagerly and therefore cannot use in the recursive
 * definition below (TS2456). The index signature is deferred, so it can.
 */
export type JsonObject = { [key: string]: JsonValue };

/** Any value that survives a JSON round trip unchanged. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/**
 * Validates any JSON value, to any depth.
 *
 * Recursive by construction, so the annotation is required: TypeScript cannot infer the type of
 * a schema that refers to itself.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** Validates a JSON object. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
