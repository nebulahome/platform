import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  matchSupportedLocale,
  resolveDisplayLocale,
  supportedLocaleSchema,
} from './locale.js';

describe('the supported languages', () => {
  it('names every language in its own words', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_NAMES[locale]).not.toBe('');
    }
  });

  it('falls back to a language it supports', () => {
    expect(isSupportedLocale(DEFAULT_LOCALE)).toBe(true);
  });

  it('accepts only the listed tags', () => {
    expect(supportedLocaleSchema.safeParse('it').success).toBe(true);
    expect(supportedLocaleSchema.safeParse('it-IT').success).toBe(false);
    expect(supportedLocaleSchema.safeParse('de').success).toBe(false);
  });
});

describe('matching a browser', () => {
  it('reads a regional tag as its language', () => {
    expect(matchSupportedLocale(['it-IT', 'en-US'])).toBe('it');
    expect(matchSupportedLocale(['IT_ch'])).toBe('it');
  });

  it("keeps the browser's order", () => {
    expect(matchSupportedLocale(['de-DE', 'en-GB', 'it'])).toBe('en');
  });

  it('finds nothing when no language is supported', () => {
    expect(matchSupportedLocale(['de-DE', 'fr'])).toBeUndefined();
    expect(matchSupportedLocale([])).toBeUndefined();
  });
});

describe('the language a person reads', () => {
  it('is their own choice first', () => {
    expect(resolveDisplayLocale('it', 'en')).toBe('it');
  });

  it('follows the house when they have none', () => {
    expect(resolveDisplayLocale(null, 'it')).toBe('it');
    expect(resolveDisplayLocale(undefined, 'it')).toBe('it');
  });

  it('skips a language no longer supported', () => {
    expect(resolveDisplayLocale('de', 'it')).toBe('it');
    expect(resolveDisplayLocale('de', 'fr')).toBe('en');
  });
});
