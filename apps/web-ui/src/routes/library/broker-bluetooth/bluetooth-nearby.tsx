/**
 * The Bluetooth broker's Nearby tab: everything heard, for finding a device and for writing an
 * integration.
 *
 * The house's filter system narrows it: a search, the Filter button with its count, the active
 * filters as chips with Clear all and "N of M", and a sheet - Recognised, Signal, Heard by, Maker,
 * Show only, Sort by. A row is what was heard: its name or Unnamed, its address, its maker and
 * service chips, its best signal, and Add (an integration recognises it), Ignore (none does) or
 * Open (it is in the house). Opened, it shows each scanner's dBm and the raw advertisement.
 *
 * While the tab is open the proxies forward everything they hear: the page holds a lease the
 * broker lets go of after 30 s, renewed every 20 s and given back when the tab closes, and an
 * accent note says so.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  BLUETOOTH_NEARBY_LEASE_MS,
  type BluetoothNearby,
  type BluetoothScanner,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Checkbox,
  cn,
  FilterChips,
  IconButton,
  Note,
  RadioGroup,
  Segmented,
  Switch,
  type ActiveFilter,
} from '@nebulahome/ui';

import { foldForSearch } from '@/lib/search-text';
import { leaseBluetoothNearby } from '@/library/bluetooth-api';
import { CopyButton, CountTag, rssiBars, SignalBars } from '@/routes/library/broker-parts';
import { devicePath } from '@/routes/library/device/device-path';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { SearchField } from '@/routes/library/search-field';

/** How long before the lease runs out it is renewed. */
const RENEW_MS = BLUETOOTH_NEARBY_LEASE_MS - 10_000;

/** What a row is, for the Recognised facet. */
type Recognition = 'integration' | 'nothing' | 'house';

/** The signal the Signal facet keeps. */
type SignalFloor = 'any' | 'fair' | 'strong';

/** What the list is sorted by. */
type SortBy = 'signal' | 'heard' | 'name';

/** The filter's state. */
type NearbyFilter = {
  readonly recognised: ReadonlySet<Recognition>;
  readonly signal: SignalFloor;
  readonly heardBy: ReadonlySet<string>;
  readonly makers: ReadonlySet<string>;
  readonly isNamedOnly: boolean;
  readonly isRecentOnly: boolean;
  readonly showsPrivate: boolean;
  readonly sortBy: SortBy;
};

/** No filter. */
const NO_FILTER: NearbyFilter = {
  recognised: new Set(),
  signal: 'any',
  heardBy: new Set(),
  makers: new Set(),
  isNamedOnly: false,
  isRecentOnly: false,
  showsPrivate: false,
  sortBy: 'signal',
};

/**
 * What a row is: in the house, recognised by an integration, or by nothing.
 *
 * @param item - The row.
 * @returns Its recognition.
 */
function recognitionOf(item: BluetoothNearby): Recognition {
  return item.deviceId !== null ? 'house' : item.claims.length > 0 ? 'integration' : 'nothing';
}

/**
 * Whether a row passes the filter, the search aside.
 *
 * @param item - The row.
 * @param filter - The filter.
 * @param now - The time, for Heard in the last minute.
 * @returns True to show it.
 */
export function isKept(item: BluetoothNearby, filter: NearbyFilter, now: number): boolean {
  const bars = rssiBars(item.rssi);

  return (
    (filter.recognised.size === 0 || filter.recognised.has(recognitionOf(item))) &&
    (filter.signal === 'any' || (filter.signal === 'fair' ? bars >= 2 : bars >= 3)) &&
    (filter.heardBy.size === 0 ||
      item.heardBy.some((each) => filter.heardBy.has(each.scannerId))) &&
    (filter.makers.size === 0 || (item.maker !== null && filter.makers.has(item.maker))) &&
    (!filter.isNamedOnly || item.name !== null) &&
    (!filter.isRecentOnly || now - item.lastHeardAt.getTime() <= 60_000) &&
    (filter.showsPrivate || !item.isPrivate)
  );
}

/**
 * Holds the Nearby lease while the tab is open, and gives it back when it closes.
 *
 * @param isHeld - Whether to hold it: false in the gallery, which has no broker.
 */
function useNearbyLease(isHeld: boolean): void {
  useEffect(() => {
    if (!isHeld) {
      return;
    }

    const leaseId = crypto.randomUUID();

    /** Takes the lease, or renews it. */
    const hold = (): void => {
      void leaseBluetoothNearby(leaseId, true).catch(() => undefined);
    };

    hold();

    const timer = setInterval(hold, RENEW_MS);

    return () => {
      clearInterval(timer);
      void leaseBluetoothNearby(leaseId, false).catch(() => undefined);
    };
  }, [isHeld]);
}

