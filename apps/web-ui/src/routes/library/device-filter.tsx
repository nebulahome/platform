/**
 * The filter on the devices page: how each device stands, its integration and room, its model and
 * how it is reached, a tag, the parts, and the ones reached two ways.
 *
 * Drawn as the integration's Devices tab draws its own: the standings as boxes with how many
 * stand so beside each, then the dropdowns two to a line - Integration beside Area, Model beside
 * Connection - the tag, Show, and a switch. No order here: the table's headings sort it. A facet
 * the devices give no choice in - one integration, one model, no tags, no parts - is not offered.
 */
import { useTranslation } from 'react-i18next';

import { Checkbox, cn, Segmented, SelectField } from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';
import { narrowingCount, OPEN_FILTER, type DeviceFilter } from '@/library/device-filters';
import { DEVICE_STATUS_ORDER, type DeviceStatusKind } from '@/library/device-status';
import { connectionName, DEVICE_SHOWS, type DeviceShow } from '@/library/vendor-device-filters';
import { Facet, facetChoices, FilterSheet, type FacetOption } from '@/routes/library/filter-sheet';
import { ShowOnly } from '@/routes/library/integration-filter';

/** What each standing is called: the words of the Status column's pills. */
const STATUS_LABELS: Readonly<Record<DeviceStatusKind, Message>> = {
  unreachable: defineMessage('library.deviceStatus.unreachable', 'Unreachable'),
  silent: defineMessage('library.deviceStatus.silent', 'Silent'),
  update: defineMessage('library.deviceStatus.updateReady', 'Update ready'),
  reporting: defineMessage('library.deviceStatus.reporting', 'Reporting'),
  disabled: defineMessage('library.deviceStatus.disabled', 'Disabled'),
};

/** The dot of each standing, in its pill's tone. */
const DOTS: Readonly<Record<DeviceStatusKind, string>> = {
  unreachable: 'bg-danger',
  silent: 'bg-warning',
  update: 'bg-cyan',
  reporting: 'bg-success',
  disabled: 'bg-foreground-subtle',
};

/** What each choice of Show is called. */
const SHOW_LABELS: Readonly<Record<DeviceShow, Message>> = {
  all: defineMessage('library.deviceFilter.showEverything', 'Everything'),
  main: defineMessage('library.deviceFilter.showMain', 'Main devices'),
  parts: defineMessage('library.deviceFilter.showParts', 'Parts'),
};

/** The words of the switch. */
const LINKED = defineMessage('library.deviceFilter.linked', 'Reached two ways');

/** The choices the loaded devices give. */
export type DeviceChoices = {
  /** The vendors the devices belong to, by id, named the way the catalogue names them. */
  readonly vendors: readonly FacetOption[];

  /** The areas the devices are in, by key, in the house's order: each room under its floor. */
  readonly areas: readonly FacetOption[];

  /** Their models. */
  readonly models: readonly string[];

  /** The transports that reach them. */
  readonly transports: readonly string[];

  /** The tags on them, by id. */
  readonly tags: readonly FacetOption[];

  /** Whether any of them is a part of another. */
  readonly hasParts: boolean;
};

/** What the filter needs. */
export type DeviceFilterButtonProps = {
  readonly filter: DeviceFilter;
  readonly choices: DeviceChoices;

  /** How many devices stand each way, by the live readings. */
  readonly counts: Readonly<Record<DeviceStatusKind, number>>;

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: DeviceFilter) => void;
};

/** One dropdown facet. */
type DropdownFacet = {
  readonly title: string;
  readonly options: readonly FacetOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
};

/** What a line of dropdowns needs. */
type FacetLineProps = {
  /** Each facet, or null where it is not offered. */
  readonly facets: readonly (DropdownFacet | null)[];
};

/**
 * Up to two dropdown facets sharing one line, half a gutter between them; none when neither is
 * offered.
 *
 * @param props - See {@link FacetLineProps}.
 * @returns The line.
 */
function FacetLine(props: FacetLineProps) {
  const shown = props.facets.filter((facet): facet is DropdownFacet => facet !== null);

  if (shown.length === 0) {
    return null;
  }

  return (
    <div className="grid auto-cols-fr grid-flow-col border-t border-border">
      {shown.map((facet, index) => (
        <Facet
          key={facet.title}
          title={facet.title}
          className={cn('border-t-0', shown.length > 1 && (index === 0 ? 'pr-1.5' : 'pl-1.5'))}
        >
          <SelectField
            label={facet.title}
            isLabelHidden
            size="compact"
            options={facet.options}
            value={facet.value}
            onChange={facet.onChange}
          />
        </Facet>
      ))}
    </div>
  );
}

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link DeviceFilterButtonProps}.
 * @returns The control.
 */
