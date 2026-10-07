/**
 * The health strip of a package's page: Runtime, Needs, Used by, Updates - each a standing, a word
 * and one line, read from the package and the lists the page already has.
 *
 * What is not known is not said: how many times it was restarted before it gave up is logged by
 * the packet-manager but not served, so a failure says how it ended and nothing about attempts.
 *
 * Pure, so the page draws what a test can hold it to.
 */
import type { ApiPackage, ApiPackageDetail, PackageRelation } from '@nebulahome/contracts';
import type { HealthTone } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';

/** One card of the strip, before it is drawn. */
export type PackageHealthLine = {
  readonly tone: HealthTone;
  readonly value: string;
  readonly detail: string;
};

/**
 * Names in a sentence: "MQTT", "MQTT and Matter", "MQTT, Matter and NVR".
 *
 * @param names - The names.
 * @returns The sentence's words.
 */
export function listed(names: readonly string[]): string {
  return names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * How the package's process stands.
 *
 * @param found - The package.
 * @returns The Runtime card.
 */
export function packageRuntimeHealth(found: ApiPackageDetail): PackageHealthLine {
  switch (found.state) {
    case 'running':
      return {
        tone: 'success',
        value: 'Running',
        detail:
          found.lastStartedAt === null ? 'Started' : `Started ${relativeTime(found.lastStartedAt)}`,
      };
    case 'starting':
      return { tone: 'info', value: 'Starting', detail: 'On its way up' };
    case 'failed':
      return {
        tone: 'danger',
        value: 'Failed',
        detail: found.lastError ?? 'It stopped on its own',
      };
    case 'waiting-dependency':
      return {
        tone: 'warning',
        value: 'Waiting',
        detail: found.problems[0] ?? 'For a package it needs',
      };
    case 'stopped':
      return { tone: 'neutral', value: 'Stopped', detail: 'Started again by Start' };
    case 'disabled':
      return { tone: 'neutral', value: 'Disabled', detail: 'It does not start with the house' };
    case 'installed':
      return { tone: 'neutral', value: 'Installed', detail: 'Not started yet' };
  }
}

/**
 * Whether what the package needs is there and running.
 *
 * @param found - The package.
 * @param installed - Every package installed, for how each it needs stands.
 * @returns The Needs card.
 */
export function packageNeedsHealth(
  found: ApiPackageDetail,
  installed: readonly Pick<ApiPackage, 'id' | 'state'>[],
): PackageHealthLine {
  if (found.dependsOn.length === 0) {
    return { tone: 'success', value: 'Nothing', detail: 'No other package to run' };
  }

  const down = found.dependsOn.filter(
    (relation) =>
      relation.kind === 'package' &&
      installed.find((each) => each.id === relation.id)?.state !== 'running',
  );

  if (down.length > 0 || found.problems.length > 0) {
    return {
      tone: 'warning',
      value: down.length > 0 ? `${String(down.length)} not running` : 'Not ready',
      detail: found.problems[0] ?? `${listed(down.map((each) => each.name))} must run first`,
    };
  }

  return {
    tone: 'success',
    value: listed(found.dependsOn.map((each) => each.name)),
    detail: found.dependsOn.length === 1 ? 'Running' : 'All running',
  };
}

/**
 * What needs the package, and whether it is waiting for it.
 *
 * @param found - The package.
 * @returns The Used by card.
 */
export function packageUsedByHealth(found: ApiPackageDetail): PackageHealthLine {
  const users: readonly PackageRelation[] = found.usedBy;

  if (users.length === 0) {
    return { tone: 'neutral', value: 'Nothing', detail: 'Nothing needs it' };
  }

  const names = listed(users.map((each) => each.name));

  if (found.state !== 'running') {
    return {
      tone: 'warning',
      value: `${String(users.length)} waiting`,
      detail: `${names} cannot work without it`,
    };
  }

  return {
    tone: 'success',
    value: users.length === 1 ? '1 user' : `${String(users.length)} users`,
    detail: names,
  };
}

/**
 * Whether a newer release, or another build, is waiting.
 *
 * @param found - The package.
 * @param newer - The newer release the index offers, if one is.
 * @param hasNewBuild - Whether the local folder holds another build of this version.
 * @param isOffered - Whether the index or the folder offers this package at all.
 * @returns The Updates card.
 */
export function packageUpdatesHealth(
  found: ApiPackageDetail,
  newer: string | undefined,
  hasNewBuild: boolean,
  isOffered: boolean,
): PackageHealthLine {
  if (newer !== undefined) {
    return { tone: 'info', value: `v${newer} ready`, detail: `Installed ${found.version}` };
  }

  if (hasNewBuild) {
    return { tone: 'info', value: 'New build', detail: 'Another build of the same version' };
  }

  if (!isOffered) {
    return {
      tone: 'neutral',
      value: `v${found.version}`,
      detail: found.source === 'local' ? 'Installed from a file' : 'Not in the index now',
    };
  }

  return { tone: 'success', value: 'Up to date', detail: `${found.version} is the latest` };
}