/** What the tab needs. */
export type BluetoothNearbyViewProps = {
  readonly items: readonly BluetoothNearby[];
  readonly scanners: readonly BluetoothScanner[];

  /** Whether proxies forward everything, which the lease asks for. */
  readonly isForwardingAll: boolean;

  /** Whether to hold the lease. */
  readonly holdsLease: boolean;

  /** Adds a recognised device; absent when the person may not. */
  readonly onAdd?: ((item: BluetoothNearby) => void) | undefined;

  /** Ignores an address; absent when the person may not. */
  readonly onIgnore?: ((item: BluetoothNearby) => void) | undefined;

  /** The row open at first, for the gallery. */
  readonly openAddress?: string;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link BluetoothNearbyViewProps}.
 * @returns The tab's content.
 */
export function BluetoothNearbyView(props: BluetoothNearbyViewProps) {
  const { t } = useTranslation();
  const { items, scanners } = props;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<NearbyFilter>(NO_FILTER);
  const [open, setOpen] = useState<string | null>(props.openAddress ?? null);
  const [now] = useState(() => Date.now());

  useNearbyLease(props.holdsLease);

  const needle = foldForSearch(search.trim());
  const makers = useMemo(
    () => [...new Set(items.flatMap((item) => (item.maker === null ? [] : [item.maker])))].sort(),
    [items],
  );
  const kept = items
    .filter(
      (item) =>
        isKept(item, filter, now) &&
        (needle === '' ||
          foldForSearch([item.name ?? '', item.address, item.maker ?? ''].join(' ')).includes(
            needle,
          )),
    )
    .sort((one, other) =>
      filter.sortBy === 'signal'
        ? other.rssi - one.rssi
        : filter.sortBy === 'heard'
          ? other.lastHeardAt.getTime() - one.lastHeardAt.getTime()
          : (one.name ?? '~').localeCompare(other.name ?? '~'),
    );

  /**
   * How many rows a facet's value would keep, the others as they are.
   *
   * @param test - Whether a row has that value.
   * @returns The count.
   */
  const countOf = (test: (item: BluetoothNearby) => boolean): number =>
    items.filter((item) => test(item) && (filter.showsPrivate || !item.isPrivate)).length;

  /**
   * A set with a value added or taken out.
   *
   * @param set - The set.
   * @param value - The value.
   * @param isIn - Whether it is in now.
   * @returns The new set.
   */
  const toggled = <TValue,>(set: ReadonlySet<TValue>, value: TValue, isIn: boolean) => {
    const next = new Set(set);

    if (isIn) {
      next.add(value);
    } else {
      next.delete(value);
    }

    return next;
  };

  const recognitionNames: Record<Recognition, string> = {
    integration: t('brokers.bluetooth.nearby.byIntegration', 'By an integration'),
    nothing: t('brokers.bluetooth.nearby.byNothing', 'By nothing'),
    house: t('brokers.bluetooth.nearby.inHouse', 'In the house'),
  };
  const signalNames: Record<SignalFloor, string> = {
    any: t('brokers.bluetooth.nearby.any', 'Any'),
    fair: t('brokers.bluetooth.nearby.fair', 'Fair or better'),
    strong: t('brokers.bluetooth.nearby.strong', 'Strong'),
  };
  /**
   * What a scanner is called.
   *
   * @param id - The scanner.
   * @returns Its name.
   */
  const scannerName = (id: string): string => scanners.find((each) => each.id === id)?.name ?? id;
  const active: ActiveFilter[] = [
    ...(filter.recognised.size === 0
      ? []
      : [
          {
            id: 'recognised',
            key: t('brokers.bluetooth.nearby.recognised', 'Recognised'),
            value: [...filter.recognised].map((each) => recognitionNames[each]).join(', '),
            /** Clears it. */
            onRemove: () => {
              setFilter({ ...filter, recognised: new Set() });
            },
          },
        ]),
    ...(filter.heardBy.size === 0
      ? []
      : [
          {
            id: 'heard-by',
            key: t('brokers.bluetooth.heardBy', 'Heard by'),
            value: moreText([...filter.heardBy].map(scannerName)),
            /** Clears it. */
            onRemove: () => {
              setFilter({ ...filter, heardBy: new Set() });
            },
          },
        ]),
    ...(filter.signal === 'any'
      ? []
      : [
          {
            id: 'signal',
            key: t('brokers.bluetooth.nearby.signal', 'Signal'),
            value: signalNames[filter.signal],
            /** Clears it. */
            onRemove: () => {
              setFilter({ ...filter, signal: 'any' });
            },
          },
        ]),
    ...(filter.makers.size === 0
      ? []
      : [
          {
            id: 'maker',
            key: t('brokers.bluetooth.nearby.maker', 'Maker'),
            value: moreText([...filter.makers]),
            /** Clears it. */
            onRemove: () => {
              setFilter({ ...filter, makers: new Set() });
            },
          },
        ]),
  ];
  const count =
    active.length +
    Number(filter.isNamedOnly) +
    Number(filter.isRecentOnly) +
    Number(filter.showsPrivate);
  const summary = t('brokers.bluetooth.nearby.shown', '{{kept}} of {{total}}', {
    kept: kept.length,
    total: items.length,
  });

  return (
    <div className="flex flex-col gap-4">
      {props.isForwardingAll || props.holdsLease ? (
        <Note tone="accent">
          {t(
            'brokers.bluetooth.nearby.forwarding',
            'Proxies are sending everything they hear while this page is open. When you leave, they go back to the house’s own devices and the ones an integration recognises.',
          )}
        </Note>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          className="w-90 lg:w-90"
          placeholder={t('brokers.bluetooth.nearby.search', 'Search by name, address or maker')}
          value={search}
          onChange={setSearch}
        />
        <FilterSheet
          label={t('brokers.bluetooth.nearby.narrow', 'Narrow what is heard')}
          count={count}
          summary={t('brokers.bluetooth.nearby.shownFoot', '{{kept}} of {{total}} shown', {
            kept: kept.length,
            total: items.length,
          })}
          onClear={() => {
            setFilter({ ...NO_FILTER, sortBy: filter.sortBy });
          }}
        >
          <Facet
            title={t('brokers.bluetooth.nearby.recognised', 'Recognised')}
            aside={
              filter.recognised.size === 0
                ? undefined
                : t('brokers.bluetooth.nearby.selected', '{{count}} selected', {
                    count: filter.recognised.size,
                  })
            }
          >
            {(['integration', 'nothing', 'house'] as const).map((each) => (
              <Checkbox
                key={each}
                label={recognitionNames[each]}
                count={countOf((item) => recognitionOf(item) === each)}
                isChecked={filter.recognised.has(each)}
                onChange={(isChecked) => {
                  setFilter({ ...filter, recognised: toggled(filter.recognised, each, isChecked) });
                }}
              />
            ))}
          </Facet>
          <Facet title={t('brokers.bluetooth.nearby.signal', 'Signal')}>
            <Segmented
              label={t('brokers.bluetooth.nearby.signal', 'Signal')}
              value={filter.signal}
              isFilled
              onChange={(signal) => {
                setFilter({ ...filter, signal });
              }}
              options={(['any', 'fair', 'strong'] as const).map((each) => ({
                value: each,
                label: signalNames[each],
              }))}
            />
          </Facet>
          <Facet
            title={t('brokers.bluetooth.heardBy', 'Heard by')}
            aside={
              filter.heardBy.size === 0
                ? undefined
                : t('brokers.bluetooth.nearby.selected', '{{count}} selected', {
                    count: filter.heardBy.size,
                  })
            }
          >
            {scanners.map((scanner) => (
              <Checkbox
                key={scanner.id}
                label={
                  scanner.kind === 'adapter' ? scanner.id.replace(/^adapter:/u, '') : scanner.name
                }
                count={countOf((item) =>
                  item.heardBy.some((each) => each.scannerId === scanner.id),
                )}
                isChecked={filter.heardBy.has(scanner.id)}
                onChange={(isChecked) => {
                  setFilter({ ...filter, heardBy: toggled(filter.heardBy, scanner.id, isChecked) });
                }}
              />
            ))}
          </Facet>
          {makers.length === 0 ? null : (
            <Facet title={t('brokers.bluetooth.nearby.maker', 'Maker')}>
              {makers.map((maker) => (
                <Checkbox
                  key={maker}
                  label={maker}
                  count={countOf((item) => item.maker === maker)}
                  isChecked={filter.makers.has(maker)}
                  onChange={(isChecked) => {
                    setFilter({ ...filter, makers: toggled(filter.makers, maker, isChecked) });
                  }}
                />
              ))}
            </Facet>
          )}
          <Facet title={t('brokers.bluetooth.nearby.showOnly', 'Show only')}>
            {(
              [
                ['isNamedOnly', 'pencil', t('brokers.bluetooth.nearby.named', 'With a name')],
                [
                  'isRecentOnly',
                  'clock',
                  t('brokers.bluetooth.nearby.recent', 'Heard in the last minute'),
                ],
                [
                  'showsPrivate',
                  'eye',
                  t('brokers.bluetooth.nearby.private', 'Private addresses too'),
                ],
              ] as const
            ).map(([key, icon, label]) => (
              <span key={key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5 text-ui text-foreground">
                  <AppIcon id={icon} size={15} className="text-foreground-muted" />
                  {label}
                </span>
                <Switch
                  label={label}
                  isOn={filter[key]}
                  onChange={(isOn) => {
                    setFilter({ ...filter, [key]: isOn });
                  }}
                />
              </span>
            ))}
          </Facet>
          <Facet title={t('brokers.bluetooth.nearby.sortBy', 'Sort by')}>
            <RadioGroup
              label={t('brokers.bluetooth.nearby.sortBy', 'Sort by')}
              isLabelHidden
              value={filter.sortBy}
              onChange={(sortBy) => {
                setFilter({ ...filter, sortBy });
              }}
              options={[
                { value: 'signal', label: t('brokers.bluetooth.nearby.bySignal', 'Signal') },
                { value: 'heard', label: t('brokers.bluetooth.nearby.byHeard', 'Last heard') },
                { value: 'name', label: t('brokers.bluetooth.nearby.byName', 'Name') },
              ]}
            />
          </Facet>
        </FilterSheet>
      </div>
      <FilterChips
        filters={active}
        summary={<span className="ml-auto">{summary}</span>}
        onClearAll={() => {
          setFilter({ ...NO_FILTER, sortBy: filter.sortBy });
        }}
      />
      {kept.length === 0 ? (
        <p className="text-ui text-foreground-subtle">
          {items.length === 0
            ? t('brokers.bluetooth.nearby.nothing', 'Nothing heard yet.')
            : t('brokers.bluetooth.nearby.noneKept', 'Nothing heard matches. Clear a filter.')}
        </p>
      ) : (
        <ul className="flex flex-col rounded-card border border-border bg-surface px-5 py-0.5">
          {kept.map((item) => (
            <NearbyRow
              key={item.address}
              item={item}
              isOpen={open === item.address}
              onToggle={() => {
                setOpen(open === item.address ? null : item.address);
              }}
              onAdd={props.onAdd}
              onIgnore={props.onIgnore}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Names in a chip: the first, and how many more.
 *
 * @param names - The names.
 * @returns `Kitchen Plug S +1`.
 */
function moreText(names: readonly string[]): string {
  const [first = '', ...rest] = names;

  return rest.length === 0 ? first : `${first} +${String(rest.length)}`;
}

/**
 * A 16-bit service id as it is written: `0xFCD2`.
 *
 * @param uuid - The id, lower case.
 * @returns The text.
 */
function serviceText(uuid: string): string {
  return uuid.length === 4 ? `0x${uuid.toUpperCase()}` : uuid;
}

/**
 * One address heard, and what it shows open.
 *
 * @param props - The row, whether it is open, and what can be done.
 * @param props.item - It.
 * @param props.isOpen - Whether it is open.
 * @param props.onToggle - Opens or closes it.
 * @param props.onAdd - Adds it; absent when the person may not.
 * @param props.onIgnore - Ignores it; absent when the person may not.
 * @returns The row.
 */
function NearbyRow(props: {
  readonly item: BluetoothNearby;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onAdd?: ((item: BluetoothNearby) => void) | undefined;
  readonly onIgnore?: ((item: BluetoothNearby) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { item, isOpen, onAdd, onIgnore } = props;
  const [claim] = item.claims;
  const raw = [
    ...Object.entries(item.serviceData).map(([uuid, hex]) => [
      t('brokers.bluetooth.nearby.serviceData', 'service data {{uuid}}', {
        uuid: serviceText(uuid),
      }),
      hex,
    ]),
    ...Object.entries(item.manufacturerData).map(([company, hex]) => [
      t('brokers.bluetooth.nearby.manufacturerData', 'manufacturer {{company}}', {
        company: `0x${Number(company).toString(16).padStart(4, '0').toUpperCase()}`,
      }),
      hex,
    ]),
    ...(item.name === null
      ? []
      : [[t('brokers.bluetooth.nearby.localName', 'local name'), item.name]]),
  ];

  return (
    <li className="border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-center gap-3.5 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
          <AppIcon id="bluetooth" size={16} />
        </span>
        <span className="flex min-w-0 grow basis-60 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-2">
            <span
              className={cn(
                'text-ui font-medium',
                item.name === null ? 'text-foreground-muted italic' : 'text-foreground',
              )}
            >
              {item.name ?? t('brokers.bluetooth.unnamed', 'Unnamed')}
            </span>
            <span className="font-mono text-mono-caption text-foreground-muted">
              {item.address}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-ui-sm text-foreground-muted">
            {item.maker ?? t('brokers.bluetooth.nearby.unknownMaker', 'Unknown maker')}
            {item.serviceUuids.map((uuid) => (
              <CountTag key={uuid}>
                {serviceText(uuid)}
                {uuid === 'fcd2' ? ` ${t('brokers.bluetooth.nearby.bthome', 'BTHome')}` : ''}
              </CountTag>
            ))}
          </span>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-mono-caption text-foreground-muted">
          <SignalBars
            lit={rssiBars(item.rssi)}
            label={t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi: item.rssi })}
          />
          {item.rssi}
        </span>
        <span
          className={cn(
            'w-56 text-right text-ui-sm',
            item.deviceId !== null || claim !== undefined
              ? 'text-success'
              : 'text-foreground-muted',
          )}
        >
          {item.deviceId !== null
            ? t('brokers.bluetooth.nearby.inHouseBy', 'In the house · {{vendor}}', {
                vendor: claim?.vendorName ?? '',
              })
            : claim === undefined
              ? t('brokers.bluetooth.nearby.noneRecognises', 'No integration recognises it')
              : t('brokers.bluetooth.nearby.recognisedBy', 'Recognised by {{vendor}}', {
                  vendor: claim.vendorName,
                })}
        </span>
        <span className="flex w-20 justify-end">
          {item.deviceId !== null ? (
            <Link
              to={devicePath(item.deviceId)}
              className="text-ui-sm font-medium text-foreground hover:text-primary"
            >
              {t('brokers.bluetooth.nearby.open', 'Open')}
            </Link>
          ) : claim !== undefined ? (
            onAdd === undefined ? null : (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  onAdd(item);
                }}
              >
                <AppIcon id="plus" size={14} />
                {t('brokers.bluetooth.add', 'Add')}
              </Button>
            )
          ) : onIgnore === undefined ? null : (
            <Button
              variant="bare"
              size="compact"
              onClick={() => {
                onIgnore(item);
              }}
            >
              {t('brokers.bluetooth.ignore', 'Ignore')}
            </Button>
          )}
        </span>
        <IconButton
          label={
            isOpen
              ? t('brokers.bluetooth.close', 'Close {{name}}', { name: item.address })
              : t('brokers.bluetooth.open', 'Open {{name}}', { name: item.address })
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
        <div className="mb-4 ml-12.5 flex flex-col gap-3">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {item.heardBy.map((each) => (
              <span
                key={each.scannerId}
                className="flex flex-col gap-1 rounded-inner border border-border px-3.5 py-2.5"
              >
                <span className="text-caption text-foreground-muted">{each.scannerName}</span>
                <span className="flex items-center gap-2 font-mono text-mono-ui text-foreground">
                  <SignalBars
                    lit={rssiBars(each.rssi)}
                    label={t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi: each.rssi })}
                  />
                  {t('brokers.bluetooth.dbm', '{{rssi}} dBm', { rssi: each.rssi })}
                </span>
              </span>
            ))}
          </div>
          {raw.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-label text-foreground-subtle uppercase">
                {t('brokers.bluetooth.nearby.raw', 'Raw advertisement')}
              </span>
              <div className="relative rounded-inner border border-border bg-rail px-4 py-3 pr-14">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-mono-caption">
                  {raw.map(([label, value]) => (
                    <span key={label} className="contents">
                      <dt className="text-foreground-muted">{label}</dt>
                      <dd className="break-all text-foreground">
                        {/^[0-9a-f]+$/u.exec(value ?? '') === null
                          ? value
                          : ((value ?? '').match(/../gu) ?? []).join(' ')}
                      </dd>
                    </span>
                  ))}
                </dl>
                <span className="absolute top-2 right-2">
                  <CopyButton
                    value={raw.map(([label, value]) => `${label ?? ''}: ${value ?? ''}`).join('\n')}
                    isCompact
                  />
                </span>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
