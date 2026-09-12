/**
 * Telling "the API said no" apart from "the API was not there".
 *
 * The two look alike from a component - both are a rejected promise - and deserve opposite
 * reactions: an answer is final and is acted on, an absence is a fact about the moment and is
 * waited out. Getting the line wrong in one direction retries a refusal forever; in the other
 * it concludes "signed out" from a proxy's 502 and shows a fresh installation the sign-in form
 * instead of setup.
 */
import { describe, expect, it } from 'vitest';

import { ApiError, isApiUnreachable, toApiError } from '@/lib/api-error';

describe('isApiUnreachable', () => {
  it('is true when fetch itself threw', () => {
    expect(
      isApiUnreachable(new ApiError({ code: 'NETWORK', status: 0, message: 'no route' })),
    ).toBe(true);
  });

  it.each([502, 503, 504])(
    'is true for a %d, which is a proxy speaking for an absent API',
    (status) => {
      expect(isApiUnreachable(toApiError(new Response('', { status }), undefined))).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 500])('is false for a %d, which is the API answering', (status) => {
    expect(isApiUnreachable(toApiError(new Response('', { status }), undefined))).toBe(false);
  });

  it('is false for anything that is not a failed request at all', () => {
    expect(isApiUnreachable(new Error('something else'))).toBe(false);
    expect(isApiUnreachable(undefined)).toBe(false);
  });
});
