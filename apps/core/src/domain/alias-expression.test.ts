import { describe, expect, it } from 'vitest';

import { evaluateAliasExpression } from './alias-expression.js';

describe('alias-expression re-export', () => {
  it('evaluates through the contracts implementation', () => {
    expect(evaluateAliasExpression('1 + 2', new Map())).toEqual({ ok: true, value: 3 });
  });
});
