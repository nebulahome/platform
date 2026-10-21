import { satisfies } from 'semver';
import { describe, expect, it } from 'vitest';

import {
  blockedUpdate,
  compareVersions,
  dependentsOf,
  describeDependencyProblem,
  planInstall,
  startOrder,
  unmetRequirements,
  type Candidate,
  type DependencyNode,
  type InstalledNode,
} from './dependencies.js';
import type { PackageRequires } from './package-requires.js';

/**
 * What a package needs.
 *
 * @param packages - Packages by id and range.
 * @param services - Services by name.
 * @param platform - The platform's range.
 * @returns The requirements.
 */
function requires(
  packages: Record<string, string> = {},
  services: string[] = [],
  platform?: string,
): PackageRequires {
  return { packages, services, ...(platform === undefined ? {} : { platform }) };
}

/**
 * One release the index offers.
 *
 * @param id - The package.
 * @param version - Its version.
 * @param fields - What else differs.
 * @returns The release.
 */
function release(id: string, version: string, fields: Partial<Candidate> = {}): Candidate {
  return { id, version, platform: '^1.0.0', requires: requires(), provides: [], ...fields };
}

/**
 * What the index offers, by id.
 *
 * @param releases - Every release.
 * @returns The map.
 */
function offered(...releases: Candidate[]): Map<string, Candidate[]> {
  const map = new Map<string, Candidate[]>();

  for (const each of releases) {
    map.set(each.id, [...(map.get(each.id) ?? []), each]);
  }

  return map;
}

/**
 * An installed package.
 *
 * @param id - The package.
 * @param version - Its version.
 * @param fields - What else differs.
 * @returns It.
 */
function installed(
  id: string,
  version: string,
  fields: Partial<InstalledNode> = {},
): InstalledNode {
  return { id, version, requires: requires(), provides: [], isRunning: true, ...fields };
}

const CONTEXT = { platformVersion: '1.4.0', satisfies };

describe('planning an installation', () => {
  it('takes the newest release that fits, and what it needs first', () => {
    const plan = planInstall('nvr', undefined, {
      ...CONTEXT,
      installed: [],
      available: offered(
        release('nvr', '1.0.0'),
        release('nvr', '1.2.0', { requires: requires({ ffmpeg: '^6.0.0' }) }),
        release('nvr', '2.0.0', { platform: '^2.0.0' }),
        release('ffmpeg', '6.1.0'),
        release('ffmpeg', '7.0.0'),
      ),
    });

    expect(plan.problems).toEqual([]);
    expect(plan.install.map((each) => `${each.id}@${each.version}`)).toEqual([
      'ffmpeg@6.1.0',
      'nvr@1.2.0',
    ]);
  });

  it('brings a provider of a service nothing installed provides, and none when one does', () => {
    const available = offered(
      release('nvr', '1.0.0', { requires: requires({}, ['object-detection']) }),
      release('frigate', '1.0.0', { provides: ['object-detection'] }),
    );

    expect(
      planInstall('nvr', undefined, { ...CONTEXT, installed: [], available }).install.map(
        (each) => each.id,
      ),
    ).toEqual(['frigate', 'nvr']);
    expect(
      planInstall('nvr', undefined, {
        ...CONTEXT,
        installed: [installed('deepstack', '1.0.0', { provides: ['object-detection'] })],
        available,
      }).install.map((each) => each.id),
    ).toEqual(['nvr']);
  });

  it('counts the platform’s own services as there, and refuses a package providing one', () => {
    const available = offered(
      release('zigbee-tools', '1.0.0', { requires: requires({}, ['mqtt-broker']) }),
      release('mqtt', '1.0.0', { provides: ['mqtt-broker'] }),
    );
    const broker = planInstall('mqtt', undefined, { ...CONTEXT, installed: [], available });

    expect(
      planInstall('zigbee-tools', undefined, { ...CONTEXT, installed: [], available }).install.map(
        (each) => each.id,
      ),
    ).toEqual(['zigbee-tools']);
    expect(broker.problems).toEqual([
      { kind: 'platform-service', by: 'mqtt', service: 'mqtt-broker' },
    ]);
    expect(describeDependencyProblem(broker.problems[0]!, () => 'MQTT')).toBe(
      'MQTT provides the MQTT broker, which NebulaHome runs itself',
    );
  });

  it('says why it cannot: the version installed, a circle, a service nobody provides', () => {
    const wrongVersion = planInstall('3d-home', undefined, {
      ...CONTEXT,
      installed: [installed('mqtt', '1.0.0')],
      available: offered(release('3d-home', '1.0.0', { requires: requires({ mqtt: '^2.0.0' }) })),
    });
    const circle = planInstall('a', undefined, {
      ...CONTEXT,
      installed: [],
      available: offered(
        release('a', '1.0.0', { requires: requires({ b: '*' }) }),
        release('b', '1.0.0', { requires: requires({ a: '*' }) }),
      ),
    });
    const nobody = planInstall('a', undefined, {
      ...CONTEXT,
      installed: [],
      available: offered(release('a', '1.0.0', { requires: requires({}, ['object-detection']) })),
    });

    expect(wrongVersion).toEqual({
      install: [],
      problems: [
        { kind: 'version', by: '3d-home', packageId: 'mqtt', range: '^2.0.0', version: '1.0.0' },
      ],
    });
    expect(circle.problems).toEqual([{ kind: 'cycle', path: ['a', 'b', 'a'] }]);
    expect(nobody.problems).toEqual([
      { kind: 'missing-service', by: 'a', service: 'object-detection' },
    ]);
    expect(describeDependencyProblem(wrongVersion.problems[0]!, (id) => id.toUpperCase())).toBe(
      '3D-HOME needs MQTT ^2.0.0; 1.0.0 is installed',
    );
  });

  it('finds nothing to install out of the platform’s range', () => {
    const plan = planInstall('nvr', '^2.0.0', {
      ...CONTEXT,
      installed: [],
      available: offered(release('nvr', '2.0.0', { platform: '^2.0.0' })),
    });

    expect(plan.problems).toEqual([{ kind: 'no-release', packageId: 'nvr', range: '^2.0.0' }]);
  });

  it('takes the newest release this platform’s SDK runs, and says the one it cannot', () => {
    const available = offered(
      release('nvr', '1.0.0', { sdk: '^1.0.0' }),
      release('nvr', '1.1.0', { sdk: '^1.3.0' }),
    );

    expect(
      planInstall('nvr', undefined, {
        ...CONTEXT,
        sdkVersion: '1.2.0',
        installed: [],
        available,
      }).install.map((each) => each.version),
    ).toEqual(['1.0.0']);
    expect(
      planInstall('nvr', '^1.1.0', { ...CONTEXT, sdkVersion: '1.2.0', installed: [], available })
        .problems,
    ).toEqual([{ kind: 'no-release', packageId: 'nvr', range: '^1.1.0' }]);
    expect(
      describeDependencyProblem({ kind: 'sdk', by: 'nvr', range: '^1.3.0', version: '1.2.0' }),
    ).toBe('nvr needs the NebulaHome package SDK ^1.3.0; this platform implements 1.2.0');
  });
});

