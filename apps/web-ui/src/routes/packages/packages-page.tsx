/**
 * The packages: what is installed on this box, and what the package index offers.
 *
 * **Not the integrations.** A package is the unit that ships and is supervised - a process, a
 * container, or only an interface - with a manifest, a release and a lifecycle; an integration is
 * a connector to a vendor, and has its own section. Both are drawn alike, a grid of the same
 * cards, so the two sections read as one library.
 *
 * Two lists, one address: Installed, the packages on this box and where each stands; and
 * Available, what the index offers, with Install for what fits this platform. Installing asks
 * the packet-manager first what it would take - what else goes in with it, or why it cannot -
 * and nothing restarts: the package starts once it is in, and its page and cards appear as it
 * does. An installed package with a newer release out says so on its card; the update is on its
 * page, beside what depends on it.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { PACKAGE_STATES, type AvailablePackage } from '@nebulahome/contracts';
import { Badge, Button, Panel, PanelNote, PanelRow, Segmented, SelectField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import {
  OPEN_PACKAGE_FILTER,
  packageFilterCodec,
  type PackageListView,
} from '@/library/list-filters';
import { fetchAvailablePackages, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { useInstalledPackages } from '@/packages/use-packages';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { InstallPackageDialog } from '@/routes/packages/install-package-dialog';
import { PACKAGE_STATE_OF, PackageTile } from '@/routes/packages/package-tile';

/** How the page's filter lives in the address. */
const PACKAGE_FILTER_CODEC = packageFilterCodec(PACKAGE_STATES);

/** The two lists. */
const VIEW_OPTIONS: readonly { readonly value: PackageListView; readonly label: string }[] = [
  { value: 'installed', label: 'Installed' },
  { value: 'available', label: 'Available' },
];

/** The state choices, with any first. */
const STATE_OPTIONS = [
  { value: '', label: 'Any state' },
  ...PACKAGE_STATES.map((state) => ({ value: state, label: PACKAGE_STATE_OF[state].label })),
];

/** How often the index is read again while the page is open: it changes by the day. */
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
  const [installing, setInstalling] = useState<AvailablePackage | null>(null);
  const installed = useInstalledPackages();
  const available = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.available,
    enabled: installed.canRead,
    staleTime: INDEX_STALE_MS,

    /**
     * Reads what the index offers.
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
  const shownOffered = offered.filter((each) =>
    matchesQuery([each.id, each.name, each.description, each.category], filter.search),
  );
  const isInstalledView = filter.view === 'installed';

  return (
    <>
      <LibraryPage
        title="Packages"
        noun="package"
        count={installed.isPending ? undefined : installed.packages.length}
        shownCount={isInstalledView ? shownInstalled.length : undefined}
        summary={[
          updates.size === 0
            ? null
            : `${String(updates.size)} update${updates.size === 1 ? '' : 's'} out`,
        ]}
        tools={
          <>
            <Segmented
              label="Which packages"
              size="compact"
              options={VIEW_OPTIONS}
              value={filter.view}
              onChange={(view) => {
                setFilter({ ...filter, view, state: view === 'installed' ? filter.state : '' });
              }}
            />
            <SearchField
              placeholder="Search packages…"
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            {isInstalledView ? (
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
            ) : null}
          </>
        }
        isPending={installed.isPending}
        error={installed.error}
        isEmpty={false}
      >
        {isInstalledView ? (
          shownInstalled.length === 0 ? (
            installed.packages.length === 0 ? (
              <p className="text-ui text-foreground-muted">
                Nothing installed yet. What the package index offers is under Available.
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
          )
        ) : (
          <Panel title="From the package index">
            {available.isPending ? (
              <PanelNote>Reading the package index…</PanelNote>
            ) : available.data?.error === null || available.data === undefined ? null : (
              <PanelNote>
                The package index could not be read: {available.data.error}. What is installed keeps
                running.
              </PanelNote>
            )}

            {shownOffered.map((each) => (
              <PanelRow
                key={each.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{each.name}</span>
                    <Badge tone="neutral" size="small">
                      {each.category}
                    </Badge>
                    {each.latest?.source === 'local' ? (
                      <Badge tone="warning" size="small">
                        Local file
                      </Badge>
                    ) : null}
                    {each.installedVersion === null ? null : (
                      <Badge
                        tone={each.hasUpdate || each.hasNewBuild ? 'accent' : 'success'}
                        size="small"
                      >
                        {each.hasUpdate
                          ? 'Update out'
                          : each.hasNewBuild
                            ? 'New build'
                            : 'Installed'}
                      </Badge>
                    )}
                  </span>
                }
                note={
                  <span className="flex flex-col gap-0.5">
                    <span>{each.description}</span>
                    <span className="text-foreground-subtle tabular">
                      {each.latest === null
                        ? `v${each.newestVersion} needs a newer NebulaHome than this one`
                        : `v${each.latest.version} · ${each.repository}`}
                    </span>
                  </span>
                }
                control={
                  each.installedVersion !== null ? (
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => {
                        void navigate(`/packages/${encodeURIComponent(each.id)}`);
                      }}
                    >
                      Open
                    </Button>
                  ) : canInstall ? (
                    <Button
                      size="compact"
                      disabled={each.latest === null}
                      onClick={() => {
                        setInstalling(each);
                      }}
                    >
                      Install
                    </Button>
                  ) : null
                }
              />
            ))}

            {available.isPending || shownOffered.length > 0 ? null : (
              <PanelNote>
                {offered.length === 0
                  ? 'The package index offers nothing yet.'
                  : 'Nothing the index offers matches the search.'}
              </PanelNote>
            )}
          </Panel>
        )}
      </LibraryPage>

      <InstallPackageDialog
        target={installing}
        onClose={() => {
          setInstalling(null);
        }}
        onInstalled={(done) => {
          setInstalling(null);

          const asked = done.at(-1);

          if (asked !== undefined) {
            void navigate(`/packages/${encodeURIComponent(asked.id)}`);
          }
        }}
      />
    </>
  );
}
