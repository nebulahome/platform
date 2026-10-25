/**
 * What the network is carrying: in and out, now and over the last quarter of an hour.
 *
 * Measured on the interface the internet is reached through (all of them, on Windows), so it is
 * the machine's traffic rather than the internet's alone: a camera streaming to it over the house
 * network counts too. The totals are since the interface came up, which on most machines is
 * since boot.
 */
import { useTranslation } from 'react-i18next';

import type { NetworkTotals, SystemMonitorSample } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import { LiveAreaChart } from '@/components/live-area-chart';
import { formatBytes, formatRate } from '@/lib/format-bytes';
import { networkSeries } from '@/system/system-readings';

/** The colours the two directions are drawn in. */
const DOWNLOAD_COLOR = 'var(--color-success)';
const UPLOAD_COLOR = 'var(--color-primary)';

/** The card the figures and the chart sit in. */
const CARD =
  'grid gap-6 rounded-card border border-border bg-surface p-4.5 shadow-edge md:grid-cols-[220px_minmax(0,1fr)]';

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
  const { label, dotClass, rate, total, totalLabel } = props;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-2 text-ui-sm text-foreground-muted">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dotClass)} />
        {label}
      </span>
      <span className="font-mono text-headline-lg tracking-normal text-foreground tabular">
        {formatRate(rate)}
      </span>
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
  const { t } = useTranslation();
  const { samples, network } = props;

  if (network === null) {
    return (
      <section className={CARD}>
        <span className="text-title font-medium text-foreground">
          {t('system.network', 'Network')}
        </span>
        <p className="text-ui-sm text-foreground-subtle">
          {t(
            'system.networkUnreadable',
            'The network cannot be read on this machine. It is read from the kernel on Linux and from netstat on Windows; the two network entities stay unavailable until it can be.',
          )}
        </p>
      </section>
    );
  }

  const latest = samples.at(-1);

  return (
    <section className={CARD} aria-label={t('system.network', 'Network')}>
      <div className="flex flex-col gap-4.5">
        <span className="text-title font-medium text-foreground">
          {t('system.network', 'Network')}
        </span>
        <Rate
          label={t('system.download', 'Download')}
          dotClass="bg-success"
          rate={latest?.receiveRate ?? null}
          total={network.receivedBytes}
          totalLabel={t('system.received', 'received')}
        />
        <Rate
          label={t('system.upload', 'Upload')}
          dotClass="bg-primary"
          rate={latest?.transmitRate ?? null}
          total={network.transmittedBytes}
          totalLabel={t('system.sent', 'sent')}
        />
      </div>

      <div className="flex min-w-0 flex-col justify-end gap-2">
        <span className="self-end text-caption text-foreground-subtle">
          {t('system.last15', 'Last 15 minutes')}
        </span>
        <div className="h-42.5">
          <LiveAreaChart
            data={networkSeries(samples)}
            series={[
              {
                key: 'download',
                label: t('system.download', 'Download'),
                color: DOWNLOAD_COLOR,
                dotClass: 'bg-success',
              },
              {
                key: 'upload',
                label: t('system.upload', 'Upload'),
                color: UPLOAD_COLOR,
                dotClass: 'bg-primary',
              },
            ]}
            formatValue={(value) => formatRate(value)}
          />
        </div>
      </div>
    </section>
  );
}
