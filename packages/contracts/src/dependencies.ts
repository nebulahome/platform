/**
 * What depends on what: packages on packages, packages and integrations on services.
 *
 * A package's manifest - and a vendor's - says what it needs (`requires`): the platform in a
 * version range, packages by id and range, and services by name, which any package that
 * `provides` them satisfies - Zigbee2MQTT needs `mqtt-broker`, not `pkg-mqtt` itself, so a package
 * with another broker may stand in. This file is the one reading of those declarations, shared by
 * the packet-manager (what to install, in which order, and what may be removed), `hub` (which
 * vendors wait for a package) and `api` (why a request is refused):
 *
 * - {@link planInstall} - what installing a package takes: the packages it needs that are not
 *   there, dependencies first, or what stands in the way;
 * - {@link unmetRequirements} - what an installed package or a vendor still waits for;
 * - {@link dependentsOf} - who needs a package, so that removing it is refused while they do;
 * - {@link blockedUpdate} - who a new version of a package would leave out of their range;
 * - {@link startOrder} - installed packages in the order they can start.
 *
 * Comparing a version with a range is handed in (`semver.satisfies`): the services carry the
 * `semver` package, and one implementation of npm's rules is enough. Every problem says both
 * parties by name, since "cannot install" helps nobody and "MQTT needs NebulaHome 2.0 or later,
 * this is 1.4.0" tells the owner what to do.
 */
import type { PackageRequires } from './package-requires.js';
import type { SatisfiesRange } from './semver.js';

/** One package, as far as dependencies go: what it is, what it needs, what it offers. */
export type DependencyNode = {
  readonly id: string;
  readonly version: string;
  readonly requires: PackageRequires;
  readonly provides: readonly string[];
};

/** A package installed, and whether it is running. */
export type InstalledNode = DependencyNode & {
  readonly isRunning: boolean;
};

/** Something with requirements that is not a package: a vendor, by its id. */
export type Dependent = {
  readonly kind: 'package' | 'vendor';
  readonly id: string;
  readonly requires: PackageRequires;
};

/** Why something cannot be installed, started, removed or updated. */
export type DependencyProblem =
  | {
      readonly kind: 'platform';
      readonly by: string;
      readonly range: string;
      readonly version: string;
    }
  | {
      readonly kind: 'missing-package';
      readonly by: string;
      readonly packageId: string;
      readonly range: string;
    }
  | {
      readonly kind: 'version';
      readonly by: string;
      readonly packageId: string;
      readonly range: string;
      readonly version: string;
    }
  | { readonly kind: 'not-running'; readonly by: string; readonly packageId: string }
  | { readonly kind: 'missing-service'; readonly by: string; readonly service: string }
  | { readonly kind: 'cycle'; readonly path: readonly string[] }
  | { readonly kind: 'no-release'; readonly packageId: string; readonly range: string };

/**
 * One problem, in a sentence for the owner.
 *
 * @param problem - The problem.
 * @param nameOf - What a package or a vendor is called, by its id; the id when unknown.
 * @returns The sentence.
 */
export function describeDependencyProblem(
  problem: DependencyProblem,
  nameOf: (id: string) => string = (id) => id,
): string {
  switch (problem.kind) {
    case 'platform': {
      return `${nameOf(problem.by)} needs NebulaHome ${problem.range}; this is ${problem.version}`;
    }

    case 'missing-package': {
      return `${nameOf(problem.by)} needs the ${nameOf(problem.packageId)} package (${problem.range}), which is not installed`;
    }

    case 'version': {
      return `${nameOf(problem.by)} needs ${nameOf(problem.packageId)} ${problem.range}; ${problem.version} is installed`;
    }

    case 'not-running': {
      return `${nameOf(problem.by)} needs the ${nameOf(problem.packageId)} package, which is not running`;
    }

    case 'missing-service': {
      return `${nameOf(problem.by)} needs a package that provides ${problem.service}, and none does`;
    }

    case 'cycle': {
      return `The packages need each other in a circle: ${problem.path.map(nameOf).join(' → ')}`;
    }

    case 'no-release': {
      return `No release of ${nameOf(problem.packageId)} matches ${problem.range} and this NebulaHome`;
    }
  }
}

/** What {@link planInstall} is given about what could be installed. */
export type Candidate = DependencyNode & {
  /** The platform versions it works with. */
  readonly platform: string;
};

/** What installing takes, or why it cannot be done. */
export type InstallPlan = {
  /** What to install, dependencies first; the package asked for is last. Empty on a problem. */
  readonly install: readonly Candidate[];
  readonly problems: readonly DependencyProblem[];
};

/** What planning an installation needs to know. */
export type InstallContext = {
  /** What is installed now. */
  readonly installed: readonly DependencyNode[];

  /** Every release of every package the index offers, by package id. */
  readonly available: ReadonlyMap<string, readonly Candidate[]>;

  /** This platform's version. */
  readonly platformVersion: string;

  readonly satisfies: SatisfiesRange;
};

