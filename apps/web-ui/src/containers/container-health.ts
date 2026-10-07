/**
 * The health strip of a container's page - Runtime, Image, Used by - and the line its hero says
 * about what it is for.
 *
 * Three cards where the board draws four: how often it restarted is not told by Docker's summary
 * nor kept by the supervisor, so the Restarts card waits for the backend to count them.
 *
 * Pure, so the page draws what a test can hold it to.
 */
import type { ContainerDetail, ContainerSummary } from '@nebulahome/contracts';
import type { HealthTone, PillTone } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';

/** One card of the strip, before it is drawn. */
export type ContainerHealthLine = {
  readonly tone: HealthTone;
  readonly value: string;
  readonly detail: string;
};

/** How each state reads in a Pill. */
const STATE_PILLS: Readonly<
  Record<ContainerSummary['state'], { readonly tone: PillTone; readonly label: string }>
> = {
  created: { tone: 'neutral', label: 'Created' },
  running: { tone: 'success', label: 'Running' },
  paused: { tone: 'warning', label: 'Paused' },
  restarting: { tone: 'warning', label: 'Restarting' },
  removing: { tone: 'neutral', label: 'Removing' },
  exited: { tone: 'neutral', label: 'Stopped' },
  dead: { tone: 'danger', label: 'Dead' },
};

/**
 * A container's state as its Pill says it; a failing health check outweighs "running".
 *
 * @param container - The container.
 * @returns The Pill's tone and word.
 */
export function containerPill(container: Pick<ContainerSummary, 'state' | 'health'>): {
  readonly tone: PillTone;
  readonly label: string;
} {
  if (container.state === 'running' && container.health === 'unhealthy') {
    return { tone: 'warning', label: 'Unhealthy' };
  }

  return STATE_PILLS[container.state];
}

/**
 * What the container is for, in a line: who runs it, or what it belongs to.
 *
 * @param container - The container.
 * @returns The line.
 */
export function containerPurpose(container: ContainerDetail): string {
  if (container.managedBy !== null && !container.managedBy.isReleased) {
    return container.managedBy.ownerKind === 'package'
      ? `Runs for the ${container.managedBy.vendorId} package.`
      : `Runs the bridge for the ${container.managedBy.vendorId} integration.`;
  }

  if (container.isSystem) {
    return container.isSelf ? 'Nebula Home itself.' : 'Part of Nebula Home.';
  }

  if (container.compose !== null) {
    return `The ${container.compose.service} service of ${container.compose.project}.`;
  }

  return `Runs ${container.image}.`;
}

/**
 * How the container's process stands.
 *
 * @param container - The container.
 * @returns The Runtime card.
 */
export function containerRuntimeHealth(container: ContainerDetail): ContainerHealthLine {
  const since =
    container.startedAt === null ? null : `up since ${relativeTime(container.startedAt)}`;

  switch (container.state) {
    case 'running':
      return container.health === 'unhealthy'
        ? { tone: 'warning', value: 'Unhealthy', detail: 'Its healthcheck is failing' }
        : {
            tone: 'success',
            value: 'Running',
            detail: [container.health === null ? null : `Healthcheck ${container.health}`, since]
              .filter((part) => part !== null)
              .join(' · '),
          };
    case 'restarting':
      return { tone: 'warning', value: 'Restarting', detail: container.status };
    case 'paused':
      return { tone: 'warning', value: 'Paused', detail: container.status };
    case 'dead':
      return { tone: 'danger', value: 'Dead', detail: container.status };
    case 'exited':
      return { tone: 'neutral', value: 'Stopped', detail: container.status };
    case 'created':
      return { tone: 'neutral', value: 'Created', detail: 'Never started' };
    case 'removing':
      return { tone: 'neutral', value: 'Removing', detail: container.status };
  }
}

/**
 * Whether a newer image is waiting, or one is being installed.
 *
 * @param container - The container.
 * @returns The Image card.
 */
export function containerImageHealth(container: ContainerDetail): ContainerHealthLine {
  const running = `Running ${container.version ?? container.image}`;

  if (container.update.isInstalling) {
    return {
      tone: 'info',
      value: 'Updating',
      detail:
        container.update.progress === null
          ? 'Pulling the new image'
          : `${String(container.update.progress)}% pulled`,
    };
  }

  if (container.update.error !== null) {
    return { tone: 'warning', value: 'Check failed', detail: container.update.error };
  }

  if (container.update.isAvailable) {
    return {
      tone: 'info',
      value: `${container.update.latestVersion ?? 'A newer image'} ready`,
      detail: running,
    };
  }

  if (container.update.checkedAt === null) {
    return { tone: 'neutral', value: 'Not checked', detail: running };
  }

  return { tone: 'success', value: 'Up to date', detail: running };
}

/** How the integration or package that runs a container stands, when it is known. */
export type OwnerStanding = {
  readonly name: string;

  /** Whether it works: a vendor that is degraded, a package that does not run, does not. */
  readonly isWorking: boolean;

  /** Why not, in a line. */
  readonly problem: string | null;
};

/**
 * What uses the container, and whether it is waiting.
 *
 * @param container - The container.
 * @param owner - How what runs it stands, when the page could read it.
 * @returns The Used by card.
 */
export function containerUsedByHealth(
  container: ContainerDetail,
  owner: OwnerStanding | null,
): ContainerHealthLine {
  if (container.managedBy !== null && !container.managedBy.isReleased) {
    const kind = container.managedBy.ownerKind === 'package' ? 'package' : 'integration';

    if (owner === null) {
      return { tone: 'neutral', value: container.managedBy.vendorId, detail: `Its ${kind}` };
    }

    return owner.isWorking
      ? { tone: 'success', value: owner.name, detail: `Its ${kind} works` }
      : {
          tone: 'warning',
          value: 'Waiting',
          detail: owner.problem ?? `The ${kind} is not working`,
        };
  }

  if (container.isSystem) {
    return { tone: 'neutral', value: 'Nebula Home', detail: 'Part of the platform' };
  }

  if (container.compose !== null) {
    return {
      tone: 'neutral',
      value: container.compose.project,
      detail: `As its ${container.compose.service} service`,
    };
  }

  return { tone: 'neutral', value: 'Nothing', detail: 'Nothing else depends on it' };
}
