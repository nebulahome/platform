/**
 * The Serial broker's tabs: Overview, Ports and Devices, and what a container that sees no port
 * says.
 *
 * Overview is the health strip - access to `/dev`, the ports seen and in use, the hot-plug watch,
 * any port two holders want - then the ports an integration or a broker recognises (Use, Ignore),
 * then what the broker is. Ports is every port in a table: what it is, its stable path to copy,
 * its USB ids and serial, who holds it (one holder each), and whether it is plugged in, with a
 * menu of what can be done to it. Devices lists the devices reached through a port.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  serialLineText,
  type SerialDevice,
  type SerialHolder,
  type SerialPort,
  type SerialStatus,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  FactGrid,
  HealthCard,
  HealthStrip,
  IconButton,
  ListRow,
  Menu,
  Note,
  RowList,
  Section,
  StatusDot,
  type MenuItem,
  type UiIconId,
} from '@nebulahome/ui';

import { SerialLogo, ThreadLogo } from '@/components/brand-logos';
import { shortTime } from '@/lib/format-time';
import {
  BrokerEmpty,
  CopyButton,
  CountTag,
  DeviceTag,
  HEAD_CELL,
  Snippet,
  TABLE_FRAME,
} from '@/routes/library/broker-parts';

/** The glyph of each kind of port. */
const PORT_ICONS: Readonly<Record<SerialPort['kind'], UiIconId>> = {
  usb: 'usb',
  builtin: 'cpu',
  network: 'globe',
};

/** The compose lines that give the container the ports. */
const COMPOSE_SNIPPET = [
  'services:',
  '  nebula:',
  '    devices:',
  '      - /dev/serial/by-id/usb-Nabu_Casa_SkyConnect_v1.0_…-if00-port0',
  '    # or, to plug in later without a restart:',
  '    # volumes: [ "/dev:/dev" ]',
  '    # device_cgroup_rules: [ "c 188:* rmw", "c 166:* rmw" ]',
].join('\n');

/**
 * A port's USB ids, as `vid:pid`.
 *
 * @param port - The port.
 * @returns The ids, or null for a port that is not on USB.
 */
function usbIds(port: SerialPort): string | null {
  return port.usb === null ? null : `${port.usb.vendorId}:${port.usb.productId}`;
}

/**
 * Who holds a port, as a tag: a device with its integration's initial, a broker with its mark, a
 * container locked; Free when nobody does.
 *
 * @param props - The holder.
 * @param props.holder - It, or null.
 * @returns The tag.
 */
