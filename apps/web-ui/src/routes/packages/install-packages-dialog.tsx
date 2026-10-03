/**
 * "Install packages": the Community Hub searched in the side card, the package picked in the
 * dialog's own - what it is, where it comes from, what installing it would take - and the one
 * button.
 *
 * The search is the packet-manager's: it asks the Hub (the browser could not, the Hub's CORS
 * being for its own sites) and answers each package with what installing it here would take,
 * from the package index. The local folder's files come first, those the Hub does not list -
 * what is being tried before a release - and stay listed when the Hub cannot be asked, which
 * the side card says. Picking a package that can be installed asks the packet-manager what it
 * would take before anything is downloaded: "Also installs MQTT", or why it cannot, naming both
 * parties. Nothing restarts: the package starts once it is in, and its page, its cards and its
 * devices appear as it does.
 */
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useId, useState } from 'react';

import type { InstalledPackage, PackageListing, PackageSearchReply } from '@nebulahome/contracts';
import { Badge, Button, cn, Modal } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { shortCount } from '@/lib/format-count';
import { useDebounced } from '@/lib/use-debounced';
import { catalogueLogoUrl, PACKAGE_QUERY_KEYS, searchCatalogue } from '@/packages/api';
import { usePackageInstall } from '@/packages/use-package-install';
import { SearchField } from '@/routes/library/search-field';
import { VendorLogo } from '@/routes/library/vendor-card';

/** How long a search is trusted while the dialog is open: the Hub changes by the hour. */
const SEARCH_STALE_MS = 60_000;

/**
 * Names in a sentence: "MQTT", "MQTT and Matter", "MQTT, Matter and NVR".
 *
 * @param names - The names.
 * @returns The sentence's words.
 */
