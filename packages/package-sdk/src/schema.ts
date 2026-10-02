/**
 * What checks a value that crosses into a package - a method's input, a service's answer: any
 * [Standard Schema](https://standardschema.dev) - zod 4, valibot, arktype - or an object with
 * zod's `safeParse`. The SDK carries no validation library of its own.
 *
 * The Standard Schema interface is written out here, as its authors ask libraries to do, rather
 * than taken as a dependency.
 */

/** One problem a Standard Schema found. */
export type SchemaIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
};

/** What a Standard Schema's `validate` gives back. */
export type StandardResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: readonly SchemaIssue[] };

/** The Standard Schema interface, version 1. */
export type StandardSchemaV1<TInput = unknown, TOutput = TInput> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
    readonly types?: { readonly input: TInput; readonly output: TOutput } | undefined;
  };
};

/** An object that checks a value the way zod's `safeParse` does. */
export type SafeParser<TOutput> = {
  readonly safeParse: (
    value: unknown,
  ) =>
    | { readonly success: true; readonly data: TOutput }
    | { readonly success: false; readonly error: unknown };
};

/** What the SDK takes to check a value: a Standard Schema, or a `safeParse`. */
export type Schema<TOutput> = StandardSchemaV1<unknown, TOutput> | SafeParser<TOutput>;