export function HolderTag(props: { readonly holder: SerialHolder | null }) {
  const { t } = useTranslation();
  const { holder } = props;

  if (holder === null) {
    return (
      <span className="inline-flex h-6 items-center rounded-pill border border-dashed border-border-strong px-2.5 text-caption text-foreground-muted">
        {t('brokers.serial.free', 'Free')}
      </span>
    );
  }

  if (holder.kind === 'broker') {
    return (
      <span className="inline-flex h-6.5 items-center gap-1.5 rounded-pill border border-border-strong bg-surface pr-2.5 pl-1.5 text-ui-sm whitespace-nowrap text-foreground">
        <ThreadLogo width={14} height={14} />
        {holder.name}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <DeviceTag name={holder.name} vendorName={holder.vendorId ?? holder.name} />
      {holder.kind === 'container' ? (
        <AppIcon
          id="lock"
          size={12}
          className="text-foreground-subtle"
          aria-label={t('brokers.serial.containerHeld', 'Released from the container’s page')}
        />
      ) : null}
    </span>
  );
}

/** What Overview needs. */
export type SerialOverviewProps = {
  readonly status: SerialStatus;
  readonly ports: readonly SerialPort[];

  /** Opens Use with… on a port; absent when the person may not. */
  readonly onUse?: ((port: SerialPort) => void) | undefined;

  /** Ignores a port suggested; absent when the person may not. */
  readonly onIgnore?: ((port: SerialPort) => void) | undefined;

  /** Opens Ports, at the container's access. */
  readonly onAccess: () => void;
};

/**
 * Renders Overview.
 *
 * @param props - See {@link SerialOverviewProps}.
 * @returns The tab's content.
 */
export function SerialOverview(props: SerialOverviewProps) {
  const { t } = useTranslation();
  const { status, ports, onUse, onIgnore } = props;
  const unplugged = ports.filter((port) => !port.isConnected).length;
  const suggested = ports.filter(
    (port) => port.holder === null && port.isConnected && !port.isIgnored && port.claims.length > 0,
  );
  const [conflict] = status.conflicts;
  const changed = status.hotplug.lastChangeAt;

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.serial.access', 'Access')}
          tone={status.access === 'ok' ? 'neutral' : 'warning'}
          value={
            status.access === 'ok'
              ? t('brokers.serial.seesDev', 'The container sees /dev')
              : t('brokers.serial.noPort', 'No port reachable')
          }
          detail={
            status.access === 'ok'
              ? t('brokers.serial.pluggingWorks', 'Plugging in later works too')
              : status.access === 'desktop'
                ? t('brokers.serial.desktop', 'Docker Desktop passes no USB through')
                : t('brokers.serial.nothingPassed', 'Nothing passed in from the host')
          }
          action={
            status.access === 'ok'
              ? undefined
              : {
                  icon: 'chevron-right',
                  verb: t('brokers.serial.howToGive', 'How to give access'),
                  onSelect: props.onAccess,
                }
          }
        />
        <HealthCard
          label={t('brokers.serial.ports', 'Ports')}
          tone="neutral"
          value={t('brokers.serial.seenInUse', '{{seen}} seen · {{inUse}} in use', {
            seen: status.ports.seen,
            inUse: status.ports.inUse,
          })}
          detail={
            status.ports.seen === 0
              ? t('brokers.serial.networkStillWork', 'Network ports still work')
              : unplugged === 0
                ? undefined
                : t('brokers.serial.unpluggedKept', '{{count}} unplugged, kept for its holder', {
                    count: unplugged,
                  })
          }
        />
        <HealthCard
          label={t('brokers.serial.hotplug', 'Hot-plug')}
          tone="neutral"
          value={
            status.hotplug.isWatching
              ? t('brokers.serial.watching', 'Watching')
              : t('brokers.serial.notWatching', 'Not watching')
          }
          detail={
            !status.hotplug.isWatching
              ? t('brokers.serial.needsDev', 'Needs /dev from the host')
              : changed === null
                ? undefined
                : t('brokers.serial.lastPlug', 'Last plug or unplug at {{time}}', {
                    time: shortTime(changed),
                  })
          }
        />
        <HealthCard
          label={t('brokers.serial.conflicts', 'Conflicts')}
          tone={conflict === undefined ? 'neutral' : 'danger'}
          value={
            conflict === undefined
              ? t('brokers.serial.none', 'None')
              : t('brokers.serial.wantedByTwo', '{{port}} wanted by {{count}}', {
                  port: conflict.name,
                  count: conflict.wantedBy.length,
                })
          }
          detail={
            conflict === undefined
              ? t('brokers.serial.oneHolder', 'One holder per port')
              : conflict.wantedBy.map((each) => each.name).join(', ')
          }
        />
      </HealthStrip>

      {status.access !== 'ok' && ports.length === 0 ? (
        <NoAccess isDesktop={status.access === 'desktop'} />
      ) : null}

      {suggested.length === 0 ? null : (
        <Section
          title={t('brokers.serial.suggested', 'Suggested')}
          note={t(
            'brokers.serial.suggestedNote',
            'Ports that an integration or a broker recognises.',
          )}
        >
          <RowList>
            {suggested.map((port) => {
              const [claim] = port.claims;
              const ids = usbIds(port);

              return (
                <ListRow
                  key={port.id}
                  icon={
                    claim?.kind === 'broker' ? (
                      <ThreadLogo width={16} height={16} />
                    ) : (
                      <span className="font-mono text-mono-ui text-primary">
                        {(claim?.vendorName ?? port.name).slice(0, 1).toUpperCase()}
                      </span>
                    )
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {port.name}
                      {ids === null ? null : <CountTag>{ids}</CountTag>}
                    </span>
                  }
                  subtitle={
                    claim === undefined
                      ? ''
                      : claim.kind === 'broker'
                        ? t(
                            'brokers.serial.looksLikeRadio',
                            'Looks like a {{model}}. Use as Thread radio?',
                            { model: claim.model ?? 'SkyConnect' },
                          )
                        : t(
                            'brokers.serial.recognisesCable',
                            '{{vendor}} recognises this cable{{serial}}. Use with {{vendor}}?',
                            {
                              vendor: claim.vendorName,
                              serial:
                                port.usb?.serialNumber == null
                                  ? ''
                                  : ` (serial ${port.usb.serialNumber})`,
                            },
                          )
                  }
                  trailing={
                    <>
                      {onIgnore === undefined ? null : (
                        <IconButton
                          label={t('brokers.serial.ignore', 'Ignore')}
                          onClick={() => {
                            onIgnore(port);
                          }}
                        >
                          <AppIcon id="x" size={15} />
                        </IconButton>
                      )}
                      {onUse === undefined ? null : (
                        <Button
                          variant="ghost"
                          size="compact"
                          onClick={() => {
                            onUse(port);
                          }}
                        >
                          {t('brokers.serial.use', 'Use')}
                        </Button>
                      )}
                    </>
                  }
                />
              );
            })}
          </RowList>
        </Section>
      )}

      <Section title={t('brokers.serial.about', 'About')}>
        <FactGrid
          facts={[
            { label: t('brokers.serial.id', 'Id'), value: 'serial', isMono: true },
            {
              label: t('brokers.serial.paths', 'Paths'),
              value: t('brokers.serial.pathsValue', 'Stable, from /dev/serial/by-id'),
            },
            {
              label: t('brokers.serial.builtin', 'Built-in ports'),
              value: status.settings.showBuiltin
                ? t('brokers.serial.builtinShown', 'Shown')
                : t('brokers.serial.builtinHidden', 'Hidden, see Settings'),
            },
            {
              label: t('brokers.serial.networkPorts', 'Network ports'),
              value: t('brokers.serial.networkValue', 'Raw TCP and RFC 2217'),
            },
          ]}
        />
      </Section>
    </div>
  );
}

