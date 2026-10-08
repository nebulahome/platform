/**
 * The Overview tab of an integration's page, as the board draws it: the health strip, what needs
 * doing, the devices in compact rows, and About.
 *
 * The strip is Runtime, Connection, Devices, Updates - each the state in a word, one line, and the
 * one action that fixes it: Set up for a vendor nobody set up, Review for devices found on the
 * network, Update for a newer release. Between the strip and the devices sit what the vendor
 * itself needs - its accounts, the containers it depends on, whether its bridge is heard - and the
 * devices of its found on the network, each with an Adopt.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import type {
  DeviceView,
  DiscoveredDevice,
  IntegrationState,
  IntegrationVendorView,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  FactGrid,
  HealthCard,
  HealthStrip,
  ListRow,
  Note,
  Pill,
  ROW_LIST_MORE,
  RowList,
  Section,
  type PillTone,
} from '@nebulahome/ui';

import { absoluteTime } from '@/lib/format-time';
import { useIntegrationInstall } from '@/library/use-integration-install';
import {
  connectionHealth,
  devicesHealth,
  runtimeHealth,
  updatesHealth,
} from '@/library/vendor-health';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon, useDeviceIcons } from '@/routes/library/device-icon';
import { DiscoveredStrip } from '@/routes/library/discovered-strip';
import { VendorAccounts } from '@/routes/library/vendor-accounts';
import { VendorContainers } from '@/routes/library/vendor-containers';
import { ListenerCallout } from '@/routes/library/vendor-hearing';
import { PairingPanel, type PairingState } from '@/routes/library/vendor-pairing';

/** How many devices the overview lists before "All devices". */
const ROWS_SHOWN = 5;

/** How a device's state reads on its row. */
const DEVICE_PILLS: Readonly<Record<IntegrationState, { tone: PillTone; label: string }>> = {
  running: { tone: 'success', label: 'Reporting' },
  failed: { tone: 'danger', label: 'Failed' },
  starting: { tone: 'accent', label: 'Starting' },
  identifying: { tone: 'accent', label: 'Listening' },
  stopped: { tone: 'neutral', label: 'Stopped' },
  disabled: { tone: 'neutral', label: 'Disabled' },
};

/**
 * The host of a site, for the link that names it.
 *
 * @param url - The vendor's site.
 * @returns `shelly.com` for `https://shelly.com/`, or the whole thing when it is not a URL.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

/** What the overview needs. */
export type VendorOverviewProps = {
  readonly vendor: IntegrationVendorView;
  readonly devices: readonly DeviceView[];

  /** Its devices found on the network that nobody has added. */
  readonly found: readonly DiscoveredDevice[];

  readonly pairing: PairingState;
  readonly canConfigure: boolean;
  readonly canInstall: boolean;

  /** Whether the person may adopt a device found. */
  readonly canAdopt: boolean;

  /** Whether the vendor declares settings every device shares. */
  readonly hasSetupFields: boolean;

  /** What the last look for devices came to, in a sentence; null when there is nothing to say. */
  readonly scanStatus: { readonly text: string; readonly isProblem: boolean } | null;

  /** Add device, when it can be offered. */
  readonly addButton?: ReactNode;

  /** Opens the Configuration tab. */
  readonly onConfigure: () => void;

  /** Opens the vendor's settings in the dialog, for a vendor set up from its container's row. */
  readonly onSetUp?: () => void;

  /** Opens the Devices tab. */
  readonly onAllDevices: () => void;

  /** Adopts a device found. */
  readonly onAdopt: (device: DiscoveredDevice) => void;
};

/**
 * Renders the Overview tab.
 *
 * @param props - See {@link VendorOverviewProps}.
 * @returns The tab's content.
 */
