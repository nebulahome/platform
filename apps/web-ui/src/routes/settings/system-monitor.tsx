/**
 * The system monitor: how the machine the platform runs on is doing, as it happens.
 *
 * The processor, the memory, the network and the disk, each with the last quarter of an hour
 * behind it, read from `core` every ten seconds. Not called telemetry - that is the history of
 * the house's own sensors - and not health, which is whether each service is up: this is the
 * machine underneath both.
 *
 * Reading it needs `system:read`. The figures move on their own; nothing here can be changed.
 */
import { useTranslation } from 'react-i18next';

import { Panel, PanelNote } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
import { SettingsPage } from '@/routes/settings/settings-ui';
import { SystemDiskCard } from '@/routes/settings/system-disk-card';
import { SystemHostStrip } from '@/routes/settings/system-host-strip';
import { SystemNetworkCard } from '@/routes/settings/system-network-card';
import { SystemTile } from '@/routes/settings/system-tile';
import { latestSample, memoryPercent } from '@/system/system-readings';
import { useSystemMonitor } from '@/system/use-system-monitor';

/**
 * Renders the page.
 *
 * @returns The page.
 */
export function SystemMonitor() {
  const { t } = useTranslation();
  const monitor = useSystemMonitor();

  if (monitor.isPending) {
    return (
      <SettingsPage path="/settings/system/monitor">
        <p className="text-ui text-foreground-subtle">
          {t('system.reading', 'Reading the machine…')}
        </p>
      </SettingsPage>
    );
  }

  if (monitor.isError) {
    return (
      <SettingsPage path="/settings/system/monitor">
        <Panel title={t('system.title', 'System monitor')}>
          <p role="alert" className="px-4 pt-4 text-ui text-danger">
            {toMessage(monitor.error)}
          </p>
          <PanelNote>
            {t(
              'system.errorNote',
              'The readings come from core, which samples the machine. The page asks again every ten seconds and fills in as soon as core answers.',
            )}
          </PanelNote>
        </Panel>
      </SettingsPage>
    );
  }

  const snapshot = monitor.data;
  const { host, samples } = snapshot;
  const latest = latestSample(snapshot);

  return (
    <SettingsPage path="/settings/system/monitor">
      <SystemHostStrip
        host={host}
        updatedAt={new Date(monitor.dataUpdatedAt)}
        isStale={monitor.isRefetchError}
      />

      <div className="grid gap-3.5 md:grid-cols-3">
        <SystemTile
          title={t('system.processor', 'Processor')}
          detail={t('system.cores', {
            model: host.cpuModel,
            count: host.cpuCount,
            defaultValue_one: '{{model}} · {{count}} core',
            defaultValue_other: '{{model}} · {{count}} cores',
          })}
          percent={latest?.cpuPercent ?? null}
          series={samples.map((sample) => sample.cpuPercent)}
          colour="cyan"
        />
        <SystemTile
          title={t('system.memory', 'Memory')}
          detail={
            latest === undefined
              ? t('system.waiting', 'Waiting for the first reading')
              : t('system.usedOf', '{{used}} of {{total}}', {
                  used: formatBytes(latest.memoryUsedBytes),
                  total: formatBytes(latest.memoryTotalBytes),
                })
          }
          percent={latest === undefined ? null : memoryPercent(latest)}
          series={samples.map((sample) => memoryPercent(sample))}
          colour="lamp"
        />
        <SystemTile
          title={t('system.disk', 'Disk')}
          detail={
            snapshot.disk === null
              ? t('system.notCounted', 'Not counted yet')
              : t('system.usedOf', '{{used}} of {{total}}', {
                  used: formatBytes(snapshot.disk.usedBytes),
                  total: formatBytes(snapshot.disk.usedBytes + snapshot.disk.freeBytes),
                })
          }
          percent={
            snapshot.disk === null || snapshot.disk.usedBytes + snapshot.disk.freeBytes === 0
              ? null
              : (snapshot.disk.usedBytes / (snapshot.disk.usedBytes + snapshot.disk.freeBytes)) *
                100
          }
          colour="violet"
        />
      </div>

      <SystemNetworkCard samples={samples} network={snapshot.network} />
      <SystemDiskCard disk={snapshot.disk} />
    </SettingsPage>
  );
}
