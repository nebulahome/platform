import { describe, expect, it } from 'vitest';

import {
  packageAnnounceRequestSchema,
  packageHubLogoReplySchema,
  packageListingSchema,
  packageRemoveRequestSchema,
  isPackageServiceAllowed,
  packageRpcRequestSchema,
  packageSearchRequestSchema,
  packageSettingsChangeSchema,
} from './packet-manager.js';
import { packageDeviceId, packageObjectPrefix, syncPackageRequestSchema } from './registration.js';
import { ensureRequestSchema, managedContainerSpecSchema } from './supervisor.js';

describe('a package device’s public id', () => {
  it('is the package and the device’s own id, slugged', () => {
    expect(packageDeviceId('mqtt', 'Client: kitchen/sensor')).toBe(
      'package-mqtt-client-kitchen-sensor',
    );
    expect(packageDeviceId('mqtt', '###')).toBe('package-mqtt-device');
  });

  it('is cut to 64 characters with a digest, so two long ids stay apart', () => {
    const one = packageDeviceId('music-player', `zone-${'a'.repeat(80)}-one`);
    const two = packageDeviceId('music-player', `zone-${'a'.repeat(80)}-two`);

    expect(one).toHaveLength(64);
    expect(one).not.toBe(two);
    expect(one).toMatch(/^package-music-player-zone-a+-[0-9a-f]{8}$/);
  });

  it('names a package’s entities after it', () => {
    expect(packageObjectPrefix('music-player')).toBe('music_player_');
  });
});

describe('syncing a package’s devices', () => {
  it('refuses two devices with one externalId', () => {
    const device = { externalId: 'broker', name: 'Broker' };

    expect(
      syncPackageRequestSchema.safeParse({ packageId: 'mqtt', devices: [device, device] }).success,
    ).toBe(false);
    expect(
      syncPackageRequestSchema.parse({ packageId: 'mqtt', devices: [device] }).devices[0]?.entities,
    ).toEqual([]);
  });
});

describe('the packet-manager’s requests', () => {
  it('keeps a package’s data unless asked, and a call’s input is null when it has none', () => {
    expect(packageRemoveRequestSchema.parse({ packageId: 'nvr' }).isDataRemoved).toBe(false);
    expect(packageRpcRequestSchema.parse({ method: 'clients' }).input).toBeNull();
  });

  it('carries who called a method, and keeps a package’s own subjects for the platform', () => {
    expect(
      packageRpcRequestSchema.parse({
        method: 'clients',
        caller: { userId: 'u-1', username: 'ada', role: 'owner' },
      }).caller,
    ).toEqual({ userId: 'u-1', username: 'ada', role: 'owner' });
    expect(isPackageServiceAllowed('recordings')).toBe(true);
    expect(isPackageServiceAllowed('settings')).toBe(false);
    expect(isPackageServiceAllowed('_internal')).toBe(false);
    expect(
      packageSettingsChangeSchema.safeParse({ values: { interval: 5 }, changed: ['interval'] })
        .success,
    ).toBe(true);
  });

  it('takes an announcement of the methods a package registered', () => {
    expect(
      packageAnnounceRequestSchema.safeParse({
        packageId: 'mqtt',
        version: '1.0.0',
        rpcMethods: [
          { name: 'topics', access: 'read' },
          { name: 'addClient', access: 'configure' },
        ],
      }).success,
    ).toBe(true);
    expect(
      packageAnnounceRequestSchema.safeParse({
        packageId: 'mqtt',
        version: '1.0.0',
        rpcMethods: [{ name: 'Topics!', access: 'read' }],
      }).success,
    ).toBe(false);
  });
});

describe('a container a package declares', () => {
  it('is a vendor’s unless said, and says whose it is', () => {
    const spec = {
      vendorId: 'nvr',
      dependencyId: 'frigate',
      name: 'Frigate',
      image: 'ghcr.io/blakeblackshear/frigate',
      minVersion: '0.14.0',
      env: [],
      volumes: [],
      devices: [],
      ports: [],
      seed: [],
      webPort: null,
    };

    expect(managedContainerSpecSchema.parse(spec).ownerKind).toBe('vendor');
    expect(
      ensureRequestSchema.parse({
        vendorId: 'nvr',
        ownerKind: 'package',
        containers: [{ ...spec, ownerKind: 'package' }],
      }).containers[0]?.ownerKind,
    ).toBe('package');
  });
});

describe('a search of the Community Hub', () => {
  /** A package a search found, as the packet-manager answers it. */
  const listing = {
    id: 'nvr',
    name: 'Recorder',
    description: '',
    category: 'security',
    repository: null,
    icon: null,
    latest: null,
    newestVersion: '1.4.0',
    installedVersion: null,
    hasUpdate: false,
    hasNewBuild: false,
    color: '#3F6FD8',
    logo: 'a'.repeat(64),
    isOfficial: true,
    downloads: 3,
    stars: 0,
    origin: 'hub',
    unavailableReason: 'No release of it is in the package index yet',
  };

  it('trims what is looked for, and asks for nothing more', () => {
    expect(packageSearchRequestSchema.parse({ q: '  rec ' })).toEqual({ q: 'rec' });
    expect(packageSearchRequestSchema.safeParse({ q: 'rec', limit: 500 }).success).toBe(false);
  });

  it('takes the Hub’s empty description, and no colour or digest that is not one', () => {
    expect(packageListingSchema.safeParse(listing).success).toBe(true);
    expect(
      packageListingSchema.safeParse({ ...listing, color: 'url(javascript:alert(1))' }).success,
    ).toBe(false);
    expect(packageListingSchema.safeParse({ ...listing, logo: '../etc/passwd' }).success).toBe(
      false,
    );
  });

  it('relays an image logo, no bigger than the Hub keeps', () => {
    expect(
      packageHubLogoReplySchema.safeParse({ contentType: 'image/png', data: 'iVBORw0KGgo=' })
        .success,
    ).toBe(true);
    expect(
      packageHubLogoReplySchema.safeParse({ contentType: 'text/html', data: 'PGI+' }).success,
    ).toBe(false);
    expect(
      packageHubLogoReplySchema.safeParse({ contentType: 'image/png', data: 'A'.repeat(400_000) })
        .success,
    ).toBe(false);
  });
});
