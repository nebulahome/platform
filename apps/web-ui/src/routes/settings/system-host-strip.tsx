/**
 * The machine, in one line: what it is called, what it runs, how long it has been up, and
 * whether the page is still hearing from it.
 *
 * The live mark is the page telling the truth about itself: it pulses while each answer keeps
 * coming, and says how old the last one is, so a page left open while `core` was down does not
 * pass off a frozen chart as a quiet machine.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { SystemHost } from '@nebulahome/contracts';
import { Badge, cn } from '@nebulahome/ui';

import { ExternalLinkIcon, ServerIcon } from '@/components/icons';
import { formatUptime } from '@/lib/format-bytes';
import { relativeTime } from '@/lib/format-time';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { devicePath } from '@/routes/library/device/device-path';

/** What the strip needs. */
export type SystemHostStripProps = {
  readonly host: SystemHost;

  /** When the last answer arrived. */
  readonly updatedAt: Date;

  /** Whether the last attempt to ask again failed, so the figures below are the last good ones. */
  readonly isStale: boolean;
};

/**
 * Renders the strip.
 *
 * @param props - See {@link SystemHostStripProps}.
 * @returns The strip.
 */
export function SystemHostStrip(props: SystemHostStripProps) {
  const { t } = useTranslation();
  const { host, updatedAt, isStale } = props;
  const isReduced = useReducedMotion();

  return (
    <section
      aria-label={t('system.thisMachine', 'This machine')}
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-panel border border-border bg-surface px-4 py-3.5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-tile border border-border bg-surface-raised text-foreground-muted">
        <ServerIcon width="19" height="19" />
      </span>

      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate text-title font-medium text-foreground">{host.hostname}</span>
        <span className="truncate text-caption text-foreground-subtle">
          {t('system.hostLine', '{{os}} · {{arch}} · up {{uptime}}', {
            os: host.osName,
            arch: host.arch,
            uptime: formatUptime(host.uptimeSeconds),
          })}
        </span>
      </span>

      <Badge
        tone={isStale ? 'warning' : 'success'}
        icon={
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              isStale ? 'bg-warning' : 'bg-success',
              isStale || isReduced ? undefined : 'animate-pulse',
            )}
          />
        }
      >
        {isStale ? t('system.notAnswering', 'Not answering') : t('system.live', 'Live')} ·{' '}
        {relativeTime(updatedAt)}
      </Badge>

      <Link
        to={devicePath('system')}
        className="flex items-center gap-1.5 text-ui text-foreground-muted transition-colors hover:text-foreground"
      >
        {t('system.openInDevices', 'Open in Devices')}
        <ExternalLinkIcon width="13" height="13" />
      </Link>
    </section>
  );
}
