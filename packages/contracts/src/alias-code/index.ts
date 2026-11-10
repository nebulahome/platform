/**
 * Code aliases: a Python subset whose top-level functions compute the parts of an alias.
 *
 * One code file per alias; each part (a thermostat's `action`, a sensor's `on`) is bound to the
 * function of its name, which takes no arguments and returns the part's value. The same
 * interpreter runs in the engine and in the editor's trials: everything outside the code comes
 * through a {@link CodeHost}.
 *
 * - {@link compile} parses a file; {@link runFunction} runs one function of it.
 * - {@link checkCode} finds problems without running, and says what the code reads and uses.
 * - {@link fitReturn} decides whether a returned value fits its part.
 * - {@link formatCode} re-indents; {@link functionTemplate} starts a function for a new part.
 * - {@link CODE_BUILTINS} and {@link LANGUAGE_NOTES} feed the docs panel.
 */
import type { Expectation } from './fit.js';

export {
  CODE_BUILTINS,
  CODE_BUILTIN_GROUPS,
  LANGUAGE_NOTES,
  type BuiltinEntry,
  type BuiltinGroup,
  type BuiltinUse,
} from './builtins.js';
export {
  checkCode,
  type CheckContext,
  type CheckedFunction,
  type CheckResult,
  type CodeReads,
  type CodeUses,
  type LiteralReturn,
  type PartBinding,
} from './checker.js';
export type { SourceSpan } from './errors.js';
export {
  MAX_MEM_BYTES,
  runFunction,
  type PrintedLine,
  type RunError,
  type RunOptions,
  type RunResult,
  type Trace,
  type TraceLine,
} from './evaluator.js';
export {
  MAX_TEXT_RETURN,
  fitReturn,
  type Expectation,
  type FitResult,
  type FittedColor,
  type FittedValue,
} from './fit.js';
export { formatCode } from './format.js';
export {
  HTTP_WRITE_INTERVAL_MS,
  HttpPolicy,
  MAX_HTTP_REQUESTS,
  MAX_HTTP_RESPONSE_BYTES,
  MAX_HTTP_TIMEOUT_SECONDS,
  MIN_HTTP_CACHE_SECONDS,
  type HttpLogEntry,
} from './http.js';
export { compile, type CodeProblem, type CodeProgram, type CompileResult } from './parser.js';
export {
  DEFAULT_RUN_LIMITS,
  type CodeHost,
  type EntityScalar,
  type HistoryKind,
  type HttpReply,
  type HttpRequest,
  type RunLimits,
} from './types.js';

/**
 * The starting source of a function for a part: a def that returns a sensible default.
 *
 * @param name - The function's name, which is the part's key.
 * @param expectation - What the part expects.
 * @returns The source, ending with a newline.
 */
export function functionTemplate(name: string, expectation: Expectation): string {
  const [first] = expectation.values ?? [];
  const defaults: Record<Expectation['kind'], string> = {
    number: '0',
    boolean: 'False',
    enum: first === undefined ? 'None' : JSON.stringify(first),
    text: '""',
    color: '(0, 0)',
  };

  return `def ${name}():\n    return ${defaults[expectation.kind]}\n`;
}