/**
 * The container sees no serial port: how to pass them in, and the way round on Docker Desktop.
 *
 * @param props - Whether it runs on Docker Desktop, and how to add a network port.
 * @param props.isDesktop - Whether it runs on Docker Desktop.
 * @param props.onNetworkPort - Opens Add network port; absent when the person may not.
 * @returns The card.
 */
export function NoAccess(props: {
  readonly isDesktop: boolean;
  readonly onNetworkPort?: (() => void) | undefined;
}) {
  const { t } = useTranslation();

  return (
    <BrokerEmpty
      mark={<SerialLogo width={28} height={28} />}
      title={t('brokers.serial.noAccessTitle', 'The container sees no serial port')}
    >
      <span className="flex flex-col items-stretch gap-4 text-left">
        <span className="text-center">
          {t(
            'brokers.serial.noAccessLine',
            'On Linux the compose file has to pass the ports in. Pass one by its stable path, or all of /dev with the rule that lets ports be plugged in later.',
          )}
        </span>
        <Snippet code={COMPOSE_SNIPPET} />
        <Note
          tone="warning"
          action={
            props.onNetworkPort === undefined ? undefined : (
              <Button variant="ghost" size="compact" onClick={props.onNetworkPort}>
                <AppIcon id="globe" size={14} />
                {t('brokers.serial.addNetworkPort', 'Add network port')}
              </Button>
            )
          }
        >
          {t(
            'brokers.serial.desktopNote',
            'Docker Desktop on Windows and macOS cannot pass USB through. Use a network port (ser2net, an ESP serial bridge) instead.',
          )}
        </Note>
      </span>
    </BrokerEmpty>
  );
}

