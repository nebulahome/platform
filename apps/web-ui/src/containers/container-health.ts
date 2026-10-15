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

import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { relativeTime } from '@/lib/format-time';

/** One card of the strip, before it is drawn. */
export type ContainerHealthLine = {
  readonly tone: HealthTone;
  readonly value: string;
  readonly detail: string;
};

/** How each state reads in a Pill. */
const STATE_PILLS: Readonly<
  Record<ContainerSummary['state'], { readonly tone: PillTone; readonly label: Message }>
> = {
  created: {
    tone: 'neutral',
    label: defineMessage('containers.containerHealth.created', 'Created'),
  },
  running: {
    tone: 'success',
    label: defineMessage('containers.containerHealth.running', 'Running'),
  },
  paused: { tone: 'warning', label: defineMessage('containers.containerHealth.paused', 'Paused') },
  restarting: {
    tone: 'warning',
    label: defineMessage('containers.containerHealth.restarting', 'Restarting'),
  },
  removing: {
    tone: 'neutral',
    label: defineMessage('containers.containerHealth.removing', 'Removing'),
  },
  exited: {
    tone: 'neutral',
    label: defineMessage('containers.containerHealth.stopped', 'Stopped'),
  },
  dead: { tone: 'danger', label: defineMessage('containers.containerHealth.dead', 'Dead') },
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
    return {
      tone: 'warning',
      label: translate('containers.containerHealth.unhealthy', 'Unhealthy'),
    };
  }

  const pill = STATE_PILLS[container.state];

  return { ...pill, label: text(pill.label) };
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
    return container.isSelf
      ? translate('containers.containerHealth.nebulaHomeItself', 'Nebula Home itself.')
      : translate('containers.containerHealth.partOfNebulaHome', 'Part of Nebula Home.');
  }

  if (container.compose !== null) {
    return translate(
      'containers.containerHealth.serviceServiceOfProject',
      'The {{service}} service of {{project}}.',
      { service: container.compose.service, project: container.compose.project },
    );
  }

  return translate('containers.containerHealth.runsImage', 'Runs {{image}}.', {
    image: container.image,
  });
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
        ? {
            tone: 'warning',
            value: translate('containers.containerHealth.unhealthy', 'Unhealthy'),
            detail: translate(
              'containers.containerHealth.itsHealthcheckIsFailing',
              'Its healthcheck is failing',
            ),
          }
        : {
            tone: 'success',
            value: translate('containers.containerHealth.running', 'Running'),
            detail: [
              container.health === null
                ? null
                : translate(
                    'containers.containerHealth.healthcheckHealth',
                    'Healthcheck {{health}}',
                    { health: container.health },
                  ),
              since,
            ]
              .filter((part) => part !== null)
              .join(' · '),
          };
    case 'restarting':
      return {
        tone: 'warning',
        value: translate('containers.containerHealth.restarting', 'Restarting'),
        detail: container.status,
      };
    case 'paused':
      return {
        tone: 'warning',
        value: translate('containers.containerHealth.paused', 'Paused'),
        detail: container.status,
      };
    case 'dead':
      return {
        tone: 'danger',
        value: translate('containers.containerHealth.dead', 'Dead'),
        detail: container.status,
      };
    case 'exited':
      return {
        tone: 'neutral',
        value: translate('containers.containerHealth.stopped', 'Stopped'),
        detail: container.status,
      };
    case 'created':
      return {
        tone: 'neutral',
        value: translate('containers.containerHealth.created', 'Created'),
        detail: translate('containers.containerHealth.neverStarted', 'Never started'),
      };
    case 'removing':
      return {
        tone: 'neutral',
        value: translate('containers.containerHealth.removing', 'Removing'),
        detail: container.status,
      };
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
      value: translate('containers.containerHealth.updating', 'Updating'),
      detail:
        container.update.progress === null
          ? translate('containers.containerHealth.pullingTheNewImage', 'Pulling the new image')
          : translate('containers.containerHealth.progressPulled', '{{progress}}% pulled', {
              progress: String(container.update.progress),
            }),
    };
  }

  if (container.update.error !== null) {
    return {
      tone: 'warning',
      value: translate('containers.containerHealth.checkFailed', 'Check failed'),
      detail: container.update.error,
    };
  }

  if (container.update.isAvailable) {
    return {
      tone: 'info',
      value: `${container.update.latestVersion ?? translate('containers.containerHealth.newerImage', 'A newer image')} ready`,
      detail: running,
    };
  }

  if (container.update.checkedAt === null) {
    return {
      tone: 'neutral',
      value: translate('containers.containerHealth.notChecked', 'Not checked'),
      detail: running,
    };
  }

  return {
    tone: 'success',
    value: translate('containers.containerHealth.upToDate', 'Up to date'),
    detail: running,
  };
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
      return {
        tone: 'neutral',
        value: container.managedBy.vendorId,
        detail: translate('containers.containerHealth.itsKind', 'Its {{kind}}', { kind }),
      };
    }

    return owner.isWorking
      ? {
          tone: 'success',
          value: owner.name,
          detail: translate('containers.containerHealth.itsKindWorks', 'Its {{kind}} works', {
            kind,
          }),
        }
      : {
          tone: 'warning',
          value: translate('containers.containerHealth.waiting', 'Waiting'),
          detail:
            owner.problem ??
            translate(
              'containers.containerHealth.kindIsNotWorking',
              'The {{kind}} is not working',
              { kind },
            ),
        };
  }

  if (container.isSystem) {
    return {
      tone: 'neutral',
      value: 'Nebula Home',
      detail: translate('containers.containerHealth.partOfThePlatform', 'Part of the platform'),
    };
  }

  if (container.compose !== null) {
    return {
      tone: 'neutral',
      value: container.compose.project,
      detail: translate(
        'containers.containerHealth.asItsServiceService',
        'As its {{service}} service',
        { service: container.compose.service },
      ),
    };
  }

  return {
    tone: 'neutral',
    value: translate('containers.containerHealth.nothing', 'Nothing'),
    detail: translate(
      'containers.containerHealth.nothingElseDependsOn',
      'Nothing else depends on it',
    ),
  };
}
