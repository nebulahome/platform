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
 *
 * Above the grid, the devices the hub found on the network and nobody has added: a row of cards,
 * each with an Adopt that adds it with what was found filled in. The row is the hub's live list -
 * a device added, or gone quiet, leaves it on its own - and it is there only when there is
 * something in it, and only for somebody who may see devices.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { DiscoveredDevice } from '@nebula-home/contracts';
import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchDiscovered, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  isNarrowing,
  matchesVendorFilter,
  OPEN_VENDOR_FILTER,
  type VendorFilter,
} from '@/library/vendor-filters';
import { AdoptDialog } from '@/routes/library/adopt-dialog';
import { DiscoveredStrip } from '@/routes/library/discovered-strip';
import { IntegrationFilter } from '@/routes/library/integration-filter';
import { LibraryPage } from '@/routes/library/library-page';
import { VendorCard } from '@/routes/library/vendor-card';

/**
 * Renders the integrations page.
 *
 * @returns The page.
 */
export function IntegrationsPage() {
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canSeeDevices = can('device:read');
  const canAddDevices = can('device:write');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<VendorFilter>(OPEN_VENDOR_FILTER);
  const [adopting, setAdopting] = useState<DiscoveredDevice | null>(null);

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

  const discovered = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.discovered,
    enabled: canSeeDevices,

    /**
     * Reads what the hub found on the network and nobody has added.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices found.
     */
    queryFn: async ({ signal }) => fetchDiscovered(signal),
  });

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    enabled: adopting !== null,

    /**
     * Reads every device, for the ids an adopted one must not take.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every device.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });

  const all = vendors.data ?? [];
  const shown = all.filter((vendor) => matchesVendorFilter(vendor, filter));
  const adoptingVendor = all.find((vendor) => vendor.id === adopting?.vendorId);

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
      <DiscoveredStrip
        devices={discovered.data ?? []}
        vendors={all}
        canAdopt={canAddDevices}
        onAdopt={setAdopting}
      />

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

      <AdoptDialog
        key={adopting?.id ?? 'shut'}
        target={
          adopting === null || adoptingVendor === undefined
            ? null
            : {
                device: adopting,
                vendor: adoptingVendor,
                existingIds: (devices.data ?? []).map((device) => device.id),
              }
        }
        canCreateTags={can('tag:write')}
        onClose={() => {
          setAdopting(null);
        }}
        onAdopted={() => {
          setAdopting(null);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
        }}
      />
    </LibraryPage>
  );
}
