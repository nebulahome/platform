/**
 * The integrations page's Filter: how each stands, how it connects, what to show only, the wire,
 * and the order.
 *
 * As the board draws it: the standings as boxes with how many stand so beside each, Connection as
 * Any / Local / Cloud, two switches for the vendors worth a look - new devices on the network, an
 * update waiting - then the wire, then Sort by. The foot says how many of how many the grid shows;
 * everything applies as it is chosen.
 */
import {
  AppIcon,
  Checkbox,
  cn,
  RadioGroup,
  Segmented,
  Switch,
  type PillTone,
  type SegmentedOption,
} from '@nebulahome/ui';

import {
  VENDOR_SORTS,
  narrowingCount,
  type InternetFilter,
  type TransportFilter,
  type VendorFilter,
  type VendorSort,
  type Wire,
} from '@/library/vendor-filters';
import {
  VENDOR_STATUS_KINDS,
  VENDOR_STATUS_LABELS,
  VENDOR_STATUS_TONES,
  type VendorStatusKind,
} from '@/library/vendor-status';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/** What each wire is called in the facet. */
const WIRE_LABELS: Readonly<Record<Wire, string>> = {
  http: 'HTTP',
  mqtt: 'MQTT',
  ble: 'BLE',
  zigbee: 'ZigBee',
  udp: 'UDP',
  modbus: 'Modbus',
};

/** How it connects: on the network alone, or through the internet. */
const CONNECTION: readonly SegmentedOption<InternetFilter>[] = [
  { value: '', label: 'Any' },
  { value: 'local', label: 'Local' },
  { value: 'needed', label: 'Cloud' },
];

/** The dot of each standing, in its tone. */
const DOTS: Readonly<Record<PillTone, string>> = {
  neutral: 'bg-foreground-subtle',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-primary',
  cyan: 'bg-cyan',
};

/** What each order is called. */
const SORT_LABELS: Readonly<Record<VendorSort, string>> = {
  name: 'Name',
  devices: 'Most devices',
  recent: 'Recently added',
};

/** What the filter needs. */
export type IntegrationFilterProps = {
  readonly filter: VendorFilter;

  /** The wires the loaded vendors speak: a wire nobody speaks is not offered. */
  readonly wires: readonly Wire[];

  /** How many vendors stand each way. */
  readonly counts: Readonly<Record<VendorStatusKind, number>>;

  /** How many the grid shows, and of how many. */
  readonly shown: number;
  readonly total: number;

  readonly onChange: (filter: VendorFilter) => void;
};

/**
 * Renders the Filter button and its sheet.
 *
 * @param props - See {@link IntegrationFilterProps}.
 * @returns The filter.
 */
export function IntegrationFilter(props: IntegrationFilterProps) {
  const { filter, wires, counts, shown, total, onChange } = props;
  const wireChoices: readonly SegmentedOption<TransportFilter>[] = [
    { value: '', label: 'Any' },
    ...wires.map((wire) => ({ value: wire, label: WIRE_LABELS[wire] })),
  ];

  /**
   * Ticks or unticks one standing.
   *
   * @param kind - The standing.
   * @param isChecked - Whether it is now ticked.
   */
  const toggleStatus = (kind: VendorStatusKind, isChecked: boolean): void => {
    onChange({
      ...filter,
      statuses: isChecked
        ? VENDOR_STATUS_KINDS.filter((each) => each === kind || filter.statuses.includes(each))
        : filter.statuses.filter((each) => each !== kind),
    });
  };

  return (
    <FilterSheet
      label="Narrow the integrations"
      count={narrowingCount(filter)}
      summary={`${String(shown)} of ${String(total)} shown`}
      onClear={() => {
        onChange({
          ...filter,
          transport: '',
          internet: '',
          statuses: [],
          hasNew: false,
          hasUpdate: false,
        });
      }}
    >
      <Facet
        title="Status"
        aside={
          filter.statuses.length === 0 ? undefined : `${String(filter.statuses.length)} selected`
        }
      >
        <div className="flex flex-col gap-3">
          {VENDOR_STATUS_KINDS.map((kind) => (
            <Checkbox
              key={kind}
              label={
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', DOTS[VENDOR_STATUS_TONES[kind]])}
                  />
                  {VENDOR_STATUS_LABELS[kind]}
                </span>
              }
              count={counts[kind]}
              isChecked={filter.statuses.includes(kind)}
              onChange={(isChecked) => {
                toggleStatus(kind, isChecked);
              }}
            />
          ))}
        </div>
      </Facet>

      <Facet title="Connection">
        <Segmented
          label="Connection"
          size="compact"
          options={CONNECTION}
          value={filter.internet}
          onChange={(internet) => {
            onChange({ ...filter, internet });
          }}
        />
      </Facet>

      <Facet title="Show only">
        <div className="flex flex-col gap-3">
          <ShowOnly
            icon="radio"
            label="Has new devices"
            isOn={filter.hasNew}
            onChange={(hasNew) => {
              onChange({ ...filter, hasNew });
            }}
          />
          <ShowOnly
            icon="circle-arrow-up"
            label="Update ready"
            isOn={filter.hasUpdate}
            onChange={(hasUpdate) => {
              onChange({ ...filter, hasUpdate });
            }}
          />
        </div>
      </Facet>

      {wires.length < 2 ? null : (
        <Facet title="Wire">
          <Segmented
            label="Wire"
            size="compact"
            options={wireChoices}
            value={filter.transport}
            onChange={(transport) => {
              onChange({ ...filter, transport });
            }}
          />
        </Facet>
      )}

      <Facet title="Sort by">
        <RadioGroup
          label="Sort by"
          isLabelHidden
          options={VENDOR_SORTS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
          value={filter.sort}
          onChange={(sort) => {
            onChange({ ...filter, sort });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}

/** What one switch of Show only needs. */
type ShowOnlyProps = {
  readonly icon: 'radio' | 'circle-arrow-up';
  readonly label: string;
  readonly isOn: boolean;
  readonly onChange: (isOn: boolean) => void;
};

/**
 * One switch of Show only: its glyph, its words, and the switch.
 *
 * @param props - See {@link ShowOnlyProps}.
 * @returns The row.
 */
function ShowOnly(props: ShowOnlyProps) {
  const { icon, label, isOn, onChange } = props;

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-ui text-foreground">
        <AppIcon id={icon} size={15} className={icon === 'radio' ? 'text-cyan' : 'text-primary'} />
        {label}
      </span>
      <Switch label={label} isOn={isOn} onChange={onChange} />
    </div>
  );
}
