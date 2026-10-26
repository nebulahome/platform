/**
 * The Modbus broker's Discovery tab: how the network search last went, and what it found - new
 * servers, those already added, those ignored.
 *
 * Nothing Modbus announces itself, so the search knocks on port 502 of the owner's ranges, or of
 * the networks the hub is on. The platform recognises no server on its own: a server is named only
 * by an integration whose rules read it and match, and is offered with that integration; one
 * nobody recognises is offered as a device to make from a template. An ignored server is never
 * offered again until the owner stops ignoring it.
 */
import { useTranslation } from 'react-i18next';

import type { ModbusDevice, ModbusFound, ModbusStatus } from '@nebulahome/contracts';
import { AppIcon, Button, Pill, RowList, Section } from '@nebulahome/ui';

import { relativeTime, shortTime } from '@/lib/format-time';

import { gatewaysOf, UnitTag } from './modbus-parts';

/** What the tab needs. */
export type ModbusDiscoveryProps = {
  readonly status: ModbusStatus;
  readonly found: readonly ModbusFound[];
  readonly ignored: readonly { readonly host: string; readonly port: number; readonly at: Date }[];
  readonly devices: readonly ModbusDevice[];

  /** Opens the settings; absent when the person may not change them. */
  readonly onSettings?: (() => void) | undefined;

  /** Searches now; absent when the person may not. */
  readonly onSearch?: (() => void) | undefined;
  readonly isSearching: boolean;

  /** Opens the add dialog at a server found; absent when the person may not add. */
  readonly onAdd?: ((found: ModbusFound) => void) | undefined;

  /** Ignores a server, or stops ignoring it; absent when the person may not. */
  readonly onIgnore?: ((host: string, port: number, isIgnored: boolean) => void) | undefined;

  /** Opens the Devices tab. */
  readonly onSeeDevices: () => void;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link ModbusDiscoveryProps}.
 * @returns The tab's content.
 */
