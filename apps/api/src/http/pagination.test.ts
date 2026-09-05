/**
 * Cursors and pages.
 *
 * The case that matters most is the corrupted cursor: returning the first page for one turns a
 * client bug into an endless loop over page one, so it has to be a rejection.
 */
import { ValidationError } from '@nebula-home/contracts';
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, toPage } from './pagination.js';

describe('cursors', () => {
  it('round-trips a key', () => {
    expect(decodeCursor(encodeCursor({ key: '2026-01-01T00:00:00.000Z' }))).toEqual({
      key: '2026-01-01T00:00:00.000Z',
    });
  });

  it('round-trips a key and its tiebreaker', () => {
    expect(decodeCursor(encodeCursor({ key: 'a', id: 'b' }))).toEqual({ key: 'a', id: 'b' });
  });

  it('is opaque rather than readable', () => {
    expect(encodeCursor({ key: 'light.kitchen' })).not.toContain('light.kitchen');
  });

  it('refuses something that is not a cursor', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(ValidationError);
  });

  it('refuses valid base64 that is not a cursor', () => {
    expect(() => decodeCursor(Buffer.from('{"nope":1}').toString('base64url'))).toThrow(
      ValidationError,
    );
  });

  it('refuses a cursor whose key is not a string', () => {
    expect(() => decodeCursor(Buffer.from('{"key":7}').toString('base64url'))).toThrow(
      ValidationError,
    );
  });
});

describe('toPage', () => {
  /**
   * Reads the sort key out of a row.
   *
   * @param row - The row.
   * @param row.id - Its identifier, which is the sort key.
   * @returns The cursor for it.
   */
  const keyOf = (row: { id: string }): { key: string } => ({ key: row.id });

  it('says there is no more when the extra row did not come back', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }], 3, keyOf);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it('drops the extra row and hands back a cursor when it did', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, keyOf);

    expect(page.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBeDefined();
  });

  it('points the cursor at the last row it returned, not the one it dropped', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, keyOf);

    expect(decodeCursor(page.nextCursor ?? '')).toEqual({ key: 'b' });
  });

  it('handles an empty result', () => {
    const page = toPage([], 10, keyOf);

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('handles a page that is exactly full', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }], 2, keyOf);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });
});
