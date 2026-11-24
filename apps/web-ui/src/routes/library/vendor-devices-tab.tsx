/**
 * The Devices tab of an integration's page: every device added under the vendor, as a table to
 * search and narrow, Add device, and the devices the vendor heard and passed over.
 *
 * A device here is the same device the Devices page lists, seen from the vendor's side: what the
 * owner added by its address, which the hub then connects to and listens for. The row is what
 * that came to - `identifying` while the hardware has not answered, `running`, or `failed` with
 * one line that leads to the device's page, where the transport's own sentence is in full.
 *
 * As the board draws it (canvas page "Integrazione · lista device", DL-A): the search with Add
 * device inside it and the Filter beside it sit in the panel's head, by the count - "2 of 12" once
 * anything narrows the table, and nowhere else; the Filter's own count says how many facets are
 * set. A row has the address under the name; a failing one is washed red, the one under the
 * pointer lifts. Every heading sorts the table, as the Automations table's do.
 *
 * A device others are part of - a printer, with its AMS units - is one row with a chevron beside
 * its spanner, closed at first; opened, its parts slide out under it, hung from its icon. A search
 * or a filter that finds a part brings its parent along, opened, with only the parts it found.
 */
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DeviceView, IntegrationState, IntegrationVendorView } from '@nebulahome/contracts';
import { AppIcon, Badge, cn, Collapse, IconButton, Panel, type BadgeTone } from '@nebulahome/ui';

import { SortHeader } from '@/components/sort-header';
import { collator } from '@/i18n/formatters';
import { relativeTime } from '@/lib/format-time';
import { markMatch } from '@/lib/mark-match';
import { queryWords } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import {
  countStandings,
  DEVICE_SORTS,
  deviceAddress,
  isNarrowing,
  matchesVendorDevice,
  modelOf,
  OPEN_VENDOR_DEVICE_FILTER,
  sortVendorDevices,
  VENDOR_DEVICE_FILTER_CODEC,
  type DeviceSort,
} from '@/library/vendor-device-filters';
import { CountTag } from '@/routes/library/broker-parts';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon, useDeviceIcons } from '@/routes/library/device-icon';
import { MatterTag } from '@/routes/library/matter-tag';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import {
  VendorDeviceFilterSheet,
  type VendorDeviceChoices,
} from '@/routes/library/vendor-device-filter';
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
 * The columns of the devices table: which device, its room, its model, how it is doing, when it
 * last reported, and the spanner - with the chevron's room too when a device has parts.
 *
 * Every track but the first three is a fixed width. The header and each row are separate grids,
 * and a track sized `auto` resolves to a different width in each of them - which is how the cells
 * once drifted from their headings. The full table needs the width a wide window has beside the
 * rail; at a tablet's width the model rides under the name and the room and the clock wait for a
 * wider screen, so the panel never grows past the page.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_40px] items-center gap-x-4 ' +
  'md:grid-cols-[minmax(0,1fr)_124px_40px] ' +
  'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_124px_112px_40px]';
const COLUMNS_WITH_PARTS =
  'grid grid-cols-[minmax(0,1fr)_72px] items-center gap-x-4 ' +
  'md:grid-cols-[minmax(0,1fr)_124px_72px] ' +
  'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_124px_112px_72px]';

/** The line that hangs from a parent's icon down to its parts, under the icon's middle. */
const LINE = 'pointer-events-none absolute left-10 border-border-strong';

/** Where the search matched in a name. */
const MARK = 'rounded-xs bg-primary/25 text-inherit';

/**
 * The ground of a row: washed red while failing, lifted under the pointer.
 *
 * @param device - The device.
 * @param isPart - Whether it hangs under another, on the parts' darker ground.
 * @returns The classes.
 */
function groundOf(device: DeviceView, isPart: boolean): string {
  return device.state === 'failed'
    ? 'bg-danger/5 hover:bg-danger/8'
    : isPart
      ? 'hover:bg-surface-raised/40'
      : 'hover:bg-surface-raised/60';
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

  /** How many devices the vendor heard on the network that nobody added. */
  readonly foundCount?: number;

  /** Opens the Found tab, where those wait. */
  readonly onShowFound?: () => void;
};