describe('what is still missing', () => {
  it('names a package stopped, another missing, and a service with no provider running', () => {
    const problems = unmetRequirements(
      'zigbee2mqtt',
      requires({ ffmpeg: '^6.0.0', nvr: '^1.0.0' }, ['mqtt-broker', 'object-detection'], '^1.0.0'),
      [
        installed('ffmpeg', '6.1.0', { isRunning: false }),
        installed('frigate', '1.0.0', { provides: ['object-detection'], isRunning: false }),
      ],
      CONTEXT,
    );

    expect(problems).toEqual([
      { kind: 'not-running', by: 'zigbee2mqtt', packageId: 'ffmpeg' },
      { kind: 'missing-package', by: 'zigbee2mqtt', packageId: 'nvr', range: '^1.0.0' },
      { kind: 'not-running', by: 'zigbee2mqtt', packageId: 'frigate' },
    ]);
  });

  it('never waits for a service the platform runs itself', () => {
    expect(unmetRequirements('zigbee2mqtt', requires({}, ['mqtt-broker']), [], CONTEXT)).toEqual(
      [],
    );
  });
});

describe('who needs a package', () => {
  const nodes: DependencyNode[] = [
    installed('frigate', '1.0.0', { provides: ['object-detection'] }),
    installed('3d-home', '1.0.0', { requires: requires({ frigate: '^1.0.0' }) }),
  ];

  it('lists the packages that name it and the vendors that need what only it provides', () => {
    const dependents = dependentsOf('frigate', nodes, [
      { kind: 'package', id: '3d-home', requires: requires({ frigate: '^1.0.0' }) },
      { kind: 'vendor', id: 'unifi', requires: requires({}, ['object-detection']) },
      { kind: 'vendor', id: 'shelly', requires: requires() },
    ]);

    expect(dependents.map((each) => each.id)).toEqual(['3d-home', 'unifi']);
  });

  it('does not count a service another installed package also provides', () => {
    const dependents = dependentsOf(
      'frigate',
      [...nodes, installed('deepstack', '1.0.0', { provides: ['object-detection'] })],
      [{ kind: 'vendor', id: 'unifi', requires: requires({}, ['object-detection']) }],
    );

    expect(dependents).toEqual([]);
  });

  it('lets a package go that provides what the platform runs itself', () => {
    expect(
      dependentsOf(
        'mqtt',
        [installed('mqtt', '1.0.0', { provides: ['mqtt-broker'] })],
        [{ kind: 'vendor', id: 'zigbee2mqtt', requires: requires({}, ['mqtt-broker']) }],
      ),
    ).toEqual([]);
  });

  it('refuses an update out of a dependent’s range', () => {
    expect(
      blockedUpdate(
        'mqtt',
        '2.0.0',
        [{ kind: 'package', id: '3d-home', requires: requires({ mqtt: '^1.0.0' }) }],
        satisfies,
      ),
    ).toEqual([
      { kind: 'version', by: '3d-home', packageId: 'mqtt', range: '^1.0.0', version: '2.0.0' },
    ]);
  });
});

describe('starting in order', () => {
  it('starts a package after what it needs, a provider before who needs its service', () => {
    const { order, problems } = startOrder([
      installed('3d-home', '1.0.0', { requires: requires({ nvr: '*' }) }),
      installed('nvr', '1.0.0', { requires: requires({}, ['mqtt-broker', 'object-detection']) }),
      installed('frigate', '1.0.0', { provides: ['object-detection'] }),
    ]);

    expect(problems).toEqual([]);
    expect(order).toEqual(['frigate', 'nvr', '3d-home']);
  });
});

describe('comparing versions', () => {
  it('orders by number, a prerelease below its release', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3+build', '1.2.3')).toBe(0);
  });
});
