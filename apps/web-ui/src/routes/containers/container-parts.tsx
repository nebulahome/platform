/**
 * What the two containers pages share: the badges a container carries, and the card that says
 * Docker cannot be seen.
 */
import type { ContainerState, ContainerSummary, DockerStatus } from '@nebula-home/contracts';
import { Badge, Panel, type BadgeTone } from '@nebula-home/ui';

/** What each state means to somebody reading the page. */
const CONTAINER_TONES: Readonly<Record<ContainerState, BadgeTone>> = {
  created: 'neutral',
  running: 'success',
  paused: 'warning',
  restarting: 'accent',
  removing: 'warning',
  exited: 'neutral',
  dead: 'danger',
};

/**
 * What Docker being out of reach means, and what to do about it.
 *
 * @param props - The status.
 * @param props.docker - Why Docker cannot be seen.
 * @returns The card.
 */
export function DockerUnavailable(props: { readonly docker: DockerStatus }) {
  return (
    <Panel title="Docker cannot be seen">
      <div className="flex flex-col gap-3 px-4 py-3.5 text-ui text-foreground-muted">
        <p>{props.docker.reason ?? 'The supervisor has not reached Docker yet.'}</p>
        <p>
          The platform reaches Docker through its socket. Give the container{' '}
          <code className="font-mono text-caption">
            -v /var/run/docker.sock:/var/run/docker.sock
          </code>{' '}
          - the compose file does - and it is asked again within half a minute. The socket is the
          machine&apos;s root: only the supervisor holds it.
        </p>
      </div>
    </Panel>
  );
}

/**
 * The line of badges a container carries.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The badges.
 */
export function ContainerBadges(props: { readonly container: ContainerSummary }) {
  const { container } = props;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={CONTAINER_TONES[container.state]} size="small">
        {container.state}
      </Badge>
      {container.health === 'unhealthy' ? (
        <Badge tone="danger" size="small">
          unhealthy
        </Badge>
      ) : null}
      {container.isSelf ? (
        <Badge tone="accent" size="small">
          Core
        </Badge>
      ) : null}
      {container.managedBy !== null && !container.managedBy.isReleased ? (
        <Badge tone="neutral" size="small">
          Run by {container.managedBy.vendorId}
        </Badge>
      ) : null}
      {container.update.isInstalling ? (
        <Badge tone="accent" size="small">
          Updating
        </Badge>
      ) : container.update.isAvailable ? (
        <Badge tone="accent" size="small">
          Update available
        </Badge>
      ) : null}
    </span>
  );
}
