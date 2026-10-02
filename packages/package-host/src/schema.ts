/**
 * Checking a value with whatever schema a package gave: a Standard Schema, or a `safeParse`.
 */
import type { Schema } from '@nebulahome/package-sdk/server';

/** What a check found. */
export type Checked<TOutput> =
  | { readonly isValid: true; readonly value: TOutput }
  | { readonly isValid: false; readonly message: string };

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
      : { isValid: false, message: result.issues.map((issue) => issue.message).join('; ') };
  }

  const result = schema.safeParse(value);

  return result.success
    ? { isValid: true, value: result.data }
    : { isValid: false, message: String(result.error) };
}