/**
 * The newest release of a package in a range that works with this platform.
 *
 * @param releases - Its releases.
 * @param range - The range, or undefined for any.
 * @param context - The platform's version and the comparison.
 * @returns The release, or undefined.
 */
function newestIn(
  releases: readonly Candidate[],
  range: string | undefined,
  context: Pick<InstallContext, 'platformVersion' | 'satisfies'>,
): Candidate | undefined {
  return releases
    .filter(
      (release) =>
        (range === undefined || context.satisfies(release.version, range)) &&
        context.satisfies(context.platformVersion, release.platform),
    )
    .reduce<Candidate | undefined>(
      (newest, release) =>
        newest === undefined || compareVersions(release.version, newest.version) > 0
          ? release
          : newest,
      undefined,
    );
}

/**
 * Compares two versions by their numbers, a prerelease below its release.
 *
 * @param left - One version.
 * @param right - The other.
 * @returns Negative, zero or positive, as `left` is older, the same, or newer.
 */
export function compareVersions(left: string, right: string): number {
  const [leftCore = '', leftPre] = left.split('+')[0]?.split('-', 2) ?? [];
  const [rightCore = '', rightPre] = right.split('+')[0]?.split('-', 2) ?? [];
  const leftParts = leftCore.split('.').map(Number);
  const rightParts = rightCore.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  if (leftPre === rightPre) {
    return 0;
  }

  if (leftPre === undefined) {
    return 1;
  }

  if (rightPre === undefined) {
    return -1;
  }

  return leftPre < rightPre ? -1 : 1;
}

/**
 * What installing a package takes: the newest release in the range, and each package it needs
 * that is not installed - by id, or as the provider of a service nothing installed provides -
 * dependencies first.
 *
 * Greedy: the newest release that fits is taken, and never reconsidered. First-party packages
 * keep their ranges wide enough for that; a conflict it cannot settle is said, not searched.
 *
 * @param packageId - The package to install.
 * @param range - Which releases; undefined for the newest.
 * @param context - What is installed, what is offered, and how versions compare.
 * @returns The plan.
 */
export function planInstall(
  packageId: string,
  range: string | undefined,
  context: InstallContext,
): InstallPlan {
  const installed = new Map(context.installed.map((node) => [node.id, node]));
  const planned = new Map<string, Candidate>();
  const order: Candidate[] = [];
  const problems: DependencyProblem[] = [];

  /**
   * Says whether a service is provided by what is installed or planned.
   *
   * @param service - The service.
   * @returns True when it is.
   */
  const isProvided = (service: string): boolean =>
    [...installed.values(), ...planned.values()].some((node) => node.provides.includes(service));

  /**
   * Plans one package and what it needs.
   *
   * @param id - The package.
   * @param wanted - Which releases.
   * @param path - The packages that led here, to see a circle.
   */
  const visit = (id: string, wanted: string | undefined, path: readonly string[]): void => {
    if (path.includes(id)) {
      problems.push({ kind: 'cycle', path: [...path.slice(path.indexOf(id)), id] });

      return;
    }

    if (planned.has(id)) {
      return;
    }

    const release = newestIn(context.available.get(id) ?? [], wanted, context);

    if (release === undefined) {
      problems.push({ kind: 'no-release', packageId: id, range: wanted ?? '*' });

      return;
    }

    planned.set(id, release);

    const { requires } = release;

    if (
      requires.platform !== undefined &&
      !context.satisfies(context.platformVersion, requires.platform)
    ) {
      problems.push({
        kind: 'platform',
        by: id,
        range: requires.platform,
        version: context.platformVersion,
      });
    }

    for (const [dependency, dependencyRange] of Object.entries(requires.packages)) {
      const present = installed.get(dependency);

      if (present !== undefined) {
        if (!context.satisfies(present.version, dependencyRange)) {
          problems.push({
            kind: 'version',
            by: id,
            packageId: dependency,
            range: dependencyRange,
            version: present.version,
          });
        }

        continue;
      }

      visit(dependency, dependencyRange, [...path, id]);
    }

    for (const service of requires.services) {
      if (isProvided(service)) {
        continue;
      }

      // The first package offering it, by id, so a plan is the same every time it is made.
      const provider = [...context.available.entries()]
        .filter(([candidate]) => candidate !== id)
        .sort(([left], [right]) => left.localeCompare(right))
        .find(([, releases]) => newestIn(releases, undefined, context)?.provides.includes(service));

      if (provider === undefined) {
        problems.push({ kind: 'missing-service', by: id, service });
        continue;
      }

      visit(provider[0], undefined, [...path, id]);
    }

    order.push(release);
  };

  visit(packageId, range, []);

  return problems.length > 0 ? { install: [], problems } : { install: order, problems: [] };
}

/**
 * What a package or a vendor still waits for among what is installed: a package missing, one in
 * the wrong version or stopped, a service nothing running provides, a platform out of range.
 *
 * @param by - Who needs it, by id: the problems name it.
 * @param requires - What it needs.
 * @param installed - What is installed.
 * @param context - This platform's version, and how versions compare.
 * @returns What is missing; empty when nothing is.
 */
