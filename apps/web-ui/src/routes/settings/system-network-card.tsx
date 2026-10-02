/**
 * What the network is carrying: in and out, now and over the last quarter of an hour.
 *
 * Measured on the interface the internet is reached through (all of them, on Windows), so it is
 * the machine's traffic rather than the internet's alone: a camera streaming to it over the house
 * network counts too. The totals are since the interface came up, which on most machines is
 * since boot.
 */
import type { ReactNode } from 'react';

import type { NetworkTotals, SystemMonitorSample } from '@nebulahome/contracts';
import { cn, Panel, PanelNote } from '@nebulahome/ui';

import { DownloadIcon, UploadIcon } from '@/components/icons';
import { LiveAreaChart } from '@/components/live-area-chart';
import { formatBytes, formatRate } from '@/lib/format-bytes';
import { networkSeries } from '@/system/system-readings';

/** The colours the two directions are drawn in. */
const DOWNLOAD_COLOR = 'var(--color-tag-cyan)';
const UPLOAD_COLOR = 'var(--color-tag-violet)';

/** What the card needs. */
export type SystemNetworkCardProps = {
  /** The quarter of an hour, oldest first. */
  readonly samples: readonly SystemMonitorSample[];

  /** The totals, or null where the network cannot be read. */
  readonly network: NetworkTotals | null;
};

/** What one direction's figure needs. */
type RateProps = {
  readonly label: string;
  readonly icon: ReactNode;
  readonly dotClass: string;
  readonly rate: number | null;
  readonly total: number;
  readonly totalLabel: string;
};

/**
 * One direction: its rate now, and how much it has carried.
 *
 * @param props - See {@link RateProps}.
 * @returns The figure.
 */
function Rate(props: RateProps) {
  const { label, icon, dotClass, rate, total, totalLabel } = props;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-2 text-caption text-foreground-subtle">
        <span aria-hidden className={cn('size-2 rounded-full', dotClass)} />
        {icon}
        {label}
      </span>
      <span className="text-reading font-semibold tracking-tight tabular">{formatRate(rate)}</span>
      <span className="text-caption text-foreground-subtle tabular">
        {formatBytes(total)} {totalLabel}
      </span>
    </div>
  );
}

/**
 * Renders the card.
 *
 * @param props - See {@link SystemNetworkCardProps}.
 * @returns The card.
 */
export function SystemNetworkCard(props: SystemNetworkCardProps) {
  const { samples, network } = props;

  if (network === null) {
    return (
      <Panel title="Network">
        <PanelNote>
          The network cannot be read on this machine. It is read from the kernel on Linux and from
          netstat on Windows; the two network entities stay unavailable until it can be.
        </PanelNote>
      </Panel>
    );
  }

  const latest = samples.at(-1);

  return (
    <Panel
      title="Network"
      action={
        network.interface === null ? undefined : (
          <span className="font-mono text-caption text-foreground-subtle">{network.interface}</span>
        )
      }
    >
      <div className="grid grid-cols-2 gap-4 px-4 pt-4">
        <Rate
          label="Download"
          icon={<DownloadIcon width="13" height="13" />}
          dotClass="bg-tag-cyan"
          rate={latest?.receiveRate ?? null}
          total={network.receivedBytes}
          totalLabel="received"
        />
        <Rate
          label="Upload"
          icon={<UploadIcon width="13" height="13" />}
          dotClass="bg-tag-violet"
          rate={latest?.transmitRate ?? null}
          total={network.transmittedBytes}
          totalLabel="sent"
        />
      </div>

      <div className="h-32 px-2 pt-3">
        <LiveAreaChart
          data={networkSeries(samples)}
          series={[
            { key: 'download', label: 'Download', color: DOWNLOAD_COLOR, dotClass: 'bg-tag-cyan' },
            { key: 'upload', label: 'Upload', color: UPLOAD_COLOR, dotClass: 'bg-tag-violet' },
          ]}
          formatValue={(value) => formatRate(value)}
        />
      </div>

      <p className="px-4 pt-2.5 pb-3.5 text-label text-foreground-subtle uppercase">
        Last 15 minutes · totals since the interface came up
      </p>
    </Panel>
  );
}
