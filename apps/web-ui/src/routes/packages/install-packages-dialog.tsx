/**
 * Installing packages: one dialog with two pages.
 *
 * The first page is the search - "In the packages folder" first, listed even when the Community
 * Hub cannot be reached, then the Hub's results - each a full-width row. Picking one opens its own
 * page in the same dialog, "‹ Packages" back: who publishes it, what the Hub says of it, and what
 * installing it takes - the packages that go in with it - before anything is downloaded.
 *
 * A package already installed is opened rather than offered again: its own page has its update,
 * its settings and its log.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { InstalledPackage, PackageListing } from '@nebulahome/contracts';
import { Button } from '@nebulahome/ui';

import { CatalogueDialog } from '@/components/catalogue/catalogue-dialog';
import { CatalogueChip, CatalogueItem, CatalogueStat } from '@/components/catalogue/catalogue-item';
import { CatalogueRow, Installs, Stars } from '@/components/catalogue/catalogue-row';
import { ListingLogo } from '@/components/catalogue/listing-logo';
import { toMessage } from '@/lib/error-message';
import { shortCount } from '@/lib/format-count';
import { relativeTime } from '@/lib/format-time';
import { packageEffects } from '@/lib/install-effects';
import { useCatalogueSearch } from '@/lib/use-catalogue-search';
import { fetchPackageCatalogueDetail, PACKAGE_QUERY_KEYS, searchCatalogue } from '@/packages/api';
import { usePackageInstall } from '@/packages/use-package-install';

/** What the results page needs. */
type ResultsProps = {
  readonly items: readonly PackageListing[];

  /** Called with the listing picked. */
  readonly onPick: (listing: PackageListing) => void;
};

/**
 * The listings of the results page: the local folder's, then the Hub's, each under its label.
 *
 * @param props - See {@link ResultsProps}.
 * @returns The lists.
 */
