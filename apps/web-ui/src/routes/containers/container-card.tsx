/**
 * The cards of the containers grid: one container, one compose project, one install still going.
 *
 * The same card as a vendor's on the integrations page - the same size, the same three lines of
 * type, the tile top left and the marks top right - so the two grids read as one design. The
 * tile is the container's icon on a tint of its own, the mark a dot that says whether it runs;
 * the name is the one people read, the image beneath it, and what it takes of the machine at the
 * foot, where the vendor's counts are.
 */
import { Link } from 'react-router';

import type { ContainerInstall, ContainerSummary } from '@nebula-home/contracts';
import { Badge, Button, cn } from '@nebula-home/ui';

import { groupUsage, type ComposeGroup } from '@/containers/container-groups';
import { formatBytes, formatPercent } from '@/lib/format-bytes';
import {
  ContainerBadges,
  ContainerTile,
  dotOf,
  ProgressBar,
  StatusDot,
  type DotTone,
} from '@/routes/containers/container-parts';

/** The shape every card of the grid has: the vendor card's. */
const CARD =
  'flex h-41 flex-col rounded-panel border border-border face-card p-[18px] ' +
  'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-card ' +
  'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none';

/** What each phase of a compose operation is called on a card. */
const COMPOSE_PHASE_LABELS = {
  pulling: 'Pulling',
  starting: 'Starting',
  stopping: 'Stopping',
  removing: 'Removing',
  done: 'Done',
  failed: 'Failed',
} as const;

/** What each phase of an install is called on a card. */
const INSTALL_PHASE_LABELS = {
  pulling: 'Downloading',
  creating: 'Creating',
  starting: 'Starting',
  failed: 'Failed',
} as const;

/**
 * The path of a container's page.
 *
 * @param name - The container.
 * @returns `/containers/<name>`.
 */
export function containerPath(name: string): string {
  return `/containers/${encodeURIComponent(name)}`;
}

/**
 * The path of a compose project's page.
 *
 * @param project - The project.
 * @returns `/containers/compose/<project>`.
 */
export function composePath(project: string): string {
  return `/containers/compose/${encodeURIComponent(project)}`;
}

/**
 * The foot of a card: two figures, pulled forward, and their words.
 *
 * @param props - The parts.
 * @param props.parts - Each part as a figure and its word; a null figure is left out.
 * @returns The line.
 */
