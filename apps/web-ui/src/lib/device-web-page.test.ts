import { describe, expect, it } from 'vitest';

import { deviceWebPageOf } from './device-web-page';

describe('deviceWebPageOf', () => {
  it('links a device on the port its driver names, leaving out the usual one', () => {
    expect(
      deviceWebPageOf({ transportConfig: { host: '192.168.1.40' } }, { webPagePort: 80 }),
    ).toBe('http://192.168.1.40/');
    expect(
      deviceWebPageOf({ transportConfig: { host: 'media.local' } }, { webPagePort: 32400 }),
    ).toBe('http://media.local:32400/');
  });

  it('keeps the port the owner typed, and the path the driver names', () => {
    expect(
      deviceWebPageOf(
        { transportConfig: { host: '192.168.1.20:32400' } },
        { webPagePort: 32400, webPagePath: '/web' },
      ),
    ).toBe('http://192.168.1.20:32400/web');
    expect(
      deviceWebPageOf({ transportConfig: { host: '192.168.1.40:8080' } }, { webPagePort: 80 }),
    ).toBe('http://192.168.1.40:8080/');
  });

  it('brackets an IPv6 address', () => {
    expect(deviceWebPageOf({ transportConfig: { host: 'fe80::1' } }, { webPagePort: 80 })).toBe(
      'http://[fe80::1]/',
    );
  });

  it('has no link for a driver that names no page, or a device with no host', () => {
    expect(deviceWebPageOf({ transportConfig: { host: '192.168.1.40' } }, {})).toBeNull();
    expect(
      deviceWebPageOf({ transportConfig: { url: 'mqtts://x' } }, { webPagePort: 80 }),
    ).toBeNull();
    expect(deviceWebPageOf({ transportConfig: { host: '192.168.1.40' } }, undefined)).toBeNull();
  });
});
