/**
 * The Modbus broker's Overview: the health strip, the gateways and the devices behind each, the
 * servers the network search found, and what the client is.
 *
 * The strip says how the client stands and since when, how many devices answer - naming the one
 * that does not - how many gateways it holds a connection to, and its traffic. A gateway is one
 * server at an address: a Modbus TCP device, or a transparent RS485 adapter whose devices are told
 * apart by their unit. A device row leads to the device's page once it is in the house.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ModbusDevice, ModbusFound, ModbusStatus } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  FactGrid,
  HealthCard,
  HealthStrip,
  IconButton,
  RowList,
  Section,
} from '@nebulahome/ui';

import { relativeTime, shortTime } from '@/lib/format-time';
import { brokerStateOf } from '@/routes/library/brokers-page';

import {
  DeviceState,
  FramingTag,
  gatewaysOf,
  SourceChip,
  UnitTag,
  type Gateway,
} from './modbus-parts';

/** What the tab needs. */
export type ModbusOverviewProps = {
  readonly status: ModbusStatus;
  readonly devices: readonly ModbusDevice[];
  readonly found: readonly ModbusFound[];

  /** Each device's room, by the device it is in the house. */
  readonly areaOf: (deviceId: string | null) => string | null;
  readonly vendorNames: ReadonlyMap<string, string>;

  /** Opens the add dialog at a server found; absent when the person may not add. */
  readonly onAdd?: ((found: ModbusFound) => void) | undefined;

  /** Ignores a server found; absent when the person may not. */
  readonly onIgnore?: ((found: ModbusFound) => void) | undefined;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link ModbusOverviewProps}.
 * @returns The tab's content.
 */
