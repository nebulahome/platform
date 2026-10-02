/**
 * Checking a value with whatever schema a package gave: a Standard Schema, or a `safeParse`.
 */
import type { Schema, SchemaIssue } from '../schema.js';

/** What a check found. */
export type Checked<TOutput> =
  | { readonly isValid: true; readonly value: TOutput }
  | { readonly isValid: false; readonly message: string };

/**
 * One line for the problems a schema found.
 *
 * @param issues - The problems.
 * @returns What they say, joined.
 */
function messageOf(issues: readonly SchemaIssue[]): string {
  return issues.map((issue) => issue.message).join('; ');
}

/**
 * Checks a value.
 *
 * @param schema - The schema.
 * @param value - The value.
 * @returns The value it gave back, or what is wrong.
 */
export async function check<TOutput>(
  schema: Schema<TOutput>,
  value: unknown,
): Promise<Checked<TOutput>> {
  if ('~standard' in schema) {
    const result = await schema['~standard'].validate(value);

    return result.issues === undefined
      ? { isValid: true, value: result.value }
      : { isValid: false, message: messageOf(result.issues) };
  }

  const result = schema.safeParse(value);

  return result.success
    ? { isValid: true, value: result.data }
    : { isValid: false, message: String(result.error) };
}