export function VendorOverview(props: VendorOverviewProps) {
  const {
    vendor,
    devices,
    found,
    pairing,
    canConfigure,
    canInstall,
    canAdopt,
    hasSetupFields,
    scanStatus,
    addButton,
    onConfigure,
    onSetUp,
    onAllDevices,
    onAdopt,
  } = props;
  const install = useIntegrationInstall(() => undefined);
  const icons = useDeviceIcons(devices);
  const runsContainers = vendor.containers.length > 0;
  // A vendor that runs a container is set up from the container's row, not from a tab.
  const hasConfiguration = hasSetupFields && !runsContainers;
  const runtime = runtimeHealth(vendor, devices.length);
  const connection = connectionHealth(vendor);
  const deviceLine = devicesHealth(vendor, devices, found.length);
  const updates = updatesHealth(vendor);
  const rows = [...devices].sort((left, right) => left.name.localeCompare(right.name));
  const isInstallable = canInstall && vendor.origin !== 'development';

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label="Runtime"
          tone={runtime.tone}
          value={runtime.value}
          detail={runtime.detail}
          action={
            vendor.needsSetup && canConfigure && hasConfiguration ? (
              <Button variant="ghost" size="compact" onClick={onConfigure}>
                Set up
              </Button>
            ) : undefined
          }
        />
        <HealthCard
          label="Connection"
          tone={connection.tone}
          value={connection.value}
          detail={connection.detail}
        />
        <HealthCard
          label="Devices"
          tone={deviceLine.tone}
          value={deviceLine.value}
          detail={deviceLine.detail}
          action={
            found.length === 0 ? undefined : (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  document.getElementById('vendor-found')?.scrollIntoView({ block: 'center' });
                }}
              >
                Review
              </Button>
            )
          }
        />
        <HealthCard
          label="Updates"
          tone={updates.tone}
          value={updates.value}
          detail={updates.detail}
          action={
            isInstallable && vendor.update?.hasUpdate === true ? (
              <Button
                variant="ghost"
                size="compact"
                isBusy={install.isPending}
                onClick={() => {
                  install.mutate({
                    vendorId: vendor.id,
                    version: vendor.update?.latestVersion ?? undefined,
                  });
                }}
              >
                Update
              </Button>
            ) : isInstallable && vendor.update?.hasNewBuild === true ? (
              <Button
                variant="ghost"
                size="compact"
                isBusy={install.isPending}
                onClick={() => {
                  install.mutate({ vendorId: vendor.id });
                }}
              >
                Reinstall
              </Button>
            ) : undefined
          }
        />
      </HealthStrip>

      {vendor.needsSetup && !runsContainers ? (
        <Note
          tone="warning"
          action={
            canConfigure && hasConfiguration ? (
              <Button size="compact" onClick={onConfigure}>
                Set up
              </Button>
            ) : undefined
          }
        >
          {vendor.name} needs setting up before a device of theirs can connect: the bundle asks for
          something every device shares.
        </Note>
      ) : null}

      <VendorAccounts vendor={vendor} devices={[...devices]} canConfigure={canConfigure} />

      <VendorContainers
        vendor={vendor}
        hasSetupFields={hasSetupFields}
        {...(onSetUp === undefined ? {} : { onSetUp })}
      />

      <ListenerCallout vendor={vendor} />

      {pairing.reason !== null &&
      !pairing.canPress &&
      vendor.pairing !== null &&
      !vendor.needsSetup ? (
        <p role="status" className="flex items-center gap-2 text-ui text-foreground-muted">
          <AppIcon id="info" size={15} className="shrink-0" />
          Pairing is not available yet: {pairing.reason}.
        </p>
      ) : null}

      {pairing.problem === null ? null : (
        <p role="alert" className="text-ui text-danger">
          {pairing.problem}
        </p>
      )}

      <PairingPanel vendor={vendor} pairing={pairing} devices={[...devices]} />

      {scanStatus === null ? null : (
        <p
          role={scanStatus.isProblem ? 'alert' : 'status'}
          className={scanStatus.isProblem ? 'text-ui text-danger' : 'text-ui text-foreground-muted'}
        >
          {scanStatus.text}
        </p>
      )}

      <div id="vendor-found">
        <DiscoveredStrip
          devices={[...found]}
          vendors={[vendor]}
          canAdopt={canAdopt && !vendor.needsSetup}
          onAdopt={onAdopt}
        />
      </div>

      <Section title="Devices" actions={addButton}>
        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong px-5.5 py-4 text-ui text-foreground-muted">
            {vendor.adoption === 'automatic'
              ? `Nothing yet. A device paired with ${vendor.name} is added here on its own.`
              : 'Nothing added yet. Add a device by its address and the hub listens for it at once.'}
          </p>
        ) : (
          <RowList>
            {rows.slice(0, ROWS_SHOWN).map((device) => {
              const pill = DEVICE_PILLS[device.state];

              return (
                <ListRow
                  key={device.id}
                  icon={<DeviceIcon icon={icons.get(device.icon ?? '')} />}
                  title={device.name}
                  subtitle={[device.model ?? device.driverName, device.areaName]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={`${String(device.entityIds.length)} ${device.entityIds.length === 1 ? 'entity' : 'entities'}`}
                  trailing={<Pill tone={pill.tone}>{pill.label}</Pill>}
                  hasChevron
                  wrap={(className, parts) => (
                    <Link to={devicePath(device.id)} aria-label={device.name} className={className}>
                      {parts}
                    </Link>
                  )}
                />
              );
            })}
            <button type="button" onClick={onAllDevices} className={ROW_LIST_MORE}>
              {rows.length > ROWS_SHOWN ? `All ${String(rows.length)} devices` : 'All devices'}
              <AppIcon id="chevron-right" size={14} />
            </button>
          </RowList>
        )}
      </Section>

      <Section title="About">
        <FactGrid
          facts={[
            { label: 'Id', value: vendor.id, isMono: true },
            { label: 'Version', value: vendor.version, isMono: true },
            {
              label: 'Discovery',
              value:
                vendor.discoverySources.length === 0
                  ? vendor.adoption === 'automatic'
                    ? 'Paired on the bridge'
                    : 'By address'
                  : vendor.discoverySources.includes('mdns')
                    ? 'mDNS, and on demand'
                    : 'Its own scan, and on demand',
            },
            {
              label: 'Set up',
              value:
                vendor.configuredAt === null
                  ? 'Nothing to set up yet'
                  : absoluteTime(vendor.configuredAt),
            },
            {
              label: 'Source',
              value:
                vendor.origin === 'development'
                  ? 'Development folder'
                  : vendor.install === null
                    ? 'Installed'
                    : `Installed ${absoluteTime(new Date(vendor.install.installedAt))}`,
            },
            ...(vendor.url === undefined
              ? []
              : [
                  {
                    label: 'Website',
                    value: (
                      <a
                        href={vendor.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary transition-colors hover:text-primary-hover"
                      >
                        {hostOf(vendor.url)}
                        <AppIcon id="external-link" size={13} />
                      </a>
                    ),
                  },
                ]),
          ]}
        />
      </Section>
    </div>
  );
}
