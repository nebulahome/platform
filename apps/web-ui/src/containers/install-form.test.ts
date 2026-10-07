import { describe, expect, it } from 'vitest';

import {
  applyDescription,
  checkInstall,
  EMPTY_INSTALL,
  pickImage,
  suggestName,
} from './install-form';

describe('suggestName', () => {
  it("offers the image's own name, numbered when a container has it", () => {
    expect(suggestName('linuxserver/jellyfin', [])).toBe('jellyfin');
    expect(suggestName('linuxserver/jellyfin', ['jellyfin', 'jellyfin-2'])).toBe('jellyfin-3');
    expect(suggestName('ghcr.io/home-assistant/home-assistant', [])).toBe('home-assistant');
  });
});

describe('applyDescription', () => {
  it("fills the form in from the image: its ports, its environment, its volumes kept in NebulaHome's data", () => {
    const draft = applyDescription(pickImage(EMPTY_INSTALL, 'nginx', []), {
      version: null,
      description: null,
      ports: [{ container: 80, protocol: 'tcp' }],
      env: [{ name: 'NGINX_VERSION', value: '1.29.1' }],
      volumes: ['/usr/share/nginx/html', '/data/html'],
    });

    expect(draft.name).toBe('nginx');
    expect(draft.ports.map((port) => [port.host, port.container, port.protocol])).toEqual([
      ['80', '80', 'tcp'],
    ]);
    expect(draft.env.map((entry) => [entry.name, entry.value])).toEqual([
      ['NGINX_VERSION', '1.29.1'],
    ]);
    expect(draft.volumes.map((volume) => [volume.kind, volume.source, volume.target])).toEqual([
      ['data', 'html', '/usr/share/nginx/html'],
      ['data', 'html-2', '/data/html'],
    ]);
  });
});

describe('checkInstall', () => {
  const draft = applyDescription(pickImage(EMPTY_INSTALL, 'traefik/whoami', []), {
    version: null,
    description: null,
    ports: [{ container: 80, protocol: 'tcp' }],
    env: [],
    volumes: [],
  });

  it('makes the request of a form that is complete', () => {
    expect(checkInstall(draft, []).request).toMatchObject({
      name: 'whoami',
      image: 'traefik/whoami',
      tag: 'latest',
      ports: [{ host: 80, container: 80, protocol: 'tcp' }],
      restartPolicy: 'unless-stopped',
      network: 'bridge',
    });
  });

  it('says which field is wrong, by its path', () => {
    const ports = draft.ports.map((port) => ({ ...port, host: 'eighty' }));

    expect(checkInstall({ ...draft, ports }, ['whoami']).errors).toEqual({
      name: 'A container is already called that',
      'ports.0.host': 'A port from 1 to 65535',
    });
  });

  it('hands a device of the machine over, at the same path unless told otherwise', () => {
    const devices = [
      { key: 'a', host: '/dev/ttyUSB0', container: '' },
      { key: 'b', host: '/dev/ttyACM0', container: '/dev/zigbee' },
      { key: 'c', host: '', container: '' },
    ];

    expect(checkInstall({ ...draft, devices }, []).request?.devices).toEqual([
      { host: '/dev/ttyUSB0', container: '/dev/ttyUSB0' },
      { host: '/dev/ttyACM0', container: '/dev/zigbee' },
    ]);
  });
});
