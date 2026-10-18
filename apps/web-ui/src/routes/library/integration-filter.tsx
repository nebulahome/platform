/**
 * The integrations page's Filter: how each stands, how it connects, what to show only, the wire,
 * and the order.
 *
 * As the board draws it: the standings as boxes with how many stand so beside each, Connection as
 * Any / Local / Cloud, two switches for the vendors worth a look - new devices on the network, an
 * update waiting - then the wire, then Sort by. The foot says how many of how many the grid shows;
 * everything applies as it is chosen.
 */
import { useTranslation } from 'react-i18next';

import {
  AppIcon,
  Checkbox,
  cn,
  RadioGroup,
  Segmented,
  SelectField,
  Switch,
  type PillTone,
} from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';
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
  matter: 'Matter',
};

/** How it connects: on the network alone, or through the internet. */
const CONNECTION: readonly { readonly value: InternetFilter; readonly label: Message }[] = [
  { value: '', label: defineMessage('common.any', 'Any') },
  { value: 'local', label: defineMessage('library.integrationFilter.local', 'Local') },
  { value: 'needed', label: defineMessage('library.integrationFilter.cloud', 'Cloud') },
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
const SORT_LABELS: Readonly<Record<VendorSort, Message>> = {
  name: defineMessage('library.integrationFilter.name', 'Name'),
  devices: defineMessage('library.integrationFilter.mostDevices', 'Most devices'),
  recent: defineMessage('library.integrationFilter.recentlyAdded', 'Recently added'),
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
  const { t } = useTranslation();

  const { filter, wires, counts, shown, total, onChange } = props;
  const wireChoices = [
    { value: '', label: t('library.integrationFilter.anyWire', 'Any wire') },
    ...wires.map((wire) => ({ value: wire, label: WIRE_LABELS[wire] })),
  ];

  /**
   * Reads the dropdown's value back as a wire.
   *
   * @param value - What was chosen.
   * @returns The wire it names, or any.
   */
  const toTransport = (value: string): TransportFilter =>
    wires.find((wire) => wire === value) ?? '';

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
      label={t('library.integrationFilter.narrowTheIntegrations', 'Narrow the integrations')}
      count={narrowingCount(filter)}
      summary={t('library.integrationFilter.shownOfTotalShown', '{{shown}} of {{total}} shown', {
        shown: String(shown),
        total: String(total),
      })}
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
        title={t('library.integrationFilter.status', 'Status')}
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
                  {text(VENDOR_STATUS_LABELS[kind])}
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

      <Facet title={t('library.integrationFilter.connection', 'Connection')}>
        <Segmented
          label={t('library.integrationFilter.connection', 'Connection')}
          size="compact"
          options={CONNECTION.map((option) => ({ ...option, label: text(option.label) }))}
          value={filter.internet}
          onChange={(internet) => {
            onChange({ ...filter, internet });
          }}
        />
      </Facet>

      <Facet title={t('library.integrationFilter.showOnly', 'Show only')}>
        <div className="flex flex-col gap-3">
          <ShowOnly
            icon="radio"
            label={t('library.integrationFilter.hasNewDevices', 'Has new devices')}
            isOn={filter.hasNew}
            onChange={(hasNew) => {
              onChange({ ...filter, hasNew });
            }}
          />
          <ShowOnly
            icon="circle-arrow-up"
            label={t('library.integrationFilter.updateReady', 'Update ready')}
            isOn={filter.hasUpdate}
            onChange={(hasUpdate) => {
              onChange({ ...filter, hasUpdate });
            }}
          />
        </div>
      </Facet>

      {wires.length < 2 ? null : (
        <Facet title={t('library.integrationFilter.wire', 'Wire')}>
          <SelectField
            label={t('library.integrationFilter.wire', 'Wire')}
            isLabelHidden
            size="compact"
            options={wireChoices}
            value={filter.transport}
            onChange={(value) => {
              onChange({ ...filter, transport: toTransport(value) });
            }}
          />
        </Facet>
      )}

      <Facet title={t('library.integrationFilter.sortBy', 'Sort by')}>
        <RadioGroup
          label={t('library.integrationFilter.sortBy', 'Sort by')}
          isLabelHidden
          options={VENDOR_SORTS.map((sort) => ({ value: sort, label: text(SORT_LABELS[sort]) }))}
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
