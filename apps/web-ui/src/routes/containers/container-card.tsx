/**
 * The cards of the containers grid: one container, one compose project, one install still going.
 *
 * The same card as a vendor's on the integrations page - the kit's Tile - so the two grids read
 * as one design. The tile is the container's icon on a tint of its own; the marks top right say
 * it is part of the platform, or that a newer image is out; the name is the one people read, the
 * image beneath it, and the foot, under its line, says how it stands as a Pill and what it takes of
 * the machine.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ContainerInstall, ContainerSummary } from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  Button,
  cn,
  Pill,
  ProgressBar,
  StatusDot,
  Tile,
  TILE_FRAME,
  TileMark,
  type PillTone,
} from '@nebulahome/ui';

import { groupUsage, type ComposeGroup } from '@/containers/container-groups';
import { containerPill } from '@/containers/container-health';
import { defineMessage, text, translate } from '@/i18n/messages';
import { formatBytes, formatPercent } from '@/lib/format-bytes';
import { ContainerTile } from '@/routes/containers/container-parts';

/** What each phase of a compose operation is called on a card. */
const COMPOSE_PHASE_LABELS = {
  pulling: defineMessage('containers.containerCard.pulling', 'Pulling'),
  starting: defineMessage('containers.containerCard.starting', 'Starting'),
  stopping: defineMessage('containers.containerCard.stopping', 'Stopping'),
  removing: defineMessage('containers.containerCard.removing', 'Removing'),
  done: defineMessage('common.done', 'Done'),
  failed: defineMessage('containers.containerCard.failed', 'Failed'),
} as const;

