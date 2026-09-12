/**
 * The only expression a declarative bundle has: a path into a payload.
 *
 * Not a language. A path names where a value is, and nothing else - no conditionals, no
 * function calls, no arithmetic. That restriction is the whole reason the declarative tier can
 * stay small: the moment a profile can compute, it is a program written in JSON, with worse
 * syntax than the language it replaced and no stack trace when a device reports one channel
 * fewer at eleven at night.
 *
 * Enforced as an **allowlist grammar** rather than a blocklist of operators. A blocklist would
 * be one operator behind whichever expression engine evaluates these, forever.
 *
 * Anything a path cannot express is a code bundle. That is not a gap; it is the line.
 */
import { z } from 'zod';

/**
 * A path: names, quoted keys and array indexes, joined by dots.
 *
 * Quoted keys are not a convenience - real payloads need them. Shelly reports its channels
 * under `switch:0`, which is not an identifier in any language.
 */
export const PATH_PATTERN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*|'[^']+')(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|'[^']+')|\[[0-9]+\])*$/;

/** Validates a path into a payload. */
export const pathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(PATH_PATTERN, 'Must be a payload path: names, quoted keys and indexes only');

/** A path into a payload. */
export type Path = z.output<typeof pathSchema>;
