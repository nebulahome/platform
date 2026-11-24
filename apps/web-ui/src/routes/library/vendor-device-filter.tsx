/**
 * The Devices tab's Filter: how each device stands, its room and model, how it is reached, the
 * parts, the silent and the linked ones, and the order.
 *
 * As the board draws it (DL-A-Filter): the standings as boxes with how many stand so beside each,
 * Area and Model side by side, Connection and Show across the sheet's width, two switches, Sort
 * by in two columns. No foot: the count beside the table's title already says how many it shows.
 * A facet the devices give no choice in - one room, one transport, no parts - is not offered.
 */
import { useTranslation } from 'react-i18next';

import {
  Checkbox,
  cn,
  RadioGroup,
  Segmented,
  SelectField,
  type ActiveFilter,
} from '@nebulahome/ui';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import {
  connectionName,
  DEVICE_SORTS,
  DEVICE_STANDINGS,
  narrowingCount,
  OPEN_VENDOR_DEVICE_FILTER,
  type DeviceShow,
  type DeviceSort,
  type DeviceStanding,
  type VendorDeviceFilter,
} from '@/library/vendor-device-filters';
import { Facet, facetChoices, FilterSheet, type FacetOption } from '@/routes/library/filter-sheet';
import { ShowOnly } from '@/routes/library/integration-filter';

/** What each standing is called. */
export const STANDING_LABELS: Readonly<Record<DeviceStanding, Message>> = {
  running: defineMessage('library.vendorDevicesTab.running', 'Running'),
  identifying: defineMessage('library.vendorDevicesTab.identifying', 'Identifying'),
  failed: defineMessage('library.vendorDevicesTab.failed', 'Failed'),
  disabled: defineMessage('library.vendorDevicesTab.disabled', 'Disabled'),
};

/** The dot of each standing, in its badge's tone. */
const DOTS: Readonly<Record<DeviceStanding, string>> = {
  running: 'bg-success',
  identifying: 'bg-primary',
  failed: 'bg-danger',
  disabled: 'bg-foreground-subtle',
};

/** What each choice of Show is called. */
const SHOW_LABELS: Readonly<Record<DeviceShow, Message>> = {
  all: defineMessage('library.vendorDevicesTab.showEverything', 'Everything'),
  main: defineMessage('library.vendorDevicesTab.showMain', 'Main devices'),
  parts: defineMessage('library.vendorDevicesTab.showOnlyParts', 'Parts'),
};

/** What each order is called. */
const SORT_LABELS: Readonly<Record<DeviceSort, Message>> = {
  name: defineMessage('library.vendorDevicesTab.sortName', 'Name'),
  area: defineMessage('library.vendorDevicesTab.sortArea', 'Area'),
  updated: defineMessage('library.vendorDevicesTab.sortUpdated', 'Last updated'),
  newest: defineMessage('library.vendorDevicesTab.sortNewest', 'Newest first'),
};

/** The words of the two switches, shared by the sheet and the chips. */
const SILENT = defineMessage('library.vendorDevicesTab.silent', 'Silent for over an hour');
const LINKED = defineMessage('library.vendorDevicesTab.linked', 'Reached two ways');

/** The choices the loaded devices give. */
export type VendorDeviceChoices = {
  /** The rooms they are in, by key. */
  readonly areas: readonly FacetOption[];

  /** Their models. */
  readonly models: readonly string[];

  /** The transports that reach them. */
  readonly transports: readonly string[];

  /** Whether any of them is a part of another. */
  readonly hasParts: boolean;
};

/** What the filter needs. */
export type VendorDeviceFilterProps = {
  readonly filter: VendorDeviceFilter;
  readonly choices: VendorDeviceChoices;

  /** How many devices stand each way. */
  readonly counts: Readonly<Record<DeviceStanding, number>>;

  readonly onChange: (filter: VendorDeviceFilter) => void;
};

/**
 * Renders the Filter button and its sheet.
 *
 * @param props - See {@link VendorDeviceFilterProps}.
 * @returns The filter.
 */
