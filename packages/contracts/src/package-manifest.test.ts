import { describe, expect, it } from 'vitest';

import { packageIndexSchema } from './package-index.js';
import { packageManifestSchema } from './package-manifest.js';

/** The MQTT package's manifest, as it ships. */
const MQTT = {
  id: 'mqtt',
  version: '1.0.0',
  platform: '^1.0.0',
  sdk: '^1.0.0',
  name: 'MQTT',
  description: 'The house’s MQTT broker, and the devices that speak MQTT to it.',
  repository: 'nebulahome/pkg-mqtt',
  category: 'protocol',
  runtime: 'node',
  server: { entry: './server/index.js' },
  ui: {
    entry: './ui/index.js',
    styles: './ui/index.css',
    page: true,
    cards: [{ id: 'broker', name: 'MQTT broker', icon: 'router', sizes: ['small', 'medium'] }],
  },
  provides: ['mqtt-broker'],
};

describe('a package manifest', () => {
  it('reads a node package with a page and a card, filling in what it leaves out', () => {
    const manifest = packageManifestSchema.parse(MQTT);

    expect(manifest).toMatchObject({
      requires: { packages: {}, services: [] },
      containers: [],
      entityTypes: [],
      ui: { cards: [{ id: 'broker', options: [] }], entityViews: [], background: null },
    });
  });

  it('reads a background, and refuses one that says nothing of what it does', () => {
    const withBackground = (description: string): unknown => ({
      ...MQTT,
      ui: { ...MQTT.ui, background: { description } },
    });

    expect(packageManifestSchema.parse(withBackground('Keeps the music playing')).ui).toMatchObject(
      { background: { description: 'Keeps the music playing' } },
    );
    expect(packageManifestSchema.safeParse(withBackground('')).success).toBe(false);
    expect(packageManifestSchema.safeParse(withBackground('x'.repeat(257))).success).toBe(false);
  });

  it('reads an entity type, and a view of it', () => {
    const manifest = packageManifestSchema.parse({
      ...MQTT,
      id: 'nvr',
      entityTypes: [
        {
          id: 'recording',
          name: 'Recording',
          icon: 'video',
          state: [
            { key: 'startedAt', type: 'timestamp', label: 'Started' },
            { key: 'size', type: 'number', label: 'Size', unit: 'MB' },
            {
              key: 'reason',
              type: 'choice',
              label: 'Why',
              choices: [
                { value: 'motion', label: 'Motion' },
                { value: 'person', label: 'A person' },
              ],
            },
          ],
          commands: [{ id: 'keep', name: 'Keep it' }],
        },
      ],
      ui: { entry: './ui/index.js', entityViews: ['recording'] },
    });

    expect(manifest.entityTypes[0]?.commands[0]?.fields).toEqual([]);
  });

  it('refuses what does not hold together', () => {
    const problems = (value: unknown): string[] =>
      packageManifestSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

    expect(problems({ ...MQTT, server: undefined })).toContain(
      'A node package names the module it runs',
    );
    expect(problems({ ...MQTT, runtime: 'container', server: undefined })).toContain(
      'A container package declares its containers or a compose file',
    );
    expect(problems({ ...MQTT, requires: { packages: { mqtt: '^1.0.0' } } })).toContain(
      'A package does not require itself',
    );
    expect(
      problems({ ...MQTT, ui: { entry: './ui/index.js', entityViews: ['recording'] } }),
    ).toContain("recording is not one of the package's entity types");
    expect(problems({ ...MQTT, server: { entry: './server/../../outside.js' } })).toEqual([
      'Must stay inside the package',
    ]);
    expect(problems({ ...MQTT, requires: { platform: 'latest please' } })).toEqual([
      'Must be a version range, such as ^1.0.0',
    ]);
  });

  it('refuses the name of a part of the platform', () => {
    expect(packageManifestSchema.safeParse({ ...MQTT, id: 'core' }).error?.issues[0]?.message).toBe(
      'Is the name of a part of the platform, which no package may take',
    );
    expect(packageManifestSchema.safeParse({ ...MQTT, id: 'core-tools' }).success).toBe(true);
  });

  it('takes an id that starts with a digit, never one that starts with a dash', () => {
    expect(packageManifestSchema.safeParse({ ...MQTT, id: '3d-home' }).success).toBe(true);
    expect(packageManifestSchema.safeParse({ ...MQTT, id: '-home' }).success).toBe(false);
    expect(packageManifestSchema.safeParse({ ...MQTT, id: '3' }).success).toBe(false);
  });

  it('reads a compose file in place of containers, and never both', () => {
    const compose = {
      ...MQTT,
      runtime: 'container',
      server: undefined,
      ui: undefined,
      compose: { file: './compose.yaml' },
    };
    const container = {
      id: 'server',
      name: 'Server',
      image: 'example/server',
      minVersion: '1.0.0',
    };

    expect(packageManifestSchema.parse(compose).compose).toEqual({ file: './compose.yaml' });
    expect(
      packageManifestSchema.safeParse({ ...compose, containers: [container] }).error?.issues[0]
        ?.message,
    ).toBe('A package declares containers or a compose file, not both');
    expect(
      packageManifestSchema.safeParse({ ...compose, runtime: 'none' }).error?.issues[0]?.message,
    ).toBe('A package that runs nothing has no compose file');
  });

  it('gives a page an entry in the sidebar, and a card its padding', () => {
    const manifest = packageManifestSchema.parse({
      ...MQTT,
      ui: { ...MQTT.ui, sidebar: { label: 'Broker' } },
    });

    expect(manifest.ui?.sidebar).toEqual({ label: 'Broker' });
    expect(manifest.ui?.cards[0]?.padding).toBe('default');
    expect(
      packageManifestSchema.safeParse({
        ...MQTT,
        ui: { ...MQTT.ui, page: false, sidebar: {} },
      }).error?.issues[0]?.message,
    ).toBe('Only a package with a page of its own has an entry for it');
  });
});

