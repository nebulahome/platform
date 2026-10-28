/**
 * The Bluetooth broker's tabs: Overview, Devices and Scanners, and the host with no adapter.
 *
 * Overview is the health strip - the adapter, the proxies reporting, what is heard, the
 * connections only the adapter can hold - then the devices an integration recognises that the
 * house does not have (Add, Ignore, the ignored in a fold) and those added lately. Devices is the
 * house's Bluetooth devices in a table: their signal as bars, the scanner that hears them best
 * (and how many others, listed on hover) and whether they listen or are connected. Scanners is a
 * row per scanner that opens to show and change it: its scan mode, what it forwards, its script,
 * the devices it hears best, and its actions.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type {
  BluetoothDevice,
  BluetoothFound,
  BluetoothScanMode,
  BluetoothScanner,
  BluetoothStatus,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  HealthCard,
  HealthStrip,
  IconButton,
  ListRow,
  Note,
  RowList,
  Section,
  Segmented,
  StatusDot,
  Switch,
} from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';
import { foldForSearch } from '@/lib/search-text';
import {
  CapabilityChip,
  CountTag,
  DeviceTag,
  HEAD_CELL,
  rssiBars,
  SignalBars,
  Snippet,
  TABLE_FRAME,
} from '@/routes/library/broker-parts';
import { devicePath } from '@/routes/library/device/device-path';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/** The lines that give the container the host's Bluetooth: D-Bus mounted, and the policy. */
const DBUS_SNIPPET = [
  'services:',
  '  nebula:',
  '    volumes:',
  '      - /run/dbus:/run/dbus:ro',
  '',
  '# /etc/dbus-1/system.d/nebulahome-bluetooth.conf on the host:',
  '<busconfig>',
  '  <policy user="1000">',
  '    <allow send_destination="org.bluez"/>',
  '  </policy>',
  '</busconfig>',
].join('\n');

/**
 * A signal as bars and its dBm.
 *
 * @param props - The signal.
 * @param props.rssi - In dBm; null when not heard.
 * @returns The bars and the figure.
 */
export function Signal(props: { readonly rssi: number | null }) {
  const { t } = useTranslation();
  const { rssi } = props;

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-mono-caption whitespace-nowrap text-foreground-muted">
      <SignalBars
        lit={rssiBars(rssi)}
        label={
          rssi === null
            ? t('brokers.bluetooth.notHeard', 'Not heard')
            : t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi })
        }
      />
      {rssi ?? '—'}
    </span>
  );
}

/** What Overview needs. */
export type BluetoothOverviewProps = {
  readonly status: BluetoothStatus;
  readonly devices: readonly BluetoothDevice[];
  readonly found: readonly BluetoothFound[];
  readonly ignored: readonly { readonly address: string; readonly name: string | null }[];
  readonly vendorNames: ReadonlyMap<string, string>;
  readonly roomOf: (areaId: string | null) => string | null;

  /** Adds a device found; absent when the person may not. */
  readonly onAdd?: ((found: BluetoothFound) => void) | undefined;

  /** Ignores an address, or stops; absent when the person may not. */
  readonly onIgnore?: ((address: string, isIgnored: boolean) => void) | undefined;

  /** Opens Add proxy; absent when the person may not. */
  readonly onAddProxy?: (() => void) | undefined;

  /** Opens Scanners. */
  readonly onScanners: () => void;
};

/**
 * Renders Overview.
 *
 * @param props - See {@link BluetoothOverviewProps}.
 * @returns The tab's content.
 */
