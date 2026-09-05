/**
 * Turning a user agent string into something a person can recognise.
 *
 * The list of sessions exists to answer one question - "is that one mine?" - and a hundred
 * characters of `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …` does not answer
 * it. "Chrome on Windows" does.
 *
 * This is deliberately crude. User agent strings are a museum of compatibility lies: every
 * browser claims to be Mozilla, Chrome claims to be Safari, and Edge claims to be Chrome. The
 * order of the checks below is what handles that - the most specific claim wins, so Edge is
 * tested before Chrome and Chrome before Safari. Getting it wrong costs a mislabelled row, which
 * is why guessing is acceptable here and would not be anywhere a decision is made.
 *
 * The full string stays available in the interface, because the summary is a convenience and the
 * original is the evidence.
 */

/** Browsers, most specific claim first. */
const BROWSERS: readonly { readonly name: string; readonly marker: RegExp }[] = [
  { name: 'Edge', marker: /\bEdg(?:e|A|iOS)?\// },
  { name: 'Opera', marker: /\bOPR\/|\bOpera\b/ },
  { name: 'Samsung Internet', marker: /\bSamsungBrowser\// },
  { name: 'Firefox', marker: /\bFirefox\/|\bFxiOS\// },
  { name: 'Chrome', marker: /\bChrome\/|\bCriOS\// },
  { name: 'Safari', marker: /\bSafari\// },
];

/** Systems, most specific claim first: iPadOS says iPhone-ish things, Android says Linux ones. */
const SYSTEMS: readonly { readonly name: string; readonly marker: RegExp }[] = [
  { name: 'iPad', marker: /\biPad\b/ },
  { name: 'iPhone', marker: /\biPhone\b/ },
  { name: 'Android', marker: /\bAndroid\b/ },
  { name: 'Windows', marker: /\bWindows\b/ },
  { name: 'macOS', marker: /\bMac OS X\b|\bMacintosh\b/ },
  { name: 'Linux', marker: /\bLinux\b|\bX11\b/ },
];

/** What a session with no user agent at all is called. */
const UNKNOWN = 'Unrecognised client';

/**
 * Summarises a user agent.
 *
 * @param userAgent - What the client sent, or null when it sent nothing.
 * @returns A phrase such as `Chrome on Windows`, or the best half of one, or a fallback.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') {
    return UNKNOWN;
  }

  const browser = BROWSERS.find((entry) => entry.marker.test(userAgent))?.name;
  const system = SYSTEMS.find((entry) => entry.marker.test(userAgent))?.name;

  if (browser !== undefined && system !== undefined) {
    return `${browser} on ${system}`;
  }

  // One half is still worth more than none: a session labelled "Windows" narrows it down, and a
  // script signing in with `curl` has neither and is better shown as itself than as a guess.
  return browser ?? system ?? userAgent.slice(0, 40);
}
