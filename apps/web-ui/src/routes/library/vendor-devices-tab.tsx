/**
 * The Devices tab of an integration's page: every device added under the vendor, as a table to
 * search and narrow, Add device, and the devices the vendor heard and passed over.
 *
 * A device here is the same device the Devices page lists, seen from the vendor's side: what the
 * owner added by its address, which the hub then connects to and listens for. The row is what
 * that came to - `identifying` while the hardware has not answered, `running`, or `failed` with
 * one line that leads to the device's page, where the transport's own sentence is in full.
 *
 * A device others are part of - an inverter, with its EPS output and dry contact - is one row
 * with a chevron beside its spanner, closed at first; opened, its parts hang under it. A search
 * or a filter that finds a part brings its parent along, opened, with only the parts it found.
 */
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DeviceView, IntegrationState, IntegrationVendorView } from '@nebulahome/contracts';
import { AppIcon, Badge, cn, IconButton, Panel, Segmented, type BadgeTone } from '@nebulahome/ui';

import { WrenchIcon } from '@/components/icons';
import { defineMessage, type Message, text } from '@/i18n/messages';
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
import { MatterTag } from '@/routes/library/matter-tag';
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
  'grid grid-cols-[minmax(0,1fr)_56px] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1fr)_120px_56px] ' +
  'lg:grid-cols-[minmax(0,1fr)_140px_120px_128px_56px]';

/** The line that hangs from a parent's icon down to its parts, under the icon's middle. */
const LINE = 'pointer-events-none absolute left-8 border-border-strong';

