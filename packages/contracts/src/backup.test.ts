/**
 * What a backup setting and a location accept: the shapes the interface sends, and nothing that
 * could turn into an option of the mount command a location ends up in.
 */
import { describe, expect, it } from 'vitest';

import {
  backupFrequencySchema,
  backupLocationCreateSchema,
  backupScheduleSchema,
  backupTargetInputSchema,
  localPathProblem,
  timeOfDaySchema,
} from './backup.js';
import { SETTINGS } from './settings.js';

describe('the backup settings', () => {
  it('parse their own defaults', () => {
    for (const setting of SETTINGS.filter((each) => each.key.startsWith('backup.'))) {
      expect(setting.schema.safeParse(setting.defaultValue).success, setting.key).toBe(true);
    }
  });

  it('take a time on a 24-hour clock and a real time zone', () => {
    expect(timeOfDaySchema.safeParse('03:45').success).toBe(true);
    expect(timeOfDaySchema.safeParse('24:00').success).toBe(false);
    expect(timeOfDaySchema.safeParse('3:45').success).toBe(false);
    expect(
      backupScheduleSchema.safeParse({ mode: 'fixed', time: '02:30', timezone: 'Europe/Rome' })
        .success,
    ).toBe(true);
    expect(
      backupScheduleSchema.safeParse({ mode: 'fixed', time: '02:30', timezone: 'Mars/Olympus' })
        .success,
    ).toBe(false);
  });

  it('take each day of a custom week once', () => {
    expect(
      backupFrequencySchema.safeParse({ mode: 'custom', days: ['monday', 'thursday'] }).success,
    ).toBe(true);
    expect(
      backupFrequencySchema.safeParse({ mode: 'custom', days: ['monday', 'monday'] }).success,
    ).toBe(false);
    expect(backupFrequencySchema.safeParse({ mode: 'custom', days: [] }).success).toBe(false);
  });
});

describe('a backup location', () => {
  it('fills what the owner left out', () => {
    const location = backupLocationCreateSchema.parse({
      name: 'NAS',
      target: { kind: 'smb', host: 'nas.local', share: 'backups' },
    });

    expect(location.isEnabled).toBe(true);
    expect(location.retention).toEqual({ mode: 'count', value: 7 });
    expect(location.target).toMatchObject({ path: '', username: '', version: 'auto' });
  });

  it.each([
    ['a host carrying a mount option', { kind: 'smb', host: 'nas,uid=0', share: 'b' }],
    ['a host with a space', { kind: 'nfs', host: 'nas local', export: '/x' }],
    ['a share with a slash', { kind: 'smb', host: 'nas', share: 'a/b' }],
    ['a path that climbs out', { kind: 'ftp', host: 'nas', path: 'a/../../etc' }],
    ['a relative local folder', { kind: 'local', path: 'backups' }],
    ['a local folder with ..', { kind: 'local', path: '/mnt/../etc' }],
    ['an export that is not absolute', { kind: 'nfs', host: 'nas', export: 'volume1' }],
  ])('refuses %s', (nothing, target) => {
    expect(backupTargetInputSchema.safeParse(target).success).toBe(false);
  });

  it('never takes the system location from the owner', () => {
    expect(backupTargetInputSchema.safeParse({ kind: 'system' }).success).toBe(false);
  });
});

describe('localPathProblem', () => {
  it.each([
    ['/mnt/usb/backups', null],
    ['/media/disk', null],
    ['/data/backups', 'The data directory'],
    ['/data', 'The data directory'],
    ['/proc/self', 'A system folder'],
    ['/etc', 'A system folder'],
    ['/', 'Choose a folder'],
  ])('%s', (folder, expected) => {
    const problem = localPathProblem(folder, '/data');

    if (expected === null) {
      expect(problem).toBeNull();
    } else {
      expect(problem).toContain(expected);
    }
  });
});
