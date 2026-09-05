/**
 * Reading a user agent string.
 *
 * Every case here is a compatibility lie that a naive check would fall for. Edge says it is
 * Chrome and Safari; Chrome says it is Safari; Firefox on iOS says it is Safari too, because
 * every iOS browser is; and Android says it is Linux. The order of the checks is the whole
 * implementation, so the order is what these cases pin.
 */
import { describe, expect, it } from 'vitest';

import { describeUserAgent } from '@/settings/user-agent';

describe('describeUserAgent', () => {
  it.each([
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    ],
    [
      'Firefox on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ],
    [
      'Firefox on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    ],
    [
      'Samsung Internet on Android',
      'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    ],
  ])('reads %s', (expected, userAgent) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it('says so plainly when the client sent nothing', () => {
    expect(describeUserAgent(null)).toBe('Unrecognised client');
    expect(describeUserAgent('   ')).toBe('Unrecognised client');
  });

  it('keeps the half it does recognise', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('shows a client it cannot read as itself rather than guessing', () => {
    // A script signing in with curl is neither a browser nor a desktop, and calling it either
    // would be worse than showing what it actually said.
    expect(describeUserAgent('curl/8.9.1')).toBe('curl/8.9.1');
  });
});