/** The standings the device table is narrowed by. */
const STANDING_OPTIONS: readonly {
  readonly value: DeviceStandingChoice;
  readonly label: Message;
}[] = [
  { value: 'any', label: defineMessage('common.any', 'Any') },
  { value: 'running', label: defineMessage('library.vendorDevicesTab.running', 'Running') },
  { value: 'failing', label: defineMessage('library.vendorDevicesTab.failed', 'Failed') },
  { value: 'disabled', label: defineMessage('library.vendorDevicesTab.disabled', 'Disabled') },
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
  const { t } = useTranslation();

  const { vendor, devices, addButton, onConfigure } = props;
  const isAutomatic = vendor.adoption === 'automatic';
  const [filter, setFilter] = useListState(VENDOR_DEVICE_FILTER_CODEC);
  const icons = useDeviceIcons(devices);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const listId = useId();
  const byId = new Map(devices.map((device) => [device.id, device]));

  /**
   * Whether a device is what the search and the filter ask for.
   *
   * @param device - The device.
   * @returns True when it matches both.
   */
  const matches = (device: DeviceView): boolean =>
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
    );
  const isNarrowed = filter.search !== '' || filter.standing !== 'any';
  const shownCount = devices.filter(matches).length;
  // A part is listed under its parent, when its parent is one of these devices.
  const rows = devices
    .filter((device) => device.parentId === null || !byId.has(device.parentId))
    .flatMap((device) => {
      const parts = device.childIds.flatMap((id) => byId.get(id) ?? []);
      const found = parts.filter(matches);

      if (!matches(device) && found.length === 0) {
        return [];
      }

      return [
        {
          device,
          hasParts: parts.length > 0,
          isOpen: (isNarrowed && found.length > 0) || opened.has(device.id),
          parts: isNarrowed ? found : parts,
        },
      ];
    });

  /**
   * Opens a parent's parts, or closes them.
   *
   * @param id - The parent.
   */
  const toggle = (id: string): void => {
    setOpened((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });
  };

  /**
   * A device's name, and under it its model on a narrow screen and what is wrong, if anything.
   *
   * @param device - The device.
   * @returns The name cell's text.
   */
  const nameOf = (device: DeviceView): ReactNode => (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <Link
          to={devicePath(device.id)}
          className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
        >
          {device.name}
        </Link>
        <MatterTag transport={device.transport} />
      </span>
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
              ? t('library.vendorDevicesTab.stillListeningSeeWhy', 'Still listening - see why')
              : t('library.vendorDevicesTab.notWorkingSeeWhy', 'Not working - see why')}
          </span>
        </Link>
      ) : device.state === 'identifying' ? (
        <span className="text-caption text-foreground-subtle">
          {t('library.vendorDevicesTab.listeningForTheDevice', 'Listening for the device…')}
        </span>
      ) : null}
    </span>
  );

  /**
   * A device's other cells: its model, its state, when it last reported, and the spanner.
   *
   * @param device - The device.
   * @param end - What follows the spanner: a parent's chevron, or the room one takes.
   * @returns The cells.
   */
  const restOf = (device: DeviceView, end: ReactNode): ReactNode => (
    <>
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
      <span className="flex items-center justify-end gap-1">
        {onConfigure === undefined ? null : (
          <IconButton
            variant="bare"
            size="small"
            label={t('library.vendorDevicesTab.configureName', 'Configure {{name}}', {
              name: device.name,
            })}
            onClick={() => {
              onConfigure(device);
            }}
          >
            <WrenchIcon width="16" height="16" />
          </IconButton>
        )}
        {end}
      </span>
    </>
  );

  // Keeps the spanners in line on the rows without a chevron.
  const noChevron = <span aria-hidden="true" className="size-6 shrink-0" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {devices.length === 0 ? null : (
          <>
            <SearchField
              placeholder={t(
                'library.vendorDevicesTab.searchThisVendorS',
                "Search this vendor's devices…",
              )}
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label={t('library.vendorDevicesTab.narrowTheDevices', 'Narrow the devices')}
              count={Number(filter.standing !== 'any')}
              summary={t('library.vendorDevicesTab.shownOfTotal', '{{shown}} of {{total}} shown', {
                shown: shownCount,
                total: devices.length,
              })}
              onClear={() => {
                setFilter({ ...filter, standing: 'any' });
              }}
            >
              <Facet title={t('library.vendorDevicesTab.status', 'Status')}>
                <Segmented
                  label={t('library.vendorDevicesTab.status', 'Status')}
                  size="compact"
                  className="self-start"
                  options={STANDING_OPTIONS.map((option) => ({
                    ...option,
                    label: text(option.label),
                  }))}
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
          shownCount === devices.length
            ? t('library.vendorDevicesTab.devicesCount', 'Devices · {{count}}', {
                count: devices.length,
              })
            : t(
                'library.vendorDevicesTab.devicesShownOfTotal',
                'Devices · {{shown}} of {{total}}',
                { shown: shownCount, total: devices.length },
              )
        }
      >
        <div
          className={`${COLUMNS} border-t border-border px-5.5 py-2.5 font-mono text-label text-foreground-subtle uppercase`}
          aria-hidden="true"
        >
          <span>{t('library.vendorDevicesTab.device', 'Device')}</span>
          <span className="hidden lg:block">{t('library.vendorDevicesTab.model', 'Model')}</span>
          <span className="hidden md:block">{t('library.vendorDevicesTab.status', 'Status')}</span>
          <span className="hidden lg:block">
            {t('library.vendorDevicesTab.lastUpdated', 'Last updated')}
          </span>
          <span />
        </div>

        {devices.length === 0 ? (
          <p className="border-t border-border px-5.5 py-3.5 text-ui text-foreground-muted">
            {isAutomatic
              ? t(
                  'library.vendorDevicesTab.nothingYetADevice',
                  'Nothing yet. A device paired with {{name}} is added here on its own.',
                  { name: vendor.name },
                )
              : t(
                  'library.vendorDevicesTab.nothingAddedYetAdd',
                  'Nothing added yet. Add a device by its address and the hub listens for it at once.',
                )}
          </p>
        ) : rows.length === 0 ? (
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
            {rows.map(({ device, hasParts, isOpen, parts }) => {
              const partsId = `${listId}-${device.id}`;
              const isShowingParts = isOpen && parts.length > 0;

              return (
                <li key={device.id} className="border-t border-border">
                  <div className={cn(COLUMNS, 'relative px-5.5 py-3')}>
                    <span className="flex min-w-0 items-center gap-3">
                      <DeviceIcon
                        icon={icons.get(device.icon ?? '')}
                        device={device}
                        className="shrink-0 text-foreground-muted"
                      />
                      {nameOf(device)}
                    </span>
                    {restOf(
                      device,
                      hasParts ? (
                        <IconButton
                          variant="bare"
                          size="small"
                          label={
                            isOpen
                              ? t(
                                  'library.vendorDevicesTab.hideParts',
                                  'Hide the devices of {{name}}',
                                  { name: device.name },
                                )
                              : t(
                                  'library.vendorDevicesTab.showParts',
                                  'Show the devices of {{name}}',
                                  { name: device.name },
                                )
                          }
                          aria-expanded={isShowingParts}
                          aria-controls={partsId}
                          className={isOpen ? 'text-foreground' : 'text-foreground-muted'}
                          onClick={() => {
                            toggle(device.id);
                          }}
                        >
                          <AppIcon id={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
                        </IconButton>
                      ) : (
                        noChevron
                      ),
                    )}
                    {isShowingParts ? (
                      <span
                        aria-hidden="true"
                        className={cn(LINE, 'top-[calc(50%+14px)] bottom-0 border-l')}
                      />
                    ) : null}
                  </div>
                  {isShowingParts ? (
                    <ul id={partsId} className="bg-well">
                      {parts.map((part, index) => (
                        <li key={part.id} className={cn(COLUMNS, 'relative px-5.5 py-2.5')}>
                          {index === parts.length - 1 ? (
                            <span
                              aria-hidden="true"
                              className={cn(
                                LINE,
                                'top-0 h-1/2 w-4 rounded-bl-[8px] border-b border-l',
                              )}
                            />
                          ) : (
                            <>
                              <span aria-hidden="true" className={cn(LINE, 'inset-y-0 border-l')} />
                              <span
                                aria-hidden="true"
                                className={cn(LINE, 'top-1/2 w-4 border-t')}
                              />
                            </>
                          )}
                          <span className="flex min-w-0 items-center gap-3 pl-7">
                            <DeviceIcon
                              icon={icons.get(part.icon ?? '')}
                              device={part}
                              size={18}
                              className="shrink-0 text-foreground-muted"
                            />
                            {nameOf(part)}
                          </span>
                          {restOf(part, noChevron)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <PassedOverPanel vendor={vendor} />
    </div>
  );
}
