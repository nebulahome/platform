/**
 * The redirect destination.
 *
 * Every case here is an open redirect that would otherwise work. The destination arrives in a
 * query string, which makes it caller input, and the moment it is used is the moment straight
 * after somebody has typed a password - which is exactly when they are least likely to notice
 * that the page they landed on is not on this host.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_DESTINATION, safeReturnTo } from '@/routes/return-to';

describe('safeReturnTo', () => {
  it.each(['/devices', '/dashboards', '/settings?tab=account', '/a/b/c'])(
    'keeps the path %j',
    (path) => {
      expect(safeReturnTo(path)).toBe(path);
    },
  );

  it.each([
    ['nothing at all', null],
    ['an empty string', ''],
    ['another origin', 'https://example.invalid/pay'],
    ['a protocol-relative url', '//example.invalid/pay'],
    ['a backslash-relative url', '/\\example.invalid/pay'],
    ['a backslash anywhere', '/devices\\..\\..\\evil'],
    ['a scheme', 'javascript:alert(1)'],
    ['a bare word', 'devices'],
  ])('refuses %s', (description, candidate) => {
    expect(safeReturnTo(candidate), description).toBe(DEFAULT_DESTINATION);
  });

  it('does not try to repair a bad destination', () => {
    // Rejecting outright rather than sanitising: a repaired destination is a guess at what an
    // attacker meant, and the cost of getting it wrong is much larger than landing on the
    // dashboard.
    expect(safeReturnTo('//example.invalid/devices')).toBe(DEFAULT_DESTINATION);
  });
});