export function BluetoothOverview(props: BluetoothOverviewProps) {
  const { t } = useTranslation();
  const { status, devices, found, ignored, onAdd, onIgnore } = props;
  const adapter = status.adapter;
  const [isIgnoredOpen, setIgnoredOpen] = useState(false);
  const recent = devices
    .filter((device) => device.addedAt !== null)
    .sort((one, other) => (other.addedAt?.getTime() ?? 0) - (one.addedAt?.getTime() ?? 0))
    .slice(0, 3);
  const hasNothing = adapter === null && status.proxies.total === 0;

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.bluetooth.adapter', 'Adapter')}
          tone={adapter === null ? 'warning' : 'neutral'}
          value={
            adapter === null
              ? t('brokers.bluetooth.noAdapter', 'No adapter')
              : [adapter.id, adapter.name].filter(Boolean).join(' · ')
          }
          detail={
            adapter === null
              ? t('brokers.bluetooth.noBluetooth', 'The container sees no Bluetooth')
              : (adapter.address ?? undefined)
          }
          action={
            adapter === null
              ? {
                  icon: 'chevron-right',
                  verb: t('brokers.bluetooth.howToFix', 'How to fix'),
                  onSelect: props.onScanners,
                }
              : undefined
          }
        />
        <HealthCard
          label={t('brokers.bluetooth.proxies', 'Proxies')}
          tone={
            status.proxies.total > 0 && status.proxies.reporting < status.proxies.total
              ? 'warning'
              : 'neutral'
          }
          value={
            status.proxies.total === 0
              ? t('brokers.bluetooth.none', 'None')
              : t('brokers.bluetooth.reporting', '{{reporting}} of {{total}} reporting', {
                  reporting: status.proxies.reporting,
                  total: status.proxies.total,
                })
          }
          detail={
            status.proxies.total === 0
              ? t('brokers.bluetooth.addShelly', 'Add a Shelly as a proxy')
              : undefined
          }
        />
        <HealthCard
          label={t('brokers.bluetooth.heard', 'Heard')}
          tone="neutral"
          value={
            status.heard.devices === 0
              ? t('brokers.bluetooth.nothing', 'Nothing')
              : t('brokers.bluetooth.heardDevices', {
                  count: status.heard.devices,
                  defaultValue_one: '{{count}} device',
                  defaultValue_other: '{{count}} devices',
                })
          }
          detail={
            status.heard.devices === 0
              ? undefined
              : t('brokers.bluetooth.heardLine', 'in the last 5 min · {{rate}} adverts/min', {
                  rate: status.heard.advertsPerMinute,
                })
          }
        />
        <HealthCard
          label={t('brokers.bluetooth.connections', 'Connections')}
          tone={status.isMatterPairing ? 'info' : 'neutral'}
          value={
            adapter === null
              ? t('brokers.bluetooth.notPossible', 'Not possible')
              : status.isMatterPairing
                ? t('brokers.bluetooth.matterPairing', 'Matter is pairing a device')
                : t('brokers.bluetooth.connectionsOf', '{{used}} of {{max}}', adapter.connections)
          }
          detail={
            adapter === null
              ? t('brokers.bluetooth.needsAdapter', 'Needs this server’s adapter')
              : t('brokers.bluetooth.localOnly', 'Local adapter only: proxies only listen')
          }
        />
      </HealthStrip>

      {hasNothing ? (
        <NoAdapter isDesktop={status.adapterProblem === 'desktop'} onAddProxy={props.onAddProxy} />
      ) : (
        <>
          {found.length === 0 && ignored.length === 0 ? null : (
            <Section
              title={t('brokers.bluetooth.found', 'Found')}
              note={t(
                'brokers.bluetooth.foundNote',
                'Devices an integration recognises that the house does not have yet.',
              )}
            >
              <div className="flex flex-col gap-3">
                {found.length === 0 ? null : (
                  <RowList>
                    {found.map((each) => {
                      const [claim] = each.claims;

                      return (
                        <ListRow
                          key={each.address}
                          icon={<AppIcon id="bluetooth" size={16} className="text-[#5b9dff]" />}
                          title={
                            <span className="flex items-baseline gap-2">
                              {each.name ?? t('brokers.bluetooth.unnamed', 'Unnamed')}
                              <span className="font-mono text-mono-caption font-normal text-foreground-muted">
                                {each.address}
                              </span>
                            </span>
                          }
                          subtitle={t(
                            'brokers.bluetooth.recognisedHeard',
                            'Recognised by {{vendor}} · heard by {{scanner}} · {{rssi}} dBm',
                            {
                              vendor: claim?.vendorName ?? '',
                              scanner: each.scannerName,
                              rssi: each.rssi,
                            },
                          )}
                          trailing={
                            <>
                              {onIgnore === undefined ? null : (
                                <IconButton
                                  label={t('brokers.bluetooth.ignore', 'Ignore')}
                                  onClick={() => {
                                    onIgnore(each.address, true);
                                  }}
                                >
                                  <AppIcon id="x" size={15} />
                                </IconButton>
                              )}
                              {onAdd === undefined ? null : (
                                <Button
                                  variant="ghost"
                                  size="compact"
                                  onClick={() => {
                                    onAdd(each);
                                  }}
                                >
                                  <AppIcon id="plus" size={14} />
                                  {t('brokers.bluetooth.add', 'Add')}
                                </Button>
                              )}
                            </>
                          }
                        />
                      );
                    })}
                  </RowList>
                )}
                {ignored.length === 0 ? null : (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      aria-expanded={isIgnoredOpen}
                      onClick={() => {
                        setIgnoredOpen(!isIgnoredOpen);
                      }}
                      className="flex items-center gap-2 self-start text-ui-sm text-foreground-muted hover:text-foreground"
                    >
                      <AppIcon
                        id="chevron-right"
                        size={14}
                        className={cn('transition-transform', isIgnoredOpen && 'rotate-90')}
                      />
                      {t('brokers.bluetooth.ignoredCount', 'Ignored · {{count}}', {
                        count: ignored.length,
                      })}
                    </button>
                    {isIgnoredOpen ? (
                      <RowList>
                        {ignored.map((each) => (
                          <ListRow
                            key={each.address}
                            icon={<AppIcon id="eye-off" size={16} />}
                            title={each.name ?? t('brokers.bluetooth.unnamed', 'Unnamed')}
                            subtitle={each.address}
                            trailing={
                              onIgnore === undefined ? undefined : (
                                <Button
                                  variant="ghost"
                                  size="compact"
                                  onClick={() => {
                                    onIgnore(each.address, false);
                                  }}
                                >
                                  {t('brokers.bluetooth.stopIgnoring', 'Stop ignoring')}
                                </Button>
                              )
                            }
                          />
                        ))}
                      </RowList>
                    ) : null}
                  </div>
                )}
              </div>
            </Section>
          )}

          {recent.length === 0 ? null : (
            <Section title={t('brokers.bluetooth.recentlyAdded', 'Recently added')}>
              <RowList>
                {recent.map((device) => (
                  <ListRow
                    key={device.deviceId}
                    icon={<AppIcon id="bluetooth" size={16} />}
                    title={
                      <span className="flex items-center gap-2">
                        {device.name}
                        <DeviceTag
                          name={props.vendorNames.get(device.vendorId) ?? device.vendorId}
                        />
                      </span>
                    }
                    subtitle={[
                      props.roomOf(device.areaId),
                      device.addedAt === null
                        ? null
                        : t('brokers.bluetooth.addedWhen', 'added {{when}}', {
                            when: relativeTime(device.addedAt),
                          }),
                      device.link === 'connected'
                        ? t('brokers.bluetooth.connectedThrough', 'connected through {{scanner}}', {
                            scanner: device.heardBy[0]?.scannerName ?? '',
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    hasChevron
                    wrap={(className, parts) => (
                      <Link to={devicePath(device.deviceId)} className={className}>
                        {parts}
                      </Link>
                    )}
                  />
                ))}
              </RowList>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The host with no Bluetooth for the container: a proxy instead, or the D-Bus to mount.
 *
 * @param props - Whether it runs on Docker Desktop, and how to add a proxy.
 * @param props.isDesktop - Whether it runs on Docker Desktop.
 * @param props.onAddProxy - Opens Add proxy; absent when the person may not.
 * @returns The note and the card.
 */
export function NoAdapter(props: {
  readonly isDesktop: boolean;
  readonly onAddProxy?: (() => void) | undefined;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <Note
        tone="warning"
        action={
          props.onAddProxy === undefined ? undefined : (
            <Button variant="ghost" size="compact" onClick={props.onAddProxy}>
              <AppIcon id="plus" size={14} />
              {t('brokers.bluetooth.addProxy', 'Add proxy')}
            </Button>
          )
        }
      >
        <span className="flex flex-col gap-1">
          <span className="font-medium text-foreground">
            {t('brokers.bluetooth.noneYet', 'The house has no Bluetooth yet')}
          </span>
          {props.isDesktop
            ? t(
                'brokers.bluetooth.desktopLine',
                'On Docker Desktop (Windows, macOS) the container cannot reach the host’s Bluetooth: add a Shelly as a proxy instead.',
              )
            : t(
                'brokers.bluetooth.proxyLine',
                'Give the container the host’s Bluetooth below, or add a Shelly as a proxy.',
              )}
        </span>
      </Note>
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <span className="flex size-10 items-center justify-center rounded-field bg-[#5b9dff]/12 text-[#5b9dff]">
          <AppIcon id="cpu" size={18} />
        </span>
        <span className="text-title font-medium text-foreground">
          {t('brokers.bluetooth.useServer', 'Use this server’s Bluetooth')}
        </span>
        <span className="text-ui text-foreground-muted">
          {t(
            'brokers.bluetooth.useServerLine',
            'Linux, with the host’s BlueZ running. Mount its D-Bus into the container and let the platform’s user talk to BlueZ. This is the only way to connect to a device, and to pair new Matter devices.',
          )}
        </span>
        <Snippet code={DBUS_SNIPPET} />
      </div>
    </div>
  );
}

/** What Devices needs. */
export type BluetoothDevicesProps = {
  readonly devices: readonly BluetoothDevice[];
  readonly vendorNames: ReadonlyMap<string, string>;
  readonly roomOf: (areaId: string | null) => string | null;
};

/**
 * Renders Devices: the house's Bluetooth devices in a table.
 *
 * @param props - See {@link BluetoothDevicesProps}.
 * @returns The tab's content.
 */
export function BluetoothDevices(props: BluetoothDevicesProps) {
  const { t } = useTranslation();
  const { devices, vendorNames, roomOf } = props;
  const [search, setSearch] = useState('');
  const needle = foldForSearch(search.trim());
  const kept = devices.filter(
    (device) =>
      needle === '' ||
      foldForSearch(
        [
          device.name,
          device.address,
          roomOf(device.areaId) ?? '',
          vendorNames.get(device.vendorId) ?? '',
        ].join(' '),
      ).includes(needle),
  );
  const headings = [
    t('brokers.bluetooth.colName', 'Name'),
    t('brokers.bluetooth.colIntegration', 'Integration'),
    t('brokers.bluetooth.colAddress', 'Address'),
    t('brokers.bluetooth.colSignal', 'Signal'),
    t('brokers.bluetooth.colHeardBy', 'Heard by'),
    t('brokers.bluetooth.colLastHeard', 'Last heard'),
    t('brokers.bluetooth.colLink', 'Link'),
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <SearchField
        className="w-90 lg:w-90"
        placeholder={t('brokers.bluetooth.searchDevices', 'Search devices')}
        value={search}
        onChange={setSearch}
      />
      {devices.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t(
            'brokers.bluetooth.noDevices',
            'No Bluetooth device in the house yet. Add one from Found or Nearby.',
          )}
        </p>
      ) : kept.length === 0 ? (
        <NoMatches
          query={search}
          onClear={() => {
            setSearch('');
          }}
        />
      ) : (
        <div className={TABLE_FRAME}>
          <table className="w-full min-w-220 border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {headings.map((heading, index) => (
                  <th
                    key={heading}
                    scope="col"
                    className={index === 0 ? `${HEAD_CELL} pl-5` : HEAD_CELL}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kept.map((device) => {
                const [best, ...others] = device.heardBy;

                return (
                  <tr key={device.deviceId} className="border-t border-border first:border-t-0">
                    <td className="py-3 pr-4 pl-5">
                      <Link
                        to={devicePath(device.deviceId)}
                        className="flex flex-col gap-0.5 hover:text-primary"
                      >
                        <span className="text-ui font-medium text-foreground">{device.name}</span>
                        <span className="text-ui-sm text-foreground-muted">
                          {roomOf(device.areaId) ?? t('brokers.bluetooth.noRoom', 'No room')}
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <DeviceTag name={vendorNames.get(device.vendorId) ?? device.vendorId} />
                    </td>
                    <td className="py-3 pr-4 font-mono text-mono-caption text-foreground">
                      {device.address}
                    </td>
                    <td className="py-3 pr-4">
                      <Signal rssi={device.rssi} />
                    </td>
                    <td className="py-3 pr-4">
                      {best === undefined ? (
                        '—'
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 text-ui-sm whitespace-nowrap text-foreground"
                          title={device.heardBy
                            .map((each) =>
                              t('brokers.bluetooth.heardLineOne', '{{scanner}} · {{rssi}} dBm', {
                                scanner: each.scannerName,
                                rssi: each.rssi,
                              }),
                            )
                            .join('\n')}
                        >
                          {best.scannerName}
                          {others.length === 0 ? null : <CountTag>+{others.length}</CountTag>}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ui-sm whitespace-nowrap text-foreground-muted">
                      {device.lastHeardAt === null
                        ? t('brokers.bluetooth.notHeard', 'Not heard')
                        : relativeTime(device.lastHeardAt)}
                    </td>
                    <td className="py-3 pr-4 text-ui-sm">
                      {device.link === 'connected' ? (
                        <span className="inline-flex h-5.5 items-center rounded-pill border border-primary/50 bg-primary/10 px-2 text-caption text-primary">
                          {t('brokers.bluetooth.connected', 'Connected')}
                        </span>
                      ) : (
                        <span className="text-foreground-muted">
                          {t('brokers.bluetooth.listening', 'Listening')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What Scanners needs. */
export type BluetoothScannersProps = {
  readonly scanners: readonly BluetoothScanner[];
  readonly vendorNames: ReadonlyMap<string, string>;
  readonly roomOf: (areaId: string | null) => string | null;

  /** Changes a scanner's scan mode; absent when the person may not. */
  readonly onMode?: ((scanner: BluetoothScanner, mode: BluetoothScanMode) => void) | undefined;

  /** Turns the local adapter on or off; absent when the person may not. */
  readonly onAdapter?: ((isOn: boolean) => void) | undefined;

  /** Updates a proxy's script; absent when the person may not. */
  readonly onUpdate?: ((scanner: BluetoothScanner) => void) | undefined;

  /** Asks to stop a device being a proxy; absent when the person may not. */
  readonly onStop?: ((scanner: BluetoothScanner) => void) | undefined;
};

/**
 * Renders Scanners: a row per scanner that opens.
 *
 * @param props - See {@link BluetoothScannersProps}.
 * @returns The tab's content.
 */
export function BluetoothScanners(props: BluetoothScannersProps) {
  const { t } = useTranslation();
  const { scanners } = props;
  const [open, setOpen] = useState<string | null>(
    () => scanners.find((each) => each.kind === 'proxy')?.id ?? null,
  );

  return (
    <Section
      title={t('brokers.bluetooth.scannersTitle', 'Scanners')}
      note={t(
        'brokers.bluetooth.scannersNote',
        'Where the house hears Bluetooth from. Open one to see it and change it. Only the local adapter can connect to a device.',
      )}
    >
      {scanners.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t('brokers.bluetooth.noScanners', 'No adapter and no proxy yet.')}
        </p>
      ) : (
        <ul className="flex flex-col rounded-card border border-border bg-surface px-5 py-0.5">
          {scanners.map((scanner) => (
            <ScannerRow
              key={scanner.id}
              scanner={scanner}
              isOpen={open === scanner.id}
              onToggle={() => {
                setOpen(open === scanner.id ? null : scanner.id);
              }}
              {...props}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * One scanner's row, and what it shows open.
 *
 * @param props - The scanner, whether it is open, and what can be done to it.
 * @param props.scanner - It.
 * @param props.isOpen - Whether it is open.
 * @param props.onToggle - Opens or closes it.
 * @returns The row.
 */
function ScannerRow(
  props: BluetoothScannersProps & {
    readonly scanner: BluetoothScanner;
    readonly isOpen: boolean;
    readonly onToggle: () => void;
  },
) {
  const { t } = useTranslation();
  const { scanner, isOpen, onMode, vendorNames, roomOf } = props;
  const isAdapter = scanner.kind === 'adapter';
  const vendor =
    scanner.vendorId === null ? null : (vendorNames.get(scanner.vendorId) ?? scanner.vendorId);
  const [shown, setShown] = useState(3);

  return (
    <li className="border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-center gap-3.5 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised font-mono text-mono-ui text-[#5b9dff]">
          {isAdapter ? (
            <AppIcon id="bluetooth" size={16} />
          ) : (
            (vendor ?? scanner.name).slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="flex min-w-0 grow basis-60 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-ui font-medium text-foreground">
              {isAdapter
                ? [scanner.id.replace(/^adapter:/u, ''), scanner.chip].filter(Boolean).join(' · ')
                : scanner.name}
            </span>
            {isAdapter ? (
              <>
                <span className="inline-flex h-5.5 items-center rounded-pill border border-[#5b9dff]/45 bg-[#5b9dff]/10 px-2 text-caption text-[#5b9dff]">
                  {t('brokers.bluetooth.localAdapter', 'Local adapter')}
                </span>
                <CapabilityChip>{t('brokers.bluetooth.connects', 'Connects')}</CapabilityChip>
              </>
            ) : (
              <CapabilityChip>{t('brokers.bluetooth.listensOnly', 'Listens only')}</CapabilityChip>
            )}
            {scanner.script?.isOutdated === true ? (
              <span className="inline-flex h-5.5 items-center gap-1 rounded-pill border border-warning/45 bg-warning/10 px-2 text-caption text-warning">
                <AppIcon id="triangle-alert" size={12} />
                {t('brokers.bluetooth.scriptOutdated', 'Script {{version}} out of date', {
                  version: scanner.script.version ?? '',
                })}
              </span>
            ) : null}
          </span>
          <span className="text-ui-sm text-foreground-muted">
            {isAdapter
              ? scanner.address
              : [
                  roomOf(scanner.areaId),
                  vendor,
                  t('brokers.bluetooth.hearsBestCount', 'hears best {{count}} devices', {
                    count: scanner.hearsBest.length,
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
        </span>
        <span className="text-ui-sm text-foreground-muted">
          {t('brokers.bluetooth.advertsPerMinute', '{{count}} adverts/min', {
            count: scanner.advertsPerMinute,
          })}
        </span>
        {isAdapter ? (
          props.onAdapter === undefined ? null : (
            <span className="flex items-center gap-2 text-ui-sm text-foreground-muted">
              {t('brokers.bluetooth.inUse', 'In use')}
              <Switch
                label={t('brokers.bluetooth.useAdapter', 'Use this server’s adapter')}
                isOn={scanner.isEnabled}
                onChange={props.onAdapter}
              />
            </span>
          )
        ) : scanner.script?.isOutdated === true && props.onUpdate !== undefined ? (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              props.onUpdate?.(scanner);
            }}
          >
            {t('brokers.bluetooth.updateScript', 'Update script')}
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-ui-sm">
            <StatusDot
              isBare
              tone={scanner.isOnline ? 'success' : 'warning'}
              title={
                scanner.isOnline
                  ? t('brokers.bluetooth.reportingNow', 'Reporting')
                  : t('brokers.bluetooth.silent', 'Silent')
              }
            />
            <span className={scanner.isOnline ? 'text-success' : 'text-warning'}>
              {scanner.lastReportAt === null
                ? t('brokers.bluetooth.silent', 'Silent')
                : relativeTime(scanner.lastReportAt)}
            </span>
          </span>
        )}
        <IconButton
          label={
            isOpen
              ? t('brokers.bluetooth.close', 'Close {{name}}', { name: scanner.name })
              : t('brokers.bluetooth.open', 'Open {{name}}', { name: scanner.name })
          }
          aria-expanded={isOpen}
          onClick={props.onToggle}
        >
          <AppIcon
            id="chevron-down"
            size={15}
            className={cn('transition-transform', isOpen && 'rotate-180')}
          />
        </IconButton>
      </div>
      {isOpen ? (
        <div className="mb-4 ml-12.5 flex flex-col rounded-card border border-border px-5">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.bluetooth.scanMode', 'Scan mode')}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {scanner.canPassive
                  ? t(
                      'brokers.bluetooth.activeHint',
                      'Active asks devices for more and uses more of their battery.',
                    )
                  : t(
                      'brokers.bluetooth.noPassive',
                      'Passive needs a newer BlueZ on the host: this one scans actively.',
                    )}
              </span>
            </span>
            <Segmented
              label={t('brokers.bluetooth.scanMode', 'Scan mode')}
              value={scanner.scanMode}
              disabled={onMode === undefined}
              onChange={(mode) => {
                onMode?.(scanner, mode);
              }}
              options={[
                {
                  value: 'passive',
                  label: t('brokers.bluetooth.passive', 'Passive'),
                  disabled: !scanner.canPassive,
                },
                { value: 'active', label: t('brokers.bluetooth.active', 'Active') },
              ]}
            />
          </div>
          {isAdapter ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3.5">
              <span className="flex flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('brokers.bluetooth.connectionSlots', 'Connections')}
                </span>
                <span className="text-ui-sm text-foreground-muted">
                  {t('brokers.bluetooth.slotsLine', 'Devices that need a link, like a lock.')}
                </span>
              </span>
              <span className="text-ui text-foreground">
                {scanner.connections === null
                  ? '—'
                  : t(
                      'brokers.bluetooth.connectionsOf',
                      '{{used}} of {{max}}',
                      scanner.connections,
                    )}
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3.5">
                <span className="flex flex-col gap-0.5">
                  <span className="text-ui font-medium text-foreground">
                    {t('brokers.bluetooth.forwards', 'Forwards')}
                  </span>
                  <span className="text-ui-sm text-foreground-muted">
                    {t('brokers.bluetooth.forwardsLine', 'Everything while Nearby is open.')}
                  </span>
                </span>
                <span className="text-ui text-foreground">
                  {scanner.forwarding === 'everything'
                    ? t('brokers.bluetooth.everything', 'Everything')
                    : t('brokers.bluetooth.housesDevices', 'The house’s devices')}
                </span>
              </div>
              {scanner.script === null ? null : (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3.5">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-ui font-medium text-foreground">
                      {t('brokers.bluetooth.script', 'Script')}
                    </span>
                    <span className="text-ui-sm text-foreground-muted">
                      {t(
                        'brokers.bluetooth.scriptLine',
                        'nebula-ble-proxy, installed by the {{vendor}} integration.',
                        { vendor: vendor ?? '' },
                      )}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'text-ui',
                      scanner.script.isOutdated ? 'text-warning' : 'text-foreground',
                    )}
                  >
                    {scanner.script.isOutdated
                      ? t('brokers.bluetooth.scriptBehind', '{{version}} · {{shipped}} is out', {
                          version: scanner.script.version ?? '?',
                          shipped: scanner.script.shipped ?? '?',
                        })
                      : t('brokers.bluetooth.upToDate', '{{version}} · up to date', {
                          version: scanner.script.version ?? '?',
                        })}
                  </span>
                </div>
              )}
            </>
          )}
          {scanner.hearsBest.length === 0 ? null : (
            <div className="flex flex-col gap-1.5 border-t border-border py-3.5">
              <span className="text-ui font-medium text-foreground">
                {t('brokers.bluetooth.hearsBest', 'Hears best')}
              </span>
              {scanner.hearsBest.slice(0, shown).map((each) => (
                <span
                  key={each.address}
                  className="flex items-center justify-between gap-3 text-ui-sm"
                >
                  <span className="text-foreground">{each.name ?? each.address}</span>
                  <Signal rssi={each.rssi} />
                </span>
              ))}
              {scanner.hearsBest.length > shown ? (
                <button
                  type="button"
                  onClick={() => {
                    setShown(scanner.hearsBest.length);
                  }}
                  className="self-start text-ui-sm text-primary hover:text-primary-hover"
                >
                  {t('brokers.bluetooth.more', '{{count}} more', {
                    count: scanner.hearsBest.length - shown,
                  })}
                </button>
              ) : null}
            </div>
          )}
          {isAdapter || (scanner.deviceId === null && props.onStop === undefined) ? null : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border py-3.5">
              {scanner.deviceId === null ? null : (
                <Link
                  to={devicePath(scanner.deviceId)}
                  className="press inline-flex h-8 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised px-3 text-ui-sm font-medium text-foreground hover:bg-surface-high"
                >
                  <AppIcon id="external-link" size={14} />
                  {t('brokers.bluetooth.openDevice', 'Open device')}
                </Link>
              )}
              {props.onStop === undefined ? null : (
                <button
                  type="button"
                  onClick={() => {
                    props.onStop?.(scanner);
                  }}
                  className="press inline-flex h-8 items-center rounded-pill border border-danger/50 px-3 text-ui-sm font-medium text-danger hover:bg-danger/10"
                >
                  {t('brokers.bluetooth.stopProxy', 'Stop being a proxy')}
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