export function ModbusDiscovery(props: ModbusDiscoveryProps) {
  const { t } = useTranslation();
  const { status, found, ignored, devices, onSettings, onSearch, onAdd, onIgnore } = props;
  const { settings, search } = status;
  const run = search.lastRun;
  const isRunning = search.isRunning || props.isSearching;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface px-5 py-4.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-cyan/14 text-cyan">
          <AppIcon id="radio-tower" size={18} />
        </span>
        <span className="flex min-w-0 grow basis-80 flex-col gap-1">
          <span className="text-ui font-medium text-foreground">
            {isRunning
              ? t('brokers.modbus.searching', 'Searching the network…')
              : run === null
                ? t('brokers.modbus.neverSearched', 'Not searched yet')
                : t('brokers.modbus.lastSearch', 'Last search {{when}}', {
                    when: relativeTime(run.at),
                  })}
          </span>
          {run === null ? null : (
            <span className="text-ui-sm text-foreground-muted">
              {[
                settings.ranges.length === 0
                  ? t('brokers.modbus.addressesOwn', '{{count}} addresses of the hub’s networks', {
                      count: run.addresses,
                    })
                  : t(
                      'brokers.modbus.addressesRanges',
                      '{{count}} addresses in {{ranges}} ranges',
                      {
                        count: run.addresses,
                        ranges: settings.ranges.length,
                      },
                    ),
                t('brokers.modbus.answered', '{{count}} answered on port 502', {
                  count: run.answered,
                }),
                t('brokers.modbus.took', 'took {{seconds}} s', {
                  seconds: Math.max(1, Math.round(run.durationMs / 1000)),
                }),
                ...(search.nextAt === null
                  ? []
                  : [
                      t('brokers.modbus.next', 'next {{when}}', {
                        when: shortTime(search.nextAt),
                      }),
                    ]),
              ].join(' · ')}
            </span>
          )}
        </span>
        <Pill tone={settings.isSearchEnabled ? 'cyan' : 'neutral'}>
          {settings.isSearchEnabled
            ? t('brokers.modbus.onEvery', 'On, every {{minutes}} min', {
                minutes: settings.intervalMinutes,
              })
            : t('brokers.modbus.searchOff', 'Off')}
        </Pill>
        {onSettings === undefined ? null : (
          <Button variant="ghost" onClick={onSettings}>
            <AppIcon id="settings" size={15} />
            {t('brokers.modbus.settings', 'Settings')}
          </Button>
        )}
        {onSearch === undefined ? null : (
          <Button isBusy={isRunning} disabled={isRunning} onClick={onSearch}>
            <AppIcon id="search" size={15} />
            {t('brokers.modbus.searchNow', 'Search now')}
          </Button>
        )}
      </div>

      <Section title={t('brokers.modbus.new', 'New')}>
        {found.length === 0 ? (
          <p className="text-ui text-foreground-subtle">
            {t('brokers.modbus.nothingNew', 'Nothing new on the network.')}
          </p>
        ) : (
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
                  <span className="flex min-w-0 grow basis-60 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-ui font-medium text-foreground">
                        {only?.model ??
                          only?.vendorName ??
                          t('brokers.modbus.unknown', 'Unknown device')}
                      </span>
                      <span className="font-mono text-mono-caption text-foreground-muted">
                        {server.host}:{server.port}
                      </span>
                    </span>
                    <span className="text-ui-sm text-foreground-muted">
                      {only === undefined
                        ? server.claims.length > 1
                          ? t('brokers.modbus.several', 'Recognised by several: {{vendors}}', {
                              vendors: server.claims.map((each) => each.vendorName).join(', '),
                            })
                          : t('brokers.modbus.nobody', 'Nobody recognises it')
                        : t('brokers.modbus.claimedBy', 'Recognised by {{vendor}}', {
                            vendor: only.vendorName,
                          })}
                    </span>
                  </span>
                  {onIgnore === undefined ? null : (
                    <Button
                      variant="bare"
                      size="compact"
                      onClick={() => {
                        onIgnore(server.host, server.port, true);
                      }}
                    >
                      {t('brokers.modbus.ignore', 'Ignore')}
                    </Button>
                  )}
                  {onAdd === undefined ? null : (
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        onAdd(server);
                      }}
                    >
                      {only?.kind == null
                        ? t('brokers.modbus.createDevice', 'Create device')
                        : t('brokers.modbus.addWith', 'Add with {{vendor}}', {
                            vendor: only.vendorName,
                          })}
                    </Button>
                  )}
                </li>
              );
            })}
          </RowList>
        )}
      </Section>

      {devices.length === 0 ? null : (
        <Section title={t('brokers.modbus.alreadyAdded', 'Already added')}>
          <RowList>
            {gatewaysOf(devices).map((gateway) => (
              <li
                key={gateway.key}
                className="flex flex-wrap items-center gap-3 px-5 py-3 opacity-70"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-subtle">
                  <AppIcon id="server" size={16} />
                </span>
                <span className="font-mono text-mono-ui text-foreground">
                  {gateway.host}:{gateway.port}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {gateway.devices.map((device) => (
                    <UnitTag key={device.id} unitId={device.unitId} />
                  ))}
                </span>
                <Button
                  variant="bare"
                  size="compact"
                  className="ml-auto"
                  onClick={props.onSeeDevices}
                >
                  {t('brokers.modbus.open', 'Open')}
                </Button>
              </li>
            ))}
          </RowList>
        </Section>
      )}

      {ignored.length === 0 ? null : (
        <Section title={t('brokers.modbus.ignored', 'Ignored')}>
          <RowList>
            {ignored.map((server) => (
              <li
                key={`${server.host}:${String(server.port)}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-subtle">
                  <AppIcon id="eye-off" size={16} />
                </span>
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="font-mono text-mono-ui text-foreground">
                    {server.host}:{server.port}
                  </span>
                  <span className="text-ui-sm text-foreground-muted">
                    {t('brokers.modbus.ignoredOn', 'Ignored {{when}}. It is not offered again.', {
                      when: relativeTime(server.at),
                    })}
                  </span>
                </span>
                {onIgnore === undefined ? null : (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      onIgnore(server.host, server.port, false);
                    }}
                  >
                    {t('brokers.modbus.stopIgnoring', 'Stop ignoring')}
                  </Button>
                )}
              </li>
            ))}
          </RowList>
        </Section>
      )}
    </div>
  );
}
