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
import { Panel, PanelNote } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
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
  const monitor = useSystemMonitor();

  if (monitor.isPending) {
    return <p className="text-ui text-foreground-subtle">Reading the machine…</p>;
  }

  if (monitor.isError) {
    return (
      <Panel title="System monitor">
        <p role="alert" className="px-4 pt-4 text-ui text-danger">
          {toMessage(monitor.error)}
        </p>
        <PanelNote>
          The readings come from core, which samples the machine. The page asks again every ten
          seconds and fills in as soon as core answers.
        </PanelNote>
      </Panel>
    );
  }

  const snapshot = monitor.data;
  const { host, samples } = snapshot;
  const latest = latestSample(snapshot);

  return (
    <>
      <SystemHostStrip
        host={host}
        updatedAt={new Date(monitor.dataUpdatedAt)}
        isStale={monitor.isRefetchError}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SystemTile
          title="Processor"
          detail={`${host.cpuModel} · ${String(host.cpuCount)} cores`}
          percent={latest?.cpuPercent ?? null}
          series={samples.map((sample) => sample.cpuPercent)}
          colour="cyan"
        />
        <SystemTile
          title="Memory"
          detail={
            latest === undefined
              ? 'Waiting for the first reading'
              : `${formatBytes(latest.memoryUsedBytes)} of ${formatBytes(latest.memoryTotalBytes)}`
          }
          percent={latest === undefined ? null : memoryPercent(latest)}
          series={samples.map((sample) => memoryPercent(sample))}
          colour="lamp"
        />
        <SystemTile
          title="Disk"
          detail={
            snapshot.disk === null
              ? 'Not counted yet'
              : `${formatBytes(snapshot.disk.usedBytes)} of ${formatBytes(snapshot.disk.usedBytes + snapshot.disk.freeBytes)}`
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
    </>
  );
}
