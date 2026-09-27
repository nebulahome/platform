import { describe, expect, it } from 'vitest';

import { containerIdFromCgroup, containerIdFromMountinfo, findSelf } from './self.js';

const ID = 'a3f1c0de9b2e4f6a8c7d5e3b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a21';

const MOUNTINFO = [
  '543 520 0:48 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/X',
  `560 543 254:1 /docker/volumes/nebulahome_nebula-data/_data /data rw,relatime - ext4 /dev/vda1 rw`,
  `561 543 254:1 /docker/containers/${ID}/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/vda1 rw`,
  `562 543 254:1 /docker/containers/${ID}/hostname /etc/hostname rw,relatime - ext4 /dev/vda1 rw`,
].join('\n');

describe('containerIdFromMountinfo', () => {
  it("reads the id from the files Docker mounts from the container's folder", () => {
    expect(containerIdFromMountinfo(MOUNTINFO)).toBe(ID);
  });

  it('finds nothing outside a container', () => {
    expect(containerIdFromMountinfo('24 1 8:1 / / rw - ext4 /dev/sda1 rw')).toBe(null);
  });
});

describe('containerIdFromCgroup', () => {
  it('reads the id where cgroup v1 names it', () => {
    expect(containerIdFromCgroup(`12:cpu,cpuacct:/docker/${ID}`)).toBe(ID);
    expect(containerIdFromCgroup('0::/')).toBe(null);
  });
});

describe('findSelf', () => {
  it('trusts the kernel first, then a host name that is a short id', () => {
    expect(findSelf([ID, 'b'.repeat(64)], { fromKernel: ID, hostname: 'box' })).toBe(ID);
    expect(findSelf([ID], { fromKernel: null, hostname: ID.slice(0, 12) })).toBe(ID);
    expect(findSelf([ID], { fromKernel: null, hostname: 'my-laptop' })).toBe(null);
  });
});
