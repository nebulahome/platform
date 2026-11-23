import { describe, expect, it } from 'vitest';

import { downloadIcs, ICS_MAX_BYTES, looksLikeIcs } from './ics-download.js';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const NONE = { etag: null, lastModified: null };

/**
 * A fetch that answers one response.
 *
 * @param response - What it answers.
 * @param seen - Where the request's headers are kept.
 * @returns The fetch.
 */
function answering(response: Response, seen: Record<string, string> = {}): typeof fetch {
  return (...[, init]: Parameters<typeof fetch>) => {
    Object.assign(seen, init?.headers ?? {});

    return Promise.resolve(response);
  };
}

describe('downloadIcs', () => {
  it('reads a calendar and keeps its validators', async () => {
    const result = await downloadIcs(
      'webcal://school.example/agenda.ics',
      NONE,
      answering(new Response(ICS, { headers: { etag: '"v1"', 'content-type': 'text/calendar' } })),
    );

    expect(result).toEqual({ kind: 'body', text: ICS, etag: '"v1"', lastModified: null });
  });

  it('sends the validators back and takes a 304', async () => {
    const seen: Record<string, string> = {};
    const result = await downloadIcs(
      'https://school.example/agenda.ics',
      { etag: '"v1"', lastModified: 'Thu, 03 Dec 2026 17:30:00 GMT' },
      answering(new Response(null, { status: 304 }), seen),
    );

    expect(result).toEqual({ kind: 'not_modified' });
    expect(seen['if-none-match']).toBe('"v1"');
    expect(seen['if-modified-since']).toBe('Thu, 03 Dec 2026 17:30:00 GMT');
  });

  it('names the errors of the boards', async () => {
    const page = await downloadIcs(
      'https://school.example/agenda',
      NONE,
      answering(
        new Response('<!doctype html><html></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    const signIn = await downloadIcs(
      'https://g.example/basic.ics',
      NONE,
      answering(new Response('', { status: 401 })),
    );
    const gone = await downloadIcs(
      'https://g.example/basic.ics',
      NONE,
      answering(new Response('', { status: 404 })),
    );
    const ftp = await downloadIcs('ftp://g.example/basic.ics', NONE, answering(new Response(ICS)));
    const silent = await downloadIcs('https://g.example/basic.ics', NONE, () =>
      Promise.reject(new TypeError('fetch failed')),
    );

    expect(page).toMatchObject({ kind: 'error', code: 'not_calendar' });
    expect(signIn).toMatchObject({ kind: 'error', code: 'needs_sign_in' });
    expect(gone).toMatchObject({ kind: 'error', code: 'not_found' });
    expect(ftp).toMatchObject({ kind: 'error', code: 'unreachable' });
    expect(silent).toMatchObject({ kind: 'error', code: 'unreachable' });
  });

  it('stops reading past 5 MB', async () => {
    const big = new Response(`BEGIN:VCALENDAR\r\n${'x'.repeat(ICS_MAX_BYTES)}`);
    const result = await downloadIcs('https://g.example/basic.ics', NONE, answering(big));

    expect(result).toMatchObject({ kind: 'error', code: 'too_big' });
  });

  it('knows a calendar by its first line', () => {
    expect(looksLikeIcs('﻿\r\nBEGIN:VCALENDAR')).toBe(true);
    expect(looksLikeIcs('%PDF-1.7')).toBe(false);
  });
});
