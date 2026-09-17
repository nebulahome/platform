/**
 * The integrations: the vendors the house talks to, and what each one has brought in.
 *
 * Its own section, apart from the packages. A package is a process the platform supervises; an
 * integration is a connector to a company - Shelly, Bambu Lab - and the person on this page is
 * thinking in those terms, not in processes. So no Running pill: a connector is always on, and
 * the only things worth a mark are which wire it speaks over and whether it needs the internet.
 *
 * One card per vendor the hub has loaded, in a grid, narrowed from the header. Opening a card
 * gives the vendor its own page: who it is, what it needs, and every device added under it.
 *
 * **Install integration** is here for the catalogue that will fill it, and does nothing yet.
 * Present rather than absent so the header already has the shape it will keep; disabled rather
 * than a no-op so nobody presses it twice wondering.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  isNarrowing,
  matchesVendorFilter,
  OPEN_VENDOR_FILTER,
  type VendorFilter,
} from '@/library/vendor-filters';
import { IntegrationFilter } from '@/routes/library/integration-filter';
import { LibraryPage } from '@/routes/library/library-page';
import { VendorCard } from '@/routes/library/vendor-card';

/**
 * Renders the integrations page.
 *
 * @returns The page.
 */
export function IntegrationsPage() {
  const canConfigure = useSession((state) => state.can)('integration:configure');
  const [filter, setFilter] = useState<VendorFilter>(OPEN_VENDOR_FILTER);

  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,

    /**
     * Reads every vendor the hub has loaded.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The vendors.
     */
    queryFn: async ({ signal }) => fetchVendors(signal),
  });

  const all = vendors.data ?? [];
  const shown = all.filter((vendor) => matchesVendorFilter(vendor, filter));

  return (
    <LibraryPage
      title="Integrations"
      hasTabs={false}
      noun="integration"
      count={vendors.isPending ? undefined : all.length}
      tools={
        <>
          <TextField
            label="Search"
            isLabelHidden
            size="compact"
            type="search"
            placeholder="Search integrations…"
            className="w-44 lg:w-72"
            value={filter.search}
            onChange={(event) => {
              setFilter({ ...filter, search: event.target.value });
            }}
          />
          <IntegrationFilter filter={filter} onChange={setFilter} />
        </>
      }
      action={
        canConfigure ? (
          <Button size="compact" disabled title="The catalogue is not here yet">
            Install integration
          </Button>
        ) : undefined
      }
      isPending={vendors.isPending}
      error={vendors.error}
      isEmpty={all.length === 0}
      emptyMessage="The hub has no integration bundles loaded. The ones that ship with it appear here as soon as it starts."
    >
      {shown.length === 0 && isNarrowing(filter) ? (
        <p className="text-ui text-foreground-muted">
          Nothing matches. Clear the search or widen the filter.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {shown.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
        </ul>
      )}
    </LibraryPage>
  );
}
