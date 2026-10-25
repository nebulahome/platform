import { describe, expect, it } from 'vitest';

import { isRecentBackupEnough, type LastBackup } from './backup-first.js';

const NOW = new Date('2026-11-14T03:00:00Z');
const ALL = ['configuration', 'history', 'packages'] as const;

/**
 * A backup that finished some minutes before now.
 *
 * @param minutes - How many.
 * @param extra - What else differs.
 * @returns The backup.
 */
function finished(minutes: number, extra: Partial<LastBackup> = {}): LastBackup {
  return {
    status: 'success',
    finishedAt: new Date(NOW.getTime() - minutes * 60_000),
    sections: ALL,
    ...extra,
  };
}

describe('isRecentBackupEnough', () => {
  it('skips the backup after a full one minutes ago', () => {
    expect(isRecentBackupEnough(finished(4), ALL, NOW)).toBe(true);
  });

  it('backs up again after five minutes', () => {
    expect(isRecentBackupEnough(finished(5), ALL, NOW)).toBe(false);
  });

  it('backs up again when the last one failed, or missed a part', () => {
    expect(isRecentBackupEnough(finished(1, { status: 'partial' }), ALL, NOW)).toBe(false);
    expect(
      isRecentBackupEnough(finished(1, { sections: ['configuration', 'history'] }), ALL, NOW),
    ).toBe(false);
    expect(
      isRecentBackupEnough(finished(1, { sections: ['configuration'] }), ['configuration'], NOW),
    ).toBe(true);
  });

  it('backs up when there is none', () => {
    expect(isRecentBackupEnough(null, ALL, NOW)).toBe(false);
  });
});
