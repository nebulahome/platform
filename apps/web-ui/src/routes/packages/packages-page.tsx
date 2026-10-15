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

import { PACKAGE_STATES } from '@nebulahome/contracts';
import { AppIcon, BrowseTile, Button, SelectField, TILE_GRID } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { defineMessage, translate, withLabels } from '@/i18n/messages';
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
  { value: '', label: defineMessage('packages.packages.anyState', 'Any state') },
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
            <SearchField
              placeholder={t('packages.packages.searchPackages', 'Search packages…')}
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label={t('packages.packages.narrowThePackages', 'Narrow the packages')}
              count={Number(filter.state !== '')}
              summary={t('packages.packages.shownOfTotal', '{{shown}} of {{total}} shown', {
                shown: shownInstalled.length,
                total: installed.packages.length,
              })}
              onClear={() => {
                setFilter({ ...filter, state: '' });
              }}
            >
              <Facet title={t('packages.packages.state', 'State')}>
                <SelectField
                  label={t('packages.packages.state', 'State')}
                  isLabelHidden
                  size="compact"
                  options={withLabels(STATE_OPTIONS)}
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
              onClick={() => {
                setInstalling(true);
              }}
            >
              <AppIcon id="plus" size={15} />
              {t('packages.packages.install', 'Install')}
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
                ? t(
                    'packages.packages.nothingInstalledYetInstall',
                    'Nothing installed yet. Install finds them on the Community Hub.',
                  )
                : t('packages.packages.nothingInstalledYet', 'Nothing installed yet.')}
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
