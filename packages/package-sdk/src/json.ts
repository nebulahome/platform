/**
 * JSON, as the platform passes it between a package and everything else: settings, attributes,
 * the input and output of a method.
 */

/** A JSON scalar. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON value. */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

/** A JSON object. */
export type JsonObject = { readonly [key: string]: JsonValue };