/**
 * Renders the Devices tab.
 *
 * @param props - See {@link VendorDevicesTabProps}.
 * @returns The tab's content.
 */
export function VendorDevicesTab(props: VendorDevicesTabProps) {
  const { t } = useTranslation();

  const { vendor, devices, addButton, onConfigure, foundCount = 0, onShowFound } = props;
  const isAutomatic = vendor.adoption === 'automatic';
  const [filter, setFilter] = useListState(VENDOR_DEVICE_FILTER_CODEC);
  const icons = useDeviceIcons(devices);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const listId = useId();
  const byId = new Map(devices.map((device) => [device.id, device]));
  const now = new Date();

  /**
   * Whether a device is a part of another device listed here.
   *
   * @param device - The device.
   * @returns True for a part.
   */
  const isPart = (device: DeviceView): boolean =>
    device.parentId !== null && byId.has(device.parentId);

  const hasParts = devices.some(isPart);
  const columns = hasParts ? COLUMNS_WITH_PARTS : COLUMNS;

  /**
   * Whether a device is what the search and the filter ask for.
   *
   * @param device - The device.
   * @returns True when it matches both.
   */
  const matches = (device: DeviceView): boolean =>
    matchesVendorDevice(device, filter, { isPart: isPart(device), now });

  const isNarrowed = isNarrowing(filter);
  const shownCount = devices.filter(matches).length;
  const words = queryWords(filter.search);
  const names = collator();
  const choices: VendorDeviceChoices = {
    areas: [
      ...new Map(
        devices.flatMap((device) =>
          device.areaKey === null ? [] : [[device.areaKey, device.areaName ?? device.areaKey]],
        ),
      ),
    ].map(([value, label]) => ({ value, label })),
    models: [...new Set(devices.map(modelOf))].toSorted((a, b) => names.compare(a, b)),
    transports: [...new Set(devices.map((device) => device.transport))].toSorted((a, b) =>
      names.compare(a, b),
    ),
    hasParts,
  };

  // The table is not paged: only the order is the paging's, kept in the address as `sort`/`dir`.
  const paging = usePaging('vendor-devices', DEVICE_SORTS, devices.length);

  // A part is listed under its parent, when its parent is one of these devices.
  const rows = sortVendorDevices(
    devices.filter((device) => !isPart(device)),
    paging.sort,
    paging.direction,
  ).flatMap((device) => {
    const parts = device.childIds.flatMap((id) => byId.get(id) ?? []);
    const found = isNarrowed ? parts.filter(matches) : parts;

    if (!matches(device) && found.length === 0) {
      return [];
    }

    return [
      {
        device,
        isOpen: found.length > 0 && (isNarrowed || opened.has(device.id)),
        parts: found,
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
   * A device's icon and name, and under it its address - its model on a narrow screen - or what
   * is wrong, if anything.
   *
   * @param device - The device.
   * @param asPart - Whether it hangs under its parent.
   * @returns The name cell.
   */
  const nameOf = (device: DeviceView, asPart: boolean): ReactNode => {
    const isOff = device.state === 'disabled';
    const address = asPart ? null : deviceAddress(device);

    return (
      <span className={cn('flex min-w-0 items-center gap-3.5', asPart && 'pl-11')}>
        <span
          className={cn(
            'flex shrink-0 items-center justify-center bg-surface-raised',
            asPart ? 'size-7.5 rounded-chip' : 'size-9 rounded-field',
          )}
        >
          <DeviceIcon
            icon={icons.get(device.icon ?? '')}
            device={device}
            size={asPart ? 15 : 17}
            className={isOff ? 'text-foreground-disabled' : 'text-foreground-muted'}
          />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to={devicePath(device.id)}
              className={cn(
                'truncate text-ui font-medium transition-colors hover:text-primary',
                isOff ? 'text-foreground-muted' : 'text-foreground',
              )}
            >
              {markMatch(device.name, words, MARK)}
            </Link>
            <MatterTag transport={device.transport} />
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
            <span className="flex items-center gap-1.5 text-caption text-foreground-subtle">
              <span aria-hidden="true" className="size-1.25 shrink-0 rounded-full bg-primary" />
              {t('library.vendorDevicesTab.listeningForTheDevice', 'Listening for the device…')}
            </span>
          ) : (
            <>
              <span className="truncate text-caption text-foreground-subtle lg:hidden">
                {modelOf(device)}
              </span>
              {address === null ? null : (
                <span className="hidden truncate font-mono text-mono-caption text-foreground-subtle lg:block">
                  {address}
                </span>
              )}
            </>
          )}
        </span>
      </span>
    );
  };

  /**
   * A device's other cells: its room, its model, its state, when it last reported, and the
   * spanner.
   *
   * @param device - The device.
   * @param end - What follows the spanner: a parent's chevron, or the room one takes.
   * @returns The cells.
   */
  const restOf = (device: DeviceView, end: ReactNode): ReactNode => (
    <>
      <span className="hidden truncate text-ui text-foreground-muted lg:block">
        {device.areaName ?? '—'}
      </span>
      <span className="hidden truncate text-ui text-foreground-muted lg:block">
        {modelOf(device)}
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
            size="medium"
            label={t('library.vendorDevicesTab.configureName', 'Configure {{name}}', {
              name: device.name,
            })}
            className="group-hover/row:text-foreground"
            onClick={() => {
              onConfigure(device);
            }}
          >
            <AppIcon id="wrench" size={16} />
          </IconButton>
        )}
        {end}
      </span>
    </>
  );

  /**
   * A heading that sorts the table, in its header cell.
   *
   * @param column - The column it sorts by.
   * @param label - The heading.
   * @param className - The cell's classes: when it shows.
   * @returns The cell.
   */
  const sortCell = (column: DeviceSort, label: string, className?: string): ReactNode => {
    return <SortHeader paging={paging} column={column} label={label} className={className} />;
  };

  // Keeps the spanners in line on the rows without a chevron.
  const noChevron = hasParts ? <span aria-hidden="true" className="size-8 shrink-0" /> : null;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t('library.vendorDevicesTab.devices', 'Devices')}
        meta={
          <CountTag isLit={isNarrowed && devices.length > 0}>
            {isNarrowed && devices.length > 0
              ? t('library.vendorDevicesTab.countOfTotal', '{{shown}} of {{total}}', {
                  shown: shownCount,
                  total: devices.length,
                })
              : devices.length}
          </CountTag>
        }
        action={
          devices.length === 0 ? (
            addButton
          ) : (
            <div className="flex items-center gap-2">
              <VendorDeviceFilterSheet
                filter={filter}
                choices={choices}
                counts={countStandings(devices)}
                onChange={setFilter}
              />
              <SearchField
                placeholder={t(
                  'library.vendorDevicesTab.searchVendorDevices',
                  'Search {{name}} devices',
                  { name: vendor.name },
                )}
                value={filter.search}
                // On a phone the pill takes what the panel's margins and the Filter leave.
                className={
                  addButton === undefined
                    ? 'w-52 lg:w-72'
                    : 'w-[min(24rem,calc(100vw-12rem))] lg:w-96'
                }
                action={addButton}
                onChange={(search) => {
                  setFilter({ ...filter, search });
                }}
              />
            </div>
          )
        }
      >
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
          <div className="border-t border-border">
            <NoMatches
              isInPanel
              query={filter.search}
              hint={t(
                'library.vendorDevicesTab.searchLooksAt',
                'The search looks at names, models, rooms and addresses.',
              )}
              footer={
                foundCount === 0 || onShowFound === undefined ? undefined : (
                  <>
                    {t('library.vendorDevicesTab.notAddedYet', {
                      count: foundCount,
                      defaultValue_one:
                        'Not added yet? {{count}} device the hub heard on the network waits in',
                      defaultValue_other:
                        'Not added yet? {{count}} devices the hub heard on the network wait in',
                    })}{' '}
                    <button
                      type="button"
                      onClick={onShowFound}
                      className="rounded-chip text-primary transition-colors hover:text-primary-hover"
                    >
                      {t('library.vendorDevicesTab.found', 'Found')}
                    </button>
                  </>
                )
              }
              onClear={() => {
                setFilter(OPEN_VENDOR_DEVICE_FILTER);
              }}
            />
          </div>
        ) : (
          <>
            <div
              role="row"
              className={cn(
                columns,
                'border-t border-border bg-well px-5.5 py-2.5 font-mono text-label text-foreground-subtle uppercase',
              )}
            >
              {sortCell('name', t('library.vendorDevicesTab.device', 'Device'))}
              {sortCell('area', t('library.vendorDevicesTab.area', 'Area'), 'hidden lg:block')}
              {sortCell('model', t('library.vendorDevicesTab.model', 'Model'), 'hidden lg:block')}
              {sortCell(
                'status',
                t('library.vendorDevicesTab.status', 'Status'),
                'hidden md:block',
              )}
              {sortCell(
                'updated',
                t('library.vendorDevicesTab.lastUpdated', 'Last updated'),
                'hidden lg:block',
              )}
              <span />
            </div>

            {/* The rows' grounds keep to the panel's rounded foot. */}
            <ul className="overflow-hidden rounded-b-panel">
              {rows.map(({ device, isOpen, parts }) => {
                const partsId = `${listId}-${device.id}`;

                return (
                  <li key={device.id} className="border-t border-border">
                    <div
                      className={cn(
                        columns,
                        'group/row relative min-h-16 px-5.5 py-3 transition-colors duration-150',
                        groundOf(device, false),
                      )}
                    >
                      {nameOf(device, false)}
                      {restOf(
                        device,
                        parts.length > 0 ? (
                          <IconButton
                            variant="bare"
                            size="medium"
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
                            aria-expanded={isOpen}
                            aria-controls={partsId}
                            className={cn(
                              'transition-colors duration-200',
                              isOpen && 'border-border-strong bg-surface-raised text-foreground',
                            )}
                            onClick={() => {
                              toggle(device.id);
                            }}
                          >
                            <AppIcon
                              id="chevron-down"
                              size={16}
                              className={cn(
                                'transition-transform duration-250 ease-out motion-reduce:transition-none',
                                isOpen && 'rotate-180',
                              )}
                            />
                          </IconButton>
                        ) : (
                          noChevron
                        ),
                      )}
                      {parts.length > 0 ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            LINE,
                            'top-[calc(50%+18px)] bottom-0 border-l transition-opacity duration-250',
                            isOpen ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      ) : null}
                    </div>
                    {parts.length > 0 ? (
                      <Collapse isOpen={isOpen} id={partsId}>
                        <ul className="bg-well">
                          {parts.map((part, index) => (
                            <li
                              key={part.id}
                              className={cn(
                                columns,
                                'group/row relative min-h-13.5 px-5.5 py-2 transition-colors duration-150',
                                groundOf(part, true),
                              )}
                            >
                              {index === parts.length - 1 ? (
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    LINE,
                                    'top-0 h-1/2 w-4.5 rounded-bl-[8px] border-b border-l',
                                  )}
                                />
                              ) : (
                                <>
                                  <span
                                    aria-hidden="true"
                                    className={cn(LINE, 'inset-y-0 border-l')}
                                  />
                                  <span
                                    aria-hidden="true"
                                    className={cn(LINE, 'top-1/2 w-4.5 border-t')}
                                  />
                                </>
                              )}
                              {nameOf(part, true)}
                              {restOf(part, noChevron)}
                            </li>
                          ))}
                        </ul>
                      </Collapse>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      <PassedOverPanel vendor={vendor} />
    </div>
  );
}
