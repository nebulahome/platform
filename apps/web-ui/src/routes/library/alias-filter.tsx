/**
 * The filter on the aliases page: which behavioural domain, whether it is on, and what is wrong.
 *
 * The domain is a dropdown - they grow with every kind of helper in use. Whether an alias is on,
 * and whether it is failing or unavailable, are two short choices of their own, because they are
 * two questions: an alias can be on and failing, and that is the one worth finding. The button
 * and the sheet are the library's shared shell.
 */
import { Segmented, SelectField } from '@nebula-home/ui';

import { aliasFacetCount, type AliasFilter } from '@/library/alias-filters';
import { Facet, facetChoices, FilterSheet, type FacetOption } from '@/routes/library/filter-sheet';

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
  const domainOptions = facetChoices(domains, filter.domain, 'Any domain');

  return (
    <FilterSheet
      label="Narrow the aliases"
      count={aliasFacetCount(filter)}
      onClear={() => {
        onChange({ ...filter, domain: '', state: 'any', health: 'any' });
      }}
    >
      <Facet title="Domain">
        {domainOptions.length === 1 ? (
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
      <Facet title="State">
        <Segmented
          label="State"
          size="compact"
          className="self-start"
          options={[
            { value: 'any', label: 'Any' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={filter.state}
          onChange={(state) => {
            onChange({ ...filter, state });
          }}
        />
      </Facet>
      <Facet title="Problems">
        <Segmented
          label="Problems"
          size="compact"
          className="self-start"
          options={[
            { value: 'any', label: 'Any' },
            { value: 'failing', label: 'Failing' },
            { value: 'unavailable', label: 'Unavailable' },
          ]}
          value={filter.health}
          onChange={(health) => {
            onChange({ ...filter, health });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