describe('the package index', () => {
  it('lists each release with its archive and what it needs', () => {
    const index = packageIndexSchema.parse({
      generatedAt: '2026-09-29T08:00:00Z',
      packages: [
        {
          id: 'mqtt',
          name: 'MQTT',
          description: 'The house’s MQTT broker.',
          repository: 'nebulahome/pkg-mqtt',
          category: 'protocol',
          versions: [
            {
              version: '1.0.0',
              platform: '^1.0.0',
              sdk: '^1.0.0',
              provides: ['mqtt-broker'],
              artifact: {
                url: 'https://github.com/nebulahome/pkg-mqtt/releases/download/v1.0.0/mqtt-1.0.0.tgz',
                sha256: 'a'.repeat(64),
                size: 123_456,
              },
              publishedAt: '2026-09-28T10:00:00Z',
            },
          ],
        },
      ],
    });

    expect(index.packages[0]?.versions[0]?.requires).toEqual({ packages: {}, services: [] });
    expect(index.generatedAt).toBeInstanceOf(Date);
  });

  it('refuses an archive not over HTTPS, and a package listed twice', () => {
    const entry = {
      id: 'mqtt',
      name: 'MQTT',
      description: 'The broker.',
      repository: 'nebulahome/pkg-mqtt',
      category: 'protocol',
      versions: [
        {
          version: '1.0.0',
          platform: '^1.0.0',
          sdk: '^1.0.0',
          artifact: { url: 'http://example.com/mqtt.tgz', sha256: 'a'.repeat(64), size: 1 },
          publishedAt: '2026-09-28T10:00:00Z',
        },
      ],
    };

    expect(
      packageIndexSchema.safeParse({ generatedAt: '2026-09-29T08:00:00Z', packages: [entry] })
        .success,
    ).toBe(false);

    const https = {
      ...entry,
      versions: [
        {
          ...entry.versions[0],
          artifact: { ...entry.versions[0]?.artifact, url: 'https://example.com/m.tgz' },
        },
      ],
    };

    expect(
      packageIndexSchema.safeParse({
        generatedAt: '2026-09-29T08:00:00Z',
        packages: [https, https],
      }).error?.issues[0]?.message,
    ).toBe('Each package is listed once');
  });
});
