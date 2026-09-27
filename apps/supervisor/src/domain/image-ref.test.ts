import { describe, expect, it } from 'vitest';

import { imageName, parseImageReference, registryPageOf } from './image-ref.js';

describe('parseImageReference', () => {
  it('puts a name with no registry on Docker Hub, an official one under library/', () => {
    expect(parseImageReference('nginx')).toEqual({
      registry: 'docker.io',
      repository: 'library/nginx',
      tag: 'latest',
      digest: null,
    });
    expect(parseImageReference('koenkk/zigbee2mqtt:2.14.1')).toEqual({
      registry: 'docker.io',
      repository: 'koenkk/zigbee2mqtt',
      tag: '2.14.1',
      digest: null,
    });
  });

  it("reads a registry's host, its port, and a digest", () => {
    expect(parseImageReference('ghcr.io/koenkk/zigbee2mqtt:latest')).toMatchObject({
      registry: 'ghcr.io',
      repository: 'koenkk/zigbee2mqtt',
      tag: 'latest',
    });
    expect(parseImageReference('registry.lan:5000/tools/app@sha256:abc')).toEqual({
      registry: 'registry.lan:5000',
      repository: 'tools/app',
      tag: 'latest',
      digest: 'sha256:abc',
    });
  });
});

describe('imageName', () => {
  it('names the image as a pull does', () => {
    expect(imageName(parseImageReference('nginx:1.27'))).toBe('nginx');
    expect(imageName(parseImageReference('ghcr.io/owner/app:1'))).toBe('ghcr.io/owner/app');
  });
});

describe('registryPageOf', () => {
  it("links an image to its page on Docker Hub, GitHub's registry or Quay", () => {
    expect(registryPageOf(parseImageReference('eclipse-mosquitto:2'))).toBe(
      'https://hub.docker.com/_/eclipse-mosquitto',
    );
    expect(registryPageOf(parseImageReference('koenkk/zigbee2mqtt'))).toBe(
      'https://hub.docker.com/r/koenkk/zigbee2mqtt',
    );
    expect(registryPageOf(parseImageReference('ghcr.io/owner/app'))).toBe(
      'https://ghcr.io/owner/app',
    );
    expect(registryPageOf(parseImageReference('registry.lan:5000/app'))).toBe(null);
  });
});
