import { describe, expect, it } from 'vitest';

import { evaluateAliasExpression, scanAliasExpression } from './alias-expression.js';

/**
 * Evaluates with the given bindings.
 *
 * @param expression - The formula.
 * @param entries - Variable bindings.
 * @returns The evaluation result.
 */
function evaluate(
  expression: string,
  entries: readonly (readonly [string, number | boolean | string])[] = [],
) {
  return evaluateAliasExpression(expression, new Map(entries));
}

describe('evaluateAliasExpression', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(
      evaluate('(t1 + t2 + t3) / 3', [
        ['t1', 21],
        ['t2', 22],
        ['t3', 23],
      ]),
    ).toEqual({ ok: true, value: 22 });
  });

  it('evaluates comparisons, logic and ternary', () => {
    expect(evaluate('a > 35', [['a', 40]])).toEqual({ ok: true, value: true });
    expect(evaluate('m == 0 ? 0 : m', [['m', 0]])).toEqual({ ok: true, value: 0 });
    expect(evaluate('true && false || true')).toEqual({ ok: true, value: true });
  });

  it('reads only declared bindings', () => {
    expect(evaluate('t1 + missing', [['t1', 1]])).toEqual({
      ok: false,
      error: 'Unknown variable missing',
    });
  });

  it('rejects property and index access by refusing the tokens', () => {
    expect(evaluate('t1.value', [['t1', 1]]).ok).toBe(false);
    expect(evaluate('t1[0]', [['t1', 1]]).ok).toBe(false);
  });

  it('rejects NaN and Infinity results', () => {
    expect(evaluate('1 / 0')).toEqual({ ok: false, error: 'Division by zero' });
  });

  it('truncates long text results to 512 characters', () => {
    const result = evaluate('a + b', [
      ['a', 'x'.repeat(400)],
      ['b', 'y'.repeat(200)],
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(typeof result.value).toBe('string');
      expect((result.value as string).length).toBe(512);
    }
  });

  it('rejects expressions longer than 2000 characters', () => {
    expect(evaluate(`1 + ${'1+'.repeat(1_100)}1`).ok).toBe(false);
  });

  it('never uses Function or eval', () => {
    // The module is a recursive-descent evaluator; this guard keeps a regression from landing a
    // new Function call that would bypass the sandbox.
    expect(evaluate('true').ok).toBe(true);
    expect(String(evaluateAliasExpression)).not.toMatch(/new Function|[^a-z]eval\s*\(/);
  });
});

describe('scanAliasExpression', () => {
  it('cuts a formula into spans that cover it exactly', () => {
    const source = '(t1 + t2) / 2 >= 20.5 && label == "on"';
    const spans = scanAliasExpression(source);

    expect(spans.map((span) => source.slice(span.start, span.end)).join('')).toBe(source);
    expect(
      spans
        .filter((span) => span.kind !== 'space')
        .map((span) => [source.slice(span.start, span.end), span.kind]),
    ).toEqual([
      ['(', 'op'],
      ['t1', 'ident'],
      ['+', 'op'],
      ['t2', 'ident'],
      [')', 'op'],
      ['/', 'op'],
      ['2', 'number'],
      ['>=', 'op'],
      ['20.5', 'number'],
      ['&&', 'op'],
      ['label', 'ident'],
      ['==', 'op'],
      ['"on"', 'string'],
    ]);
  });

  it('marks what the tokeniser would refuse rather than giving up', () => {
    expect(scanAliasExpression('t1 # 2').map((span) => span.kind)).toEqual([
      'ident',
      'space',
      'invalid',
      'space',
      'number',
    ]);
    expect(scanAliasExpression("'open").map((span) => span.kind)).toEqual(['invalid']);
    expect(scanAliasExpression('true').map((span) => span.kind)).toEqual(['boolean']);
  });
});
