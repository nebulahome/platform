/**
 * The machine, in one card: what it is called, what it runs, how long it has been up, and
 * whether the page is still hearing from it.
 *
 * The live pill is the page telling the truth about itself: it says Live while each answer keeps
 * coming, Not answering once one fails, and how old the last answer is on hover, so a page left
 * open while `core` was down does not pass off a frozen chart as a quiet machine.
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { SystemHost } from '@nebulahome/contracts';
import { AppIcon, Button, Pill } from '@nebulahome/ui';

import { formatUptime } from '@/lib/format-bytes';
import { relativeTime } from '@/lib/format-time';
import { devicePath } from '@/routes/library/device/device-path';
import { HeroCard, HeroIcon } from '@/routes/settings/settings-ui';

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
  const navigate = useNavigate();
  const { host, updatedAt, isStale } = props;

  return (
    <HeroCard
      leading={<HeroIcon icon="server" />}
      title={host.hostname}
      subtitle={t('system.hostLine', '{{os}} · {{arch}} · up {{uptime}}', {
        os: host.osName,
        arch: host.arch,
        uptime: formatUptime(host.uptimeSeconds),
      })}
      actions={
        <>
          <Pill tone={isStale ? 'warning' : 'success'}>
            <span title={relativeTime(updatedAt)}>
              {isStale ? t('system.notAnswering', 'Not answering') : t('system.live', 'Live')}
            </span>
          </Pill>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate(devicePath('system'));
            }}
          >
            <AppIcon id="external-link" size={16} />
            {t('system.openDevice', 'Open device')}
          </Button>
        </>
      }
    />
  );
}
