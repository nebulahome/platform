/**
 * Sandboxed evaluation of alias formulas.
 *
 * Re-exported from contracts so core and the API share one evaluator (RULES.md §16), and one
 * reading of what a source binds to.
 */
export {
  aliasScalarFromState,
  DEFAULT_ALIAS_EVALUATE_LIMITS,
  evaluateAliasExpression,
  type AliasEvaluateLimits,
  type AliasEvaluateResult,
  type AliasScalar,
} from '@nebulahome/contracts';
