/**
 * Installing integrations: one dialog with two pages.
 *
 * The first page is the search across the whole dialog - the integrations folder's files first,
 * then the Community Hub's results - each a full-width row: logo, name, the official mark, one
 * line, stars, installs, who publishes it, and "Needs the internet" when it does. Picking one
 * opens its own page, "‹ Results" back: what installing it does, before anything is downloaded.
 *
 * Nothing is found on the network before an integration is installed: its devices are added from
 * its page afterwards, which is where the dialog sends the owner once the hub runs it.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationInstallReply, IntegrationListing } from '@nebulahome/contracts';
import { Button } from '@nebulahome/ui';

import { CatalogueDialog } from '@/components/catalogue/catalogue-dialog';
import { CatalogueRow, Installs, Stars } from '@/components/catalogue/catalogue-row';
import { ListingLogo } from '@/components/catalogue/listing-logo';
import { toMessage } from '@/lib/error-message';
import { integrationActionOf, needsTrust } from '@/lib/install-effects';
import { useCatalogueSearch } from '@/lib/use-catalogue-search';
import {
  fetchIntegrationDetail,
  INTEGRATION_CATALOGUE_KEYS,
  searchIntegrationCatalogue,
} from '@/library/integration-catalogue-api';
import { useIntegrationInstall } from '@/library/use-integration-install';
import { IntegrationCatalogueItem } from '@/routes/library/integration-catalogue-item';

/** What a row's line of facts needs. */
type FactsProps = {
  readonly listing: IntegrationListing;
};

/**
 * What the Hub says of an integration, under its name: stars, installs, who publishes it, and
 * whether it needs the internet.
 *
 * @param props - See {@link FactsProps}.
 * @returns The facts.
 */
