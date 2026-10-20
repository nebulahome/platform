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
import { useTranslation } from 'react-i18next';
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

import { defineMessage, type Message, text } from '@/i18n/messages';
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
import { MatterTag } from '@/routes/library/matter-tag';
import { VendorAccounts } from '@/routes/library/vendor-accounts';
import { VendorContainers } from '@/routes/library/vendor-containers';
import { ListenerCallout } from '@/routes/library/vendor-hearing';
import { PairingPanel, type PairingState } from '@/routes/library/vendor-pairing';

/** How many devices the overview lists before "All devices". */
const ROWS_SHOWN = 5;

/** How a device's state reads on its row. */
const DEVICE_PILLS: Readonly<Record<IntegrationState, { tone: PillTone; label: Message }>> = {
  running: {
    tone: 'success',
    label: defineMessage('library.vendorOverview.reporting', 'Reporting'),
  },
  failed: { tone: 'danger', label: defineMessage('library.vendorOverview.failed', 'Failed') },
  starting: { tone: 'accent', label: defineMessage('library.vendorOverview.starting', 'Starting') },
  identifying: {
    tone: 'accent',
    label: defineMessage('library.vendorOverview.listening', 'Listening'),
  },
  stopped: { tone: 'neutral', label: defineMessage('library.vendorOverview.stopped', 'Stopped') },
  disabled: {
    tone: 'neutral',
    label: defineMessage('library.vendorOverview.disabled', 'Disabled'),
  },
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
  const { t } = useTranslation();

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
          label={t('library.vendorOverview.runtime', 'Runtime')}
          tone={runtime.tone}
          value={runtime.value}
          detail={runtime.detail}
          action={
            vendor.needsSetup && canConfigure && hasConfiguration
              ? {
                  icon: 'settings',
                  verb: t('library.vendorOverview.setUp', 'Set up'),
                  onSelect: onConfigure,
                }
              : undefined
          }
        />
        <HealthCard
          label={t('library.vendorOverview.connection', 'Connection')}
          tone={connection.tone}
          value={connection.value}
          detail={connection.detail}
        />
        <HealthCard
          label={t('library.vendorOverview.devices', 'Devices')}
          tone={deviceLine.tone}
          value={deviceLine.value}
          detail={deviceLine.detail}
          action={
            found.length === 0
              ? undefined
              : {
                  icon: 'eye',
                  verb: t('library.vendorOverview.review', 'Review'),
                  /** Does what the corner says. */
                  onSelect: () => {
                    document.getElementById('vendor-found')?.scrollIntoView({ block: 'center' });
                  },
                }
          }
        />
        <HealthCard
          label={t('library.vendorOverview.updates', 'Updates')}
          tone={updates.tone}
          value={updates.value}
          detail={updates.detail}
          action={
            isInstallable && vendor.update?.hasUpdate === true
              ? {
                  icon: 'download',
                  verb: t('library.vendorOverview.update', 'Update'),
                  isBusy: install.isPending,
                  /** Does what the corner says. */
                  onSelect: () => {
                    install.mutate({
                      vendorId: vendor.id,
                      version: vendor.update?.latestVersion ?? undefined,
                    });
                  },
                }
              : isInstallable && vendor.update?.hasNewBuild === true
                ? {
                    icon: 'refresh-cw',
                    verb: t('library.vendorOverview.reinstall', 'Reinstall'),
                    isBusy: install.isPending,
                    /** Does what the corner says. */
                    onSelect: () => {
                      install.mutate({ vendorId: vendor.id });
                    },
                  }
                : undefined
          }
        />
      </HealthStrip>

      {vendor.needsSetup && !runsContainers ? (
        <Note
          tone="warning"
          action={
            canConfigure && hasConfiguration ? (
              <Button size="compact" onClick={onConfigure}>
                {t('library.vendorOverview.setUp', 'Set up')}
              </Button>
            ) : undefined
          }
        >
          {t(
            'library.vendorOverview.nameNeedsSettingUp',
            '{{name}} needs setting up before a device of theirs can connect: the bundle asks for something every device shares.',
            { name: vendor.name },
          )}
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
          {t(
            'library.vendorOverview.pairingIsNotAvailable',
            'Pairing is not available yet: {{reason}}.',
            { reason: pairing.reason },
          )}
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

      <Section title={t('library.vendorOverview.devices', 'Devices')} actions={addButton}>
        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong px-5.5 py-4 text-ui text-foreground-muted">
            {vendor.adoption === 'automatic'
              ? t(
                  'library.vendorOverview.nothingYetADevice',
                  'Nothing yet. A device paired with {{name}} is added here on its own.',
                  { name: vendor.name },
                )
              : t(
                  'library.vendorOverview.nothingAddedYetAdd',
                  'Nothing added yet. Add a device by its address and the hub listens for it at once.',
                )}
          </p>
        ) : (
          <RowList>
            {rows.slice(0, ROWS_SHOWN).map((device) => {
              const pill = DEVICE_PILLS[device.state];

              return (
                <ListRow
                  key={device.id}
                  icon={<DeviceIcon icon={icons.get(device.icon ?? '')} />}
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{device.name}</span>
                      <MatterTag transport={device.transport} />
                    </span>
                  }
                  subtitle={[device.model ?? device.driverName, device.areaName]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={t('library.vendorOverview.entities', {
                    count: device.entityIds.length,
                    defaultValue_one: '{{count}} entity',
                    defaultValue_other: '{{count}} entities',
                  })}
                  trailing={<Pill tone={pill.tone}>{text(pill.label)}</Pill>}
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
              {rows.length > ROWS_SHOWN
                ? t('library.vendorOverview.allCountDevices', 'All {{count}} devices', {
                    count: rows.length,
                  })
                : t('library.vendorOverview.allDevices', 'All devices')}
              <AppIcon id="chevron-right" size={14} />
            </button>
          </RowList>
        )}
      </Section>

      <Section title={t('library.vendorOverview.about', 'About')}>
        <FactGrid
          facts={[
            { label: t('library.vendorOverview.id', 'Id'), value: vendor.id, isMono: true },
            {
              label: t('library.vendorOverview.version', 'Version'),
              value: vendor.version,
              isMono: true,
            },
            {
              label: t('library.vendorOverview.discovery', 'Discovery'),
              value:
                vendor.discoverySources.length === 0
                  ? vendor.adoption === 'automatic'
                    ? t('library.vendorOverview.pairedOnTheBridge', 'Paired on the bridge')
                    : t('library.vendorOverview.byAddress', 'By address')
                  : vendor.discoverySources.includes('mdns')
                    ? t('library.vendorOverview.mdnsAndOnDemand', 'mDNS, and on demand')
                    : t('library.vendorOverview.itsOwnScanAnd', 'Its own scan, and on demand'),
            },
            {
              label: t('library.vendorOverview.setUp', 'Set up'),
              value:
                vendor.configuredAt === null
                  ? t('library.vendorOverview.nothingToSetUp', 'Nothing to set up yet')
                  : absoluteTime(vendor.configuredAt),
            },
            {
              label: t('library.vendorOverview.source', 'Source'),
              value:
                vendor.origin === 'development'
                  ? t('library.vendorOverview.developmentFolder', 'Development folder')
                  : vendor.install === null
                    ? t('library.vendorOverview.installed', 'Installed')
                    : t(
                        'library.vendorOverview.installedAbsolutetime',
                        'Installed {{absoluteTime}}',
                        { absoluteTime: absoluteTime(new Date(vendor.install.installedAt)) },
                      ),
            },
            ...(vendor.url === undefined
              ? []
              : [
                  {
                    label: t('library.vendorOverview.website', 'Website'),
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