export function unmetRequirements(
  by: string,
  requires: PackageRequires,
  installed: readonly InstalledNode[],
  context: Pick<InstallContext, 'platformVersion' | 'satisfies'>,
): DependencyProblem[] {
  const problems: DependencyProblem[] = [];
  const byId = new Map(installed.map((node) => [node.id, node]));

  if (
    requires.platform !== undefined &&
    !context.satisfies(context.platformVersion, requires.platform)
  ) {
    problems.push({
      kind: 'platform',
      by,
      range: requires.platform,
      version: context.platformVersion,
    });
  }

  for (const [packageId, range] of Object.entries(requires.packages)) {
    const present = byId.get(packageId);

    if (present === undefined) {
      problems.push({ kind: 'missing-package', by, packageId, range });
    } else if (!context.satisfies(present.version, range)) {
      problems.push({ kind: 'version', by, packageId, range, version: present.version });
    } else if (!present.isRunning) {
      problems.push({ kind: 'not-running', by, packageId });
    }
  }

  for (const service of requires.services) {
    const providers = installed.filter((node) => node.id !== by && node.provides.includes(service));

    if (providers.length === 0) {
      problems.push({ kind: 'missing-service', by, service });
    } else if (!providers.some((node) => node.isRunning)) {
      problems.push({ kind: 'not-running', by, packageId: providers[0]?.id ?? service });
    }
  }

  return problems;
}

/**
 * Who needs a package: the packages and vendors that require it by id, or that require a
 * service it provides and no other installed package does.
 *
 * @param packageId - The package.
 * @param installed - What is installed, it among them.
 * @param dependents - Everything with requirements: the installed packages and the vendors.
 * @returns Who would be left waiting without it.
 */
export function dependentsOf(
  packageId: string,
  installed: readonly DependencyNode[],
  dependents: readonly Dependent[],
): Dependent[] {
  const target = installed.find((node) => node.id === packageId);
  const soleServices = new Set(
    (target?.provides ?? []).filter(
      (service) =>
        !installed.some((node) => node.id !== packageId && node.provides.includes(service)),
    ),
  );

  return dependents.filter(
    (dependent) =>
      !(dependent.kind === 'package' && dependent.id === packageId) &&
      (packageId in dependent.requires.packages ||
        dependent.requires.services.some((service) => soleServices.has(service))),
  );
}

/**
 * Who a new version of a package would leave out of their range.
 *
 * @param packageId - The package.
 * @param version - The new version.
 * @param dependents - The packages and vendors that could need it.
 * @param satisfies - How versions compare.
 * @returns The problems: one per dependent whose range the version is not in.
 */
export function blockedUpdate(
  packageId: string,
  version: string,
  dependents: readonly Dependent[],
  satisfies: SatisfiesRange,
): DependencyProblem[] {
  return dependents.flatMap((dependent): DependencyProblem[] => {
    const range = dependent.requires.packages[packageId];

    return range === undefined || satisfies(version, range)
      ? []
      : [{ kind: 'version', by: dependent.id, packageId, range, version }];
  });
}

/**
 * The installed packages in an order they can start in: each after the packages it requires and
 * the providers of the services it requires. A package in a circle is left out, with the circle.
 *
 * @param installed - What is installed.
 * @returns The order, and any circle found.
 */
export function startOrder(installed: readonly DependencyNode[]): {
  readonly order: readonly string[];
  readonly problems: readonly DependencyProblem[];
} {
  const byId = new Map(installed.map((node) => [node.id, node]));
  const order: string[] = [];
  const done = new Set<string>();
  const problems: DependencyProblem[] = [];

  /**
   * The installed packages one package starts after.
   *
   * @param node - The package.
   * @returns Their ids.
   */
  const before = (node: DependencyNode): string[] => [
    ...Object.keys(node.requires.packages).filter((id) => byId.has(id)),
    ...node.requires.services.flatMap((service) =>
      installed
        .filter((other) => other.id !== node.id && other.provides.includes(service))
        .map((other) => other.id),
    ),
  ];

  /**
   * Places one package after what it needs.
   *
   * @param id - The package.
   * @param path - The packages that led here.
   * @returns False when it is in a circle.
   */
  const place = (id: string, path: readonly string[]): boolean => {
    if (done.has(id)) {
      return true;
    }

    if (path.includes(id)) {
      problems.push({ kind: 'cycle', path: [...path.slice(path.indexOf(id)), id] });

      return false;
    }

    const node = byId.get(id);

    if (node === undefined) {
      return true;
    }

    const isPlaced = before(node).every((dependency) => place(dependency, [...path, id]));

    if (isPlaced) {
      done.add(id);
      order.push(id);
    }

    return isPlaced;
  };

  for (const node of [...installed].sort((left, right) => left.id.localeCompare(right.id))) {
    place(node.id, []);
  }

  return { order, problems };
}