/** What Ports needs. */
export type SerialPortsProps = {
  readonly status: SerialStatus;
  readonly ports: readonly SerialPort[];

  /** What can be done to a port, for its menu. */
  readonly menuOf: (port: SerialPort) => MenuItem[];
  readonly onNetworkPort?: (() => void) | undefined;
};

/**
 * Renders Ports: every port in a table.
 *
 * @param props - See {@link SerialPortsProps}.
 * @returns The tab's content.
 */
export function SerialPorts(props: SerialPortsProps) {
  const { t } = useTranslation();
  const { status, ports, menuOf } = props;

  if (ports.length === 0) {
    return status.access === 'ok' ? (
      <p className="text-ui text-foreground-subtle">
        {t('brokers.serial.noPorts', 'No port plugged in yet.')}
      </p>
    ) : (
      <NoAccess isDesktop={status.access === 'desktop'} onNetworkPort={props.onNetworkPort} />
    );
  }

  return (
    <Section
      title={t('brokers.serial.portsTitle', 'Ports')}
      note={t(
        'brokers.serial.portsNote',
        'One holder per port: an integration’s device, a broker, or a managed container.',
      )}
    >
      <div className={TABLE_FRAME}>
        <table className="w-full min-w-200 border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={`${HEAD_CELL} pl-5`}>
                {t('brokers.serial.colPort', 'Port')}
              </th>
              <th scope="col" className={`${HEAD_CELL} w-60`}>
                {t('brokers.serial.colHeldBy', 'Held by')}
              </th>
              <th scope="col" className={`${HEAD_CELL} w-36`}>
                {t('brokers.serial.colState', 'State')}
              </th>
              <th scope="col" className="w-12" />
            </tr>
          </thead>
          <tbody>
            {ports.map((port) => {
              const ids = usbIds(port);
              const items = menuOf(port);

              return (
                <tr
                  key={port.id}
                  className={cn(
                    'border-t border-border align-middle first:border-t-0',
                    !port.isConnected && 'opacity-55',
                  )}
                >
                  <td className="py-3.5 pr-4 pl-5">
                    <span className="flex items-start gap-3.5">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised text-[#f0c27b]">
                        <AppIcon id={PORT_ICONS[port.kind]} size={15} />
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-ui font-medium text-foreground">{port.name}</span>
                          {ids === null ? null : <CountTag>{ids}</CountTag>}
                          {port.network === null ? null : (
                            <CountTag>
                              {port.network.protocol === 'rfc2217'
                                ? t('brokers.serial.rfc2217', 'RFC 2217')
                                : t('brokers.serial.rawTcp', 'Raw TCP')}
                            </CountTag>
                          )}
                          {port.usb?.serialNumber == null ? null : (
                            <CountTag>
                              {t('brokers.serial.sn', 'SN {{serial}}', {
                                serial: port.usb.serialNumber,
                              })}
                            </CountTag>
                          )}
                        </span>
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="max-w-140 truncate font-mono text-mono-caption text-foreground-muted">
                            {port.path}
                          </span>
                          <CopyButton value={port.path} isCompact />
                        </span>
                        {port.isConnected || port.lastSeenAt === null ? null : (
                          <span className="text-caption text-foreground-subtle">
                            {t(
                              'brokers.serial.unpluggedAt',
                              'Unplugged at {{time}}: its holder gets it back when it is plugged in again.',
                              { time: shortTime(port.lastSeenAt) },
                            )}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <HolderTag holder={port.holder} />
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className="flex items-center gap-1.5 text-ui-sm whitespace-nowrap">
                      <StatusDot
                        isBare
                        tone={port.isConnected ? 'success' : 'neutral'}
                        title={
                          port.isConnected
                            ? t('brokers.serial.connected', 'Connected')
                            : t('brokers.serial.unplugged', 'Unplugged')
                        }
                      />
                      <span className={port.isConnected ? 'text-success' : 'text-foreground-muted'}>
                        {port.isConnected
                          ? t('brokers.serial.connected', 'Connected')
                          : t('brokers.serial.unplugged', 'Unplugged')}
                      </span>
                    </span>
                  </td>
                  <td className="py-3.5 pr-4 text-right">
                    {items.length === 0 ? null : (
                      <Menu
                        align="end"
                        items={items}
                        trigger={(state) => (
                          <IconButton
                            ref={state.buttonRef}
                            label={t('brokers.serial.portMenu', 'More for {{name}}', {
                              name: port.name,
                            })}
                            aria-expanded={state.isOpen}
                            onClick={state.toggle}
                          >
                            <AppIcon id="ellipsis-vertical" size={15} />
                          </IconButton>
                        )}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** What Devices needs. */
export type SerialDevicesProps = {
  readonly devices: readonly SerialDevice[];
  readonly roomOf: (areaId: string | null) => string | null;
  readonly vendorNames: ReadonlyMap<string, string>;
};

/**
 * Renders Devices: those reached through a port.
 *
 * @param props - See {@link SerialDevicesProps}.
 * @returns The tab's content.
 */
export function SerialDevices(props: SerialDevicesProps) {
  const { t } = useTranslation();
  const { devices, roomOf, vendorNames } = props;
  const headings = [
    t('brokers.serial.colName', 'Name'),
    t('brokers.serial.colIntegration', 'Integration'),
    t('brokers.serial.colRoom', 'Room'),
    t('brokers.serial.colPort', 'Port'),
    t('brokers.serial.colSettings', 'Settings'),
    t('brokers.serial.colState', 'State'),
  ];

  if (devices.length === 0) {
    return (
      <p className="text-ui text-foreground-subtle">
        {t(
          'brokers.serial.noDevices',
          'No device on a port yet. Use a free port with an integration from Ports.',
        )}
      </p>
    );
  }

  return (
    <div className={TABLE_FRAME}>
      <table className="w-full min-w-200 border-collapse text-left">
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
          {devices.map((device) => (
            <tr key={device.deviceId} className="border-t border-border first:border-t-0">
              <td className="py-3 pr-4 pl-5">
                <Link
                  to={`/devices/${device.deviceId}`}
                  className="text-ui font-medium text-foreground hover:text-primary"
                >
                  {device.name}
                </Link>
              </td>
              <td className="py-3 pr-4">
                <DeviceTag name={vendorNames.get(device.vendorId) ?? device.vendorId} />
              </td>
              <td className="py-3 pr-4 text-ui text-foreground">
                {roomOf(device.areaId) ?? t('brokers.serial.noRoom', 'No room')}
              </td>
              <td className="py-3 pr-4 font-mono text-mono-ui text-foreground">
                {device.portName}
              </td>
              <td className="py-3 pr-4 font-mono text-mono-ui text-foreground-muted">
                {serialLineText(device.line)}
              </td>
              <td className="py-3 pr-4">
                <span className="flex items-center gap-1.5 text-ui-sm">
                  <StatusDot
                    isBare
                    tone={device.isOnline ? 'success' : 'warning'}
                    title={
                      device.isOnline
                        ? t('brokers.serial.online', 'Online')
                        : t('brokers.serial.offline', 'Offline')
                    }
                  />
                  {device.isOnline
                    ? t('brokers.serial.online', 'Online')
                    : t('brokers.serial.offline', 'Offline')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
