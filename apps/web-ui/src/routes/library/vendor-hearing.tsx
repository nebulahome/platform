/**
 * How a vendor's devices are being heard, on its page: what its own listener says when they do
 * not come, and the devices it heard and did not add.
 *
 * Both answer "why is my device not here". The first is the case that goes wrong in silence -
 * Zigbee2MQTT and NebulaHome on two different brokers, each fine on its own - so a listener that
 * hears nothing, or cannot reach its broker, says it in a callout with the way to its container's
 * log. The second lists what was heard and passed over, with why: still being paired, a model no
 * driver takes, disabled in Zigbee2MQTT.
 */
import { Link } from 'react-router';

import type { IntegrationVendorView } from '@nebula-home/contracts';
import { AppIcon, Badge, Panel, cn } from '@nebula-home/ui';

import { relativeTime } from '@/lib/format-time';

/** What the callout needs. */
export type ListenerCalloutProps = {
  readonly vendor: IntegrationVendorView;
};

/**
 * Says how the vendor's listener is getting on, when it is not hearing what it should.
 *
 * @param props - See {@link ListenerCalloutProps}.
 * @returns The callout, or nothing while the listener hears what it listens to.
 */
export function ListenerCallout(props: ListenerCalloutProps) {
  const { vendor } = props;
  const listener = vendor.listener;

  if (listener === null || listener.level === 'ok') {
    return null;
  }

  const container = vendor.containerStatuses.find((status) => status?.containerName != null);
  const isError = listener.level === 'error';

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-panel border px-4 py-3.5',
        isError ? 'border-danger/40 bg-danger/8' : 'border-warning/40 bg-warning/8',
      )}
    >
      <AppIcon
        id="triangle-alert"
        size={18}
        className={cn('mt-0.5 shrink-0', isError ? 'text-danger' : 'text-warning')}
      />
      <div className="flex min-w-0 grow flex-col gap-1">
        <p className="text-ui font-medium text-foreground">
          {isError ? `${vendor.name} cannot be heard` : `Nothing heard from ${vendor.name} yet`}
        </p>
        <p className="text-ui leading-relaxed text-foreground-muted">{listener.message}</p>
        {container?.containerName == null ? null : (
          <Link
            to={`/containers/${encodeURIComponent(container.containerName)}`}
            className="self-start text-ui text-primary underline-offset-2 hover:underline"
          >
            Open its log
          </Link>
        )}
      </div>
    </div>
  );
}

/** What the list needs. */
export type PassedOverPanelProps = {
  readonly vendor: IntegrationVendorView;
};

/**
 * The devices heard and not added, with why.
 *
 * @param props - See {@link PassedOverPanelProps}.
 * @returns The panel, or nothing when every device heard was added.
 */
export function PassedOverPanel(props: PassedOverPanelProps) {
  const { vendor } = props;

  if (vendor.passedOver.length === 0) {
    return null;
  }

  return (
    <Panel title={`Seen but not added · ${String(vendor.passedOver.length)}`}>
      <ul className="flex flex-col divide-y divide-border">
        {vendor.passedOver.map((device) => (
          <li key={device.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-ui">
                <span className="font-medium text-foreground">{device.name}</span>
                {device.model === null ? null : (
                  <span className="text-caption text-foreground-subtle">{device.model}</span>
                )}
              </span>
              <span className="text-caption text-foreground-muted">{device.reason}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone="neutral" size="small">
                Not added
              </Badge>
              <span className="text-caption text-foreground-subtle">
                {relativeTime(device.heardAt)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