export function ModbusOverview(props: ModbusOverviewProps) {
  const { t } = useTranslation();
  const { status, devices, found, onAdd, onIgnore } = props;
  const state = brokerStateOf(status.state);
  const silent = devices.filter((device) => device.state === 'offline');
  const [first] = silent;

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.modbus.client', 'Client')}
          tone={
            status.state === 'running'
              ? 'success'
              : status.state === 'failed'
                ? 'danger'
                : 'neutral'
          }
          value={state.label}
          detail={
            status.state === 'running' && status.startedAt !== null
              ? t('brokers.modbus.since', 'Since {{when}}', {
                  when: relativeTime(status.startedAt),
                })
              : (status.error ?? undefined)
          }
        />
        <HealthCard
          label={t('brokers.modbus.devices', 'Devices')}
          tone={devices.length === 0 ? 'neutral' : silent.length > 0 ? 'warning' : 'success'}
          value={t('brokers.modbus.onlineOf', '{{online}} of {{total}} online', {
            online: status.devices.online,
            total: status.devices.total,
          })}
          detail={
            first === undefined
              ? undefined
              : first.lastReadAt === null
                ? t('brokers.modbus.silent', '{{name}}: no answer', { name: first.name })
                : t('brokers.modbus.silentSince', '{{name}}: no answer since {{time}}', {
                    name: first.name,
                    time: shortTime(first.lastReadAt),
                  })
          }
        />
        <HealthCard
          label={t('brokers.modbus.gateways', 'Gateways')}
          tone="neutral"
          value={String(gatewaysOf(devices).length)}
          detail={t('brokers.modbus.oneAtATime', 'One request at a time on each')}
        />
        <HealthCard
          label={t('brokers.modbus.traffic', 'Traffic')}
          tone="neutral"
          value={t('brokers.modbus.perMinute', '{{count}} requests a minute', {
            count: status.requestsPerMinute,
          })}
          detail={
            status.averageMs === null
              ? undefined
              : t('brokers.modbus.average', '{{ms}} ms on average', { ms: status.averageMs })
          }
        />
      </HealthStrip>

      <Section title={t('brokers.modbus.gatewaysTitle', 'Gateways')}>
        {devices.length === 0 ? (
          <p className="text-ui text-foreground-subtle">
            {t(
              'brokers.modbus.noDevices',
              'No Modbus device yet. Add one by its address, or turn the network search on.',
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {gatewaysOf(devices).map((gateway) => (
              <GatewayCard
                key={gateway.key}
                gateway={gateway}
                areaOf={props.areaOf}
                vendorNames={props.vendorNames}
              />
            ))}
          </div>
        )}
      </Section>

      {found.length === 0 ? null : (
        <Section title={t('brokers.modbus.foundTitle', 'Found on the network')}>
          <RowList>
            {found.map((server) => {
              const [claim, other] = server.claims;
              const only = other === undefined ? claim : undefined;

              return (
                <li
                  key={`${server.host}:${String(server.port)}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
                    <AppIcon id="server" size={16} />
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="font-mono text-mono-ui text-foreground">
                      {server.host}:{server.port}
                    </span>
                    <span className="text-ui-sm text-foreground-muted">
                      {only === undefined
                        ? t('brokers.modbus.nobody', 'Nobody recognises it')
                        : t('brokers.modbus.claimedBy', 'Recognised by {{vendor}}', {
                            vendor: only.vendorName,
                          })}
                    </span>
                  </span>
                  {onAdd === undefined ? null : (
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        onAdd(server);
                      }}
                    >
                      {only === undefined
                        ? t('brokers.modbus.createDevice', 'Create device')
                        : t('brokers.modbus.add', 'Add')}
                    </Button>
                  )}
                  {onIgnore === undefined ? null : (
                    <IconButton
                      label={t('brokers.modbus.ignore', 'Ignore')}
                      onClick={() => {
                        onIgnore(server);
                      }}
                    >
                      <AppIcon id="x" size={15} />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </RowList>
        </Section>
      )}

      <Section title={t('brokers.modbus.about', 'About')}>
        <FactGrid
          facts={[
            { label: t('brokers.modbus.id', 'Id'), value: 'modbus', isMono: true },
            {
              label: t('brokers.modbus.functions', 'Functions'),
              value: '01–06, 15, 16',
              isMono: true,
            },
            {
              label: t('brokers.modbus.requests', 'Requests'),
              value: t('brokers.modbus.requestsValue', 'One at a time on each gateway'),
            },
            {
              label: t('brokers.modbus.blocks', 'Blocks'),
              value: t('brokers.modbus.blocksValue', 'Up to 100 registers a read'),
            },
            {
              label: t('brokers.modbus.writes', 'Writes'),
              value: t('brokers.modbus.writesValue', 'Within each entity’s min and max'),
            },
            {
              label: t('brokers.modbus.search', 'Network search'),
              value: status.settings.isSearchEnabled
                ? t('brokers.modbus.searchEvery', 'Every {{minutes}} min', {
                    minutes: status.settings.intervalMinutes,
                  })
                : t('brokers.modbus.searchOff', 'Off'),
            },
          ]}
        />
      </Section>
    </div>
  );
}

/**
 * One gateway: its address, how frames travel to it, and the devices behind it.
 *
 * @param props - The gateway, each device's room, and the integrations' names.
 * @param props.gateway - The gateway.
 * @param props.areaOf - A device's room.
 * @param props.vendorNames - What each integration is called.
 * @returns The card.
 */
function GatewayCard(props: {
  readonly gateway: Gateway;
  readonly areaOf: (deviceId: string | null) => string | null;
  readonly vendorNames: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const { gateway, areaOf, vendorNames } = props;

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-cyan/14 text-cyan">
          <AppIcon id="server" size={16} />
        </span>
        <span className="font-mono text-mono-ui text-foreground">
          {gateway.host}:{gateway.port}
        </span>
        <FramingTag framing={gateway.framing} />
        <span className="ml-auto text-ui-sm text-foreground-subtle">
          {t('brokers.modbus.deviceCount', {
            count: gateway.devices.length,
            defaultValue_one: '{{count}} device',
            defaultValue_other: '{{count}} devices',
          })}
        </span>
      </div>
      <ul className="flex flex-col">
        {gateway.devices.map((device) => {
          const area = areaOf(device.deviceId);
          const row = (
            <>
              <span className="flex min-w-0 grow basis-55 flex-col gap-0.75">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-ui font-medium text-foreground">{device.name}</span>
                  <UnitTag unitId={device.unitId} />
                </span>
                <span className="truncate text-ui-sm text-foreground-muted">
                  {[
                    device.templateName ?? t('brokers.modbus.templateMissing', 'Template missing'),
                    area,
                    t('brokers.modbus.every', 'every {{seconds}} s', {
                      seconds: device.everySeconds,
                    }),
                  ]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
              </span>
              <SourceChip
                vendorId={device.vendorId}
                vendorName={device.vendorId === null ? undefined : vendorNames.get(device.vendorId)}
              />
              <DeviceState device={device} />
              <AppIcon
                id="chevron-right"
                size={15}
                className={device.deviceId === null ? 'invisible' : 'text-foreground-subtle'}
              />
            </>
          );

          return (
            <li key={device.id} className="border-t border-border first:border-t-0">
              {device.deviceId === null ? (
                <div className="flex flex-wrap items-center gap-3 px-5 py-3">{row}</div>
              ) : (
                <Link
                  to={`/devices/${device.deviceId}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-raised"
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
