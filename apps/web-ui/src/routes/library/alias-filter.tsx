/**
 * The filter on the aliases page: which behavioural domain, and which standing.
 *
 * Both are dropdowns. Domains grow with every helper kind in use, and standing is five words
 * rather than a segmented row that would fight the sheet. The button and the sheet are the
 * library's shared shell.
 */
import { SelectField } from '@nebula-home/ui';

import { ALIAS_STATUSES, type AliasFilter, type AliasStatus } from '@/library/alias-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/** One thing a facet may be set to. */
export type FacetOption = {
  readonly value: string;
  readonly label: string;
};

/** Standing choices, with any first. */
const STATUSES: readonly FacetOption[] = ALIAS_STATUSES.map((status) => ({
  value: status,
  label: status === 'any' ? 'Any status' : status.charAt(0).toUpperCase() + status.slice(1),
}));

/**
 * Reads a dropdown value back as a status.
 *
 * @param value - What the dropdown chose.
 * @returns The status it names, or any.
 */
function toStatus(value: string): AliasStatus {
  return ALIAS_STATUSES.find((status) => status === value) ?? 'any';
}

/** What the filter needs. */
export type AliasFilterButtonProps = {
  readonly filter: AliasFilter;

  /** The domains present on the page, named as they are stored. */
  readonly domains: readonly FacetOption[];

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: AliasFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link AliasFilterButtonProps}.
 * @returns The control.
 */
export function AliasFilterButton(props: AliasFilterButtonProps) {
  const { filter, domains, onChange } = props;
  const count = Number(filter.domain !== '') + Number(filter.status !== 'any');
  const domainOptions = [{ value: '', label: 'Any domain' }, ...domains];

  return (
    <FilterSheet
      label="Narrow the aliases"
      count={count}
      width="wide"
      onClear={() => {
        onChange({ ...filter, domain: '', status: 'any' });
      }}
    >
      <Facet title="Domain">
        {domains.length === 0 ? (
          <span className="text-caption text-foreground-subtle">No alias has a domain yet.</span>
        ) : (
          <SelectField
            label="Domain"
            isLabelHidden
            size="compact"
            options={domainOptions}
            value={filter.domain}
            onChange={(domain) => {
              onChange({ ...filter, domain });
            }}
          />
        )}
      </Facet>
      <Facet title="Status">
        <SelectField
          label="Status"
          isLabelHidden
          size="compact"
          options={STATUSES}
          value={filter.status}
          onChange={(value) => {
            onChange({ ...filter, status: toStatus(value) });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