function listed(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join('');
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * The square that names a package of a search: its logo from the Hub, or a monogram in its
 * colour.
 *
 * @param props - The package, and the side of the square.
 * @param props.listing - The package.
 * @param props.size - The side, in pixels.
 * @returns The square.
 */
function ListingLogo(props: { readonly listing: PackageListing; readonly size: number }) {
  const { listing, size } = props;
  const logo = catalogueLogoUrl(listing.logo);

  return (
    <VendorLogo
      vendor={{
        name: listing.name,
        logoPadding: 0,
        ...(listing.color === null ? {} : { color: listing.color }),
        ...(logo === undefined ? {} : { logo }),
      }}
      size={size}
    />
  );
}

/**
 * Where a package of a search stands here: installed, with an update or another build out, or a
 * file of the local folder.
 *
 * @param props - The package.
 * @param props.listing - The package.
 * @returns The badges; nothing for a package of the Hub not installed.
 */
function ListingBadges(props: { readonly listing: PackageListing }) {
  const { listing } = props;

  return (
    <>
      {listing.isOfficial ? (
        <Badge tone="accent" size="small">
          Official
        </Badge>
      ) : null}
      {listing.latest?.source === 'local' ? (
        <Badge tone="warning" size="small">
          Local file
        </Badge>
      ) : null}
      {listing.installedVersion === null ? null : (
        <Badge tone={listing.hasUpdate || listing.hasNewBuild ? 'accent' : 'success'} size="small">
          {listing.hasUpdate ? 'Update out' : listing.hasNewBuild ? 'New build' : 'Installed'}
        </Badge>
      )}
    </>
  );
}

/** What the search card needs. */
type CatalogueSearchProps = {
  /** Whether the dialog is open: shut, it asks the Hub nothing. */
  readonly isOpen: boolean;

  /** The package picked, if any. */
  readonly picked: string | null;

  /** Called with the package picked. */
  readonly onPick: (listing: PackageListing) => void;
};

/**
 * The Community Hub, searched as the owner types: the side card.
 *
 * @param props - See {@link CatalogueSearchProps}.
 * @returns The card's content.
 */
function CatalogueSearch(props: CatalogueSearchProps) {
  const { isOpen, picked, onPick } = props;
  const id = useId();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 350);
  const results = useInfiniteQuery<
    PackageSearchReply,
    Error,
    InfiniteData<PackageSearchReply>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: PACKAGE_QUERY_KEYS.catalogue(query),
    enabled: isOpen,
    initialPageParam: undefined,
    staleTime: SEARCH_STALE_MS,

    /**
     * Asks the Hub, through the packet-manager.
     *
     * @param context - The page's cursor and the abort signal.
     * @param context.pageParam - The page; undefined for the first.
     * @param context.signal - Cancels the request.
     * @returns The page.
     */
    queryFn: async ({ pageParam, signal }) => searchCatalogue(query, pageParam, signal),

    /**
     * The next page's cursor.
     *
     * @param last - The last page read.
     * @returns Its cursor, or undefined on the last.
     */
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pages = results.data?.pages ?? [];
  const found = pages.flatMap((page) => page.items);
  const hubError = pages[0]?.hubError ?? null;

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border-soft p-4">
        <h3 id={`${id}-label`} className="text-title font-semibold">
          Community Hub
        </h3>
        <SearchField
          label="Search the Community Hub"
          placeholder="Search packages…"
          value={search}
          onChange={setSearch}
          className="w-full lg:w-full"
        />
        {hubError === null ? null : (
          <p role="status" className="text-caption text-warning">
            {hubError}. The local folder&apos;s files are listed still.
          </p>
        )}
      </div>

      <ul
        aria-labelledby={`${id}-label`}
        aria-busy={results.isFetching}
        className="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto p-2"
      >
        {results.isPending ? (
          <li className="px-2.5 py-3 text-ui text-foreground-subtle">Asking the Hub…</li>
        ) : results.error === null ? (
          found.length === 0 ? (
            <li className="px-2.5 py-3 text-ui text-foreground-subtle">
              {query === '' ? 'No package to offer yet.' : `No package matches “${query}”.`}
            </li>
          ) : null
        ) : (
          <li className="px-2.5 py-3 text-ui text-danger">{toMessage(results.error)}</li>
        )}
        {found.map((listing) => {
          const isPicked = listing.id === picked;

          return (
            <li key={`${listing.origin}:${listing.id}`}>
              <button
                type="button"
                aria-pressed={isPicked}
                onClick={() => {
                  onPick(listing);
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-chip px-2.5 py-2 text-left',
                  'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
                  isPicked
                    ? 'bg-primary/13 text-foreground'
                    : 'text-foreground-muted hover:bg-surface-raised/70 hover:text-foreground',
                )}
              >
                <ListingLogo listing={listing} size={32} />
                <span className="flex min-w-0 grow flex-col gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-ui font-medium text-foreground">
                      {listing.name}
                    </span>
                    <ListingBadges listing={listing} />
                  </span>
                  {listing.description === '' ? null : (
                    <span className="line-clamp-2 text-caption text-foreground-muted">
                      {listing.description}
                    </span>
                  )}
                  <span className="text-caption text-foreground-subtle tabular">
                    {listing.origin === 'local'
                      ? `${listing.category} · this installation's local folder`
                      : `${listing.category} · ${shortCount(listing.downloads)} installs · ★ ${shortCount(listing.stars)}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {results.hasNextPage ? (
          <li className="px-2.5 py-2">
            <Button
              size="compact"
              variant="ghost"
              isBusy={results.isFetchingNextPage}
              onClick={() => {
                void results.fetchNextPage();
              }}
            >
              More packages
            </Button>
          </li>
        ) : null}
      </ul>
    </>
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
  const [picked, setPicked] = useState<PackageListing | null>(null);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="large"
      title="Install packages"
      description="Packages from the Community Hub: a broker, a recorder, a music player. Nothing restarts when one goes in."
      aside={
        <CatalogueSearch
          isOpen={isOpen}
          picked={picked?.id ?? null}
          onPick={(listing) => {
            if (!install.isPending) {
              install.reset();
              setPicked(listing);
            }
          }}
        />
      }
      asideLabel="Community Hub"
      footer={
        <>
          <Button variant="ghost" disabled={install.isPending} onClick={close}>
            {picked?.installedVersion === null || picked === null ? 'Cancel' : 'Close'}
          </Button>
          {picked !== null && picked.installedVersion !== null ? (
            <Button
              onClick={() => {
                onOpen(picked.id);
              }}
            >
              Open
            </Button>
          ) : (
            <Button
              isBusy={install.isPending}
              disabled={!canInstall}
              onClick={() => {
                install.mutate();
              }}
            >
              {others.length === 0 ? 'Install' : `Install ${String(others.length + 1)} packages`}
            </Button>
          )}
        </>
      }
    >
      {picked === null ? (
        <p className="flex min-h-64 items-center justify-center text-center text-ui text-foreground-subtle">
          Pick a package on the left to see what it is and what installing it takes.
        </p>
      ) : (
        <div className="flex min-h-64 flex-col gap-4 text-ui">
          <div className="flex items-start gap-3">
            <ListingLogo listing={picked} size={48} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-title font-semibold">{picked.name}</span>
                <Badge tone="neutral" size="small">
                  {picked.category}
                </Badge>
                <ListingBadges listing={picked} />
              </span>
              <span className="text-caption text-foreground-subtle tabular">
                {[
                  picked.latest === null
                    ? picked.newestVersion === null
                      ? null
                      : `v${picked.newestVersion}`
                    : `v${picked.latest.version}`,
                  picked.repository,
                  picked.origin === 'hub'
                    ? `${shortCount(picked.downloads)} installs · ★ ${shortCount(picked.stars)}`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </span>
            </div>
          </div>

          {picked.description === '' ? null : (
            <p className="text-foreground-muted">{picked.description}</p>
          )}

          {picked.installedVersion === null ? null : (
            <p role="status" className="text-foreground">
              Version <span className="font-medium tabular">{picked.installedVersion}</span> is
              installed.{' '}
              {picked.hasUpdate || picked.hasNewBuild
                ? 'Its page has the update.'
                : 'Its page has its settings and its log.'}
            </p>
          )}

          {picked.unavailableReason === null ? null : (
            <p role="alert" className="text-danger">
              {picked.unavailableReason}.
            </p>
          )}

          {isInstallable && plan.isPending ? (
            <p role="status" className="text-foreground-subtle">
              Working out what it needs…
            </p>
          ) : null}

          {others.length === 0 ? null : (
            <p role="status" className="text-foreground">
              Also installs {listed(others.map((each) => each.name))}, which it needs.
            </p>
          )}

          {problems.length === 0 ? null : (
            <ul role="alert" className="flex flex-col gap-1 text-danger">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          {plan.error === null ? null : (
            <p role="alert" className="text-danger">
              {toMessage(plan.error)}
            </p>
          )}

          {install.error === null ? null : (
            <p role="alert" className="text-danger">
              {toMessage(install.error)}
            </p>
          )}

          {install.isPending ? (
            <p role="status" className="text-foreground-muted">
              Downloading and starting it. Nothing else restarts.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