function Results(props: ResultsProps) {
  const { items, onPick } = props;
  const local = items.filter((listing) => listing.origin === 'local');
  const hub = items.filter((listing) => listing.origin === 'hub');

  return (
    <div className="flex flex-col gap-4">
      {local.length === 0 ? null : (
        <section aria-label="In the packages folder" className="flex flex-col gap-1">
          <h3 className="flex items-baseline justify-between px-1 pt-1 font-mono text-label text-foreground-subtle uppercase">
            <span>In the packages folder</span>
            <span className="font-sans text-caption tracking-normal normal-case">
              not released yet
            </span>
          </h3>
          <ul className="flex flex-col">
            {local.map((listing) => (
              <CatalogueRow
                key={`local:${listing.id}`}
                logo={<ListingLogo listing={listing} size={48} />}
                name={listing.name}
                isOfficial={false}
                description={`v${listing.latest?.version ?? listing.newestVersion ?? '?'} · being tried on this machine`}
                facts={
                  <>
                    <span>by you · local</span>
                    <span className="rounded-chip border border-warning-line px-1.5 font-mono text-label text-warning uppercase">
                      Local file
                    </span>
                    {listing.hasNewBuild ? <span className="text-primary">New build</span> : null}
                  </>
                }
                isInstalled={listing.installedVersion !== null && !listing.hasNewBuild}
                onOpen={() => {
                  onPick(listing);
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {hub.length === 0 ? null : (
        <section aria-label="Community Hub" className="flex flex-col gap-1">
          {local.length === 0 ? null : (
            <h3 className="flex items-baseline justify-between px-1 pt-1 font-mono text-label text-foreground-subtle uppercase">
              <span>Community Hub</span>
              <span className="font-sans text-caption tracking-normal normal-case">
                {hub.length} {hub.length === 1 ? 'package' : 'packages'}
              </span>
            </h3>
          )}
          <ul className="flex flex-col">
            {hub.map((listing) => (
              <CatalogueRow
                key={`hub:${listing.id}`}
                logo={<ListingLogo listing={listing} size={48} />}
                name={listing.name}
                isOfficial={listing.isOfficial}
                description={listing.description}
                facts={
                  <>
                    <Stars count={listing.stars} />
                    <Installs count={listing.downloads} />
                    {listing.hasUpdate ? <span className="text-primary">Update out</span> : null}
                  </>
                }
                isInstalled={listing.installedVersion !== null}
                onOpen={() => {
                  onPick(listing);
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** What the dialog needs. */
export type InstallPackagesDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** Called once a package is in, with what went in: the one asked for last. */
  readonly onInstalled: (installed: readonly InstalledPackage[]) => void;

  /** Called to open an installed package's page. */
  readonly onOpen: (packageId: string) => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link InstallPackagesDialogProps}.
 * @returns The dialog.
 */
export function InstallPackagesDialog(props: InstallPackagesDialogProps) {
  const { isOpen, onClose, onInstalled, onOpen } = props;
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<PackageListing | null>(null);
  const results = useCatalogueSearch({
    text: search,
    isOpen,
    keyOf: PACKAGE_QUERY_KEYS.catalogue,
    search: searchCatalogue,
  });
  const detail = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.catalogueDetail(picked?.id ?? ''),
    enabled: picked !== null && picked.origin === 'hub',
    retry: false,
    staleTime: 60_000,

    /**
     * Asks the Hub what it says of the package.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns What it says.
     */
    queryFn: async ({ signal }) => fetchPackageCatalogueDetail(picked?.id ?? '', signal),
  });
  const isInstallable =
    picked !== null && picked.latest !== null && picked.installedVersion === null;
  const { plan, install, others, problems, canInstall } = usePackageInstall(
    isInstallable ? picked.id : null,
    (installed) => {
      setPicked(null);
      onInstalled(installed);
    },
  );

  /** Closes, unless an install is under way. */
  const close = (): void => {
    if (!install.isPending) {
      setPicked(null);
      install.reset();
      onClose();
    }
  };

  const version = picked?.latest?.version ?? picked?.newestVersion ?? null;
  const publishedAt = picked?.latest?.publishedAt ?? detail.data?.publishedAt ?? null;

  return (
    <CatalogueDialog
      isOpen={isOpen}
      onClose={close}
      title="Install a package"
      subtitle="From the Community Hub, and the packages folder on this machine"
      icon="package"
      item={
        picked === null
          ? null
          : {
              name: picked.name,
              backLabel: 'Packages',

              /** Goes back to the results, unless an install is under way. */
              onBack: () => {
                if (!install.isPending) {
                  install.reset();
                  setPicked(null);
                }
              },
            }
      }
      search={search}
      onSearch={setSearch}
      searchLabel="Search the Community Hub"
      searchPlaceholder="Search packages"
      status={
        results.hubError === null ? (
          results.isPending ? (
            'Asking the Hub…'
          ) : (
            `${String(results.items.length)}${results.hasMore ? '+' : ''} ${results.items.length === 1 ? 'package' : 'packages'}`
          )
        ) : (
          <span role="status" className="text-warning">
            {results.hubError}. The local folder&apos;s files are listed still.
          </span>
        )
      }
      footer={
        picked === null ? undefined : (
          <>
            <span />
            <div className="flex items-center gap-2.5">
              <Button variant="bare" disabled={install.isPending} onClick={close}>
                {picked.installedVersion === null ? 'Cancel' : 'Close'}
              </Button>
              {picked.installedVersion === null ? (
                <Button
                  isBusy={install.isPending}
                  disabled={!canInstall}
                  onClick={() => {
                    install.mutate();
                  }}
                >
                  {others.length === 0
                    ? `Install ${picked.name}`
                    : `Install ${String(others.length + 1)} packages`}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    onOpen(picked.id);
                  }}
                >
                  Open
                </Button>
              )}
            </div>
          </>
        )
      }
    >
      {picked === null ? (
        <>
          {results.error === null ? null : (
            <p role="alert" className="px-1 text-ui text-danger">
              {toMessage(results.error)}
            </p>
          )}
          {!results.isPending && results.error === null && results.items.length === 0 ? (
            <p className="px-1 py-6 text-center text-ui text-foreground-subtle">
              {results.query === ''
                ? 'No package to offer yet.'
                : `No package matches “${results.query}”.`}
            </p>
          ) : null}
          <Results items={results.items} onPick={setPicked} />
          {results.hasMore ? (
            <Button
              variant="ghost"
              className="self-center"
              isBusy={results.isLoadingMore}
              onClick={results.loadMore}
            >
              Show more
            </Button>
          ) : null}
        </>
      ) : (
        <CatalogueItem
          logo={<ListingLogo listing={picked} size={80} />}
          name={picked.name}
          by={
            picked.origin === 'local'
              ? 'From the packages folder on this machine'
              : detail.data?.owner === null || detail.data?.owner === undefined
                ? null
                : `by ${detail.data.owner}`
          }
          chips={
            <>
              {picked.isOfficial ? <CatalogueChip tone="accent">Official</CatalogueChip> : null}
              {picked.latest?.source === 'local' ? (
                <CatalogueChip tone="warning" icon="hard-drive">
                  Local file
                </CatalogueChip>
              ) : null}
              <CatalogueChip>{picked.category}</CatalogueChip>
            </>
          }
          stats={
            <>
              {picked.origin === 'hub' ? (
                <>
                  <CatalogueStat
                    icon="star"
                    iconClassName="text-lamp"
                    value={shortCount(picked.stars)}
                    label="stars"
                  />
                  <CatalogueStat
                    icon="download"
                    value={shortCount(picked.downloads)}
                    label="installs"
                  />
                </>
              ) : null}
              {version === null ? null : <CatalogueStat icon="tag" value={version} />}
              {publishedAt === null ? null : (
                <CatalogueStat
                  icon="clock"
                  value={relativeTime(publishedAt)}
                  label="since the last release"
                />
              )}
            </>
          }
          description={picked.description}
          effects={
            isInstallable && plan.data !== undefined
              ? packageEffects(
                  picked,
                  others.map((each) => each.name),
                )
              : []
          }
        >
          {picked.installedVersion === null ? null : (
            <p role="status" className="text-ui text-foreground">
              Version <span className="font-mono font-medium">{picked.installedVersion}</span> is
              installed.{' '}
              {picked.hasUpdate || picked.hasNewBuild
                ? 'Its page has the update.'
                : 'Its page has its settings and its log.'}
            </p>
          )}

          {picked.unavailableReason === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {picked.unavailableReason}.
            </p>
          )}

          {isInstallable && plan.isPending ? (
            <p role="status" className="text-ui text-foreground-subtle">
              Working out what it needs…
            </p>
          ) : null}

          {problems.length === 0 ? null : (
            <ul role="alert" className="flex flex-col gap-1 text-ui text-danger">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          {plan.error === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {toMessage(plan.error)}
            </p>
          )}

          {install.error === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {toMessage(install.error)}
            </p>
          )}

          {install.isPending ? (
            <p role="status" className="text-ui text-foreground-muted">
              Downloading and starting it. Nothing else restarts.
            </p>
          ) : null}
        </CatalogueItem>
      )}
    </CatalogueDialog>
  );
}
