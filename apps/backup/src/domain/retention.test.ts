/**
 * What a location lets go of: the oldest beyond the count or the days, never the archive just
 * written, never the last one, never a file that is not an archive.
 */
import { describe, expect, it } from 'vitest';

import { archiveNameFor, parseArchiveName } from './archive-name.js';
import { archivesToRemove } from './retention.js';

const NOW = new Date('2026-09-27T03:00:00Z');

/**
 * Names the archive made some days before now.
 *
 * @param daysAgo - How many days before.
 * @returns The name.
 */
function made(daysAgo: number): string {
  return archiveNameFor(
    `${String(daysAgo).padStart(8, '0')}-0000-4000-8000-000000000000`,
    new Date(NOW.getTime() - daysAgo * 86_400_000),
  );
}

describe('archive names', () => {
  it('say when the archive was made', () => {
    const name = archiveNameFor('1a2b3c4d-0000-4000-8000-000000000000', NOW);

    expect(name).toBe('nebulahome-20260927T030000Z-1a2b3c4d.nhbk');
    expect(parseArchiveName(name)?.createdAt).toEqual(NOW);
  });

  it('are not mistaken for anything else', () => {
    expect(parseArchiveName('notes.txt')).toBeNull();
    expect(parseArchiveName('.nebulahome-20260927T030000Z-1a2b3c4d.nhbk.partial')).toBeNull();
  });
});

describe('archivesToRemove', () => {
  it('keeps the newest by count, removing the oldest first', () => {
    const names = [made(0), made(1), made(2), made(3), made(4)];

    expect(archivesToRemove(names, { mode: 'count', value: 3 }, NOW, made(0))).toEqual([
      made(4),
      made(3),
    ]);
  });

  it('keeps those within the days', () => {
    const names = [made(0), made(2), made(6), made(8), made(30)];

    expect(archivesToRemove(names, { mode: 'days', value: 7 }, NOW, made(0))).toEqual([
      made(30),
      made(8),
    ]);
  });

  it('never removes the archive just written, nor the last one', () => {
    // A clock gone wrong: the new archive looks older than the rule allows.
    const names = [made(40)];

    expect(archivesToRemove(names, { mode: 'days', value: 7 }, NOW, made(40))).toEqual([]);
  });

  it('leaves files that are not archives alone', () => {
    const names = ['README.txt', made(0), made(1), 'other-backup.tar'];

    expect(archivesToRemove(names, { mode: 'count', value: 1 }, NOW, made(0))).toEqual([made(1)]);
  });
});
