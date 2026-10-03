/**
 * The packages installed on this box, and where each stands.
 *
 * **Not the integrations.** A package is the unit that ships and is supervised - a process, a
 * container, or only an interface - with a manifest, a release and a lifecycle; an integration is
 * a connector to a vendor, and has its own section. Both are drawn alike, a grid of the same
 * cards, so the two sections read as one library.
 *
 * What there is to install is found with **Install packages**: a dialog that searches the
 * Community Hub, and the local folder beside it. An installed package with a newer release out
 * says so on its card - the package index is read for that - and the update is on its page,
 * beside what depends on it.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { PACKAGE_STATES } from '@nebulahome/contracts';
import { Button, SelectField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import { OPEN_PACKAGE_FILTER, packageFilterCodec } from '@/library/list-filters';
import { fetchAvailablePackages, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { useInstalledPackages } from '@/packages/use-packages';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { InstallPackagesDialog } from '@/routes/packages/install-packages-dialog';
import { PACKAGE_STATE_OF, PackageTile } from '@/routes/packages/package-tile';

/** How the page's filter lives in the address. */
const PACKAGE_FILTER_CODEC = packageFilterCodec(PACKAGE_STATES);

/** The state choices, with any first. */
const STATE_OPTIONS = [
  { value: '', label: 'Any state' },
  ...PACKAGE_STATES.map((state) => ({ value: state, label: PACKAGE_STATE_OF[state].label })),
];

/** How often the index is read again for updates while the page is open: it changes by the day. */
const INDEX_STALE_MS = 5 * 60_000;

/**
 * Renders the packages page.
 *
 * @returns The page.
 */
export function PackagesPage() {
  const navigate = useNavigate();
  const canInstall = useSession((state) => state.can('package:install'));
  const [filter, setFilter] = useListState(PACKAGE_FILTER_CODEC);
  const [isInstalling, setInstalling] = useState(false);
  const installed = useInstalledPackages();
  const available = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.available,
    enabled: installed.canRead,
    staleTime: INDEX_STALE_MS,

    /**
     * Reads what the index offers: which installed package has an update out.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The packages, and whether the index could be read.
     */
    queryFn: async ({ signal }) => fetchAvailablePackages(signal),
  });

  const offered = available.data?.items ?? [];
  const updates = new Map(
    offered.flatMap((each) =>
      each.hasUpdate && each.latest !== null ? [[each.id, each.latest.version] as const] : [],
    ),
  );
  const shownInstalled = installed.packages.filter(
    (found) =>
      (filter.state === '' || found.state === filter.state) &&
      matchesQuery(
        [found.id, found.name, found.description, found.version, found.lastError],
        filter.search,
      ),
  );

  return (
    <>
      <LibraryPage
        title="Packages"
        noun="package"
        count={installed.isPending ? undefined : installed.packages.length}
        shownCount={shownInstalled.length}
        summary={[
          updates.size === 0
            ? null
            : `${String(updates.size)} update${updates.size === 1 ? '' : 's'} out`,
        ]}
        tools={
          <>
            <SearchField
              placeholder="Search packages…"
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label="Narrow the packages"
              count={Number(filter.state !== '')}
              onClear={() => {
                setFilter({ ...filter, state: '' });
              }}
            >
              <Facet title="State">
                <SelectField
                  label="State"
                  isLabelHidden
                  size="compact"
                  options={STATE_OPTIONS}
                  value={filter.state}
                  onChange={(state) => {
                    setFilter({
                      ...filter,
                      state: PACKAGE_STATES.find((candidate) => candidate === state) ?? '',
                    });
                  }}
                />
              </Facet>
            </FilterSheet>
          </>
        }
        action={
          canInstall ? (
            <Button
              size="compact"
              onClick={() => {
                setInstalling(true);
              }}
            >
              Install packages
            </Button>
          ) : undefined
        }
        isPending={installed.isPending}
        error={installed.error}
        isEmpty={false}
      >
        {shownInstalled.length === 0 ? (
          installed.packages.length === 0 ? (
            <p className="text-ui text-foreground-muted">
              {canInstall
                ? 'Nothing installed yet. Install packages finds them on the Community Hub.'
                : 'Nothing installed yet.'}
            </p>
          ) : (
            <NoMatches
              query={filter.search}
              onClear={() => {
                setFilter(OPEN_PACKAGE_FILTER);
              }}
            />
          )
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {shownInstalled.map((found) => (
              <PackageTile key={found.id} found={found} update={updates.get(found.id)} />
            ))}
          </ul>
        )}
      </LibraryPage>

      <InstallPackagesDialog
        isOpen={isInstalling}
        onClose={() => {
          setInstalling(false);
        }}
        onInstalled={(done) => {
          setInstalling(false);

          const asked = done.at(-1);

          if (asked !== undefined) {
            void navigate(`/packages/${encodeURIComponent(asked.id)}`);
          }
        }}
        onOpen={(packageId) => {
          setInstalling(false);
          void navigate(`/packages/${encodeURIComponent(packageId)}`);
        }}
      />
    </>
  );
}
