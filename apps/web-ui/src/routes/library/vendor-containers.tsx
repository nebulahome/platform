/**
 * The containers a vendor's devices depend on, on the vendor's page.
 *
 * Zigbee reaches the platform through zigbee2mqtt, which runs in a container of its own: the
 * platform downloads it and runs it once the vendor is set up, and this panel says where it
 * stands - waiting for the setup, being downloaded, running, or why not - and leads to the
 * container's own page. Setting the vendor up is what starts it, so the button that does - Set up
 * the first time, Configure after - sits on the container's row, where the owner is looking.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { IntegrationVendorView, ManagedStatus } from '@nebulahome/contracts';
import { Badge, Button, Panel, type BadgeTone } from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';

/** How a declared container's state reads, and its colour. */
const STATE_OF: Readonly<Record<ManagedStatus['state'], { label: Message; tone: BadgeTone }>> = {
  missing: {
    label: defineMessage('library.vendorContainers.notRunning', 'Not running'),
    tone: 'warning',
  },
  pulling: {
    label: defineMessage('library.vendorContainers.downloading', 'Downloading'),
    tone: 'accent',
  },
  created: { label: defineMessage('library.vendorContainers.created', 'Created'), tone: 'neutral' },
  running: { label: defineMessage('library.vendorContainers.running', 'Running'), tone: 'success' },
  paused: { label: defineMessage('library.vendorContainers.paused', 'Paused'), tone: 'warning' },
  restarting: {
    label: defineMessage('library.vendorContainers.restarting', 'Restarting'),
    tone: 'accent',
  },
  removing: {
    label: defineMessage('library.vendorContainers.removing', 'Removing'),
    tone: 'warning',
  },
  exited: { label: defineMessage('library.vendorContainers.stopped', 'Stopped'), tone: 'neutral' },
  dead: { label: defineMessage('library.vendorContainers.dead', 'Dead'), tone: 'danger' },
};

/** What the panel needs. */
export type VendorContainersProps = {
  /** As the API lists it, with its containers' statuses. */
  readonly vendor: IntegrationVendorView;

  /** Opens the vendor's settings; absent for somebody who may not change them. */
  readonly onSetUp?: () => void;

  /** Whether the vendor asks anything once set up: without, there is nothing to configure. */
  readonly hasSetupFields: boolean;
};

/**
 * Renders the panel, for a vendor that runs containers.
 *
 * @param props - See {@link VendorContainersProps}.
 * @returns The panel, or nothing for a vendor that runs none.
 */
export function VendorContainers(props: VendorContainersProps) {
  const { t } = useTranslation();

  const { vendor, onSetUp, hasSetupFields } = props;

  if (vendor.containers.length === 0) {
    return null;
  }

  return (
    <Panel
      title={
        vendor.containers.length === 1
          ? t('library.vendorContainers.runsInAContainer', 'Runs in a container')
          : t('library.vendorContainers.runsInContainers', 'Runs in containers')
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {vendor.containers.map((container, index) => {
          const status = vendor.containerStatuses[index] ?? null;
          const state = vendor.needsSetup
            ? {
                label: t('library.vendorContainers.waitingForSetup', 'Waiting for setup'),
                tone: 'warning' as const,
              }
            : status === null
              ? null
              : { ...STATE_OF[status.state], label: text(STATE_OF[status.state].label) };

          return (
            <li
              key={container.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-ui text-foreground">
                  {status?.containerName !== null && status?.containerName !== undefined ? (
                    <Link
                      to={`/containers/${encodeURIComponent(status.containerName)}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {container.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{container.name}</span>
                  )}
                  {state === null ? null : (
                    <Badge tone={state.tone} size="small">
                      {state.label}
                    </Badge>
                  )}
                </span>
                <span className="font-mono text-caption text-foreground-subtle">
                  {container.image} ·{' '}
                  {status?.version ??
                    t('library.vendorContainers.minversionOrNewer', '{{minVersion}} or newer', {
                      minVersion: container.minVersion,
                    })}
                </span>
                {status?.error === null || status?.error === undefined ? null : (
                  <span className="text-caption text-danger">{status.error}</span>
                )}
              </span>
              {onSetUp === undefined ? null : vendor.needsSetup ? (
                <Button size="compact" onClick={onSetUp}>
                  {t('library.vendorContainers.setUp', 'Set up')}
                </Button>
              ) : hasSetupFields ? (
                <Button variant="ghost" size="compact" onClick={onSetUp}>
                  {t('library.vendorContainers.configure', 'Configure')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
