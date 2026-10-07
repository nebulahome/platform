/**
 * The integrations: the vendors the house talks to, and what each one has brought in.
 *
 * Its own section, apart from the packages. A package is a process the platform supervises; an
 * integration is a connector to a company - Shelly, Bambu Lab - and the person on this page is
 * thinking in those terms, not in processes. So no Running pill: a connector is always on, and
 * the only things worth a mark are which wire it speaks over and whether it needs the internet.
 *
 * One card per vendor the hub has loaded, in a grid, narrowed from the header. Opening a card
 * gives the vendor its own page: who it is, what it needs, every device added under it, and the
 * devices of theirs the hub found on the network and nobody has added. A card says how many were
 * found, so the page worth opening is visible from here. Looking for a vendor's devices now,
 * rather than at the hub's next pass, is on that vendor's page.
 *
 * **Install** opens the Community Hub's integrations - and the local integrations folder's - for
 * whoever may install them (`integration:install`), and sends the owner to the vendor's page once
 * the hub runs it, which is where its devices are added.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { AppIcon, BrowseTile, Button, FilterChips, TILE_GRID } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { useListState } from '@/lib/use-list-state';
import { fetchDiscovered, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  countStatuses,
  isNarrowing,
  matchesVendorFilter,
  OPEN_VENDOR_FILTER,
  sortVendors,
  statusesText,
  VENDOR_FILTER_CODEC,
  WIRES,
  wiresOf,
} from '@/library/vendor-filters';
import { InstallIntegrationsDialog } from '@/routes/library/install-integrations-dialog';
import { IntegrationFilter } from '@/routes/library/integration-filter';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { VendorCard } from '@/routes/library/vendor-card';

/**
 * Renders the integrations page.
 *
 * @returns The page.
 */
export function IntegrationsPage() {
  const can = useSession((state) => state.can);
  const canInstall = can('integration:install');
  const canSeeDevices = can('device:read');
  const navigate = useNavigate();
  const [isInstalling, setInstalling] = useState(false);
  const [filter, setFilter] = useListState(VENDOR_FILTER_CODEC);

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
     * Reads what the hub found on the network and nobody has added, for the counts on the cards.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices found.
     */
    queryFn: async ({ signal }) => fetchDiscovered(signal),
  });

  const all = vendors.data ?? [];
  const foundBy = new Map<string, number>();

  for (const device of discovered.data ?? []) {
    foundBy.set(device.vendorId, (foundBy.get(device.vendorId) ?? 0) + 1);
  }

  const shown = sortVendors(
    all.filter((vendor) => matchesVendorFilter(vendor, filter, foundBy.get(vendor.id) ?? 0)),
    filter.sort,
  );
  const wires = WIRES.filter((wire) => all.some((vendor) => wiresOf(vendor).includes(wire)));
  const chips = [
    ...(filter.statuses.length === 0
      ? []
      : [
          {
            id: 'status',
            key: 'Status',
            value: statusesText(filter.statuses),
            /** Takes the standings off. */
            onRemove: () => {
              setFilter({ ...filter, statuses: [] });
            },
          },
        ]),
    ...(filter.internet === ''
      ? []
      : [
          {
            id: 'connection',
            key: 'Connection',
            value: filter.internet === 'local' ? 'Local' : 'Cloud',
            /** Takes the connection off. */
            onRemove: () => {
              setFilter({ ...filter, internet: '' });
            },
          },
        ]),
    ...(filter.transport === ''
      ? []
      : [
          {
            id: 'wire',
            key: 'Wire',
            value: filter.transport.toUpperCase(),
            /** Takes the wire off. */
            onRemove: () => {
              setFilter({ ...filter, transport: '' });
            },
          },
        ]),
    ...(filter.hasNew
      ? [
          {
            id: 'new',
            value: 'Has new devices',
            /** Shows every vendor again, found devices or not. */
            onRemove: () => {
              setFilter({ ...filter, hasNew: false });
            },
          },
        ]
      : []),
    ...(filter.hasUpdate
      ? [
          {
            id: 'update',
            value: 'Update ready',
            /** Shows every vendor again, update or not. */
            onRemove: () => {
              setFilter({ ...filter, hasUpdate: false });
            },
          },
        ]
      : []),
  ];

  const found = discovered.data?.length ?? 0;

  return (
    <LibraryPage
      title="Integrations"
      noun="integration"
      count={vendors.isPending ? undefined : all.length}
      shownCount={shown.length}
      summary={[found === 0 ? null : `${String(found)} found on the network`]}
      tools={
        <>
          <SearchField
            placeholder="Search integrations…"
            value={filter.search}
            onChange={(search) => {
              setFilter({ ...filter, search });
            }}
          />
          <IntegrationFilter
            filter={filter}
            wires={wires}
            counts={countStatuses(all)}
            shown={shown.length}
            total={all.length}
            onChange={setFilter}
          />
        </>
      }
      action={
        canInstall ? (
          <>
            <Button
              onClick={() => {
                setInstalling(true);
              }}
            >
              <AppIcon id="plus" size={15} />
              Install
            </Button>
            <InstallIntegrationsDialog
              isOpen={isInstalling}
              onClose={() => {
                setInstalling(false);
              }}
              onInstalled={(reply) => {
                setInstalling(false);
                void navigate(`/integrations/${reply.vendorId}`);
              }}
              onOpen={(vendorId) => {
                setInstalling(false);
                void navigate(`/integrations/${vendorId}`);
              }}
            />
          </>
        ) : undefined
      }
      filters={
        <FilterChips
          filters={chips}
          summary={`${String(shown.length)} of ${String(all.length)}`}
          onClearAll={() => {
            setFilter({ ...OPEN_VENDOR_FILTER, search: filter.search, sort: filter.sort });
          }}
        />
      }
      isPending={vendors.isPending}
      error={vendors.error}
      isEmpty={all.length === 0}
      emptyMessage="The hub has no integration bundles loaded. The ones that ship with it appear here as soon as it starts."
    >
      {shown.length === 0 && isNarrowing(filter) ? (
        <NoMatches
          query={filter.search}
          onClear={() => {
            setFilter(OPEN_VENDOR_FILTER);
          }}
        />
      ) : (
        <ul className={TILE_GRID}>
          {shown.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} foundCount={foundBy.get(vendor.id) ?? 0} />
          ))}
          {canInstall ? (
            <li className="flex list-none flex-col">
              <BrowseTile
                title="Browse the integration index"
                note="Brands, protocols and services"
                icon="globe"
                onClick={() => {
                  setInstalling(true);
                }}
              />
            </li>
          ) : null}
        </ul>
      )}
    </LibraryPage>
  );
}
