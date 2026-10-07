/**
 * The Devices tab of an integration's page: every device added under the vendor, as a table to
 * search and narrow, Add device, and the devices the vendor heard and passed over.
 *
 * A device here is the same device the Devices page lists, seen from the vendor's side: what the
 * owner added by its address, which the hub then connects to and listens for. The row is what
 * that came to - `identifying` while the hardware has not answered, `running`, or `failed` with
 * one line that leads to the device's page, where the transport's own sentence is in full.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import type { DeviceView, IntegrationState, IntegrationVendorView } from '@nebulahome/contracts';
import { AppIcon, Badge, cn, IconButton, Panel, Segmented, type BadgeTone } from '@nebulahome/ui';

import { WrenchIcon } from '@/components/icons';
import { relativeTime } from '@/lib/format-time';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import {
  OPEN_VENDOR_DEVICE_FILTER,
  VENDOR_DEVICE_FILTER_CODEC,
  type DeviceStandingChoice,
} from '@/library/list-filters';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon, useDeviceIcons } from '@/routes/library/device-icon';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { PassedOverPanel } from '@/routes/library/vendor-hearing';

/** What each runtime state means to somebody reading the page. */
const TONES: Readonly<Record<IntegrationState, BadgeTone>> = {
  stopped: 'neutral',
  starting: 'accent',
  identifying: 'accent',
  running: 'success',
  failed: 'danger',
  disabled: 'neutral',
};

/**
 * The columns of the devices table: which device, its model, how it is doing, when it last
 * reported, and the spanner.
 *
 * Every track but the first is a fixed width. The header and each row are separate grids, and
 * a track sized `auto` resolves to a different width in each of them - which is how the cells
 * once drifted from their headings. The full table needs the width a wide window has beside
 * the rail; at a tablet's width the model rides under the name and the clock waits for a wider
 * screen, so the panel never grows past the page.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_40px] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1fr)_120px_40px] ' +
  'lg:grid-cols-[minmax(0,1fr)_140px_120px_128px_40px]';

/** The standings the device table is narrowed by. */
const STANDING_OPTIONS: readonly {
  readonly value: DeviceStandingChoice;
  readonly label: string;
}[] = [
  { value: 'any', label: 'Any' },
  { value: 'running', label: 'Running' },
  { value: 'failing', label: 'Failed' },
  { value: 'disabled', label: 'Disabled' },
];

/**
 * Whether a device's state is the standing asked for.
 *
 * @param state - The device's lifecycle state.
 * @param standing - What the filter asks for.
 * @returns True when it matches, or when any standing will do.
 */
function standingMatches(state: IntegrationState, standing: DeviceStandingChoice): boolean {
  switch (standing) {
    case 'any':
      return true;
    case 'running':
      return state === 'running';
    case 'failing':
      return state === 'failed';
    case 'disabled':
      return state === 'disabled';
  }
}

/** What the tab needs. */
export type VendorDevicesTabProps = {
  readonly vendor: IntegrationVendorView;

  /** The devices added under it. */
  readonly devices: readonly DeviceView[];

  /** Add device, when the person may add one and the vendor takes devices by address. */
  readonly addButton?: ReactNode;

  /** Opens a device's settings; absent for who may not edit devices. */
  readonly onConfigure?: (device: DeviceView) => void;
};

/**
 * Renders the Devices tab.
 *
 * @param props - See {@link VendorDevicesTabProps}.
 * @returns The tab's content.
 */