export function VendorDeviceFilterSheet(props: VendorDeviceFilterProps) {
  const { t } = useTranslation();

  const { filter, choices, counts, onChange } = props;
  const anyConnection = t('library.vendorDevicesTab.anyConnection', 'Any');
  const connections = [
    { value: '', label: anyConnection },
    ...choices.transports.map((transport) => ({
      value: transport,
      label: connectionName(transport),
    })),
  ];

  /**
   * Ticks or unticks one standing.
   *
   * @param standing - The standing.
   * @param isChecked - Whether it is now ticked.
   */
  const toggleStanding = (standing: DeviceStanding, isChecked: boolean): void => {
    onChange({
      ...filter,
      statuses: isChecked
        ? DEVICE_STANDINGS.filter((each) => each === standing || filter.statuses.includes(each))
        : filter.statuses.filter((each) => each !== standing),
    });
  };

  return (
    <FilterSheet
      label={t('library.vendorDevicesTab.narrowTheDevices', 'Narrow the devices')}
      count={narrowingCount(filter)}
      onClear={() => {
        onChange({ ...OPEN_VENDOR_DEVICE_FILTER, search: filter.search, sort: filter.sort });
      }}
    >
      <Facet
        title={t('library.vendorDevicesTab.status', 'Status')}
        aside={
          filter.statuses.length === 0
            ? undefined
            : t('library.vendorDevicesTab.selected', {
                count: filter.statuses.length,
                defaultValue_one: '{{count}} selected',
                defaultValue_other: '{{count}} selected',
              })
        }
      >
        <div className="flex flex-col gap-3">
          {DEVICE_STANDINGS.map((standing) => (
            <Checkbox
              key={standing}
              // A standing no device has stays offered, quieter: the list may yet have one.
              className={cn(counts[standing] === 0 && 'opacity-45')}
              label={
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', DOTS[standing])}
                  />
                  {text(STANDING_LABELS[standing])}
                </span>
              }
              count={counts[standing]}
              isChecked={filter.statuses.includes(standing)}
              onChange={(isChecked) => {
                toggleStanding(standing, isChecked);
              }}
            />
          ))}
        </div>
      </Facet>

      {choices.areas.length < 2 && choices.models.length < 2 ? null : (
        // Area and Model side by side: two facets sharing one line, half a gutter between them.
        <div className="grid auto-cols-fr grid-flow-col border-t border-border">
          {choices.areas.length < 2 ? null : (
            <Facet
              title={t('library.vendorDevicesTab.area', 'Area')}
              className={cn('border-t-0', choices.models.length >= 2 && 'pr-1.5')}
            >
              <SelectField
                label={t('library.vendorDevicesTab.area', 'Area')}
                isLabelHidden
                size="compact"
                options={facetChoices(
                  choices.areas,
                  filter.areaKey,
                  t('library.vendorDevicesTab.anyArea', 'Any area'),
                )}
                value={filter.areaKey}
                onChange={(areaKey) => {
                  onChange({ ...filter, areaKey });
                }}
              />
            </Facet>
          )}
          {choices.models.length < 2 ? null : (
            <Facet
              title={t('library.vendorDevicesTab.model', 'Model')}
              className={cn('border-t-0', choices.areas.length >= 2 && 'pl-1.5')}
            >
              <SelectField
                label={t('library.vendorDevicesTab.model', 'Model')}
                isLabelHidden
                size="compact"
                options={facetChoices(
                  choices.models.map((model) => ({ value: model, label: model })),
                  filter.model,
                  t('library.vendorDevicesTab.anyModel', 'Any model'),
                )}
                value={filter.model}
                onChange={(model) => {
                  onChange({ ...filter, model });
                }}
              />
            </Facet>
          )}
        </div>
      )}

      {choices.transports.length < 2 ? null : (
        <Facet title={t('library.vendorDevicesTab.connection', 'Connection')}>
          {/* Four choices fit across the sheet; past that a dropdown does. */}
          {connections.length <= 4 ? (
            <Segmented
              label={t('library.vendorDevicesTab.connection', 'Connection')}
              size="compact"
              isFilled
              options={connections}
              value={filter.transport}
              onChange={(transport) => {
                onChange({ ...filter, transport });
              }}
            />
          ) : (
            <SelectField
              label={t('library.vendorDevicesTab.connection', 'Connection')}
              isLabelHidden
              size="compact"
              options={connections}
              value={filter.transport}
              onChange={(transport) => {
                onChange({ ...filter, transport });
              }}
            />
          )}
        </Facet>
      )}

      {choices.hasParts ? (
        <Facet title={t('library.vendorDevicesTab.show', 'Show')}>
          <Segmented
            label={t('library.vendorDevicesTab.show', 'Show')}
            size="compact"
            isFilled
            options={(['all', 'main', 'parts'] as const).map((value) => ({
              value,
              label: text(SHOW_LABELS[value]),
            }))}
            value={filter.show}
            onChange={(show) => {
              onChange({ ...filter, show });
            }}
          />
        </Facet>
      ) : null}

      <Facet title={t('library.vendorDevicesTab.showOnly', 'Show only')}>
        <div className="flex flex-col gap-3">
          <ShowOnly
            icon="clock-alert"
            label={text(SILENT)}
            isOn={filter.isSilent}
            onChange={(isSilent) => {
              onChange({ ...filter, isSilent });
            }}
          />
          <ShowOnly
            icon="link-2"
            label={text(LINKED)}
            isOn={filter.isLinked}
            onChange={(isLinked) => {
              onChange({ ...filter, isLinked });
            }}
          />
        </div>
      </Facet>

      <Facet title={t('library.vendorDevicesTab.sortBy', 'Sort by')}>
        <RadioGroup
          label={t('library.vendorDevicesTab.sortBy', 'Sort by')}
          isLabelHidden
          className="grid grid-cols-2 gap-x-4 gap-y-1"
          options={DEVICE_SORTS.map((sort) => ({ value: sort, label: text(SORT_LABELS[sort]) }))}
          value={filter.sort}
          onChange={(sort) => {
            onChange({ ...filter, sort });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}

/**
 * The facets set, as the chips under the table's title: each one removed on its own.
 *
 * @param filter - The filter.
 * @param choices - The choices the devices give, to name a room.
 * @param onChange - Called with the filter less the facet removed.
 * @returns The chips; none when nothing is set.
 */
export function activeDeviceFilters(
  filter: VendorDeviceFilter,
  choices: VendorDeviceChoices,
  onChange: (filter: VendorDeviceFilter) => void,
): ActiveFilter[] {
  // Each facet: whether it is set, its chip's id, what it is called, what it is set to, and the
  // filter less it.
  const facets: readonly [
    boolean,
    string,
    string | undefined,
    string,
    Partial<VendorDeviceFilter>,
  ][] = [
    [
      filter.statuses.length > 0,
      'status',
      translate('library.vendorDevicesTab.status', 'Status'),
      DEVICE_STANDINGS.filter((each) => filter.statuses.includes(each))
        .map((each) => text(STANDING_LABELS[each]))
        .join(', '),
      { statuses: [] },
    ],
    [
      filter.areaKey !== '',
      'area',
      translate('library.vendorDevicesTab.area', 'Area'),
      choices.areas.find((each) => each.value === filter.areaKey)?.label ?? filter.areaKey,
      { areaKey: '' },
    ],
    [
      filter.model !== '',
      'model',
      translate('library.vendorDevicesTab.model', 'Model'),
      filter.model,
      { model: '' },
    ],
    [
      filter.transport !== '',
      'via',
      translate('library.vendorDevicesTab.connection', 'Connection'),
      connectionName(filter.transport),
      { transport: '' },
    ],
    [
      filter.show !== 'all',
      'show',
      translate('library.vendorDevicesTab.show', 'Show'),
      text(SHOW_LABELS[filter.show]),
      { show: 'all' },
    ],
    [filter.isSilent, 'silent', undefined, text(SILENT), { isSilent: false }],
    [filter.isLinked, 'linked', undefined, text(LINKED), { isLinked: false }],
  ];

  return facets
    .filter(([isSet]) => isSet)
    .map(([, id, key, value, unset]) => ({
      id,
      ...(key === undefined ? {} : { key }),
      value,

      /** Unsets this facet alone. */
      onRemove: () => {
        onChange({ ...filter, ...unset });
      },
    }));
}