/** What each phase of an install is called on a card. */
const INSTALL_PHASE_LABELS = {
  pulling: defineMessage('containers.containerCard.downloading', 'Downloading'),
  creating: defineMessage('containers.containerCard.creating', 'Creating'),
  starting: defineMessage('containers.containerCard.starting', 'Starting'),
  failed: defineMessage('containers.containerCard.failed', 'Failed'),
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
 * What a card takes of the machine, for the right of its foot: "1.1% · 156 MB", or dashes for one
 * not measured.
 *
 * @param cpuPercent - Its processor share.
 * @param memoryUsedBytes - Its memory.
 * @returns The figures.
 */
function usageText(cpuPercent: number | null, memoryUsedBytes: number | null): string {
  return `${cpuPercent === null ? '—' : formatPercent(cpuPercent)} · ${
    memoryUsedBytes === null ? '—' : formatBytes(memoryUsedBytes)
  }`;
}

/**
 * The mark of a newer image: its version, in the tint an update has everywhere.
 *
 * @param props - The version.
 * @param props.version - What is out.
 * @returns The mark.
 */
function UpdateMark(props: { readonly version: string | null }) {
  const { t } = useTranslation();

  return (
    <span
      title={t('containers.containerCard.updateReady', 'Update {{version}} ready', {
        version: props.version ?? '',
      })}
      className="inline-flex h-6.5 items-center gap-1.5 rounded-chip bg-cyan/12 px-2 font-mono text-mono-caption text-cyan tabular"
    >
      <AppIcon id="circle-arrow-up" size={13} />
      {props.version ?? t('containers.containerCard.new', 'New')}
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
  const { t } = useTranslation();

  const { container } = props;
  const pill = containerPill(container);
  const isRunning = container.state === 'running';

  return (
    <li className="list-none">
      <Link
        to={containerPath(container.name)}
        aria-label={container.displayName}
        className={TILE_FRAME}
      >
        <Tile
          logo={<ContainerTile name={container.name} icon="container" size={44} />}
          marks={
            !container.isSystem && !container.update.isAvailable ? undefined : (
              <>
                {container.update.isAvailable ? (
                  <UpdateMark version={container.update.latestVersion} />
                ) : null}
                {container.isSystem ? (
                  <TileMark
                    title={t('containers.containerCard.partOfThePlatform', 'Part of the platform')}
                  >
                    <AppIcon id="lock" size={13} />
                  </TileMark>
                ) : null}
              </>
            )
          }
          name={container.displayName}
          version={container.image}
          footer={
            <>
              <Pill tone={pill.tone}>{pill.label}</Pill>
              <span className="font-mono text-mono-caption">
                {isRunning ? usageText(container.cpuPercent, container.memoryUsedBytes) : '— · —'}
              </span>
            </>
          }
        />
      </Link>
    </li>
  );
}

/**
 * How a project reads in its Pill: its operation, when one is going, or how many of its
 * containers run.
 *
 * @param group - The project.
 * @returns The tone and the word.
 */
function projectPill(group: ComposeGroup): { readonly tone: PillTone; readonly label: string } {
  const phase = group.operation?.phase;

  if (phase !== undefined && phase !== 'done' && phase !== 'failed') {
    return { tone: 'accent', label: text(COMPOSE_PHASE_LABELS[phase]) };
  }

  const { running } = groupUsage(group);
  const total = group.containers.length;

  if (total === 0) {
    return phase === 'failed'
      ? { tone: 'danger', label: translate('containers.containerCard.failed', 'Failed') }
      : {
          tone: 'neutral',
          label: translate('containers.containerCard.noContainerYet', 'No container yet'),
        };
  }

  if (group.containers.some((container) => container.health === 'unhealthy')) {
    return { tone: 'warning', label: translate('containers.containerCard.unhealthy', 'Unhealthy') };
  }

  return running === total
    ? { tone: 'success', label: translate('containers.containerCard.running', 'Running') }
    : running === 0
      ? { tone: 'neutral', label: translate('containers.containerCard.stopped', 'Stopped') }
      : {
          tone: 'warning',
          label: translate(
            'containers.containerCard.runningOfTotalRunning',
            '{{running}} of {{total}} running',
            { running: String(running), total: String(total) },
          ),
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
  const { t } = useTranslation();

  const { group } = props;
  const pill = projectPill(group);
  const usage = groupUsage(group);
  const total = group.containers.length;

  return (
    <li className="list-none">
      <Link to={composePath(group.project)} aria-label={group.title} className={TILE_FRAME}>
        <Tile
          logo={<ContainerTile name={group.project} icon="layers" size={44} />}
          marks={
            group.isSystem ? (
              <TileMark
                title={t('containers.containerCard.partOfThePlatform', 'Part of the platform')}
              >
                <AppIcon id="lock" size={13} />
              </TileMark>
            ) : undefined
          }
          name={group.title}
          version={`Compose · ${String(total)} ${total === 1 ? 'container' : 'containers'}`}
          footer={
            <>
              <Pill tone={pill.tone}>{pill.label}</Pill>
              <span className="font-mono text-mono-caption">
                {usageText(usage.cpuPercent, usage.memoryUsedBytes)}
              </span>
            </>
          }
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
  const { t } = useTranslation();

  const { install, onDismiss } = props;
  const isFailed = install.phase === 'failed';

  return (
    <li className="list-none">
      <div
        className={cn(TILE_FRAME, 'hover:border-border')}
        aria-busy={!isFailed}
        aria-label={`${install.name}: ${text(INSTALL_PHASE_LABELS[install.phase])}`}
      >
        <span className="flex items-start gap-1.5">
          <ContainerTile name={install.name} icon="download" size={44} />
          <span className="grow" />
          <StatusDot
            tone={isFailed ? 'danger' : 'accent'}
            title={text(INSTALL_PHASE_LABELS[install.phase])}
            isBusy={!isFailed}
          />
        </span>

        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-title font-medium text-foreground">{install.name}</span>
            <Badge tone={isFailed ? 'danger' : 'accent'} size="small">
              {text(INSTALL_PHASE_LABELS[install.phase])}
            </Badge>
          </span>
          <span className="truncate font-mono text-mono-caption text-foreground-subtle">
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
              {install.error ?? t('containers.containerCard.itDidNotInstall', 'It did not install')}
            </span>
            {onDismiss === undefined ? null : (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  onDismiss(install.name);
                }}
              >
                {t('containers.containerCard.dismiss', 'Dismiss')}
              </Button>
            )}
          </span>
        ) : (
          <span className="mt-3 flex flex-col gap-1.5">
            <ProgressBar
              percent={install.phase === 'pulling' ? install.progress : null}
              label={t('containers.containerCard.installingName', 'Installing {{name}}', {
                name: install.name,
              })}
            />
            <span className="text-caption text-foreground-subtle tabular">
              {install.phase === 'pulling' && install.progress !== null
                ? t('containers.containerCard.progressDownloaded', '{{progress}}% downloaded', {
                    progress: String(Math.round(install.progress)),
                  })
                : `${text(INSTALL_PHASE_LABELS[install.phase])}…`}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}
