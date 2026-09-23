/**
 * The filter on the integrations page: which wire, and whether the internet is needed.
 *
 * Two facets, each a segmented control - three or four choices each, which is what a segmented
 * control is for. The button and the sheet are the library's shared shell.
 */
import { Segmented, type SegmentedOption } from '@nebula-home/ui';

import type { InternetFilter, TransportFilter, VendorFilter } from '@/library/vendor-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/** The wires a vendor may be narrowed to. */
const WIRES: readonly SegmentedOption<TransportFilter>[] = [
  { value: '', label: 'Any' },
  { value: 'http', label: 'HTTP' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'own', label: 'Own' },
];

/** The internet facet's choices. */
const INTERNET: readonly SegmentedOption<InternetFilter>[] = [
  { value: '', label: 'Any' },
  { value: 'local', label: 'Local only' },
  { value: 'needed', label: 'Needs it' },
];

/** What the filter needs. */
export type IntegrationFilterProps = {
  readonly filter: VendorFilter;

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: VendorFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link IntegrationFilterProps}.
 * @returns The control.
 */
export function IntegrationFilter(props: IntegrationFilterProps) {
  const { filter, onChange } = props;
  const count = Number(filter.transport !== '') + Number(filter.internet !== '');

  return (
    <FilterSheet
      label="Narrow the integrations"
      count={count}
      onClear={() => {
        onChange({ ...filter, transport: '', internet: '' });
      }}
    >
      <Facet title="Wire">
        <Segmented
          label="Wire"
          size="compact"
          options={WIRES}
          value={filter.transport}
          onChange={(transport) => {
            onChange({ ...filter, transport });
          }}
        />
      </Facet>
      <Facet title="Internet">
        <Segmented
          label="Internet"
          size="compact"
          options={INTERNET}
          value={filter.internet}
          onChange={(internet) => {
            onChange({ ...filter, internet });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
