/**
 * The mount commands: built from fixed options, the share's name and nothing else the owner
 * typed, and never with a password in them.
 */
import { describe, expect, it } from 'vitest';

import { nfsMountArguments, smbCredentials, smbMountArguments } from './mount.js';

const SMB = {
  host: 'nas.local',
  share: 'backups',
  path: 'nebula',
  username: 'robin',
  password: 'p@ss,word=1',
  domain: '',
  version: '3.1.1',
};

describe('smbMountArguments', () => {
  it('mounts the share with a credentials file, never the password', () => {
    const args = smbMountArguments(SMB, '/run/m/1', '/tmp/c/credentials');

    expect(args.slice(0, 4)).toEqual(['-t', 'cifs', '//nas.local/backups', '/run/m/1']);
    expect(args.join(' ')).not.toContain('p@ss');
    expect(args[5]).toContain('credentials=/tmp/c/credentials');
    expect(args[5]).toContain('vers=3.1.1');
    expect(args[5]).toContain('noexec');
  });

  it('mounts as a guest without a user', () => {
    expect(smbMountArguments({ ...SMB, username: '' }, '/m', null)[5]).toMatch(/^guest,/u);
  });

  it('lets the two sides agree on a version when asked to', () => {
    expect(smbMountArguments({ ...SMB, version: 'auto' }, '/m', null)[5]).not.toContain('vers=');
  });
});

describe('smbCredentials', () => {
  it('writes the user and the password as the file wants them', () => {
    expect(smbCredentials({ ...SMB, domain: 'HOME' })).toBe(
      'username=robin\npassword=p@ss,word=1\ndomain=HOME\n',
    );
  });

  it('refuses a password with a line break, which would add a line of its own', () => {
    expect(() => smbCredentials({ ...SMB, password: 'a\nusername=root' })).toThrow(/line break/u);
  });
});

describe('nfsMountArguments', () => {
  it('mounts soft, so a server gone away fails the backup instead of hanging it', () => {
    const args = nfsMountArguments(
      { host: '192.168.1.5', export: '/volume1/backups', path: '', version: '4.1' },
      '/m',
    );

    expect(args.slice(0, 4)).toEqual(['-t', 'nfs', '192.168.1.5:/volume1/backups', '/m']);
    expect(args[5]).toBe('soft,timeo=100,retrans=2,vers=4.1,nosuid,nodev,noexec');
  });

  it('puts an IPv6 address in brackets', () => {
    expect(
      nfsMountArguments({ host: 'fd00::5', export: '/x', path: '', version: 'auto' }, '/m')[2],
    ).toBe('[fd00::5]:/x');
  });
});
