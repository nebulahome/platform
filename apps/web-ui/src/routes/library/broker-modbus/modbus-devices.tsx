/**
 * The Modbus broker's Devices tab: every device, in one table.
 *
 * All, Online or No answer at the left, with how many of each, and a search over names, rooms,
 * templates and addresses at the right. A row says what the device is read with, where it is -
 * the server and the unit behind it - how often it is read and when it last answered. Its name
 * leads to its page once it is in the house; the bin removes it.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ModbusDevice } from '@nebulahome/contracts';
import { AppIcon, IconButton, Segmented } from '@nebulahome/ui';

import { foldForSearch } from '@/lib/search-text';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

import { DeviceState, LastRead, SourceChip, UnitTag } from './modbus-parts';

/** Which devices show. */
type Shown = 'all' | 'online' | 'offline';

/** What the tab needs. */
export type ModbusDevicesProps = {
  readonly devices: readonly ModbusDevice[];
  readonly areaOf: (deviceId: string | null) => string | null;
  readonly vendorNames: ReadonlyMap<string, string>;

  /** Removes a device from the house; absent when the person may not. */
  readonly onRemove?: ((device: ModbusDevice) => void) | undefined;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link ModbusDevicesProps}.
 * @returns The tab's content.
 */
export function ModbusDevices(props: ModbusDevicesProps) {
  const { t } = useTranslation();
  const { devices, areaOf, vendorNames, onRemove } = props;
  const [shown, setShown] = useState<Shown>('all');
  const [search, setSearch] = useState('');
  const needle = foldForSearch(search.trim());

  /**
   * Whether a device is one a choice shows.
   *
   * @param device - The device.
   * @param what - The choice.
   * @returns True to show it.
   */
  const isShown = (device: ModbusDevice, what: Shown): boolean =>
    what === 'all' || device.state === what;
  const kept = devices.filter(
    (device) =>
      isShown(device, shown) &&
      (needle === '' ||
        foldForSearch(
          [
            device.name,
            areaOf(device.deviceId) ?? '',
            device.templateName ?? '',
            `${device.host}:${String(device.port)}`,
          ].join(' '),
        ).includes(needle)),
  );
  /**
   * How many devices a choice shows, before the search.
   *
   * @param what - The choice.
   * @returns The count.
   */
  const count = (what: Shown): number => devices.filter((device) => isShown(device, what)).length;
  const headings = [
    t('brokers.modbus.colDevice', 'Device'),
    t('brokers.modbus.colReadWith', 'Read with'),
    t('brokers.modbus.colAddress', 'Address'),
    t('brokers.modbus.colPolling', 'Polling'),
    t('brokers.modbus.colLastRead', 'Last read'),
    t('brokers.modbus.colStatus', 'Status'),
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('brokers.modbus.show', 'Show')}
          value={shown}
          onChange={setShown}
          options={[
            {
              value: 'all',
              label: t('brokers.modbus.showAll', 'All · {{count}}', { count: count('all') }),
            },
            {
              value: 'online',
              label: t('brokers.modbus.showOnline', 'Online · {{count}}', {
                count: count('online'),
              }),
            },
            {
              value: 'offline',
              label: t('brokers.modbus.showOffline', 'No answer · {{count}}', {
                count: count('offline'),
              }),
            },
          ]}
        />
        <SearchField
          className="w-65 lg:w-65"
          placeholder={t('brokers.modbus.searchDevices', 'Search devices')}
          value={search}
          onChange={setSearch}
        />
      </div>
      {devices.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {t(
            'brokers.modbus.noDevices',
            'No Modbus device yet. Add one by its address, or turn the network search on.',
          )}
        </p>
      ) : kept.length === 0 ? (
        <NoMatches
          query={search}
          onClear={() => {
            setSearch('');
            setShown('all');
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-200 border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {headings.map((heading, index) => (
                  <th
                    key={heading}
                    scope="col"
                    className={
                      index === 0
                        ? 'py-3.5 pr-4 pl-5 font-mono text-label font-normal text-foreground-subtle uppercase'
                        : 'py-3.5 pr-4 font-mono text-label font-normal text-foreground-subtle uppercase'
                    }
                  >
                    {heading}
                  </th>
                ))}
                {onRemove === undefined ? null : <th scope="col" className="w-12" />}
              </tr>
            </thead>
            <tbody>
              {kept.map((device) => (
                <tr key={device.id} className="border-t border-border first:border-t-0">
                  <td className="min-w-48 py-3 pr-4 pl-5">
                    <span className="flex flex-col gap-0.5">
                      {device.deviceId === null ? (
                        <span className="text-ui font-medium text-foreground">{device.name}</span>
                      ) : (
                        <Link
                          to={`/devices/${device.deviceId}`}
                          className="text-ui font-medium text-foreground hover:text-primary"
                        >
                          {device.name}
                        </Link>
                      )}
                      <span className="text-ui-sm text-foreground-muted">
                        {areaOf(device.deviceId) ?? t('brokers.modbus.noRoom', 'No room')}
                      </span>
                    </span>
                  </td>
                  <td className="max-w-60 py-3 pr-4">
                    <SourceChip
                      vendorId={device.vendorId}
                      vendorName={
                        device.vendorId === null ? undefined : vendorNames.get(device.vendorId)
                      }
                      templateName={
                        device.templateName ??
                        t('brokers.modbus.templateMissing', 'Template missing')
                      }
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-mono-ui whitespace-nowrap text-foreground">
                        {device.host}:{device.port}
                      </span>
                      <UnitTag unitId={device.unitId} />
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-ui-sm whitespace-nowrap text-foreground-muted">
                    {t('brokers.modbus.everyShort', 'Every {{seconds}} s', {
                      seconds: device.everySeconds,
                    })}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <LastRead device={device} />
                  </td>
                  <td className="py-3 pr-4">
                    <span title={device.lastError ?? undefined}>
                      <DeviceState device={device} />
                    </span>
                  </td>
                  {onRemove === undefined ? null : (
                    <td className="py-3 pr-4 text-right">
                      <IconButton
                        label={t('brokers.modbus.removeDevice', 'Remove {{name}}', {
                          name: device.name,
                        })}
                        onClick={() => {
                          onRemove(device);
                        }}
                      >
                        <AppIcon id="trash-2" size={15} />
                      </IconButton>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