function Foot(props: { readonly parts: readonly (readonly [string | null, string])[] }) {
  const parts = props.parts.filter(([figure]) => figure !== null);

  return (
    <span className="mt-3 flex items-baseline gap-1 truncate text-ui leading-tight text-foreground-muted tabular">
      {parts.map(([figure, word], index) => (
        <span key={word} className="flex items-baseline gap-1">
          {index > 0 ? <span className="mx-1 text-foreground-subtle">·</span> : null}
          <span className="font-medium text-foreground">{figure}</span>
          <span>{word}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * One container started on its own. The whole card leads to its page.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The card.
 */
export function ContainerCard(props: { readonly container: ContainerSummary }) {
  const { container } = props;
  const dot = dotOf(container);
  const isRunning = container.state === 'running';

  return (
    <li className="list-none">
      <Link to={containerPath(container.name)} aria-label={container.displayName} className={CARD}>
        <span className="flex items-start gap-1.5">
          <ContainerTile name={container.name} icon="container" size={44} />
          <span className="grow" />
          <StatusDot tone={dot.tone} title={dot.title} isBusy={dot.isBusy} />
        </span>

        <span className="mt-4 flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] leading-tight font-medium text-foreground">
              {container.displayName}
            </span>
            <ContainerBadges container={container} isStateShown={false} />
          </span>
          <span
            title={container.image}
            className="truncate font-mono text-caption leading-tight text-foreground-subtle"
          >
            {container.image}
          </span>
        </span>

        <span className="grow" />

        {isRunning ? (
          <Foot
            parts={[
              [container.cpuPercent === null ? null : formatPercent(container.cpuPercent), 'CPU'],
              [
                container.memoryUsedBytes === null ? null : formatBytes(container.memoryUsedBytes),
                'RAM',
              ],
            ]}
          />
        ) : (
          <span className="mt-3 truncate text-ui leading-tight text-foreground-muted">
            {container.status === '' ? container.state : container.status}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * How a project's dot reads: its operation, when one is going, or how many of its containers
 * run.
 *
 * @param group - The project.
 * @returns The tone, what it says, and whether it pulses.
 */
function projectDot(group: ComposeGroup): {
  readonly tone: DotTone;
  readonly title: string;
  readonly isBusy: boolean;
} {
  const phase = group.operation?.phase;

  if (phase !== undefined && phase !== 'done' && phase !== 'failed') {
    return { tone: 'accent', title: COMPOSE_PHASE_LABELS[phase], isBusy: true };
  }

  const { running } = groupUsage(group);
  const total = group.containers.length;

  if (total === 0) {
    return phase === 'failed'
      ? { tone: 'danger', title: 'The last deployment failed', isBusy: false }
      : { tone: 'neutral', title: 'No container yet', isBusy: false };
  }

  if (group.containers.some((container) => container.health === 'unhealthy')) {
    return { tone: 'danger', title: 'A container is unhealthy', isBusy: false };
  }

  return running === total
    ? { tone: 'success', title: 'Every container runs', isBusy: false }
    : running === 0
      ? { tone: 'neutral', title: 'Stopped', isBusy: false }
      : {
          tone: 'warning',
          title: `${String(running)} of ${String(total)} running`,
          isBusy: false,
        };
}

/**
 * One compose project: its containers together. The whole card leads to the project's page.
 *
 * @param props - The project.
 * @param props.group - It.
 * @returns The card.
 */
export function ComposeCard(props: { readonly group: ComposeGroup }) {
  const { group } = props;
  const dot = projectDot(group);
  const usage = groupUsage(group);
  const total = group.containers.length;
  const phase = group.operation?.phase;
  const isWorking = phase !== undefined && phase !== 'done' && phase !== 'failed';

  return (
    <li className="list-none">
      <Link to={composePath(group.project)} aria-label={group.title} className={CARD}>
        <span className="flex items-start gap-1.5">
          <ContainerTile name={group.project} icon="layers" size={44} />
          <span className="grow" />
          <StatusDot tone={dot.tone} title={dot.title} isBusy={dot.isBusy} />
        </span>

        <span className="mt-4 flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] leading-tight font-medium text-foreground">
              {group.title}
            </span>
            {group.isSystem ? (
              <Badge tone="accent" size="small">
                System
              </Badge>
            ) : isWorking ? (
              <Badge tone="accent" size="small">
                {COMPOSE_PHASE_LABELS[phase]}
              </Badge>
            ) : phase === 'failed' ? (
              <Badge tone="danger" size="small">
                Failed
              </Badge>
            ) : null}
          </span>
          <span className="truncate text-caption leading-tight text-foreground-subtle">
            Compose · {total} {total === 1 ? 'container' : 'containers'}
          </span>
        </span>

        <span className="grow" />

        <Foot
          parts={[
            [String(usage.running), 'running'],
            [usage.cpuPercent === null ? null : formatPercent(usage.cpuPercent), 'CPU'],
            [usage.memoryUsedBytes === null ? null : formatBytes(usage.memoryUsedBytes), 'RAM'],
          ]}
        />
      </Link>
    </li>
  );
}

/** What an install's card needs. */
type InstallCardProps = {
  readonly install: ContainerInstall;

  /** Forgets a failed install; absent for somebody who may not. */
  readonly onDismiss?: (name: string) => void;
};

/**
 * One container being installed: the image being pulled, made and started. Not a link - there
 * is no container to open yet - and, once failed, why, with the way to put it away.
 *
 * @param props - See {@link InstallCardProps}.
 * @returns The card.
 */
export function InstallCard(props: InstallCardProps) {
  const { install, onDismiss } = props;
  const isFailed = install.phase === 'failed';

  return (
    <li className="list-none">
      <div
        className={cn(CARD, 'hover:border-border hover:shadow-none')}
        aria-busy={!isFailed}
        aria-label={`${install.name}: ${INSTALL_PHASE_LABELS[install.phase]}`}
      >
        <span className="flex items-start gap-1.5">
          <ContainerTile name={install.name} icon="download" size={44} />
          <span className="grow" />
          <StatusDot
            tone={isFailed ? 'danger' : 'accent'}
            title={INSTALL_PHASE_LABELS[install.phase]}
            isBusy={!isFailed}
          />
        </span>

        <span className="mt-4 flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] leading-tight font-medium text-foreground">
              {install.name}
            </span>
            <Badge tone={isFailed ? 'danger' : 'accent'} size="small">
              {INSTALL_PHASE_LABELS[install.phase]}
            </Badge>
          </span>
          <span className="truncate font-mono text-caption leading-tight text-foreground-subtle">
            {install.image}
          </span>
        </span>

        <span className="grow" />

        {isFailed ? (
          <span className="mt-3 flex items-center gap-2">
            <span
              title={install.error ?? undefined}
              className="grow truncate text-caption text-danger"
            >
              {install.error ?? 'It did not install'}
            </span>
            {onDismiss === undefined ? null : (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  onDismiss(install.name);
                }}
              >
                Dismiss
              </Button>
            )}
          </span>
        ) : (
          <span className="mt-3 flex flex-col gap-1.5">
            <ProgressBar
              percent={install.phase === 'pulling' ? install.progress : null}
              label={`Installing ${install.name}`}
            />
            <span className="text-caption text-foreground-subtle tabular">
              {install.phase === 'pulling' && install.progress !== null
                ? `${String(Math.round(install.progress))}% downloaded`
                : `${INSTALL_PHASE_LABELS[install.phase]}…`}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}
