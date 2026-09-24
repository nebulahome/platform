/**
 * The packages: what is installed on this box, and how each one is faring.
 *
 * **Not the integrations.** This page briefly showed those and it was wrong. A package is the
 * unit that ships and is supervised — a process or a container with a manifest, a version and a
 * lifecycle. An integration is a driver bound to a transport, and it has its own section. A
 * package may contribute one; a house may run three instances of that one; neither fact fits in
 * a row shared between them.
 *
 * **Read-only, and not by choice.** Installing, starting and stopping belong to
 * `packet-manager`, which is not built — and the constraint is stricter than a missing service:
 * `nebula_api` holds `SELECT` on `system.packages` and nothing more, because those rows are not
 * its to write (DATABASE.md §12). Even the endpoint would be refused by the database. Buttons
 * are therefore absent rather than disabled, and the page says why once.
 *
 * The state is a word as well as a colour. A package that has failed is the thing somebody came
 * here to find, and `lastError` is the answer they came for, so it is shown rather than hidden
 * behind a row that has to be opened.
 */
import { useQuery } from '@tanstack/react-query';

import { PACKAGE_STATES, type PackageState } from '@nebula-home/contracts';
import { Badge, Panel, PanelNote, PanelRow, SelectField, type BadgeTone } from '@nebula-home/ui';

import { relativeTime } from '@/lib/format-time';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import { fetchPackages, LIBRARY_QUERY_KEYS } from '@/library/api';
import { OPEN_PACKAGE_FILTER, packageFilterCodec } from '@/library/list-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/** What each lifecycle state means to somebody reading the page. */
const TONES: Readonly<Record<PackageState, BadgeTone>> = {
  installed: 'neutral',
  starting: 'accent',
  running: 'success',
  stopped: 'neutral',
  failed: 'danger',
  disabled: 'neutral',
};

/** How the page's filter lives in the address. */
const PACKAGE_FILTER_CODEC = packageFilterCodec(PACKAGE_STATES);

/** The state choices, with any first. */
const STATE_OPTIONS = [
  { value: '', label: 'Any state' },
  ...PACKAGE_STATES.map((state) => ({
    value: state,
    label: state.charAt(0).toUpperCase() + state.slice(1),
  })),
];

/**
 * Renders the packages page.
 *
 * @returns The page.
 */
export function PackagesPage() {
  const packages = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.packages,
    /**
     * Reads every installed package.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every integration and how it is faring.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchPackages(signal),
  });

  const items = packages.data ?? [];
  const [filter, setFilter] = useListState(PACKAGE_FILTER_CODEC);
  const shown = items.filter(
    (installed) =>
      (filter.state === '' || installed.state === filter.state) &&
      matchesQuery(
        [installed.id, installed.version, installed.runtime, installed.lastError],
        filter.search,
      ),
  );

  return (
    <LibraryPage
      title="Packages"
      hasTabs={false}
      noun="package"
      count={packages.isPending ? undefined : items.length}
      shownCount={shown.length}
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
      isPending={packages.isPending}
      error={packages.error}
      isEmpty={items.length === 0}
      emptyMessage="Nothing installed. Installing is packet-manager's to do, and it is not built yet."
    >
      {shown.length === 0 ? (
        <NoMatches
          query={filter.search}
          onClear={() => {
            setFilter(OPEN_PACKAGE_FILTER);
          }}
        />
      ) : null}
      <Panel title="Installed">
        {shown.map((installed) => (
          <PanelRow
            key={installed.id}
            title={
              <span className="flex items-center gap-2.5">
                <span className="font-mono">{installed.id}</span>
                <Badge tone={TONES[installed.state]}>{installed.state}</Badge>
              </span>
            }
            note={
              <span className="flex flex-col gap-1">
                <span>
                  {installed.version} · {installed.runtime} · {installed.entityCount} entit
                  {installed.entityCount === 1 ? 'y' : 'ies'} · {installed.deviceCount} device
                  {installed.deviceCount === 1 ? '' : 's'}
                </span>

                {installed.lastError === null ? null : (
                  <span className="text-danger">{installed.lastError}</span>
                )}
              </span>
            }
            control={
              <span className="text-caption text-foreground-subtle tabular">
                {installed.lastStartedAt === null
                  ? 'never started'
                  : `started ${relativeTime(installed.lastStartedAt)}`}
              </span>
            }
          />
        ))}

        <PanelNote>
          Starting, stopping and installing are not here: those rows belong to packet-manager, which
          is not built, and this service holds read access to them and nothing more.
        </PanelNote>
      </Panel>
    </LibraryPage>
  );
}