function Facts(props: FactsProps) {
  const { t } = useTranslation();

  const { listing } = props;
  const owner = listing.repository?.split('/')[0];

  if (listing.origin === 'local') {
    return (
      <>
        <span>{t('library.installIntegrationsDialog.byYouLocal', 'by you · local')}</span>
        <span className="rounded-chip border border-warning-line px-1.5 font-mono text-label text-warning uppercase">
          {t('library.installIntegrationsDialog.localFile', 'Local file')}
        </span>
        {listing.hasNewBuild ? (
          <span className="text-primary">
            {t('library.installIntegrationsDialog.newBuild', 'New build')}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Stars count={listing.stars} />
      <Installs count={listing.downloads} />
      {owner === undefined ? null : (
        <span>{t('library.installIntegrationsDialog.byOwner', 'by {{owner}}', { owner })}</span>
      )}
      {listing.internetRequired === true ? (
        <span className="rounded-pill border border-warning-line px-2 text-warning">
          {t('library.installIntegrationsDialog.needsTheInternet', 'Needs the internet')}
        </span>
      ) : null}
      {listing.isBuiltIn ? (
        <span>{t('library.installIntegrationsDialog.inDevelopment', 'In development')}</span>
      ) : null}
      {listing.hasUpdate ? (
        <span className="text-primary">
          {t('library.installIntegrationsDialog.updateOut', 'Update out')}
        </span>
      ) : null}
    </>
  );
}

/** What the dialog needs. */
export type InstallIntegrationsDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** Called once the hub runs the integration installed, to open its page. */
  readonly onInstalled: (reply: IntegrationInstallReply) => void;

  /** Called to open an installed integration's page. */
  readonly onOpen: (vendorId: string) => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link InstallIntegrationsDialogProps}.
 * @returns The dialog.
 */
export function InstallIntegrationsDialog(props: InstallIntegrationsDialogProps) {
  const { t } = useTranslation();

  const { isOpen, onClose, onInstalled, onOpen } = props;
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<IntegrationListing | null>(null);
  const [isTrusted, setTrusted] = useState(false);
  const results = useCatalogueSearch({
    text: search,
    isOpen,
    keyOf: INTEGRATION_CATALOGUE_KEYS.search,
    search: searchIntegrationCatalogue,
  });
  const detail = useQuery({
    queryKey: INTEGRATION_CATALOGUE_KEYS.detail(picked?.id ?? ''),
    enabled: picked !== null && picked.origin === 'hub',
    retry: false,
    staleTime: 60_000,

    /**
     * Asks the Hub what it says of the integration.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns What it says.
     */
    queryFn: async ({ signal }) => fetchIntegrationDetail(picked?.id ?? '', signal),
  });
  const install = useIntegrationInstall((reply) => {
    setPicked(null);
    onInstalled(reply);
  });

  /**
   * Opens an integration's page, or goes back to the results.
   *
   * @param listing - The integration; null for the results.
   */
  const pick = (listing: IntegrationListing | null): void => {
    if (!install.isPending) {
      install.reset();
      setTrusted(false);
      setPicked(listing);
    }
  };

  /** Closes, unless an install is under way. */
  const close = (): void => {
    if (!install.isPending) {
      pick(null);
      onClose();
    }
  };

  const action = picked === null ? null : integrationActionOf(picked);
  const isBlocked =
    picked?.latest == null || (action?.kind === 'install' && needsTrust(picked) && !isTrusted);

  return (
    <CatalogueDialog
      isOpen={isOpen}
      onClose={close}
      title={t('library.installIntegrationsDialog.installAnIntegration', 'Install an integration')}
      subtitle={t(
        'library.installIntegrationsDialog.fromTheCommunityHub',
        'From the Community Hub, and the integrations folder on this machine',
      )}
      icon="library"
      item={
        picked === null
          ? null
          : {
              name: picked.name,
              backLabel: t('library.installIntegrationsDialog.results', 'Results'),

              /** Goes back to the results. */
              onBack: () => {
                pick(null);
              },
            }
      }
      search={search}
      onSearch={setSearch}
      searchLabel={t(
        'library.installIntegrationsDialog.searchTheCommunityHub',
        'Search the Community Hub',
      )}
      searchPlaceholder={t(
        'library.installIntegrationsDialog.searchIntegrationsBrandsModels',
        'Search integrations, brands, models',
      )}
      status={
        results.hubError === null ? (
          results.isPending ? (
            t('library.installIntegrationsDialog.askingTheHub', 'Asking the Hub…')
          ) : (
            `${String(results.items.length)}${results.hasMore ? '+' : ''} ${results.items.length === 1 ? 'result' : 'results'}${results.query === '' ? '' : ` for “${results.query}”`}`
          )
        ) : (
          <span role="status" className="text-warning">
            {t(
              'library.installIntegrationsDialog.huberrorTheLocalFolder',
              "{{hubError}}. The local folder's files are listed still.",
              { hubError: results.hubError },
            )}
          </span>
        )
      }
      footer={
        picked === null || action === null ? undefined : (
          <>
            <span />
            <div className="flex items-center gap-2.5">
              <Button variant="bare" disabled={install.isPending} onClick={close}>
                {action.kind === 'open' ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
              </Button>
              {action.kind === 'open' ? (
                <Button
                  onClick={() => {
                    onOpen(picked.id);
                  }}
                >
                  {action.label}
                </Button>
              ) : (
                <Button
                  isBusy={install.isPending}
                  disabled={isBlocked}
                  onClick={() => {
                    install.mutate({
                      vendorId: picked.id,
                      version: action.kind === 'update' ? action.version : undefined,
                    });
                  }}
                >
                  {action.label}
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
                ? t(
                    'library.installIntegrationsDialog.noIntegrationToOffer',
                    'No integration to offer yet.',
                  )
                : t(
                    'library.installIntegrationsDialog.noIntegrationMatchesQuery',
                    'No integration matches “{{query}}”.',
                    { query: results.query },
                  )}
            </p>
          ) : null}
          <ul className="flex flex-col">
            {results.items.map((listing) => (
              <CatalogueRow
                key={`${listing.origin}:${listing.id}`}
                logo={<ListingLogo listing={listing} size={48} />}
                name={listing.name}
                isOfficial={listing.isOfficial}
                description={listing.description}
                facts={<Facts listing={listing} />}
                isInstalled={
                  listing.installedVersion !== null && !listing.hasUpdate && !listing.hasNewBuild
                }
                onOpen={() => {
                  pick(listing);
                }}
              />
            ))}
          </ul>
          {results.hasMore ? (
            <Button
              variant="ghost"
              className="self-center"
              isBusy={results.isLoadingMore}
              onClick={results.loadMore}
            >
              {t('library.installIntegrationsDialog.showMore', 'Show more')}
            </Button>
          ) : null}
        </>
      ) : (
        <IntegrationCatalogueItem
          listing={picked}
          detail={detail.data}
          isTrusted={isTrusted}
          onTrustChange={setTrusted}
          error={install.error === null ? null : toMessage(install.error)}
          isInstalling={install.isPending}
        />
      )}
    </CatalogueDialog>
  );
}
