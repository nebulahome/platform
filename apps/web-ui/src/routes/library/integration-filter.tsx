/**
 * The filter on the integrations page: which wire, and whether the internet is needed.
 *
 * Two facets, each a segmented control - a handful of choices each, which is what a segmented
 * control is for. The wires offered are the ones some vendor goes over. The button and the sheet are the library's shared shell.
 */
import { Segmented, type SegmentedOption } from '@nebulahome/ui';

import type { InternetFilter, TransportFilter, VendorFilter, Wire } from '@/library/vendor-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/** What each wire is called on its choice. */
const WIRE_LABELS: Readonly<Record<Wire, string>> = {
  http: 'HTTP',
  mqtt: 'MQTT',
  ble: 'BLE',
  zigbee: 'ZigBee',
  udp: 'UDP',
  modbus: 'Modbus',
};

/** The internet facet's choices. */
const INTERNET: readonly SegmentedOption<InternetFilter>[] = [
  { value: '', label: 'Any' },
  { value: 'local', label: 'Local only' },
  { value: 'needed', label: 'Needs it' },
];

/** What the filter needs. */
export type IntegrationFilterProps = {
  readonly filter: VendorFilter;

  /** The wires some vendor goes over: only those are offered, as a choice nothing would match is none. */
  readonly wires: readonly Wire[];

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
  const { filter, wires, onChange } = props;
  const count = Number(filter.transport !== '') + Number(filter.internet !== '');
  const choices: readonly SegmentedOption<TransportFilter>[] = [
    { value: '', label: 'Any' },
    ...wires.map((wire) => ({ value: wire, label: WIRE_LABELS[wire] })),
  ];

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
          options={choices}
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
