/**
 * The packages installed on this box, and where each stands.
 *
 * **Not the integrations.** A package is the unit that ships and is supervised - a process, a
 * container, or only an interface - with a manifest, a release and a lifecycle; an integration is
 * a connector to a vendor, and has its own section. Both are drawn alike, a grid of the same
 * cards, so the two sections read as one library.
 *
 * What there is to install is found with **Install**: a dialog that searches the
 * Community Hub, and the local folder beside it. An installed package with a newer release out
 * says so on its card - the package index is read for that - and the update is on its page,
 * beside what depends on it.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PACKAGE_STATES, type PackageState } from '@nebulahome/contracts';
import { AppIcon, BrowseTile, Button, Checkbox, cn, EmptyState, TILE_GRID } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { text, translate } from '@/i18n/messages';
import { DOCS_LINKS } from '@/lib/docs-links';
import { matchesQuery } from '@/lib/search-text';
import { signalled } from '@/lib/signalled';
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

/** The dot of each state, in the tone its tile gives it. */
const DOTS: Readonly<Record<PackageState, string>> = {
  installed: 'bg-foreground-subtle',
  starting: 'bg-primary',
  running: 'bg-success',
  stopped: 'bg-foreground-subtle',
  failed: 'bg-danger',
  disabled: 'bg-border-strong',
  'waiting-dependency': 'bg-warning',
};

/** How often the index is read again for updates while the page is open: it changes by the day. */
const INDEX_STALE_MS = 5 * 60_000;

/**
 * Renders the packages page.
 *
 * @returns The page.
 */
export function PackagesPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const canInstall = useSession((state) => state.can('package:install'));
  const [filter, setFilter] = useListState(PACKAGE_FILTER_CODEC);
  const [isInstalling, setInstalling] = useState(false);
  const installed = useInstalledPackages();
  const available = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.available,
    enabled: installed.canRead,
    staleTime: INDEX_STALE_MS,
    queryFn: signalled(fetchAvailablePackages),
  });

  const offered = available.data?.items ?? [];
  const updates = new Map(
    offered.flatMap((each) =>
      each.hasUpdate && each.latest !== null ? [[each.id, each.latest.version] as const] : [],
    ),
  );
  const shownInstalled = installed.packages.filter(
    (found) =>
      (filter.states.length === 0 || filter.states.includes(found.state)) &&
      matchesQuery(
        [found.id, found.name, found.description, found.version, found.lastError],
        filter.search,
      ),
  );

  const counts = new Map<PackageState, number>();

  for (const found of installed.packages) {
    counts.set(found.state, (counts.get(found.state) ?? 0) + 1);
  }

  /**
   * Ticks or unticks one state.
   *
   * @param state - The state.
   * @param isChecked - Whether it is now ticked.
   */
  const toggleState = (state: PackageState, isChecked: boolean): void => {
    setFilter({
      ...filter,
      states: isChecked
        ? PACKAGE_STATES.filter((each) => each === state || filter.states.includes(each))
        : filter.states.filter((each) => each !== state),
    });
  };

  return (
    <>
      <LibraryPage
        title={t('packages.packages.packages', 'Packages')}
        counted={(count) =>
          translate('packages.count', {
            count,
            defaultValue_one: '{{count}} package',
            defaultValue_other: '{{count}} packages',
          })
        }
        count={installed.isPending ? undefined : installed.packages.length}
        shownCount={shownInstalled.length}
        summary={[
          updates.size === 0
            ? null
            : translate('packages.packages.updatesOut', {
                count: updates.size,
                defaultValue_one: '{{count}} update out',
                defaultValue_other: '{{count}} updates out',
              }),
        ]}
        tools={
          <>
            <FilterSheet
              label={t('packages.packages.narrowThePackages', 'Narrow the packages')}
              count={Number(filter.states.length > 0)}
              onClear={() => {
                setFilter({ ...filter, states: [] });
              }}
            >
              <Facet
                title={t('packages.packages.state', 'State')}
                aside={
                  filter.states.length === 0
                    ? undefined
                    : t('packages.packages.selected', {
                        count: filter.states.length,
                        defaultValue_one: '{{count}} selected',
                        defaultValue_other: '{{count}} selected',
                      })
                }
              >
                <div className="flex flex-col gap-3">
                  {PACKAGE_STATES.map((state) => (
                    <Checkbox
                      key={state}
                      // A state no package is in stays offered, quieter: one may yet get there.
                      className={cn(!counts.has(state) && 'opacity-45')}
                      label={
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn('size-1.5 rounded-full', DOTS[state])}
                          />
                          {text(PACKAGE_STATE_OF[state].label)}
                        </span>
                      }
                      count={counts.get(state) ?? 0}
                      isChecked={filter.states.includes(state)}
                      onChange={(isChecked) => {
                        toggleState(state, isChecked);
                      }}
                    />
                  ))}
                </div>
              </Facet>
            </FilterSheet>
            <SearchField
              placeholder={t('packages.packages.searchPackages', 'Search packages…')}
              value={filter.search}
              // On a phone the pill takes what the page's margins and the Filter leave.
              className={canInstall ? 'w-[min(24rem,calc(100vw-12rem))] lg:w-96' : ''}
              action={
                canInstall ? (
                  <Button
                    size="compact"
                    className="shrink-0"
                    onClick={() => {
                      setInstalling(true);
                    }}
                  >
                    <AppIcon id="plus" size={14} />
                    {/* A phone keeps the room for the search it sits in: the plus alone, named to a reader. */}
                    <span className="max-sm:sr-only">
                      {t('packages.packages.install', 'Install')}
                    </span>
                  </Button>
                ) : undefined
              }
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
          </>
        }
        isPending={installed.isPending}
        error={installed.error}
        isEmpty={installed.packages.length === 0}
        empty={
          <EmptyState
            icon={<AppIcon id="package" size={32} />}
            title={t('packages.packages.installYourFirstPackage', 'Install your first package')}
            description={t(
              'packages.packages.packageAddsToThe',
              'A package adds what no device brings, like a 3D view of the house, a music player or a broker, each with its own pages and cards. You can install one from the Community Hub.',
            )}
            action={
              canInstall ? (
                <Button
                  onClick={() => {
                    setInstalling(true);
                  }}
                >
                  <AppIcon id="plus" size={15} />
                  {t('packages.packages.install', 'Install')}
                </Button>
              ) : undefined
            }
            learnMoreHref={DOCS_LINKS.packages}
          />
        }
      >
        {shownInstalled.length === 0 ? (
          <NoMatches
            query={filter.search}
            onClear={() => {
              setFilter(OPEN_PACKAGE_FILTER);
            }}
          />
        ) : (
          <ul className={TILE_GRID}>
            {shownInstalled.map((found) => (
              <PackageTile key={found.id} found={found} update={updates.get(found.id)} />
            ))}
            {canInstall ? (
              <li className="flex list-none flex-col">
                <BrowseTile
                  title={t('packages.packages.browseThePackageIndex', 'Browse the package index')}
                  note={t(
                    'packages.packages.energyCamerasMediaAnd',
                    'Energy, cameras, media and more',
                  )}
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
