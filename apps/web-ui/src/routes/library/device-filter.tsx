/**
 * The filter on the devices page: which integration, and which room.
 *
 * Both are dropdowns. The integrations grow with every bundle installed, and the rooms of a
 * house - a kitchen, a hall, a study on every floor - are past four the moment the house is
 * described, which is where a segmented control stops fitting. The button and the sheet are the
 * library's shared shell.
 */
import { useTranslation } from 'react-i18next';

import { SelectField } from '@nebulahome/ui';

import type { DeviceFilter } from '@/library/device-filters';
import { Facet, facetChoices, FilterSheet, type FacetOption } from '@/routes/library/filter-sheet';

/** What the filter needs. */
export type DeviceFilterButtonProps = {
  readonly filter: DeviceFilter;

  /** The vendors the devices belong to, by id, named the way the catalogue names them. */
  readonly vendors: readonly FacetOption[];

  /** The areas the devices are in, by key, in the house's order: each room under its floor. */
  readonly areas: readonly FacetOption[];

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: DeviceFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link DeviceFilterButtonProps}.
 * @returns The control.
 */
export function DeviceFilterButton(props: DeviceFilterButtonProps) {
  const { t } = useTranslation();

  const { filter, vendors, areas, onChange } = props;
  const count = Number(filter.vendorId !== '') + Number(filter.areaKey !== '');
  const vendorOptions = facetChoices(
    vendors,
    filter.vendorId,
    t('library.deviceFilter.anyIntegration', 'Any integration'),
  );
  const areaOptions = facetChoices(
    areas,
    filter.areaKey,
    t('library.deviceFilter.anyArea', 'Any area'),
    true,
  );

  return (
    <FilterSheet
      label={t('library.deviceFilter.narrowTheDevices', 'Narrow the devices')}
      count={count}
      onClear={() => {
        onChange({ ...filter, vendorId: '', areaKey: '' });
      }}
    >
      <Facet title={t('library.deviceFilter.integration', 'Integration')}>
        <SelectField
          label={t('library.deviceFilter.integration', 'Integration')}
          isLabelHidden
          size="compact"
          options={vendorOptions}
          value={filter.vendorId}
          onChange={(vendorId) => {
            onChange({ ...filter, vendorId });
          }}
        />
      </Facet>
      <Facet title={t('library.deviceFilter.area', 'Area')}>
        {areaOptions.length === 1 ? (
          <span className="text-caption text-foreground-subtle">
            {t('library.deviceFilter.noDeviceIsIn', 'No device is in a room yet.')}
          </span>
        ) : (
          <SelectField
            label={t('library.deviceFilter.area', 'Area')}
            isLabelHidden
            size="compact"
            options={areaOptions}
            value={filter.areaKey}
            onChange={(areaKey) => {
              onChange({ ...filter, areaKey });
            }}
          />
        )}
      </Facet>
    </FilterSheet>
  );
}