export function DeviceFilterButton(props: DeviceFilterButtonProps) {
  const { t } = useTranslation();

  const { filter, choices, counts, onChange } = props;

  /**
   * A dropdown facet, when the devices give at least `least` choices in it.
   *
   * @param title - What it is called.
   * @param options - The choices, before "any".
   * @param least - How many choices it takes to be worth offering.
   * @param anyLabel - What the "any" choice is called.
   * @param key - The field of the filter it sets.
   * @param isOrdered - Whether the choices already come in the order to show them.
   * @returns The facet, or null.
   */
  const dropdown = (
    title: string,
    options: readonly FacetOption[],
    least: number,
    anyLabel: string,
    key: 'vendorId' | 'areaKey' | 'model' | 'transport' | 'tagId',
    isOrdered = false,
  ): DropdownFacet | null =>
    // A facet set to a value the devices no longer give stays, so it can be cleared.
    options.length < least && filter[key] === ''
      ? null
      : {
          title,
          options: facetChoices(options, filter[key], anyLabel, isOrdered),
          value: filter[key],

          /**
           * Sets the facet.
           *
           * @param value - The choice; blank for any.
           */
          onChange: (value) => {
            onChange({ ...filter, [key]: value });
          },
        };

  /**
   * Ticks or unticks one standing.
   *
   * @param kind - The standing.
   * @param isChecked - Whether it is now ticked.
   */
  const toggleStatus = (kind: DeviceStatusKind, isChecked: boolean): void => {
    onChange({
      ...filter,
      statuses: isChecked
        ? DEVICE_STATUS_ORDER.filter((each) => each === kind || filter.statuses.includes(each))
        : filter.statuses.filter((each) => each !== kind),
    });
  };

  return (
    <FilterSheet
      label={t('library.deviceFilter.narrowTheDevices', 'Narrow the devices')}
      count={narrowingCount(filter)}
      onClear={() => {
        onChange({ ...OPEN_FILTER, search: filter.search });
      }}
    >
      <Facet
        title={t('library.deviceFilter.status', 'Status')}
        aside={
          filter.statuses.length === 0
            ? undefined
            : t('library.deviceFilter.selected', {
                count: filter.statuses.length,
                defaultValue_one: '{{count}} selected',
                defaultValue_other: '{{count}} selected',
              })
        }
      >
        <div className="flex flex-col gap-3">
          {DEVICE_STATUS_ORDER.map((kind) => (
            <Checkbox
              key={kind}
              // A standing no device has stays offered, quieter: a reading may yet bring one.
              className={cn(counts[kind] === 0 && 'opacity-45')}
              label={
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOTS[kind])} />
                  {text(STATUS_LABELS[kind])}
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

      <FacetLine
        facets={[
          dropdown(
            t('library.deviceFilter.integration', 'Integration'),
            choices.vendors,
            2,
            t('library.deviceFilter.anyIntegration', 'Any integration'),
            'vendorId',
          ),
          dropdown(
            t('library.deviceFilter.area', 'Area'),
            choices.areas,
            2,
            t('library.deviceFilter.anyArea', 'Any area'),
            'areaKey',
            true,
          ),
        ]}
      />

      <FacetLine
        facets={[
          dropdown(
            t('library.deviceFilter.model', 'Model'),
            choices.models.map((model) => ({ value: model, label: model })),
            2,
            t('library.deviceFilter.anyModel', 'Any model'),
            'model',
          ),
          dropdown(
            t('library.deviceFilter.connection', 'Connection'),
            choices.transports.map((transport) => ({
              value: transport,
              label: connectionName(transport),
            })),
            2,
            t('library.deviceFilter.anyConnection', 'Any connection'),
            'transport',
          ),
        ]}
      />

      {/* One tag in use is still a choice: not every device carries it. */}
      <FacetLine
        facets={[
          dropdown(
            t('library.deviceFilter.tag', 'Tag'),
            choices.tags,
            1,
            t('library.deviceFilter.anyTag', 'Any tag'),
            'tagId',
          ),
        ]}
      />

      {choices.hasParts || filter.show !== 'all' ? (
        <Facet title={t('library.deviceFilter.show', 'Show')}>
          <Segmented
            label={t('library.deviceFilter.show', 'Show')}
            size="compact"
            isFilled
            options={DEVICE_SHOWS.map((value) => ({ value, label: text(SHOW_LABELS[value]) }))}
            value={filter.show}
            onChange={(show) => {
              onChange({ ...filter, show });
            }}
          />
        </Facet>
      ) : null}

      <Facet title={t('library.deviceFilter.showOnly', 'Show only')}>
        <ShowOnly
          icon="link-2"
          label={text(LINKED)}
          isOn={filter.isLinked}
          onChange={(isLinked) => {
            onChange({ ...filter, isLinked });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