export function VendorDevicesTab(props: VendorDevicesTabProps) {
  const { vendor, devices, addButton, onConfigure } = props;
  const isAutomatic = vendor.adoption === 'automatic';
  const [filter, setFilter] = useListState(VENDOR_DEVICE_FILTER_CODEC);
  const icons = useDeviceIcons(devices);
  const shownDevices = devices.filter(
    (device) =>
      standingMatches(device.state, filter.standing) &&
      matchesQuery(
        [
          device.name,
          device.model,
          device.series,
          device.driverName,
          device.areaName,
          device.externalId,
          device.id,
        ],
        filter.search,
      ),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {devices.length === 0 ? null : (
          <>
            <SearchField
              placeholder="Search this vendor's devices…"
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label="Narrow the devices"
              count={Number(filter.standing !== 'any')}
              summary={`${String(shownDevices.length)} of ${String(devices.length)} shown`}
              onClear={() => {
                setFilter({ ...filter, standing: 'any' });
              }}
            >
              <Facet title="Status">
                <Segmented
                  label="Status"
                  size="compact"
                  className="self-start"
                  options={STANDING_OPTIONS}
                  value={filter.standing}
                  onChange={(standing) => {
                    setFilter({ ...filter, standing });
                  }}
                />
              </Facet>
            </FilterSheet>
          </>
        )}
        {addButton}
      </div>

      <Panel
        title={
          shownDevices.length === devices.length
            ? `Devices · ${String(devices.length)}`
            : `Devices · ${String(shownDevices.length)} of ${String(devices.length)}`
        }
      >
        <div
          className={`${COLUMNS} border-t border-border px-5.5 py-2.5 font-mono text-label text-foreground-subtle uppercase`}
          aria-hidden="true"
        >
          <span>Device</span>
          <span className="hidden lg:block">Model</span>
          <span className="hidden md:block">Status</span>
          <span className="hidden lg:block">Last updated</span>
          <span />
        </div>

        {devices.length === 0 ? (
          <p className="border-t border-border px-5.5 py-3.5 text-ui text-foreground-muted">
            {isAutomatic
              ? `Nothing yet. A device paired with ${vendor.name} is added here on its own.`
              : 'Nothing added yet. Add a device by its address and the hub listens for it at once.'}
          </p>
        ) : shownDevices.length === 0 ? (
          <div className="border-t border-border p-4">
            <NoMatches
              query={filter.search}
              onClear={() => {
                setFilter(OPEN_VENDOR_DEVICE_FILTER);
              }}
            />
          </div>
        ) : (
          <ul>
            {shownDevices.map((device) => (
              <li key={device.id} className={`${COLUMNS} border-t border-border px-5.5 py-3`}>
                <span className="flex min-w-0 items-center gap-3">
                  <DeviceIcon
                    icon={icons.get(device.icon ?? '')}
                    className="text-foreground-muted"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      to={devicePath(device.id)}
                      className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {device.name}
                    </Link>
                    <span className="text-caption text-foreground-subtle lg:hidden">
                      {device.model ?? device.driverName}
                    </span>
                    {/* One line at most: what went wrong is on the device's page, in full. */}
                    {device.lastError !== null ? (
                      <Link
                        to={devicePath(device.id)}
                        className={cn(
                          'flex items-center gap-1 text-caption transition-colors hover:text-primary',
                          device.state === 'identifying' ? 'text-foreground-subtle' : 'text-danger',
                        )}
                      >
                        <AppIcon id="triangle-alert" size={12} className="shrink-0" />
                        <span className="truncate">
                          {device.state === 'identifying'
                            ? 'Still listening - see why'
                            : 'Not working - see why'}
                        </span>
                      </Link>
                    ) : device.state === 'identifying' ? (
                      <span className="text-caption text-foreground-subtle">
                        Listening for the device…
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="hidden truncate text-ui text-foreground-muted lg:block">
                  {device.model ?? device.driverName}
                </span>
                <span className="hidden items-center md:flex">
                  <Badge tone={TONES[device.state]} size="small">
                    {device.state}
                  </Badge>
                </span>
                <span className="hidden text-caption text-foreground-subtle tabular lg:block">
                  {device.lastUpdatedAt === null ? '—' : relativeTime(device.lastUpdatedAt)}
                </span>
                <span className="flex justify-end">
                  {onConfigure === undefined ? null : (
                    <IconButton
                      variant="bare"
                      size="small"
                      label={`Configure ${device.name}`}
                      onClick={() => {
                        onConfigure(device);
                      }}
                    >
                      <WrenchIcon width="16" height="16" />
                    </IconButton>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PassedOverPanel vendor={vendor} />
    </div>
  );
}
