/**
 * What a password has to satisfy.
 *
 * The last case is the one that earns its keep: it reads the bounds back off the contract's own
 * schema, so the numbers shown to somebody typing cannot drift away from the numbers the server
 * enforces. Zod does not expose a `min` as a value, which is why they are written twice; this is
 * what stops the second copy going quietly wrong.
 */
import { describe, expect, it } from 'vitest';

import { createUserRequestSchema } from '@nebulahome/contracts';

import {
  PASSWORD_MAXIMUM_LENGTH,
  PASSWORD_MINIMUM_LENGTH,
  isPasswordAcceptable,
  passwordRules,
} from '@/lib/password-rules';

describe('passwordRules', () => {
  it('reports the length rule as unmet while it is', () => {
    const [length] = passwordRules('short');

    expect(length?.isMet).toBe(false);
    expect(length?.label).toContain('12');
  });

  it('reports it as met the moment it is', () => {
    expect(passwordRules('a'.repeat(PASSWORD_MINIMUM_LENGTH))[0]?.isMet).toBe(true);
  });

  it('keeps the lower bound on screen once it is satisfied', () => {
    // It is the thing being worked towards, so watching it turn green is the point.
    expect(passwordRules('a'.repeat(20))[0]?.isShownWhenMet).toBe(true);
  });

  it('hides the upper bound until it is broken', () => {
    // A limit nobody reaches is noise on every form it appears on.
    const upper = passwordRules('a'.repeat(20))[1];

    expect(upper?.isMet).toBe(true);
    expect(upper?.isShownWhenMet).toBe(false);
  });

  it('reports the upper bound as broken when it is', () => {
    expect(passwordRules('a'.repeat(PASSWORD_MAXIMUM_LENGTH + 1))[1]?.isMet).toBe(false);
  });
});

describe('isPasswordAcceptable', () => {
  it.each([
    ['', false],
    ['eleven-chrs', false],
    ['twelve-chars', true],
    ['a much longer passphrase than strictly needed', true],
  ])('reads %j as %s', (password, expected) => {
    expect(isPasswordAcceptable(password)).toBe(expected);
  });

  it('refuses a password past the upper bound', () => {
    expect(isPasswordAcceptable('a'.repeat(PASSWORD_MAXIMUM_LENGTH + 1))).toBe(false);
  });
});

describe('the bounds shown and the bounds enforced', () => {
  it.each([
    ['refuses one character short', PASSWORD_MINIMUM_LENGTH - 1, false],
    ['accepts exactly the minimum', PASSWORD_MINIMUM_LENGTH, true],
    ['accepts exactly the maximum', PASSWORD_MAXIMUM_LENGTH, true],
    ['refuses one character over', PASSWORD_MAXIMUM_LENGTH + 1, false],
  ])('%s, and so does the API schema', (description, length, expected) => {
    const password = 'a'.repeat(length);
    const parsed = createUserRequestSchema.safeParse({
      username: 'someone',
      displayName: 'Someone',
      password,
      role: 'member',
    });

    expect(isPasswordAcceptable(password), description).toBe(expected);
    expect(parsed.success, description).toBe(expected);
  });
});
