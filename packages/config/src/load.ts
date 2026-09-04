/**
 * Startup-time loading and validation of environment configuration.
 *
 * This is the only module in the platform allowed to read `process.env`; everywhere else
 * configuration arrives as an already-validated typed value (RULES.md 11). A service that
 * cannot be configured correctly must not start at all, so both entry points here fail loudly
 * rather than returning a partial object.
 */
import { ConfigurationError, EXIT_CODES } from '@nebula-home/contracts';
import type { z, ZodType } from 'zod';

/** A source of environment variables. `process.env` in production, a literal in tests. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/** One rejected variable, as reported in `ConfigurationError.details`. */
export type ConfigurationIssue = {
  /** Name of the offending environment variable. */
  readonly variable: string;

  /** Why it was rejected, in English. */
  readonly message: string;
};

/**
 * Validates a source of environment variables against a schema.
 *
 * @param schema - The service's environment schema, composed from `env-schemas.js`.
 * @param source - Where to read variables from. Defaults to the real process environment.
 * @returns The parsed configuration, with defaults applied and values coerced to their types.
 * @throws {ConfigurationError} When one or more variables are missing or invalid. Every problem
 * is reported at once, in `details.issues`, so that a misconfigured deployment is fixed in one
 * pass instead of one restart per variable.
 */
export function loadConfig<TSchema extends ZodType>(
  schema: TSchema,
  source: EnvironmentSource = process.env,
): z.output<TSchema> {
  const result = schema.safeParse(source);

  if (result.success) {
    return result.data;
  }

  const issues: ConfigurationIssue[] = result.error.issues.map((issue) => ({
    variable: issue.path.length > 0 ? issue.path.join('.') : '(environment)',
    message: issue.message,
  }));

  const names = issues.map((issue) => issue.variable).join(', ');

  throw new ConfigurationError(`Invalid environment configuration: ${names}`, {
    details: { issues },
  });
}

/**
 * Loads configuration, or ends the process with a readable explanation.
 *
 * Intended for a service's `main.ts`, where there is no caller left to handle the failure.
 * The report goes to stderr rather than through `@nebula-home/logging`, because the logger is
 * itself configured from these variables and does not exist yet at this point.
 *
 * Only variable names and validation messages are printed. **Values are never echoed**, since
 * the environment holds secrets and a startup failure is exactly when someone screenshots the
 * terminal (RULES.md 10.1).
 *
 * @param schema - The service's environment schema, composed from `env-schemas.js`.
 * @param source - Where to read variables from. Defaults to the real process environment.
 * @returns The parsed configuration when it is valid. Otherwise the process exits and never returns.
 * @throws {Error} Rethrows unchanged anything that is not a configuration failure: an error from
 * inside a schema refinement is a defect in the schema, not a misconfigured deployment, and
 * hiding it behind exit code 78 would send whoever debugs it to the wrong place.
 */
export function loadConfigOrExit<TSchema extends ZodType>(
  schema: TSchema,
  source: EnvironmentSource = process.env,
): z.output<TSchema> {
  try {
    return loadConfig(schema, source);
  } catch (error: unknown) {
    if (!(error instanceof ConfigurationError)) {
      throw error;
    }

    const issues = (error.details['issues'] ?? []) as readonly ConfigurationIssue[];
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);

    process.stderr.write(
      ['Cannot start: the environment configuration is not valid.', ...lines, ''].join('\n'),
    );

    return process.exit(EXIT_CODES.INVALID_CONFIGURATION);
  }
}
